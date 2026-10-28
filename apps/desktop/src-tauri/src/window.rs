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
    // Board 41 section 4: right after AI providers.
    "multiplayer",
    // Board 46 2A: Settings › Workspace, right after Multiplayer.
    "workspace",
    "updates",
    "about",
];
/// `settings/<pane>[/<focus>]`: `focus` (an MCP client to expand, `usage`, a workspace id) is kept
/// only when it is 1–64 chars of `[A-Za-z0-9._-]`, so the route can be inlined into a script.
pub fn settings_route(pane: &str, focus: Option<&str>) -> String {
    match focus.filter(|f| {
        !f.is_empty()
            && f.len() <= 64
            && f.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    }) {
        Some(f) => format!("settings/{pane}/{f}"),
        None => format!("settings/{pane}"),
    }
}

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
    /// macOS: right edge of the zoom button in whole window points, measured from the real buttons
    /// (14 pt buttons on macOS 26, 12 pt before). `None` until measured and off macOS.
    pub traffic_lights_right: Option<f64>,
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
        traffic_lights_right: lights_right(w.label()),
    }
}

fn lights_right(label: &str) -> Option<f64> {
    if has_overlay_chrome(label) {
        crate::window_chrome::lights_right_of(label)
    } else {
        None
    }
}

/// Title bar double-click: the system preference on macOS, toggle maximize elsewhere.
pub fn titlebar_double_click<Rt: Runtime>(w: &WebviewWindow<Rt>) -> R<()> {
    #[cfg(target_os = "macos")]
    let r = crate::window_chrome::double_click(w);
    #[cfg(not(target_os = "macos"))]
    let r = if w.is_maximized().unwrap_or(false) {
        w.unmaximize()
    } else if w.is_resizable().unwrap_or(false) {
        w.maximize()
    } else {
        Ok(())
    };
    r.map_err(|e| io_msg(e.to_string()))
}

/// Centers the traffic lights on the 48 pt topbar and publishes their right edge (macOS).
pub fn align_lights<Rt: Runtime>(w: &WebviewWindow<Rt>) {
    #[cfg(target_os = "macos")]
    crate::window_chrome::schedule(w);
    #[cfg(not(target_os = "macos"))]
    let _ = w;
}

/// Creates (or focuses) an editor window.
pub fn create_editor_window<Rt: Runtime>(app: &AppHandle<Rt>, label: &str) -> R<WebviewWindow<Rt>> {
    create_editor_window_at(app, label, None)
}

/// `encodeURIComponent` (the web's `diskPath`): everything but `A-Z a-z 0-9 - _ . ! ~ * ' ( )`
/// is percent-encoded as UTF-8, so the route is safe to put in a URL fragment.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The editor route of a file on disk (`#/disk/<encoded path>`, the web's `diskPath`).
pub fn disk_route(path: &str) -> String {
    format!("/disk/{}", encode_uri_component(path))
}

/// Creates (or focuses) an editor window; a new one starts on `route` (a hash route such as
/// [`disk_route`]) instead of Home.
pub fn create_editor_window_at<Rt: Runtime>(
    app: &AppHandle<Rt>,
    label: &str,
    route: Option<&str>,
) -> R<WebviewWindow<Rt>> {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return Ok(w);
    }
    let url = match route {
        Some(r) => WebviewUrl::App(format!("index.html#{r}").into()),
        None => WebviewUrl::default(),
    };
    let b = WebviewWindowBuilder::new(app, label, url)
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
    align_lights(&w);
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

pub fn open_settings<Rt: Runtime>(
    app: &AppHandle<Rt>,
    pane: Option<&str>,
    focus: Option<&str>,
) -> R<()> {
    let pane = pane
        .filter(|p| SETTINGS_PANES.contains(p))
        .unwrap_or("general");
    let route = settings_route(pane, focus);
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        // `route` is a fixed pane plus a focus of [A-Za-z0-9._-] only, so it is safe to inline.
        let _ = w.eval(format!("window.location.hash = '#/{route}'"));
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
        WebviewUrl::App(format!("index.html#/{route}").into()),
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
    let w = b
        .build()
        .map_err(|e| io_msg(format!("Could not open Settings: {e}")))?;
    align_lights(&w);
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
    } else if let Some(m) = crate::mcp::service(app) {
        // The user cancelled (unsaved-files dialog): a pending Quit is cancelled with it, so a
        // later close of this window forgets it instead of reopening it on launch (D1).
        if is_editor_label(&label) {
            m.quitting.store(
                cancel_quit(m.quitting.load(std::sync::atomic::Ordering::SeqCst)),
                std::sync::atomic::Ordering::SeqCst,
            );
        }
    }
    Ok(())
}

/// A refused close during Quit ends the quit (pure, for tests).
pub fn cancel_quit(_quitting: bool) -> bool {
    false
}

/// Window event hook (registered on the builder).
pub fn on_window_event<Rt: Runtime>(window: &tauri::Window<Rt>, event: &WindowEvent) {
    let label = window.label().to_string();
    let app = window.app_handle();
    let st = state(app);
    // AppKit relays out the title bar on these (leaving fullscreen, theme, display changes).
    if matches!(
        event,
        WindowEvent::Resized(_)
            | WindowEvent::Focused(_)
            | WindowEvent::ThemeChanged(_)
            | WindowEvent::ScaleFactorChanged { .. }
    ) {
        if let Some(w) = app.get_webview_window(&label) {
            align_lights(&w);
        }
    }
    match event {
        WindowEvent::Focused(focused) => {
            if *focused {
                crate::menu::on_focus(app, &label);
            }
            let fullscreen = window.is_fullscreen().unwrap_or(false);
            let s = WindowState {
                focused: *focused,
                fullscreen,
                traffic_light_position: traffic_lights(&label),
                traffic_lights_right: lights_right(&label),
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
                    traffic_lights_right: lights_right(&label),
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
            // `quitting`: the window closes because the app quits (General › On launch reopens
            // the files of windows closed this way), not because the user closed it.
            let quitting = crate::mcp::service(app)
                .is_some_and(|m| m.quitting.load(std::sync::atomic::Ordering::SeqCst));
            let _ = app.emit_to(
                label.as_str(),
                "kimo://close-requested",
                serde_json::json!({ "requestId": id, "quitting": quitting }),
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
            st.menu_context.lock().unwrap().remove(&label);
            st.pending_menu.lock().unwrap().forget(&label);
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
    fn disk_route_matches_the_web_disk_path() {
        // encodeURIComponent("/Users/me/my file#1.kimo") in the web's diskPath.
        assert_eq!(
            disk_route("/Users/me/my file#1.kimo"),
            "/disk/%2FUsers%2Fme%2Fmy%20file%231.kimo"
        );
        assert_eq!(encode_uri_component("a-b_c.d!~*'()"), "a-b_c.d!~*'()");
        assert_eq!(encode_uri_component("é"), "%C3%A9");
        assert_eq!(encode_uri_component("C:\\a"), "C%3A%5Ca");
    }

    #[test]
    fn settings_route_keeps_only_safe_focus() {
        assert_eq!(settings_route("general", None), "settings/general");
        assert_eq!(
            settings_route("agents-mcp", Some("claude-code")),
            "settings/agents-mcp/claude-code"
        );
        assert_eq!(
            settings_route("ai-providers", Some("usage")),
            "settings/ai-providers/usage"
        );
        assert_eq!(
            settings_route("agents-mcp", Some("x'; alert(1)")),
            "settings/agents-mcp"
        );
        assert_eq!(
            settings_route("agents-mcp", Some("")),
            "settings/agents-mcp"
        );
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
}
