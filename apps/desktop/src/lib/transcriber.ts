import type { TranscriptionQuality } from "./preferences";
import { isDesktopApp } from "./desktop";

export type ModelProgress = {
  quality: TranscriptionQuality;
  state: "missing" | "downloading" | "ready" | "error";
  downloadedBytes: number;
  totalBytes: number;
};

type NativeTranscription = {
  text: string;
  jobId: string;
  elapsedMs: number;
  quality: TranscriptionQuality;
};

const MODEL_NAMES: Record<TranscriptionQuality, string> = {
  accurate: "Whisper small Q5",
  fast: "Whisper base Q5"
};

export function modelName(quality: TranscriptionQuality = "accurate"): string {
  return MODEL_NAMES[quality];
}

export async function modelStatus(quality: TranscriptionQuality): Promise<ModelProgress> {
  if (!isDesktopApp()) {
    return { quality, state: "missing", downloadedBytes: 0, totalBytes: 0 };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ModelProgress>("model_status", { quality });
}

export async function loadTranscriber(
  quality: TranscriptionQuality = "accurate",
  onProgress?: (progress: ModelProgress) => void
): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const current = await modelStatus(quality);
  onProgress?.(current);
  if (current.state === "ready") {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const ready = await invoke<ModelProgress>("ensure_model", { quality });
  onProgress?.(ready);
}

export async function listenModelProgress(
  handler: (progress: ModelProgress) => void
): Promise<(() => void) | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ModelProgress>("dictation:model-progress", (event) => handler(event.payload));
}

export async function transcribeLocal(
  audio: Float32Array,
  language: "es" | "en",
  quality: TranscriptionQuality = "accurate"
): Promise<string> {
  if (!isDesktopApp()) {
    throw new Error("La transcripción nativa solo está disponible en la aplicación instalada.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<NativeTranscription>("transcribe_local", {
    wavBase64: encodeMono16kWav(audio),
    language,
    quality
  });
  return result.text.trim();
}

function encodeMono16kWav(audio: Float32Array): string {
  const bytes = new Uint8Array(44 + audio.length * 2);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + audio.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, audio.length * 2, true);

  for (let index = 0; index < audio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, audio[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
