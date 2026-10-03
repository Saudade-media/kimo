//! Native app menu (board 20 "Settings entry", macOS app menu Qj4uq / CRG2I). macOS only:
//! Windows and Linux have no native menu bar; the in-app File menu is their only menu entry.
//!
//! Menu bar: Kimo · File · Edit · View · Window · Help. The Kimo menu is the board's: About
//! Kimo (info) · Check for updates… (refresh-cw) · ─ · Settings… ⌘, (settings) · ─ · Hide Kimo
//! ⌘H · Quit Kimo ⌘Q. The other menus keep Tauri's default items (the webview's Edit commands
//! and window management), so key handling in the editor is unchanged.

use tauri::{AppHandle, Runtime};

/// Menu item ids handled by [`on_menu_event`].
pub const ABOUT: &str = "kimo-about";
pub const CHECK_UPDATES: &str = "kimo-check-updates";
pub const SETTINGS: &str = "kimo-settings";

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
    let help = Submenu::with_items(app, "Help", true, &[])?;
    Menu::with_items(app, &[&kimo, &file, &edit, &view, &window, &help])
}

/// Runs a Kimo-menu item: Settings… / About open the Settings window (board 19 XmeDB) at their
/// pane; Check for updates… also starts a check on the configured channel (the Updates pane and
/// the update toasts show the result).
pub fn on_menu_event<Rt: Runtime>(app: &AppHandle<Rt>, id: &str) {
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
}
