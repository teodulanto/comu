use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod transcription;

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Space";

struct RegisteredHotkey(Mutex<String>);

#[derive(Default)]
struct DictationTarget(Mutex<Option<isize>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InsertResult {
    inserted: bool,
}

impl Default for RegisteredHotkey {
    fn default() -> Self {
        Self(Mutex::new(DEFAULT_HOTKEY.to_string()))
    }
}

#[cfg(windows)]
fn allow_microphone_permission(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::{
            Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            },
            PermissionRequestedEventHandler,
        };

        let Ok(core_webview) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let mut kind = Default::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
            }
            Ok(())
        }));
        let mut token = 0;
        let _ = core_webview.add_PermissionRequested(&handler, &mut token);
    });
}

#[tauri::command]
fn insert_text(app: AppHandle, text: String) -> Result<(), String> {
    let clipboard_ready = app.clipboard().write_text(text.clone()).is_ok();

    #[cfg(windows)]
    {
        if clipboard_ready {
            std::thread::sleep(std::time::Duration::from_millis(35));
            if windows_input::paste_text().is_ok() {
                return Ok(());
            }
        }
        return windows_input::insert_text(&text);
    }

    #[cfg(not(windows))]
    {
        let _ = text;
        Err("La inserción de texto todavía está disponible solo en Windows.".to_string())
    }
}

#[tauri::command]
fn capture_dictation_target(state: State<'_, DictationTarget>) -> Result<(), String> {
    #[cfg(windows)]
    let target = windows_input::capture_foreground_target();

    #[cfg(not(windows))]
    let target = None;

    let mut stored = state
        .0
        .lock()
        .map_err(|_| "No se pudo guardar la ventana de destino.".to_string())?;
    *stored = target;
    Ok(())
}

#[tauri::command]
fn insert_text_at_target(
    app: AppHandle,
    state: State<'_, DictationTarget>,
    text: String,
) -> Result<InsertResult, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("No se pudo guardar el texto en el portapapeles: {error}"))?;

    let target = state
        .0
        .lock()
        .map_err(|_| "No se pudo leer la ventana de destino.".to_string())?
        .take();

    #[cfg(windows)]
    {
        let Some(target) = target else {
            return Ok(InsertResult { inserted: false });
        };
        if !windows_input::is_target_active(target) {
            return Ok(InsertResult { inserted: false });
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
        return Ok(InsertResult {
            inserted: windows_input::paste_text().is_ok(),
        });
    }

    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(InsertResult { inserted: false })
    }
}

#[tauri::command]
fn get_autostart_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    return windows_autostart::is_enabled();

    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    return windows_autostart::set_enabled(enabled);

    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("El inicio automático todavía está disponible solo en Windows.".to_string())
    }
}

#[tauri::command]
fn hotkey_label(state: State<'_, RegisteredHotkey>) -> Result<String, String> {
    state
        .0
        .lock()
        .map(|hotkey| hotkey.clone())
        .map_err(|_| "No se pudo leer el atajo actual.".to_string())
}

#[tauri::command]
fn set_hotkey(
    app: AppHandle,
    state: State<'_, RegisteredHotkey>,
    shortcut: String,
) -> Result<String, String> {
    let normalized = shortcut.to_ascii_lowercase();
    if !normalized.contains("ctrl+")
        && !normalized.contains("alt+")
        && !normalized.contains("super+")
    {
        return Err("El atajo debe incluir Ctrl, Alt o la tecla Windows.".to_string());
    }

    let mut current = state
        .0
        .lock()
        .map_err(|_| "No se pudo actualizar el atajo.".to_string())?;
    if *current == shortcut {
        return Ok(shortcut);
    }

    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|error| format!("Windows no pudo registrar ese atajo: {error}"))?;

    if let Err(error) = app.global_shortcut().unregister(current.as_str()) {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
        return Err(format!("No se pudo reemplazar el atajo anterior: {error}"));
    }

    *current = shortcut.clone();
    Ok(shortcut)
}

#[cfg(windows)]
mod windows_input {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
    };

    pub fn capture_foreground_target() -> Option<isize> {
        let window = unsafe { GetForegroundWindow() };
        if window.0.is_null() {
            return None;
        }

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
        if process_id == std::process::id() {
            return None;
        }

        Some(window.0 as isize)
    }

    pub fn is_target_active(raw_window: isize) -> bool {
        let target = HWND(raw_window as *mut c_void);
        if !unsafe { IsWindow(Some(target)) }.as_bool() {
            return false;
        }
        let foreground = unsafe { GetForegroundWindow() };
        foreground == target
    }

    pub fn paste_text() -> Result<(), String> {
        let inputs = [
            virtual_key_input(0x11, false),
            virtual_key_input(0x56, false),
            virtual_key_input(0x56, true),
            virtual_key_input(0x11, true),
        ];
        send_inputs(&inputs, "Windows no pudo pegar el texto completo.")
    }

    pub fn insert_text(text: &str) -> Result<(), String> {
        let code_units: Vec<u16> = text.encode_utf16().collect();

        if code_units.is_empty() {
            return Ok(());
        }

        let mut inputs = Vec::with_capacity(code_units.len() * 2);

        for code_unit in code_units {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: code_unit,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });

            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: code_unit,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }

        send_inputs(&inputs, "Windows no pudo insertar todo el texto.")
    }

    fn virtual_key_input(key: u16, released: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(key),
                    wScan: 0,
                    dwFlags: if released {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_inputs(inputs: &[INPUT], error_message: &str) -> Result<(), String> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err(error_message.to_string())
        }
    }
}

#[cfg(windows)]
mod windows_autostart {
    use std::io::ErrorKind;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const PREFERENCES_KEY: &str = "Software\\Comu";
    const VALUE_NAME: &str = "Comu";
    const LEGACY_PREFERENCES_KEY: &str = "Software\\Dictado local";
    const LEGACY_VALUE_NAME: &str = "Dictado local";
    const PREFERENCE_NAME: &str = "AutostartEnabled";

    fn executable_command() -> Result<String, String> {
        let executable = std::env::current_exe()
            .map_err(|error| format!("No se encontró el ejecutable instalado: {error}"))?;
        Ok(format!("\"{}\"", executable.display()))
    }

    pub fn is_enabled() -> Result<bool, String> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(run_key) = current_user.open_subkey(RUN_KEY) else {
            return Ok(false);
        };
        let Ok(saved_command) = run_key.get_value::<String, _>(VALUE_NAME) else {
            return Ok(false);
        };
        Ok(saved_command.eq_ignore_ascii_case(&executable_command()?))
    }

    fn apply_run_value(enabled: bool) -> Result<(), String> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = current_user
            .create_subkey(RUN_KEY)
            .map_err(|error| format!("Windows no permitió configurar el inicio automático: {error}"))?;

        if enabled {
            run_key
                .set_value(VALUE_NAME, &executable_command()?)
                .map_err(|error| format!("No se pudo activar el inicio automático: {error}"))?;
        } else if let Err(error) = run_key.delete_value(VALUE_NAME) {
            if error.kind() != ErrorKind::NotFound {
                return Err(format!("No se pudo desactivar el inicio automático: {error}"));
            }
        }
        let _ = run_key.delete_value(LEGACY_VALUE_NAME);
        Ok(())
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let (preferences, _) = current_user
            .create_subkey(PREFERENCES_KEY)
            .map_err(|error| format!("No se pudo guardar la preferencia de inicio: {error}"))?;
        preferences
            .set_value(PREFERENCE_NAME, &(enabled as u32))
            .map_err(|error| format!("No se pudo guardar la preferencia de inicio: {error}"))?;
        apply_run_value(enabled)
    }

    pub fn initialize() -> Result<(), String> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let (preferences, _) = current_user
            .create_subkey(PREFERENCES_KEY)
            .map_err(|error| format!("No se pudo preparar el inicio automático: {error}"))?;
        let legacy_enabled = current_user
            .open_subkey(LEGACY_PREFERENCES_KEY)
            .ok()
            .and_then(|key| key.get_value::<u32, _>(PREFERENCE_NAME).ok());
        let enabled = match preferences.get_value::<u32, _>(PREFERENCE_NAME) {
            Ok(value) => value != 0,
            Err(_) => {
                let value = legacy_enabled.map(|value| value != 0).unwrap_or(true);
                preferences
                    .set_value(PREFERENCE_NAME, &(value as u32))
                    .map_err(|error| format!("No se pudo guardar el inicio predeterminado: {error}"))?;
                value
            }
        };
        apply_run_value(enabled)?;
        let _ = current_user.delete_subkey_all(LEGACY_PREFERENCES_KEY);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RegisteredHotkey::default())
        .manage(DictationTarget::default())
        .manage(transcription::ModelManager::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Err(error) = windows_autostart::initialize() {
                eprintln!("No se pudo inicializar el inicio automático: {error}");
            }

            #[cfg(windows)]
            for label in ["main", "settings"] {
                if let Some(window) = app.get_webview_window(label) {
                    allow_microphone_permission(&window);
                }
            }

            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                use tauri_plugin_global_shortcut::ShortcutState;

                let settings_item =
                    MenuItem::with_id(app, "settings", "Configuración", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("Comu")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "settings" => {
                            if let Some(window) = app.get_webview_window("settings") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                }
                            }
                            let state = match event.state() {
                                ShortcutState::Pressed => "Pressed",
                                ShortcutState::Released => "Released",
                            };
                            let _ = app.emit("dictation:hotkey", state);
                        })
                        .build(),
                )?;

                app.global_shortcut().register(DEFAULT_HOTKEY)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            insert_text,
            capture_dictation_target,
            insert_text_at_target,
            get_autostart_enabled,
            set_autostart_enabled,
            hotkey_label,
            set_hotkey,
            transcription::model_status,
            transcription::ensure_model,
            transcription::transcribe_local
        ])
        .run(tauri::generate_context!())
        .expect("error while running Comu");
}
