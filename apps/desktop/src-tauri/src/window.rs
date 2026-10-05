//! Windows (ADR 0012 §5): `main` / `editor-<n>` editor windows (macOS: `titleBarStyle:
//! Overlay`, hidden title, traffic lights at {16, 18}; Windows/Linux: native decorations) and
//! the separate `settings` window (`#/settings/<pane>`). Focus/fullscreen changes are sent as
//! `kimo://window-state`; closing an editor window goes through the `kimo://close-requested`
//! handshake so sessions can flush first.

use crate::error::{io_msg, R};
use crate::state::state;
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const SETTINGS_LABEL: &str = "settings";
pub const SETTINGS_PANES: &[&str] = &[
    "general",
    // Board 27 §4 (Lwg6P): right after General.
    "canvas",
    "files",
    "fonts",
    "agents-mcp",
    // M6 (board 22/23): right after Agents & MCP.
    "ai-providers",
    "updates",
    "about",
];
/// Board 19 "Settings Window" (XmeDB): a fixed 840×536 window.
pub const SETTINGS_SIZE: (f64, f64) = (840.0, 536.0);
/// Native traffic lights (02d WindowChrome/TrafficLights L2zCG: close dot at {16, 18}); the
/// Settings sidebar places the same 68×48 lights block at sidebar padding 12 + leading 4.
pub const TRAFFIC_LIGHTS: Point = Point { x: 16, y: 18 };
/// A close request unanswered for this long no longer blocks the next close (a crashed or
/// hung page must not trap the user).
const CLOSE_ANSWER_GRACE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct Point {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub focused: bool,
    pub fullscreen: bool,
    pub traffic_light_position: Option<Point>,
}

pub fn is_editor_label(label: &str) -> bool {
    label == "main" || label.starts_with("editor-")
}

/// Windows whose macOS chrome is an overlay title bar with in-window traffic lights.
pub fn has_overlay_chrome(label: &str) -> bool {
    is_editor_label(label) || label == SETTINGS_LABEL
}

pub fn traffic_lights(label: &str) -> Option<Point> {
    (cfg!(target_os = "macos") && has_overlay_chrome(label)).then_some(TRAFFIC_LIGHTS)
}

pub fn window_state<Rt: Runtime>(w: &WebviewWindow<Rt>) -> WindowState {
    WindowState {
        focused: w.is_focused().unwrap_or(false),
        fullscreen: w.is_fullscreen().unwrap_or(false),
        traffic_light_position: traffic_lights(w.label()),
    }
}

/// Creates (or focuses) an editor window.
pub fn create_editor_window<Rt: Runtime>(app: &AppHandle<Rt>, label: &str) -> R<WebviewWindow<Rt>> {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return Ok(w);
    }
    let b = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Kimo")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 560.0)
        .disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(
            TRAFFIC_LIGHTS.x as f64,
            TRAFFIC_LIGHTS.y as f64,
        ));
    #[cfg(not(target_os = "macos"))]
    let b = b.decorations(true);
    // Board 29 "Launch loader": paint the native window in $bg-app of the stored appearance
    // before the page loads, so there is no white/black flash ahead of the loader.
    let appearance = app
        .try_state::<std::sync::Arc<crate::state::AppState>>()
        .map(|s| s.settings.get("general.appearance"));
    let appearance = appearance
        .as_ref()
        .and_then(|v| v.as_str())
        .unwrap_or("system");
    let b = match appearance {
        "light" | "dark" => b.background_color(launch_background(appearance, false)),
        _ => b,
    };
    let w = b
        .build()
        .map_err(|e| io_msg(format!("Could not open a window: {e}")))?;
    if appearance != "light" && appearance != "dark" {
        let os_dark = matches!(w.theme(), Ok(tauri::Theme::Dark));
        let _ = w.set_background_color(Some(launch_background(appearance, os_dark)));
    }
    Ok(w)
}

/// $bg-app for the launch loader (board 29): light #FFFFFF, dark #0A0A0A. `system` (or any
/// other value) follows the OS theme.
pub fn launch_background(appearance: &str, os_dark: bool) -> tauri::window::Color {
    let dark = match appearance {
        "dark" => true,
        "light" => false,
        _ => os_dark,
    };
    if dark {
        tauri::window::Color(0x0A, 0x0A, 0x0A, 0xFF)
    } else {
        tauri::window::Color(0xFF, 0xFF, 0xFF, 0xFF)
    }
}

/// The window that receives open requests: `main`, else the first editor window.
pub fn primary_editor<Rt: Runtime>(app: &AppHandle<Rt>) -> Option<WebviewWindow<Rt>> {
    let windows = app.webview_windows();
    if let Some(w) = windows.get("main") {
        return Some(w.clone());
    }
    let mut editors: Vec<_> = windows
        .into_iter()
        .filter(|(l, _)| is_editor_label(l))
        .collect();
    editors.sort_by(|a, b| a.0.cmp(&b.0));
    editors.into_iter().next().map(|(_, w)| w)
}

pub fn open_settings<Rt: Runtime>(app: &AppHandle<Rt>, pane: Option<&str>) -> R<()> {
    let pane = pane
        .filter(|p| SETTINGS_PANES.contains(p))
        .unwrap_or("general");
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        // `pane` is from the fixed list above, so it is safe to inline.
        let _ = w.eval(format!("window.location.hash = '#/settings/{pane}'"));
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let (w, h) = SETTINGS_SIZE;
    // Board 19 shows a fixed-size preferences window: not resizable, no zoom.
    let b = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App(format!("index.html#/settings/{pane}").into()),
    )
    .title("Settings")
    .inner_size(w, h)
    .min_inner_size(w, h)
    .resizable(false)
    .maximizable(false)
    .disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(
            TRAFFIC_LIGHTS.x as f64,
            TRAFFIC_LIGHTS.y as f64,
        ));
    #[cfg(not(target_os = "macos"))]
    let b = b.decorations(true);
    b.build()
        .map_err(|e| io_msg(format!("Could not open Settings: {e}")))?;
    Ok(())
}

/// macOS close-button dot. No-op elsewhere.
pub fn set_document_edited<Rt: Runtime>(w: &WebviewWindow<Rt>, edited: bool) -> R<()> {
    #[cfg(target_os = "macos")]
    {
        let win = w.clone();
        w.run_on_main_thread(move || {
            if let Ok(ns) = win.ns_window() {
                if !ns.is_null() {
                    // SAFETY: `ns` is this window's live NSWindow, used on the main thread.
                    unsafe {
                        let obj: &objc2::runtime::AnyObject =
                            &*(ns as *mut objc2::runtime::AnyObject);
                        let _: () = objc2::msg_send![obj, setDocumentEdited: edited];
                    }
                }
            }
        })
        .map_err(|e| io_msg(e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (w, edited);
    Ok(())
}

/// Closes a window without asking it again (after the handshake said yes, or `close()`).
pub fn close_confirmed<Rt: Runtime>(w: &WebviewWindow<Rt>) -> R<()> {
    let st = state(w.app_handle());
    st.close_allowed
        .lock()
        .unwrap()
        .insert(w.label().to_string());
    w.close().map_err(|e| io_msg(e.to_string()))
}

pub fn confirm_close<Rt: Runtime>(app: &AppHandle<Rt>, request_id: &str, allow: bool) -> R<()> {
    let st = state(app);
    let Some((label, _)) = st.close_requests.lock().unwrap().remove(request_id) else {
        return Ok(()); // already answered or window gone
    };
    if allow {
        if let Some(w) = app.get_webview_window(&label) {
            close_confirmed(&w)?;
        }
    }
    Ok(())
}

/// Window event hook (registered on the builder).
pub fn on_window_event<Rt: Runtime>(window: &tauri::Window<Rt>, event: &WindowEvent) {
    let label = window.label().to_string();
    let app = window.app_handle();
    let st = state(app);
    match event {
        WindowEvent::Focused(focused) => {
            let fullscreen = window.is_fullscreen().unwrap_or(false);
            let s = WindowState {
                focused: *focused,
                fullscreen,
                traffic_light_position: traffic_lights(&label),
            };
            let _ = app.emit_to(label.as_str(), "kimo://window-state", s);
        }
        WindowEvent::Resized(_) => {
            let fullscreen = window.is_fullscreen().unwrap_or(false);
            let changed = {
                let mut g = st.fullscreen.lock().unwrap();
                let prev = g.insert(label.clone(), fullscreen).unwrap_or(false);
                prev != fullscreen
            };
            if changed {
                let s = WindowState {
                    focused: window.is_focused().unwrap_or(false),
                    fullscreen,
                    traffic_light_position: traffic_lights(&label),
                };
                let _ = app.emit_to(label.as_str(), "kimo://window-state", s);
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            if !is_editor_label(&label) {
                return;
            }
            if st.close_allowed.lock().unwrap().remove(&label) {
                return; // confirmed: let it close
            }
            let mut reqs = st.close_requests.lock().unwrap();
            let stale = reqs
                .iter()
                .any(|(_, (l, at))| *l == label && at.elapsed() > CLOSE_ANSWER_GRACE);
            if stale {
                reqs.retain(|_, (l, _)| *l != label);
                return; // the page never answered: close anyway
            }
            api.prevent_close();
            if reqs.values().any(|(l, _)| *l == label) {
                return; // already asking
            }
            let id = uuid::Uuid::new_v4().simple().to_string();
            reqs.insert(id.clone(), (label.clone(), Instant::now()));
            drop(reqs);
            let _ = app.emit_to(
                label.as_str(),
                "kimo://close-requested",
                serde_json::json!({ "requestId": id }),
            );
        }
        WindowEvent::Destroyed => {
            st.drop_window_watches(&label);
            st.fullscreen.lock().unwrap().remove(&label);
            st.close_requests
                .lock()
                .unwrap()
                .retain(|_, (l, _)| *l != label);
            st.close_allowed.lock().unwrap().remove(&label);
            if label == crate::mcp::HOST_LABEL {
                crate::mcp::on_host_destroyed(app);
            } else {
                exit_if_no_user_windows(app, &label);
            }
        }
        _ => {}
    }
}

/// The hidden document host keeps Tauri from seeing "all windows closed", so the app exits
/// itself when the last user-facing window goes (as it did before M5), or when a quit is under
/// way and the last editor window has closed.
fn exit_if_no_user_windows<Rt: Runtime>(app: &AppHandle<Rt>, destroyed: &str) {
    let remaining: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|l| l != destroyed && l != crate::mcp::HOST_LABEL)
        .collect();
    let quitting = crate::mcp::service(app)
        .is_some_and(|m| m.quitting.load(std::sync::atomic::Ordering::SeqCst));
    if should_exit(&remaining, quitting) {
        app.exit(0);
    }
}

pub fn should_exit(remaining_user_windows: &[String], quitting: bool) -> bool {
    remaining_user_windows.is_empty()
        || (quitting && !remaining_user_windows.iter().any(|l| is_editor_label(l)))
}

/// Quit: ask every editor window (each flushes, then closes); the app exits when the last one
/// is gone.
pub fn request_quit<Rt: Runtime>(app: &AppHandle<Rt>) -> bool {
    let editors: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(l, _)| is_editor_label(l))
        .collect();
    if editors.is_empty() {
        return false;
    }
    for (_, w) in editors {
        let _ = w.close();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_window_matches_board_19() {
        assert_eq!(SETTINGS_SIZE, (840.0, 536.0));
        assert_eq!(TRAFFIC_LIGHTS, Point { x: 16, y: 18 });
    }

    #[test]
    fn exits_when_the_last_user_window_goes() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(should_exit(&s(&[]), false));
        assert!(!should_exit(&s(&["main"]), false));
        assert!(!should_exit(&s(&[SETTINGS_LABEL]), false));
        // Quitting: Settings alone does not keep the app alive.
        assert!(should_exit(&s(&[SETTINGS_LABEL]), true));
        assert!(!should_exit(&s(&["editor-2"]), true));
    }

    #[test]
    fn launch_background_is_bg_app_of_the_appearance() {
        use tauri::window::Color;
        let (light, dark) = (Color(0xFF, 0xFF, 0xFF, 0xFF), Color(0x0A, 0x0A, 0x0A, 0xFF));
        assert_eq!(launch_background("light", true), light);
        assert_eq!(launch_background("dark", false), dark);
        assert_eq!(launch_background("system", true), dark);
        assert_eq!(launch_background("system", false), light);
    }

    #[test]
    fn overlay_chrome_labels() {
        assert!(has_overlay_chrome("main"));
        assert!(has_overlay_chrome("editor-3"));
        assert!(has_overlay_chrome(SETTINGS_LABEL));
        assert!(!has_overlay_chrome("other"));
        let expected = cfg!(target_os = "macos").then_some(TRAFFIC_LIGHTS);
        assert_eq!(traffic_lights(SETTINGS_LABEL), expected);
        assert_eq!(traffic_lights("main"), expected);
        assert_eq!(traffic_lights("other"), None);
    }
}
