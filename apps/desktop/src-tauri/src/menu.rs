//! Native app menu (board 20 "Settings entry", macOS app menu Qj4uq / CRG2I). macOS only:
//! Windows and Linux have no native menu bar; the in-app File menu is their only menu entry.
//!
//! Menu bar: Kimo · File · Edit · View · Window · Help. The Kimo menu is the board's: About
//! Kimo (info) · Check for updates… (refresh-cw) · ─ · Settings… ⌘, (settings) · ─ · Hide Kimo
//! ⌘H · Quit Kimo ⌘Q. The other menus keep Tauri's default items (the webview's Edit commands
//! and window management), so key handling in the editor is unchanged.
//!
//! Help (board 25 §7 (b) A0qRF; macOS adds the Search field itself): Kimo documentation ·
//! Keyboard shortcuts ⌘/ · What's new in <major.minor> · ─ · Report an issue… · Copy diagnostics
//! · ─ · Show logs in Finder. Logs are revealed here; every other item is sent to the focused
//! editor window as `kimo://help-menu` (the web owns the URLs, the confirm and the clipboard).
//! Windows / Linux have the same items as File › Help in the in-app menu.

use tauri::{AppHandle, Runtime};

/// Menu item ids handled by [`on_menu_event`].
pub const ABOUT: &str = "kimo-about";
pub const CHECK_UPDATES: &str = "kimo-check-updates";
pub const SETTINGS: &str = "kimo-settings";
pub const HELP_DOCS: &str = "kimo-help-docs";
pub const HELP_SHORTCUTS: &str = "kimo-help-shortcuts";
pub const HELP_WHATS_NEW: &str = "kimo-help-whats-new";
pub const HELP_REPORT: &str = "kimo-help-report-issue";
pub const HELP_DIAGNOSTICS: &str = "kimo-help-copy-diagnostics";
pub const HELP_LOGS: &str = "kimo-help-show-logs";

/// The `kimo://help-menu` event's `action` for each Help item the web handles (`None` = not
/// one; Show logs runs in Rust).
pub fn help_action_for(id: &str) -> Option<&'static str> {
    match id {
        HELP_DOCS => Some("docs"),
        HELP_SHORTCUTS => Some("shortcuts"),
        HELP_WHATS_NEW => Some("whats-new"),
        HELP_REPORT => Some("report-issue"),
        HELP_DIAGNOSTICS => Some("copy-diagnostics"),
        _ => None,
    }
}

/// "What's new in 1.0": the release line of `version` (`1.0.3` → `1.0`).
pub fn whats_new_label(version: &str) -> String {
    let line: Vec<&str> = version.split(['.', '-', '+']).take(2).collect();
    format!("What's new in {}", line.join("."))
}

/// The Settings pane each Kimo-menu item opens (`None` = not a Kimo item).
pub fn settings_pane_for(id: &str) -> Option<&'static str> {
    match id {
        ABOUT => Some("about"),
        CHECK_UPDATES => Some("updates"),
        SETTINGS => Some("general"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub fn build<Rt: Runtime>(app: &AppHandle<Rt>) -> tauri::Result<tauri::menu::Menu<Rt>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let sep = || PredefinedMenuItem::separator(app);
    let kimo = Submenu::with_items(
        app,
        "Kimo",
        true,
        &[
            &MenuItem::with_id(app, ABOUT, "About Kimo", true, None::<&str>)?,
            &MenuItem::with_id(app, CHECK_UPDATES, "Check for updates…", true, None::<&str>)?,
            &sep()?,
            &MenuItem::with_id(app, SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide Kimo"))?,
            &PredefinedMenuItem::quit(app, Some("Quit Kimo"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let version = app.package_info().version.to_string();
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, HELP_DOCS, "Kimo documentation", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                HELP_SHORTCUTS,
                "Keyboard shortcuts",
                true,
                Some("CmdOrCtrl+/"),
            )?,
            &MenuItem::with_id(
                app,
                HELP_WHATS_NEW,
                whats_new_label(&version),
                true,
                None::<&str>,
            )?,
            &sep()?,
            &MenuItem::with_id(app, HELP_REPORT, "Report an issue…", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                HELP_DIAGNOSTICS,
                "Copy diagnostics",
                true,
                None::<&str>,
            )?,
            &sep()?,
            &MenuItem::with_id(app, HELP_LOGS, "Show logs in Finder", true, None::<&str>)?,
        ],
    )?;
    // macOS puts its Help search field in the menu registered as the app's Help menu.
    let _ = help.set_as_help_menu_for_nsapp();
    Menu::with_items(app, &[&kimo, &file, &edit, &view, &window, &help])
}

/// Runs a Kimo-menu item: Settings… / About open the Settings window (board 19 XmeDB) at their
/// pane; Check for updates… also starts a check on the configured channel (the Updates pane and
/// the update toasts show the result).
pub fn on_menu_event<Rt: Runtime>(app: &AppHandle<Rt>, id: &str) {
    if id == HELP_LOGS {
        let home = crate::state::state(app).kimo_home.clone();
        let _ = crate::commands::show_logs(app, &home);
        return;
    }
    if let Some(action) = help_action_for(id) {
        emit_help(app, action);
        return;
    }
    let Some(pane) = settings_pane_for(id) else {
        return;
    };
    let _ = crate::window::open_settings(app, Some(pane));
    if id == CHECK_UPDATES {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let st = crate::state::state(&app);
            let channel = st
                .settings
                .get("updates.channel")
                .as_str()
                .unwrap_or("stable")
                .to_string();
            let _ = st.updater.check(&app, &channel).await;
        });
    }
}

/// Sends a Help item to the focused editor window (else the primary one): the Settings window
/// and the document host have no shortcuts sheet / issue confirm.
fn emit_help<Rt: Runtime>(app: &AppHandle<Rt>, action: &str) {
    use tauri::{Emitter, Manager};
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| crate::window::is_editor_label(w.label()) && w.is_focused().unwrap_or(false));
    if let Some(w) = focused.or_else(|| crate::window::primary_editor(app)) {
        let _ = w.set_focus();
        let _ = app.emit_to(
            w.label(),
            "kimo://help-menu",
            serde_json::json!({ "action": action }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kimo_menu_items_open_their_settings_panes() {
        assert_eq!(settings_pane_for(SETTINGS), Some("general"));
        assert_eq!(settings_pane_for(ABOUT), Some("about"));
        assert_eq!(settings_pane_for(CHECK_UPDATES), Some("updates"));
        assert_eq!(settings_pane_for("close"), None);
        for p in ["general", "about", "updates"] {
            assert!(crate::window::SETTINGS_PANES.contains(&p));
        }
    }

    #[test]
    fn help_items_map_to_web_actions() {
        assert_eq!(help_action_for(HELP_DOCS), Some("docs"));
        assert_eq!(help_action_for(HELP_SHORTCUTS), Some("shortcuts"));
        assert_eq!(help_action_for(HELP_WHATS_NEW), Some("whats-new"));
        assert_eq!(help_action_for(HELP_REPORT), Some("report-issue"));
        assert_eq!(help_action_for(HELP_DIAGNOSTICS), Some("copy-diagnostics"));
        // Logs are revealed in Rust; Kimo-menu items are not Help items.
        assert_eq!(help_action_for(HELP_LOGS), None);
        assert_eq!(help_action_for(ABOUT), None);
        assert_eq!(settings_pane_for(HELP_DOCS), None);
    }

    #[test]
    fn whats_new_names_the_release_line() {
        assert_eq!(whats_new_label("1.0.0"), "What's new in 1.0");
        assert_eq!(whats_new_label("1.2.3-beta.1"), "What's new in 1.2");
        assert_eq!(whats_new_label("0.0.0"), "What's new in 0.0");
    }
}
