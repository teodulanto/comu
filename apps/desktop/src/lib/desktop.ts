import type { DictationPreferences } from "./preferences";

export type HotkeyState = "Pressed" | "Released";
export type OverlayState = {
  status: "recording" | "processing" | "ready" | "error";
  issue?: "microphone" | "model" | "audio" | "transcription" | null;
  errorMessage?: string;
  message?: string;
  elapsedMs?: number;
  audioLevel?: number;
};

export type TargetInsertResult = {
  inserted: boolean;
};

const OVERLAY_POSITION_KEY = "comu:overlay-position";
const LEGACY_OVERLAY_POSITION_KEY = "dictado-local:overlay-position";

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isSettingsWindow(): boolean {
  if (!isDesktopApp()) {
    return false;
  }

  const internals = (window as Window & {
    __TAURI_INTERNALS__?: {
      metadata?: { currentWindow?: { label?: string } };
    };
  }).__TAURI_INTERNALS__;

  return internals?.metadata?.currentWindow?.label === "settings";
}

export async function insertText(text: string): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("insert_text", { text });
}

export async function captureDictationTarget(): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("capture_dictation_target");
}

export async function insertTextAtTarget(text: string): Promise<TargetInsertResult> {
  if (!isDesktopApp()) {
    return { inserted: false };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TargetInsertResult>("insert_text_at_target", { text });
}

export async function setGlobalHotkey(shortcut: string): Promise<string> {
  if (!isDesktopApp()) {
    return shortcut;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("set_hotkey", { shortcut });
}

export async function setOverlayVisible(visible: boolean): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  if (visible) {
    await window.setFocusable(true);
    await window.show();
  } else {
    await window.hide();
    await window.setFocusable(false);
  }
}

export async function setMainOverlayVisible(visible: boolean): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const overlay = await WebviewWindow.getByLabel("main");
  if (visible) {
    await overlay?.show();
  } else {
    await overlay?.hide();
  }
}

export async function emitOverlayState(state: OverlayState): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", "dictation:overlay-state", state);
}

export async function listenOverlayState(
  handler: (state: OverlayState) => void
): Promise<(() => void) | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }

  const { listen } = await import("@tauri-apps/api/event");
  return listen<OverlayState>("dictation:overlay-state", (event) => {
    handler(event.payload);
  });
}

export async function requestDictationCancel(): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { emit } = await import("@tauri-apps/api/event");
  await emit("dictation:cancel");
}

export async function listenDictationCancel(
  handler: () => void
): Promise<(() => void) | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }

  const { listen } = await import("@tauri-apps/api/event");
  return listen("dictation:cancel", handler);
}

export async function startOverlayDragging(): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function restoreAndTrackOverlayPosition(): Promise<() => void> {
  if (!isDesktopApp()) {
    return () => undefined;
  }

  const { availableMonitors, getCurrentWindow, PhysicalPosition } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();

  try {
    const stored = window.localStorage.getItem(OVERLAY_POSITION_KEY)
      ?? window.localStorage.getItem(LEGACY_OVERLAY_POSITION_KEY);
    if (stored) {
      const position = JSON.parse(stored) as { x?: unknown; y?: unknown };
      if (typeof position.x === "number" && typeof position.y === "number") {
        const x = position.x;
        const y = position.y;
        const monitors = await availableMonitors();
        const isVisible = monitors.some((monitor) => (
          x >= monitor.position.x
          && x < monitor.position.x + monitor.size.width - 40
          && y >= monitor.position.y
          && y < monitor.position.y + monitor.size.height - 24
        ));

        if (isVisible) {
          await appWindow.setPosition(new PhysicalPosition(x, y));
        }
      }
    }
  } catch {
    // An invalid saved position falls back to Windows' default placement.
  }

  return appWindow.onMoved(({ payload }) => {
    try {
      window.localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify({
        x: payload.x,
        y: payload.y
      }));
    } catch {
      // Position persistence is optional; dragging still works for this session.
    }
  });
}

export async function hideSettingsWindow(): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const settingsWindow = await WebviewWindow.getByLabel("settings");
  await settingsWindow?.hide();
}

export async function notifyPreferencesChanged(
  preferences: DictationPreferences
): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", "dictation:preferences", preferences);
}

export async function listenPreferencesChanged(
  handler: (preferences: DictationPreferences) => void
): Promise<(() => void) | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }

  const { listen } = await import("@tauri-apps/api/event");
  return listen<DictationPreferences>("dictation:preferences", (event) => {
    handler(event.payload);
  });
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isDesktopApp()) {
    return false;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("get_autostart_enabled");
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (!isDesktopApp()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_autostart_enabled", { enabled });
}

export async function listenDictationHotkey(
  handler: (state: HotkeyState) => void
): Promise<(() => void) | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }

  const { listen } = await import("@tauri-apps/api/event");
  return listen<HotkeyState>("dictation:hotkey", (event) => {
    handler(event.payload);
  });
}
