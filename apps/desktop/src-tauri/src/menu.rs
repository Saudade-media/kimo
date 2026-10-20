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
//!
//! Board 27 §10 (d) W3CpXw / §9: File › Export… and Copy selection as PNG, View › Preview. They
//! are sent to the focused editor window as `kimo://editor-menu` (`platform.menu.onAction`).
//! No accelerators: a native accelerator would take ⇧⌘E / ⇧⌘C / ⇧Space before the webview (text
//! fields included); the editor's own shortcut handler binds those keys.
//!
//! Board 37 (audit A6, E3, E5, G2, G4, B9): File starts with Back to files (the editor's way
//! Home) and has New file ⌘N, Open… ⌘O and New window ⇧⌘N; Edit › Undo / Redo / Select all are
//! Kimo items (Tauri's predefined ones send AppKit selectors the canvas never sees). They go to
//! the focused editor window as `kimo://editor-menu` too; the page runs them on the document, or
//! with `execCommand` when a text field has focus. In a window that is not an editor (Settings)
//! the Edit items run `execCommand` there. Cut / Copy / Paste stay predefined: they fire the DOM
//! clipboard events the editor already handles. Each editor window reports whether it shows Home
//! or a document (`kimo_menu_set_context`); the document items (Back to files, Export…, Copy
//! selection as PNG, Preview) are disabled while the focused window shows Home or Settings.

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
pub const FILE_EXPORT: &str = "kimo-file-export";
pub const FILE_COPY_PNG: &str = "kimo-file-copy-png";
pub const VIEW_PREVIEW: &str = "kimo-view-preview";
pub const FILE_HOME: &str = "kimo-file-home";
pub const FILE_NEW: &str = "kimo-file-new";
pub const FILE_OPEN: &str = "kimo-file-open";
pub const FILE_NEW_WINDOW: &str = "kimo-file-new-window";
pub const EDIT_UNDO: &str = "kimo-edit-undo";
pub const EDIT_REDO: &str = "kimo-edit-redo";
pub const EDIT_SELECT_ALL: &str = "kimo-edit-select-all";

/// The `kimo://editor-menu` event's `action` for each File / Edit / View item (`None` = not
/// one). New window runs in Rust.
pub fn editor_action_for(id: &str) -> Option<&'static str> {
    match id {
        FILE_EXPORT => Some("export"),
        FILE_COPY_PNG => Some("copy-png"),
        VIEW_PREVIEW => Some("preview"),
        FILE_HOME => Some("go-home"),
        FILE_NEW => Some("new-file"),
        FILE_OPEN => Some("open-file"),
        EDIT_UNDO => Some("undo"),
        EDIT_REDO => Some("redo"),
        EDIT_SELECT_ALL => Some("select-all"),
        _ => None,
    }
}

/// The `document.execCommand` an Edit item runs in a window that is not an editor (Settings).
pub fn text_command_for(action: &str) -> Option<&'static str> {
    match action {
        "undo" => Some("undo"),
        "redo" => Some("redo"),
        "select-all" => Some("selectAll"),
        _ => None,
    }
}

/// What the focused window shows (`kimo_menu_set_context`; a non-editor window is `Other`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuContext {
    Home,
    Editor,
    Other,
}

impl MenuContext {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "home" => Some(Self::Home),
            "editor" => Some(Self::Editor),
            _ => None,
        }
    }
}

/// The items that act on an open document.
pub const DOCUMENT_ITEMS: &[&str] = &[FILE_HOME, FILE_EXPORT, FILE_COPY_PNG, VIEW_PREVIEW];

/// Whether `id` is enabled while the focused window shows `ctx`.
pub fn enabled_in(ctx: MenuContext, id: &str) -> bool {
    ctx == MenuContext::Editor || !DOCUMENT_ITEMS.contains(&id)
}

/// The context of window `label`: what its page last reported (an editor window that has not
/// reported yet shows Home, the launch route), `Other` for Settings.
pub fn context_of<Rt: Runtime>(app: &AppHandle<Rt>, label: &str) -> MenuContext {
    if !crate::window::is_editor_label(label) {
        return MenuContext::Other;
    }
    crate::state::state(app)
        .menu_context
        .lock()
        .unwrap()
        .get(label)
        .copied()
        .unwrap_or(MenuContext::Home)
}

/// Enables / disables the document items for the focused window's context (macOS menu bar).
pub fn apply_context<Rt: Runtime>(app: &AppHandle<Rt>, ctx: MenuContext) {
    #[cfg(target_os = "macos")]
    {
        let Some(menu) = app.menu() else { return };
        let Ok(items) = menu.items() else { return };
        for top in items {
            let Some(sub) = top.as_submenu() else {
                continue;
            };
            for id in DOCUMENT_ITEMS {
                if let Some(item) = sub.get(*id) {
                    if let Some(i) = item.as_menuitem() {
                        let _ = i.set_enabled(enabled_in(ctx, id));
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, ctx);
}

/// A window gained focus: the menu follows its context.
pub fn on_focus<Rt: Runtime>(app: &AppHandle<Rt>, label: &str) {
    if label == crate::mcp::HOST_LABEL {
        return;
    }
    apply_context(app, context_of(app, label));
}

/// `kimo_menu_set_context`: window `label` now shows `ctx`.
pub fn set_context<Rt: Runtime>(app: &AppHandle<Rt>, label: &str, ctx: MenuContext, focused: bool) {
    crate::state::state(app)
        .menu_context
        .lock()
        .unwrap()
        .insert(label.to_string(), ctx);
    if focused {
        apply_context(app, ctx);
    }
}

/// `editor-<n>` for the smallest free n ≥ 2 (`main` is the first editor window).
pub fn next_editor_label(taken: &[String]) -> String {
    (2..)
        .map(|n| format!("editor-{n}"))
        .find(|l| !taken.contains(l))
        .unwrap_or_else(|| "editor-x".into())
}

/// File › New window (G4): another editor window on Home.
pub fn open_new_window<Rt: Runtime>(app: &AppHandle<Rt>) -> crate::error::R<()> {
    use tauri::Manager;
    let taken: Vec<String> = app.webview_windows().into_keys().collect();
    // No editor window left (macOS keeps running): reopen `main`.
    let label = if taken.iter().any(|l| crate::window::is_editor_label(l)) {
        next_editor_label(&taken)
    } else {
        "main".to_string()
    };
    let w = crate::window::create_editor_window(app, &label)?;
    let _ = w.set_focus();
    Ok(())
}

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
        &[
            // Board 37 Xq4V0: Back to files leads, then a divider. Disabled until an editor
            // window reports a document (`apply_context`).
            &MenuItem::with_id(app, FILE_HOME, "Back to files", false, None::<&str>)?,
            &sep()?,
            &MenuItem::with_id(app, FILE_NEW, "New file", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, FILE_OPEN, "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(
                app,
                FILE_NEW_WINDOW,
                "New window",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?,
            &sep()?,
            &MenuItem::with_id(app, FILE_EXPORT, "Export…", false, None::<&str>)?,
            &MenuItem::with_id(
                app,
                FILE_COPY_PNG,
                "Copy selection as PNG",
                false,
                None::<&str>,
            )?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, EDIT_UNDO, "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, EDIT_REDO, "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &MenuItem::with_id(
                app,
                EDIT_SELECT_ALL,
                "Select all",
                true,
                Some("CmdOrCtrl+A"),
            )?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, VIEW_PREVIEW, "Preview", false, None::<&str>)?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
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
    if id == FILE_NEW_WINDOW {
        if let Err(e) = open_new_window(app) {
            eprintln!("kimo: {}", e.message);
        }
        return;
    }
    if let Some(action) = editor_action_for(id) {
        // Edit items in Settings (no editor page there) run on its focused text field.
        if let Some(cmd) = text_command_for(action) {
            if let Some(w) =
                focused_window(app).filter(|w| !crate::window::is_editor_label(w.label()))
            {
                let _ = w.eval(format!("document.execCommand('{cmd}')"));
                return;
            }
        }
        emit_to_editor(app, "kimo://editor-menu", action);
        return;
    }
    let Some(pane) = settings_pane_for(id) else {
        return;
    };
    let _ = crate::window::open_settings(app, Some(pane), None);
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
    emit_to_editor(app, "kimo://help-menu", action);
}

/// The focused window (editor or Settings), if Kimo has one.
fn focused_window<Rt: Runtime>(app: &AppHandle<Rt>) -> Option<tauri::WebviewWindow<Rt>> {
    use tauri::Manager;
    app.webview_windows()
        .into_values()
        .find(|w| w.label() != crate::mcp::HOST_LABEL && w.is_focused().unwrap_or(false))
}

/// Where a menu item for the editor goes.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuTarget {
    /// An editor window whose page listens: emit now.
    Window(String),
    /// No editor window (macOS keeps running after the last one closes), or `main` is still
    /// loading: queue the item and (re)open `main`.
    QueueForMain,
}

/// Picks the window for a menu item: the focused editor, else the primary one; queued when
/// none is open or the reopened `main` hasn't reported its context yet.
pub fn menu_target(focused: Option<&str>, primary: Option<&str>, queue: &MenuQueue) -> MenuTarget {
    if !queue.is_empty() {
        return MenuTarget::QueueForMain;
    }
    match focused.or(primary) {
        Some(l) => MenuTarget::Window(l.to_string()),
        None => MenuTarget::QueueForMain,
    }
}

/// Menu items (`(event, action)`) waiting for the reopened `main` window.
#[derive(Debug, Default)]
pub struct MenuQueue {
    items: Vec<(String, String)>,
}

impl MenuQueue {
    pub fn push(&mut self, event: &str, action: &str) {
        self.items.push((event.to_string(), action.to_string()));
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The items for `label` once its page is ready: only `main` was opened for them.
    pub fn take_for(&mut self, label: &str) -> Vec<(String, String)> {
        if label != "main" {
            return Vec::new();
        }
        std::mem::take(&mut self.items)
    }

    /// `label` closed before its page was ready: its items go with it.
    pub fn forget(&mut self, label: &str) {
        if label == "main" {
            self.items.clear();
        }
    }
}

/// Sends `{ action }` as `event` to the focused editor window (else the primary one). With no
/// editor window open, reopens `main` and runs the item once its page is ready
/// ([`deliver_pending`]).
fn emit_to_editor<Rt: Runtime>(app: &AppHandle<Rt>, event: &str, action: &str) {
    use tauri::{Emitter, Manager};
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| crate::window::is_editor_label(w.label()) && w.is_focused().unwrap_or(false));
    let primary = crate::window::primary_editor(app);
    let st = crate::state::state(app);
    let mut queue = st.pending_menu.lock().unwrap();
    let target = menu_target(
        focused.as_ref().map(|w| w.label()),
        primary.as_ref().map(|w| w.label()),
        &queue,
    );
    match target {
        MenuTarget::Window(label) => {
            drop(queue);
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.set_focus();
            }
            let _ = app.emit_to(
                label.as_str(),
                event,
                serde_json::json!({ "action": action }),
            );
        }
        MenuTarget::QueueForMain => {
            queue.push(event, action);
            drop(queue);
            match crate::window::create_editor_window(app, "main") {
                Ok(w) => {
                    let _ = w.set_focus();
                }
                Err(e) => {
                    st.pending_menu.lock().unwrap().forget("main");
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    app.dialog()
                        .message(e.message)
                        .title("Couldn't open a window")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            }
        }
    }
}

/// `kimo_menu_set_context` from `label`: its page listens now, so the queued items run there.
pub fn deliver_pending<Rt: Runtime>(app: &AppHandle<Rt>, label: &str) {
    use tauri::Emitter;
    let items = crate::state::state(app)
        .pending_menu
        .lock()
        .unwrap()
        .take_for(label);
    for (event, action) in items {
        let _ = app.emit_to(label, &event, serde_json::json!({ "action": action }));
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
    fn file_and_view_items_map_to_editor_actions() {
        assert_eq!(editor_action_for(FILE_EXPORT), Some("export"));
        assert_eq!(editor_action_for(FILE_COPY_PNG), Some("copy-png"));
        assert_eq!(editor_action_for(VIEW_PREVIEW), Some("preview"));
        assert_eq!(editor_action_for(HELP_DOCS), None);
        assert_eq!(help_action_for(FILE_EXPORT), None);
        assert_eq!(settings_pane_for(VIEW_PREVIEW), None);
    }

    #[test]
    fn file_and_edit_items_map_to_page_actions() {
        assert_eq!(editor_action_for(FILE_HOME), Some("go-home"));
        assert_eq!(editor_action_for(FILE_NEW), Some("new-file"));
        assert_eq!(editor_action_for(FILE_OPEN), Some("open-file"));
        assert_eq!(editor_action_for(EDIT_UNDO), Some("undo"));
        assert_eq!(editor_action_for(EDIT_REDO), Some("redo"));
        assert_eq!(editor_action_for(EDIT_SELECT_ALL), Some("select-all"));
        // New window runs in Rust.
        assert_eq!(editor_action_for(FILE_NEW_WINDOW), None);
        assert_eq!(text_command_for("select-all"), Some("selectAll"));
        assert_eq!(text_command_for("undo"), Some("undo"));
        assert_eq!(text_command_for("export"), None);
    }

    /// Every action Rust emits is a member of `EditorMenuAction` in platform types.ts.
    #[test]
    fn editor_actions_match_platform_ts() {
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/platform/src/types.ts"
        ))
        .unwrap()
        // A Windows checkout may have CRLF line endings.
        .replace("\r\n", "\n");
        let union = ts
            .split("export type EditorMenuAction =")
            .nth(1)
            .unwrap()
            .split("\n\n")
            .next()
            .unwrap();
        let ts_actions: Vec<&str> = union.split('"').skip(1).step_by(2).collect();
        let ids = [
            FILE_EXPORT,
            FILE_COPY_PNG,
            VIEW_PREVIEW,
            FILE_HOME,
            FILE_NEW,
            FILE_OPEN,
            EDIT_UNDO,
            EDIT_REDO,
            EDIT_SELECT_ALL,
        ];
        let rust: Vec<&str> = ids.iter().filter_map(|i| editor_action_for(i)).collect();
        assert_eq!(rust.len(), ids.len());
        let mut a = rust.clone();
        let mut b = ts_actions.clone();
        a.sort_unstable();
        b.sort_unstable();
        assert_eq!(a, b);
    }

    #[test]
    fn document_items_follow_the_context() {
        for id in DOCUMENT_ITEMS {
            assert!(enabled_in(MenuContext::Editor, id));
            assert!(!enabled_in(MenuContext::Home, id));
            assert!(!enabled_in(MenuContext::Other, id));
        }
        for id in [
            FILE_NEW,
            FILE_OPEN,
            FILE_NEW_WINDOW,
            EDIT_UNDO,
            EDIT_SELECT_ALL,
        ] {
            assert!(enabled_in(MenuContext::Home, id));
            assert!(enabled_in(MenuContext::Other, id));
        }
        assert_eq!(MenuContext::parse("home"), Some(MenuContext::Home));
        assert_eq!(MenuContext::parse("editor"), Some(MenuContext::Editor));
        assert_eq!(MenuContext::parse("settings"), None);
    }

    #[test]
    fn items_with_no_editor_window_wait_for_main() {
        let mut q = MenuQueue::default();
        // An editor window is open: the focused one wins, else the primary one.
        assert_eq!(
            menu_target(Some("editor-2"), Some("main"), &q),
            MenuTarget::Window("editor-2".into())
        );
        assert_eq!(
            menu_target(None, Some("main"), &q),
            MenuTarget::Window("main".into())
        );
        // Every editor window closed (only Settings / the document host left): queue, open main.
        assert_eq!(menu_target(None, None, &q), MenuTarget::QueueForMain);
        q.push("kimo://editor-menu", "new-file");
        // main exists but its page hasn't reported yet: later items queue behind the first.
        assert_eq!(
            menu_target(None, Some("main"), &q),
            MenuTarget::QueueForMain
        );
        q.push("kimo://help-menu", "shortcuts");
        // Another window reporting doesn't take main's items.
        assert!(q.take_for("editor-2").is_empty());
        assert_eq!(
            q.take_for("main"),
            vec![
                ("kimo://editor-menu".to_string(), "new-file".to_string()),
                ("kimo://help-menu".to_string(), "shortcuts".to_string()),
            ]
        );
        assert!(q.is_empty());
        assert_eq!(
            menu_target(None, Some("main"), &q),
            MenuTarget::Window("main".into())
        );
        // main closed before its page was ready: its items are dropped, not sent later.
        q.push("kimo://editor-menu", "open-file");
        q.forget("main");
        assert!(q.is_empty());
    }

    #[test]
    fn new_windows_get_the_next_free_label() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(next_editor_label(&s(&["main"])), "editor-2");
        assert_eq!(
            next_editor_label(&s(&["main", "editor-2", "settings"])),
            "editor-3"
        );
        assert_eq!(next_editor_label(&s(&["main", "editor-3"])), "editor-2");
        assert!(crate::window::is_editor_label(&next_editor_label(&[])));
    }

    #[test]
    fn whats_new_names_the_release_line() {
        assert_eq!(whats_new_label("1.0.0"), "What's new in 1.0");
        assert_eq!(whats_new_label("1.2.3-beta.1"), "What's new in 1.2");
        assert_eq!(whats_new_label("0.0.0"), "What's new in 0.0");
    }
}
