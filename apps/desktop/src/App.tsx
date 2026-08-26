import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  checkMicrophone,
  hasUsableAudio,
  listMicrophones,
  startRecording,
  type ActiveRecording,
  type Microphone,
  type Recording
} from "./lib/audio";
import {
  captureDictationTarget,
  getAutostartEnabled,
  hideSettingsWindow,
  insertText,
  insertTextAtTarget,
  isDesktopApp,
  isSettingsWindow,
  emitOverlayState,
  listenDictationHotkey,
  listenDictationCancel,
  listenOverlayState,
  listenPreferencesChanged,
  notifyPreferencesChanged,
  restoreAndTrackOverlayPosition,
  requestDictationCancel,
  setAutostartEnabled,
  setGlobalHotkey,
  setMainOverlayVisible,
  setOverlayVisible,
  startOverlayDragging,
  type HotkeyState
} from "./lib/desktop";
import {
  loadPreferences,
  savePreferences,
  type DictationPreferences
} from "./lib/preferences";
import { applyPersonalVocabulary, cleanTranscript } from "./lib/text-cleanup";
import {
  listenModelProgress,
  loadTranscriber,
  transcribeLocal,
  type ModelProgress
} from "./lib/transcriber";

type Status = "idle" | "recording" | "processing" | "ready" | "error";
type Issue = "microphone" | "model" | "audio" | "transcription" | null;
type MicrophoneStatus = "idle" | "checking" | "ready" | "error";

const AUTOSTART_INITIALIZED_KEY = "comu:autostart-initialized";

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return minutes + ":" + remainder;
}

function formatHotkey(shortcut: string): string {
  const labels: Record<string, string> = {
    Space: "Espacio",
    Super: "Windows",
    ArrowUp: "Flecha arriba",
    ArrowDown: "Flecha abajo",
    ArrowLeft: "Flecha izquierda",
    ArrowRight: "Flecha derecha"
  };
  return shortcut.split("+").map((key) => labels[key] ?? key).join(" + ");
}

function formatModelProgress(progress: ModelProgress | null, error: string): string {
  if (error) {
    return error;
  }
  if (!progress || progress.state === "missing") {
    return "Preparando el motor local...";
  }
  if (progress.state === "ready") {
    return "Motor local listo.";
  }
  if (progress.state === "error") {
    return "No se pudo preparar el motor local.";
  }
  const percent = progress.totalBytes > 0
    ? Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100))
    : 0;
  return "Descargando modelo local · " + percent + "%";
}

function hotkeyFromKeyboardEvent(event: React.KeyboardEvent<HTMLButtonElement>): string | null {
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Super" : ""
  ].filter(Boolean);

  if (modifiers.length === 0 || !event.code) {
    return null;
  }

  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) {
    key = event.code.slice(3);
  } else if (/^Digit[0-9]$/.test(event.code)) {
    key = event.code.slice(5);
  } else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
    key = event.code;
  } else {
    const allowedKeys: Record<string, string> = {
      Space: "Space",
      Enter: "Enter",
      Tab: "Tab",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Insert: "Insert",
      Delete: "Delete",
      Backspace: "Backspace",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight"
    };
    key = allowedKeys[event.code] ?? "";
  }

  return key ? [...modifiers, key].join("+") : null;
}

function describeMicrophoneError(error: unknown): string {
  const nativeMessage = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";
  const errorName = typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name
    : "";

  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    return "Windows bloqueó el acceso al micrófono. Revisa Privacidad y seguridad > Micrófono.";
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No se encontró ningún micrófono conectado.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Otra aplicación está usando el micrófono.";
  }
  return nativeMessage || "No se pudo abrir el micrófono seleccionado.";
}

function describeAppError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function DesktopOverlay({
  status,
  issue,
  errorMessage,
  message,
  elapsedMs,
  audioLevel
}: {
  status: Status;
  issue: Issue;
  errorMessage: string;
  message: string;
  elapsedMs: number;
  audioLevel: number;
}) {
  const waveShape = [0.28, 0.46, 0.68, 0.92, 0.62, 0.38, 0.58, 0.88, 0.52, 0.3, 0.48, 0.78, 0.58, 0.34, 0.5, 0.76, 0.46, 0.26];
  const hint = message || (status === "recording"
    ? formatDuration(elapsedMs) + " · Escuchando"
    : status === "processing"
      ? "Transcribiendo..."
      : issue === "microphone"
        ? "Micrófono no disponible · Revisar configuración"
        : issue === "model"
          ? "No se pudo preparar el modelo local"
          : issue === "audio"
            ? "No se detectó voz"
            : issue === "transcription"
              ? "No se pudo transcribir"
              : "Listo");

  return (
    <main
      className={"desktop-overlay overlay-" + (issue ?? status)}
      role="status"
      aria-live="polite"
      aria-label={errorMessage || message || hint}
      onMouseDown={(event) => {
        if (event.button === 0) {
          void startOverlayDragging();
        }
      }}
    >
      {status !== "idle" ? (
        <button
          className="overlay-cancel"
          type="button"
          title="Cancelar dictado"
          aria-label="Cancelar dictado"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (status === "recording") {
              void requestDictationCancel();
            }
            void setOverlayVisible(false);
          }}
        >
          ×
        </button>
      ) : null}
      <div className={"waveform " + (status === "recording" ? "waveform-live" : "")} aria-label="Nivel de audio">
        {waveShape.map((height, index) => {
          const scaledHeight = Math.max(0.12, Math.min(1, height * (0.3 + audioLevel * 1.8)));
          return <span key={index} className="wave-bar" style={{ "--wave-height": scaledHeight } as CSSProperties} />;
        })}
      </div>
      <p className="overlay-hint">{hint}</p>
    </main>
  );
}

function DictationOverlayApp() {
  const preferences = useRef<DictationPreferences>(loadPreferences());
  const [status, setStatus] = useState<Status>("ready");
  const [issue, setIssue] = useState<Issue>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [overlayMessage, setOverlayMessage] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const activeRecording = useRef<ActiveRecording | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const levelFrame = useRef<number | undefined>(undefined);
  const beginRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const finishRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    document.documentElement.classList.add("compact-desktop");
    let disposed = false;
    let stopTracking: (() => void) | undefined;
    void restoreAndTrackOverlayPosition().then((stop) => {
      if (disposed) {
        stop();
      } else {
        stopTracking = stop;
      }
    });

    return () => {
      disposed = true;
      document.documentElement.classList.remove("compact-desktop");
      stopTracking?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void listenPreferencesChanged((nextPreferences) => {
      preferences.current = nextPreferences;
    }).then((stop) => {
      if (disposed) {
        stop?.();
      } else {
        stopListening = stop;
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void listenOverlayState((nextState) => {
      setStatus(nextState.status);
      setIssue(nextState.issue ?? null);
      setErrorMessage(nextState.errorMessage ?? "");
      setOverlayMessage(nextState.message ?? "");
      setElapsedMs(nextState.elapsedMs ?? 0);
      setAudioLevel(nextState.audioLevel ?? 0);
    }).then((stop) => {
      if (disposed) {
        stop?.();
      } else {
        stopListening = stop;
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
      if (timer.current) {
        window.clearInterval(timer.current);
      }
      if (levelFrame.current) {
        window.cancelAnimationFrame(levelFrame.current);
      }
    };
  }, []);

  async function beginRecording() {
    if (activeRecording.current || status === "processing") {
      return;
    }

    setIssue(null);
    setErrorMessage("");
    setElapsedMs(0);
    setStatus("recording");

    try {
      await setOverlayVisible(true);
      await new Promise((resolve) => window.setTimeout(resolve, 150));

      const latestPreferences = preferences.current;
      const recording = await startRecording(latestPreferences.microphoneId || undefined);
      activeRecording.current = recording;

      const updateLevel = () => {
        if (!activeRecording.current) {
          setAudioLevel(0);
          return;
        }
        setAudioLevel(activeRecording.current.getLevel());
        levelFrame.current = window.requestAnimationFrame(updateLevel);
      };
      levelFrame.current = window.requestAnimationFrame(updateLevel);

      const startedAt = performance.now();
      timer.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAt);
      }, 100);
    } catch (error) {
      setIssue("microphone");
      setErrorMessage(describeMicrophoneError(error));
      setStatus("error");
    }
  }

  async function finishRecording() {
    if (!activeRecording.current) {
      return;
    }

    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = undefined;
    }
    if (levelFrame.current) {
      window.cancelAnimationFrame(levelFrame.current);
      levelFrame.current = undefined;
    }
    setAudioLevel(0);
    setStatus("processing");

    let keepOverlayVisible = false;
    try {
      const recording = await activeRecording.current.stop();
      activeRecording.current = null;
      const audio = recording.audio;

      if (!hasUsableAudio(audio)) {
        setIssue("audio");
        setErrorMessage("No se detectó voz en la grabación.");
        setStatus("error");
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        return;
      }

      const currentPreferences = preferences.current;
      const rawText = await transcribeLocal(audio, currentPreferences.language, currentPreferences.quality);
      const transcript = applyPersonalVocabulary(cleanTranscript(rawText), currentPreferences.vocabulary);

      if (!transcript) {
        setIssue("audio");
        setErrorMessage("No se detectaron palabras.");
        setStatus("error");
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 60));
      await insertText(transcript);
      setIssue(null);
      setErrorMessage("");
      setStatus("ready");
    } catch (error) {
      keepOverlayVisible = true;
      activeRecording.current = null;
      setIssue("transcription");
      setErrorMessage(describeAppError(error, "No se pudo transcribir el audio."));
      setStatus("error");
    } finally {
      if (!keepOverlayVisible) {
        try {
          await setOverlayVisible(false);
        } catch {
          // The process may be closing from the tray menu.
        }
      }
    }
  }

  beginRecordingRef.current = beginRecording;
  finishRecordingRef.current = finishRecording;

  return (
    <DesktopOverlay
      status={status}
      issue={issue}
      errorMessage={errorMessage}
      message={overlayMessage}
      elapsedMs={elapsedMs}
      audioLevel={audioLevel}
    />
  );
}

function SettingsPanel({ desktopMode }: { desktopMode: boolean }) {
  const [preferences, setPreferences] = useState<DictationPreferences>(() => loadPreferences());
  const preferencesRef = useRef(preferences);
  const recordingPromise = useRef<ReturnType<typeof startRecording> | null>(null);
  const recordingTimer = useRef<number | undefined>(undefined);
  const isProcessing = useRef(false);
  const isStarting = useRef(false);
  const capturingHotkeyRef = useRef(false);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("idle");
  const [microphoneMessage, setMicrophoneMessage] = useState("Selecciona el dispositivo que usará el atajo.");
  const [autostart, setAutostart] = useState(false);
  const [autostartReady, setAutostartReady] = useState(!desktopMode);
  const [autostartMessage, setAutostartMessage] = useState("");
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotkeyMessage, setHotkeyMessage] = useState("");
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null);
  const [modelError, setModelError] = useState("");

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    void setGlobalHotkey(preferencesRef.current.hotkey).catch((error) => {
      setHotkeyMessage(error instanceof Error ? error.message : "No se pudo activar el atajo guardado.");
    });
  }, [desktopMode]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    setModelError("");
    void loadTranscriber(preferences.quality, setModelProgress).catch((error) => {
      setModelError(describeAppError(error, "No se pudo preparar el motor local."));
    });
  }, [desktopMode, preferences.quality]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listenModelProgress((progress) => {
      if (progress.quality === preferencesRef.current.quality) {
        setModelProgress(progress);
        if (progress.state !== "error") {
          setModelError("");
        }
      }
    }).then((stop) => {
      if (disposed) {
        stop?.();
      } else {
        stopListening = stop;
      }
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [desktopMode]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    let disposed = false;
    let stopListening: (() => void) | undefined;
    let stopCancelListening: (() => void) | undefined;

    const beginBackgroundRecording = async () => {
      if (recordingPromise.current || isProcessing.current || isStarting.current) {
        return;
      }

      isStarting.current = true;
      try {
        await captureDictationTarget();
      } catch {
        // Dictation can continue; insertion will fall back to the clipboard.
      }
      if (disposed) {
        isStarting.current = false;
        return;
      }

      const startedAt = performance.now();
      void setMainOverlayVisible(true);
      void emitOverlayState({ status: "recording", elapsedMs: 0, audioLevel: 0 });
      const pending = startRecording(preferencesRef.current.microphoneId || undefined);
      recordingPromise.current = pending;
      isStarting.current = false;

      void pending
        .then((recording) => {
          if (recordingPromise.current !== pending) {
            return;
          }
          recordingTimer.current = window.setInterval(() => {
            void emitOverlayState({
              status: "recording",
              elapsedMs: performance.now() - startedAt,
              audioLevel: recording.getLevel()
            });
          }, 80);
        })
        .catch((error) => {
          if (recordingPromise.current === pending) {
            recordingPromise.current = null;
            void emitOverlayState({
              status: "error",
              issue: "microphone",
              errorMessage: describeMicrophoneError(error)
            });
            window.setTimeout(() => void setMainOverlayVisible(false), 1800);
          }
        });
    };

    const cancelBackgroundRecording = async () => {
      const pending = recordingPromise.current;
      recordingPromise.current = null;
      isStarting.current = false;
      if (recordingTimer.current) {
        window.clearInterval(recordingTimer.current);
        recordingTimer.current = undefined;
      }

      await setMainOverlayVisible(false);
      if (!pending) {
        return;
      }

      isProcessing.current = true;
      try {
        const recording = await pending;
        recording.cancel();
      } catch {
        // A denied or disconnected microphone has nothing left to cancel.
      } finally {
        isProcessing.current = false;
      }
    };

    const finishBackgroundRecording = async () => {
      const pending = recordingPromise.current;
      if (!pending) {
        return;
      }
      recordingPromise.current = null;
      isProcessing.current = true;
      if (recordingTimer.current) {
        window.clearInterval(recordingTimer.current);
        recordingTimer.current = undefined;
      }
      await emitOverlayState({ status: "processing" });

      try {
        const recording = await pending;
        const result = await recording.stop();
        if (!hasUsableAudio(result.audio)) {
          await emitOverlayState({ status: "error", issue: "audio", errorMessage: "No se detectó voz." });
          window.setTimeout(() => void setMainOverlayVisible(false), 1400);
          return;
        }

        const currentPreferences = preferencesRef.current;
        const rawText = await transcribeLocal(result.audio, currentPreferences.language, currentPreferences.quality);
        const transcript = applyPersonalVocabulary(cleanTranscript(rawText), currentPreferences.vocabulary);
        if (!transcript) {
          await emitOverlayState({ status: "error", issue: "audio", errorMessage: "No se detectaron palabras." });
          window.setTimeout(() => void setMainOverlayVisible(false), 1400);
          return;
        }

        const insertion = await insertTextAtTarget(transcript + " ");
        if (insertion.inserted) {
          await emitOverlayState({ status: "ready" });
          window.setTimeout(() => void setMainOverlayVisible(false), 450);
        } else {
          await emitOverlayState({ status: "ready", message: "Texto listo · Ctrl+V" });
          window.setTimeout(() => void setMainOverlayVisible(false), 2200);
        }
      } catch (error) {
        await emitOverlayState({
          status: "error",
          issue: "transcription",
          errorMessage: describeAppError(error, "No se pudo completar el dictado.")
        });
        window.setTimeout(() => void setMainOverlayVisible(false), 1800);
      } finally {
        isProcessing.current = false;
      }
    };

    void listenDictationHotkey((state: HotkeyState) => {
      if (capturingHotkeyRef.current || isProcessing.current) {
        return;
      }

      if (preferencesRef.current.dictationMode === "toggle") {
        if (state === "Pressed") {
          if (recordingPromise.current) {
            void finishBackgroundRecording();
          } else {
            void beginBackgroundRecording();
          }
        }
      } else if (state === "Pressed") {
        void beginBackgroundRecording();
      } else {
        void finishBackgroundRecording();
      }
    }).then((stop) => {
      if (disposed) {
        stop?.();
      } else {
        stopListening = stop;
      }
    });

    void listenDictationCancel(() => {
      void cancelBackgroundRecording();
    }).then((stop) => {
      if (disposed) {
        stop?.();
      } else {
        stopCancelListening = stop;
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
      stopCancelListening?.();
      if (recordingTimer.current) {
        window.clearInterval(recordingTimer.current);
      }
    };
  }, [desktopMode]);

  async function refreshMicrophones() {
    try {
      const available = await listMicrophones();
      setMicrophones(available);
      const stored = loadPreferences();
      if (stored.microphoneId && available.length > 0 && !available.some((microphone) => microphone.id === stored.microphoneId)) {
        updatePreferences({ ...stored, microphoneId: "" });
        setMicrophoneMessage("El dispositivo anterior ya no existe. Se usará el predeterminado de Windows.");
      }
    } catch (error) {
      setMicrophones([]);
      setMicrophoneStatus("error");
      setMicrophoneMessage(describeMicrophoneError(error));
    }
  }

  useEffect(() => {
    void refreshMicrophones();
    if (desktopMode) {
      const initializeAutostart = async () => {
        try {
          let enabled = await getAutostartEnabled();
          if (!window.localStorage.getItem(AUTOSTART_INITIALIZED_KEY)) {
            if (!enabled) {
              await setAutostartEnabled(true);
            }
            enabled = await getAutostartEnabled();
            if (enabled) {
              window.localStorage.setItem(AUTOSTART_INITIALIZED_KEY, "true");
            }
          }
          setAutostart(enabled);
          setAutostartMessage(enabled ? "" : "No se pudo activar el inicio automático.");
        } catch {
          setAutostart(false);
          setAutostartMessage("Windows no permitió configurar el inicio automático.");
        } finally {
          setAutostartReady(true);
        }
      };
      void initializeAutostart();
    }
  }, [desktopMode]);

  function updatePreferences(nextPreferences: DictationPreferences) {
    setPreferences(nextPreferences);
    savePreferences(nextPreferences);
    void notifyPreferencesChanged(nextPreferences);
    setMicrophoneStatus("idle");
    setMicrophoneMessage("Configuración guardada.");
  }

  async function testSelectedMicrophone() {
    setMicrophoneStatus("checking");
    setMicrophoneMessage("Comprobando acceso...");
    try {
      await checkMicrophone(preferences.microphoneId || undefined);
      setMicrophoneStatus("ready");
      setMicrophoneMessage("Micrófono disponible.");
      await refreshMicrophones();
    } catch (error) {
      setMicrophoneStatus("error");
      setMicrophoneMessage(describeMicrophoneError(error));
    }
  }

  async function updateAutostart(enabled: boolean) {
    setAutostartReady(false);
    setAutostartMessage("");
    try {
      await setAutostartEnabled(enabled);
      const verified = await getAutostartEnabled();
      setAutostart(verified);
      if (verified !== enabled) {
        setAutostartMessage("Windows no aplicó el cambio solicitado.");
      } else {
        window.localStorage.setItem(AUTOSTART_INITIALIZED_KEY, "true");
      }
    } catch {
      setAutostart(await getAutostartEnabled().catch(() => !enabled));
      setAutostartMessage("No se pudo cambiar el inicio automático.");
    } finally {
      setAutostartReady(true);
    }
  }

  async function captureHotkey(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = hotkeyFromKeyboardEvent(event);
    if (!shortcut) {
      setHotkeyMessage("Usa Ctrl, Alt o Windows junto con otra tecla.");
      return;
    }

    try {
      const registered = await setGlobalHotkey(shortcut);
      updatePreferences({ ...preferencesRef.current, hotkey: registered });
      setHotkeyMessage("Atajo actualizado.");
      setIsCapturingHotkey(false);
      capturingHotkeyRef.current = false;
    } catch (error) {
      setHotkeyMessage(error instanceof Error ? error.message : "Ese atajo no está disponible.");
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <p className="eyebrow">Comu</p>
          <h1>Configuración</h1>
        </div>
        {desktopMode ? (
          <button className="icon-button" type="button" onClick={() => void hideSettingsWindow()} aria-label="Ocultar configuración" title="Ocultar">
            ×
          </button>
        ) : null}
      </header>

      <section className="settings-section" aria-labelledby="voice-settings-title">
        <div className="section-heading">
          <h2 id="voice-settings-title">Dictado</h2>
          <span className="saved-state">Se guarda automáticamente</span>
        </div>

        <label className="setting-field" htmlFor="language">
          <span>Idioma</span>
          <select
            id="language"
            value={preferences.language}
            onChange={(event) => updatePreferences({
              ...preferences,
              language: event.target.value === "en" ? "en" : "es"
            })}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="setting-field" htmlFor="microphone">
          <span>Micrófono</span>
          <select
            id="microphone"
            value={preferences.microphoneId}
            onChange={(event) => updatePreferences({ ...preferences, microphoneId: event.target.value })}
          >
            <option value="">Predeterminado del sistema</option>
            {microphones.map((microphone) => (
              <option key={microphone.id} value={microphone.id}>{microphone.label}</option>
            ))}
          </select>
        </label>

        <label className="setting-field" htmlFor="quality">
          <span>Calidad</span>
          <select
            id="quality"
            value={preferences.quality}
            onChange={(event) => updatePreferences({
              ...preferences,
              quality: event.target.value === "fast" ? "fast" : "accurate"
            })}
          >
            <option value="accurate">Alta precisión</option>
            <option value="fast">Rápida</option>
          </select>
        </label>

        {desktopMode ? (
          <div className={"model-status model-" + (modelProgress?.state ?? "missing")} role="status">
            <span className="check-dot" aria-hidden="true" />
            <span>{formatModelProgress(modelProgress, modelError)}</span>
          </div>
        ) : null}

        <label className="setting-field" htmlFor="vocabulary">
          <span>Correcciones</span>
          <input
            id="vocabulary"
            type="text"
            value={preferences.vocabulary}
            placeholder="incorrecta=correcta, otra=corrección"
            onChange={(event) => updatePreferences({ ...preferences, vocabulary: event.target.value })}
          />
        </label>

        <div className="microphone-check">
          <div className={"check-message check-" + microphoneStatus} role="status">
            <span className="check-dot" aria-hidden="true" />
            <span>{microphoneMessage}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => void testSelectedMicrophone()} disabled={microphoneStatus === "checking"}>
            {microphoneStatus === "checking" ? "Comprobando..." : "Comprobar"}
          </button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="app-settings-title">
        <h2 id="app-settings-title">Aplicación</h2>

        <div className="setting-row">
          <div>
            <span className="setting-label">Atajo de dictado</span>
            <span className="setting-description">Haz clic y pulsa la nueva combinación.</span>
            {hotkeyMessage ? <span className="setting-message" role="status">{hotkeyMessage}</span> : null}
          </div>
          <button
            className={"hotkey-button" + (isCapturingHotkey ? " hotkey-capturing" : "")}
            type="button"
            onClick={() => {
              capturingHotkeyRef.current = true;
              setIsCapturingHotkey(true);
              setHotkeyMessage("Pulsa la nueva combinación.");
            }}
            onBlur={() => {
              capturingHotkeyRef.current = false;
              setIsCapturingHotkey(false);
            }}
            onKeyDown={(event) => void captureHotkey(event)}
          >
            {isCapturingHotkey ? "Esperando teclas..." : formatHotkey(preferences.hotkey)}
          </button>
        </div>

        <label className="setting-field mode-field" htmlFor="dictation-mode">
          <span>Activación</span>
          <select
            id="dictation-mode"
            value={preferences.dictationMode}
            onChange={(event) => updatePreferences({
              ...preferences,
              dictationMode: event.target.value === "hold" ? "hold" : "toggle"
            })}
          >
            <option value="toggle">Pulsar para iniciar y detener</option>
            <option value="hold">Mantener presionado</option>
          </select>
        </label>

        {desktopMode ? (
          <label className="setting-row toggle-row">
            <div>
              <span className="setting-label">Iniciar con Windows</span>
              <span className="setting-description">
                {autostartMessage || "Deja el dictado listo en segundo plano."}
              </span>
            </div>
            <input
              type="checkbox"
              checked={autostart}
              disabled={!autostartReady}
              onChange={(event) => void updateAutostart(event.target.checked)}
            />
          </label>
        ) : null}
      </section>

      <p className="settings-footer">El audio y la transcripción permanecen en este equipo.</p>
    </main>
  );
}

function App() {
  const desktopMode = isDesktopApp();
  if (desktopMode && !isSettingsWindow()) {
    return <DictationOverlayApp />;
  }
  return <SettingsPanel desktopMode={desktopMode} />;
}

export default App;
