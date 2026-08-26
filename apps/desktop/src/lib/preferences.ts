export type Language = "es" | "en";
export type DictationMode = "toggle" | "hold";
export type TranscriptionQuality = "accurate" | "fast";

export type DictationPreferences = {
  language: Language;
  microphoneId: string;
  dictationMode: DictationMode;
  hotkey: string;
  quality: TranscriptionQuality;
  vocabulary: string;
};

const STORAGE_KEY = "comu:preferences";
const LEGACY_STORAGE_KEY = "dictado-local:preferences";

export const defaultPreferences: DictationPreferences = {
  language: "es",
  microphoneId: "",
  dictationMode: "toggle",
  hotkey: "Ctrl+Alt+Space",
  quality: "accurate",
  vocabulary: "instruccionado=instruccional, creditación=acreditación"
};

export function loadPreferences(): DictationPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) {
      return defaultPreferences;
    }

    const parsed = JSON.parse(stored) as Partial<DictationPreferences>;
    const preferences: DictationPreferences = {
      language: parsed.language === "en" ? "en" : "es",
      microphoneId: typeof parsed.microphoneId === "string" ? parsed.microphoneId : "",
      dictationMode: parsed.dictationMode === "hold" ? "hold" : "toggle",
      hotkey: typeof parsed.hotkey === "string" && parsed.hotkey ? parsed.hotkey : defaultPreferences.hotkey,
      quality: parsed.quality === "fast" ? "fast" : "accurate",
      vocabulary: typeof parsed.vocabulary === "string" ? parsed.vocabulary : defaultPreferences.vocabulary
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return preferences;
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: DictationPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preferences still work for the current session.
  }
}
