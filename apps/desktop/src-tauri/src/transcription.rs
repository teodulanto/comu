use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{header::RANGE, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_WAV_BYTES: usize = 256 * 1024 * 1024;

pub struct ModelManager {
    downloading: Mutex<HashSet<String>>,
}

impl Default for ModelManager {
    fn default() -> Self {
        Self {
            downloading: Mutex::new(HashSet::new()),
        }
    }
}

#[derive(Clone, Copy)]
struct ModelSpec {
    quality: &'static str,
    file_name: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
}

const ACCURATE_MODEL: ModelSpec = ModelSpec {
  quality: "accurate",
  file_name: "ggml-small-q5_1.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin?download=true",
  sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
  size: 190_085_487
};

const FAST_MODEL: ModelSpec = ModelSpec {
    quality: "fast",
    file_name: "ggml-base-q5_1.bin",
    url:
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin?download=true",
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    size: 59_707_625,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    quality: String,
    state: String,
    downloaded_bytes: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    text: String,
    job_id: String,
    elapsed_ms: u128,
    quality: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobMetadata<'a> {
    job_id: &'a str,
    state: &'a str,
    quality: &'a str,
    language: &'a str,
    elapsed_ms: Option<u128>,
    error: Option<&'a str>,
}

fn model_spec(quality: &str) -> ModelSpec {
    if quality == "fast" {
        FAST_MODEL
    } else {
        ACCURATE_MODEL
    }
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de datos: {error}"))?
        .join("models");
    fs::create_dir_all(&path)
        .map_err(|error| format!("No se pudo crear la carpeta de modelos: {error}"))?;
    Ok(path)
}

fn jobs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de datos: {error}"))?
        .join("jobs");
    fs::create_dir_all(&path)
        .map_err(|error| format!("No se pudo crear la carpeta de trabajos: {error}"))?;
    Ok(path)
}

fn marker_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("bin.sha256")
}

fn model_is_ready(model_path: &Path, spec: ModelSpec) -> bool {
    let size_matches = model_path
        .metadata()
        .map(|metadata| metadata.len() == spec.size)
        .unwrap_or(false);
    let marker_matches = fs::read_to_string(marker_path(model_path))
        .map(|value| value.trim().eq_ignore_ascii_case(spec.sha256))
        .unwrap_or(false);
    size_matches && marker_matches
}

fn current_status(
    app: &AppHandle,
    manager: &ModelManager,
    spec: ModelSpec,
) -> Result<ModelStatus, String> {
    let model_path = models_dir(app)?.join(spec.file_name);
    let downloaded_bytes = model_path
        .with_extension("bin.part")
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let downloading = manager
        .downloading
        .lock()
        .map_err(|_| "No se pudo consultar el estado del modelo.".to_string())?
        .contains(spec.quality);

    Ok(ModelStatus {
        quality: spec.quality.to_string(),
        state: if model_is_ready(&model_path, spec) {
            "ready"
        } else if downloading {
            "downloading"
        } else {
            "missing"
        }
        .to_string(),
        downloaded_bytes,
        total_bytes: spec.size,
    })
}

fn emit_model_status(app: &AppHandle, status: &ModelStatus) {
    let _ = app.emit("dictation:model-progress", status);
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("No se pudo verificar el modelo: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("No se pudo verificar el modelo: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn download_model(
    app: &AppHandle,
    spec: ModelSpec,
    destination: &Path,
) -> Result<(), String> {
    let partial = destination.with_extension("bin.part");
    let mut existing = partial
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if existing > spec.size {
        fs::remove_file(&partial)
            .map_err(|error| format!("No se pudo reiniciar la descarga: {error}"))?;
        existing = 0;
    }

    if existing == spec.size {
        let actual_hash = sha256_file(&partial)?;
        if actual_hash.eq_ignore_ascii_case(spec.sha256) {
            if destination.exists() {
                fs::remove_file(destination).map_err(|error| {
                    format!("No se pudo reemplazar el modelo anterior: {error}")
                })?;
            }
            fs::rename(&partial, destination)
                .map_err(|error| format!("No se pudo activar el modelo: {error}"))?;
            fs::write(marker_path(destination), spec.sha256).map_err(|error| {
                format!("No se pudo registrar la verificación del modelo: {error}")
            })?;
            return Ok(());
        }
        fs::remove_file(&partial)
            .map_err(|error| format!("No se pudo reiniciar una descarga inválida: {error}"))?;
        existing = 0;
    }

    let client = reqwest::Client::builder()
        .user_agent(concat!("comu/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("No se pudo preparar la descarga: {error}"))?;
    let mut request = client.get(spec.url);
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("No se pudo descargar el modelo: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "El servidor del modelo respondió con {}.",
            response.status()
        ));
    }

    let append = existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    if !append {
        existing = 0;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial)
        .map_err(|error| format!("No se pudo guardar el modelo: {error}"))?;
    let mut downloaded = existing;
    let mut last_emitted = downloaded;

    emit_model_status(
        app,
        &ModelStatus {
            quality: spec.quality.to_string(),
            state: "downloading".to_string(),
            downloaded_bytes: downloaded,
            total_bytes: spec.size,
        },
    );

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("La descarga se interrumpió: {error}"))?
    {
        file.write_all(&chunk)
            .map_err(|error| format!("No se pudo guardar el modelo: {error}"))?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_emitted) >= 1024 * 1024 || downloaded >= spec.size {
            last_emitted = downloaded;
            emit_model_status(
                app,
                &ModelStatus {
                    quality: spec.quality.to_string(),
                    state: "downloading".to_string(),
                    downloaded_bytes: downloaded.min(spec.size),
                    total_bytes: spec.size,
                },
            );
        }
    }
    file.sync_all()
        .map_err(|error| format!("No se pudo finalizar el modelo: {error}"))?;
    drop(file);

    if downloaded != spec.size {
        return Err(format!(
            "La descarga quedó incompleta: {downloaded} de {} bytes.",
            spec.size
        ));
    }
    let actual_hash = sha256_file(&partial)?;
    if !actual_hash.eq_ignore_ascii_case(spec.sha256) {
        let _ = fs::remove_file(&partial);
        return Err("El modelo descargado no superó la verificación de integridad.".to_string());
    }

    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("No se pudo reemplazar el modelo anterior: {error}"))?;
    }
    fs::rename(&partial, destination)
        .map_err(|error| format!("No se pudo activar el modelo: {error}"))?;
    fs::write(marker_path(destination), spec.sha256)
        .map_err(|error| format!("No se pudo registrar la verificación del modelo: {error}"))?;
    Ok(())
}

async fn ensure_model_ready(
    app: &AppHandle,
    manager: &ModelManager,
    quality: &str,
) -> Result<PathBuf, String> {
    let spec = model_spec(quality);
    let destination = models_dir(app)?.join(spec.file_name);
    if model_is_ready(&destination, spec) {
        return Ok(destination);
    }

    {
        let mut downloading = manager
            .downloading
            .lock()
            .map_err(|_| "No se pudo preparar el modelo local.".to_string())?;
        if !downloading.insert(spec.quality.to_string()) {
            return Err(
                "El modelo local todavía se está preparando. Intenta nuevamente en unos segundos."
                    .to_string(),
            );
        }
    }

    let result = download_model(app, spec, &destination).await;
    if let Ok(mut downloading) = manager.downloading.lock() {
        downloading.remove(spec.quality);
    }

    match result {
        Ok(()) => {
            emit_model_status(
                app,
                &ModelStatus {
                    quality: spec.quality.to_string(),
                    state: "ready".to_string(),
                    downloaded_bytes: spec.size,
                    total_bytes: spec.size,
                },
            );
            Ok(destination)
        }
        Err(error) => {
            emit_model_status(
                app,
                &ModelStatus {
                    quality: spec.quality.to_string(),
                    state: "error".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: spec.size,
                },
            );
            Err(error)
        }
    }
}

fn whisper_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| format!("No se pudo localizar el motor local: {error}"))?
        .join("resources")
        .join("whisper");
    if bundled.join("whisper-cli.exe").exists() {
        return Ok(bundled);
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("whisper");
    if development.join("whisper-cli.exe").exists() {
        return Ok(development);
    }
    Err("No se encontró el motor whisper.cpp dentro de la instalación.".to_string())
}

fn job_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("dictation-{millis}")
}

fn write_metadata(path: &Path, metadata: &JobMetadata<'_>) -> Result<(), String> {
    let value = serde_json::to_vec_pretty(metadata)
        .map_err(|error| format!("No se pudo registrar el trabajo: {error}"))?;
    fs::write(path, value).map_err(|error| format!("No se pudo registrar el trabajo: {error}"))
}

fn run_whisper(
    runtime_dir: &Path,
    model_path: &Path,
    wav_path: &Path,
    output_base: &Path,
    language: &str,
    quality: &str,
) -> Result<(), String> {
    let executable = runtime_dir.join("whisper-cli.exe");
    let mut command = Command::new(executable);
    command
        .current_dir(runtime_dir)
        .arg("--model")
        .arg(model_path)
        .arg("--file")
        .arg(wav_path)
        .arg("--language")
        .arg(if language == "en" { "en" } else { "es" })
        .arg("--threads")
        .arg("4")
        .arg("--no-gpu")
        .arg("--output-txt")
        .arg("--output-json-full")
        .arg("--output-file")
        .arg(output_base)
        .arg("--no-prints");

    if quality == "fast" {
        command
            .arg("--vad")
            .arg("--vad-model")
            .arg(runtime_dir.join("ggml-silero-v6.2.0.bin"))
            .arg("--vad-threshold")
            .arg("0.35")
            .arg("--vad-min-speech-duration-ms")
            .arg("100")
            .arg("--vad-min-silence-duration-ms")
            .arg("500")
            .arg("--vad-max-speech-duration-s")
            .arg("28")
            .arg("--vad-speech-pad-ms")
            .arg("250")
            .arg("--vad-samples-overlap")
            .arg("0.25");
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("No se pudo iniciar whisper.cpp: {error}"))?;
    fs::write(output_base.with_extension("log"), &output.stderr)
        .map_err(|error| format!("No se pudo guardar el registro del motor: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "whisper.cpp terminó con un error: {}",
            detail.trim()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn model_status(
    app: AppHandle,
    manager: State<'_, ModelManager>,
    quality: String,
) -> Result<ModelStatus, String> {
    current_status(&app, &manager, model_spec(&quality))
}

#[tauri::command]
pub async fn ensure_model(
    app: AppHandle,
    manager: State<'_, ModelManager>,
    quality: String,
) -> Result<ModelStatus, String> {
    ensure_model_ready(&app, &manager, &quality).await?;
    current_status(&app, &manager, model_spec(&quality))
}

#[tauri::command]
pub async fn transcribe_local(
    app: AppHandle,
    manager: State<'_, ModelManager>,
    wav_base64: String,
    language: String,
    quality: String,
) -> Result<TranscriptionResult, String> {
    let model_path = ensure_model_ready(&app, &manager, &quality).await?;
    let runtime_dir = whisper_runtime_dir(&app)?;
    let wav = BASE64
        .decode(wav_base64)
        .map_err(|_| "El audio recibido no es válido.".to_string())?;
    if wav.len() < 44
        || wav.len() > MAX_WAV_BYTES
        || &wav[0..4] != b"RIFF"
        || &wav[8..12] != b"WAVE"
    {
        return Err("El audio recibido no tiene un formato WAV válido.".to_string());
    }

    let id = job_id();
    let directory = jobs_dir(&app)?.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear el trabajo local: {error}"))?;
    let wav_path = directory.join("audio.wav");
    let partial_wav = directory.join("audio.wav.part");
    fs::write(&partial_wav, wav)
        .map_err(|error| format!("No se pudo guardar el audio: {error}"))?;
    fs::rename(&partial_wav, &wav_path)
        .map_err(|error| format!("No se pudo confirmar el audio guardado: {error}"))?;

    let metadata_path = directory.join("job.json");
    write_metadata(
        &metadata_path,
        &JobMetadata {
            job_id: &id,
            state: "processing",
            quality: &quality,
            language: &language,
            elapsed_ms: None,
            error: None,
        },
    )?;

    let output_base = directory.join("transcript");
    let started = Instant::now();
    let runtime_for_process = runtime_dir.clone();
    let model_for_process = model_path.clone();
    let wav_for_process = wav_path.clone();
    let output_for_process = output_base.clone();
    let language_for_process = language.clone();
    let quality_for_process = quality.clone();
    let process_result = tauri::async_runtime::spawn_blocking(move || {
        run_whisper(
            &runtime_for_process,
            &model_for_process,
            &wav_for_process,
            &output_for_process,
            &language_for_process,
            &quality_for_process,
        )
    })
    .await
    .map_err(|error| format!("El proceso de transcripción se interrumpió: {error}"))?;

    let elapsed_ms = started.elapsed().as_millis();
    if let Err(error) = process_result {
        let _ = write_metadata(
            &metadata_path,
            &JobMetadata {
                job_id: &id,
                state: "error",
                quality: &quality,
                language: &language,
                elapsed_ms: Some(elapsed_ms),
                error: Some(&error),
            },
        );
        return Err(format!("{error} El audio quedó guardado para recuperarlo."));
    }

    let text_bytes = fs::read(output_base.with_extension("txt"))
        .map_err(|error| format!("El motor terminó sin entregar texto: {error}"))?;
    let text = String::from_utf8_lossy(&text_bytes).trim().to_string();
    if text
        .chars()
        .filter(|character| character.is_alphabetic())
        .count()
        < 2
    {
        let error = "El motor no reconoció palabras. El audio quedó guardado para reintentar.";
        let _ = write_metadata(
            &metadata_path,
            &JobMetadata {
                job_id: &id,
                state: "error",
                quality: &quality,
                language: &language,
                elapsed_ms: Some(elapsed_ms),
                error: Some(error),
            },
        );
        return Err(error.to_string());
    }

    write_metadata(
        &metadata_path,
        &JobMetadata {
            job_id: &id,
            state: "complete",
            quality: &quality,
            language: &language,
            elapsed_ms: Some(elapsed_ms),
            error: None,
        },
    )?;
    let _ = fs::remove_file(&wav_path);

    Ok(TranscriptionResult {
        text,
        job_id: id,
        elapsed_ms,
        quality,
    })
}
