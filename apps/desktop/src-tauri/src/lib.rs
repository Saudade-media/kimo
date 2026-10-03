//! Kimo desktop shell (ADR 0012 §5): the `kimo_*` command surface of `TauriCommandMap`
//! (packages/platform/src/tauri.ts), the `kimo://` events, windows, file association, deep
//! links, single instance and the updater. Rust routes and persists host state; it never owns
//! document content (ADR 0002): documents are only touched by the atomic write + read-back.

pub mod command_list;
mod commands;
pub mod error;
pub mod fonts;
pub mod fs_ops;
pub mod git;
pub mod leases;
pub mod links;
pub mod menu;
pub mod recents;
pub mod recovery;
pub mod scope;
pub mod settings;
mod state;
pub mod updater;
pub mod util;
mod watch;
mod window;

use state::AppState;
use std::sync::Arc;
use tauri::{Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;

fn kimo_home(app: &tauri::App) -> std::path::PathBuf {
    if let Some(h) = std::env::var_os("KIMO_HOME").filter(|h| !h.is_empty()) {
        return h.into();
    }
    app.path()
        .home_dir()
        .map(|h| h.join(".kimo"))
        .unwrap_or_else(|_| std::env::temp_dir().join("kimo"))
}

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default();
    // Must be registered first: a second launch forwards its argv here and exits.
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let st = state::state(app);
        let args: Vec<String> = argv.into_iter().skip(1).collect();
        // Deep links in argv reach the deep-link plugin (single-instance "deep-link" feature).
        let reqs: Vec<_> =
            links::requests_from_args(&args, std::path::Path::new(&cwd), "second-instance")
                .into_iter()
                .filter(|r| r.source != "deep-link")
                .collect();
        if reqs.is_empty() {
            if let Some(w) = window::primary_editor(app) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        for r in reqs {
            st.open_request(app, r);
        }
    }));

    // Board 20 Qj4uq: the macOS app menu holds About / Check for updates… / Settings… ⌘,.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);
    let builder = builder.on_menu_event(|app, event| menu::on_menu_event(app, event.id().as_ref()));

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let version = app.package_info().version.to_string();
            let st = Arc::new(AppState::new(
                kimo_home(app),
                &config_dir,
                &data_dir,
                version,
            ));
            app.manage(st.clone());
            let handle = app.handle().clone();

            // Cold-start argv (Windows/Linux file association, `kimo open`, deep links).
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().skip(1).collect();
            for r in links::requests_from_args(&args, &cwd, "argv") {
                st.open_request(&handle, r);
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let h = handle.clone();
            app.deep_link().on_open_url(move |event| {
                let st = state::state(&h);
                for url in event.urls() {
                    if let Some(l) = links::parse_deep_link(url.as_str()) {
                        st.open_request(
                            &h,
                            links::OpenRequest {
                                source: "deep-link",
                                refs: vec![l.path],
                                node: l.node,
                            },
                        );
                    }
                }
            });

            window::create_editor_window(&handle, "main").map_err(|e| e.to_string())?;
            Ok(())
        })
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::kimo_app_info,
            commands::kimo_fs_read_text,
            commands::kimo_fs_read_bytes,
            commands::kimo_fs_write_text_atomic,
            commands::kimo_fs_write_bytes_atomic,
            commands::kimo_fs_remove,
            commands::kimo_fs_stat,
            commands::kimo_fs_list,
            commands::kimo_fs_watch,
            commands::kimo_fs_unwatch,
            commands::kimo_fs_reveal,
            commands::kimo_fs_open_default,
            commands::kimo_open_url,
            commands::kimo_dialog_open_file,
            commands::kimo_dialog_save_file,
            commands::kimo_dialog_pick_folder,
            commands::kimo_recents_list_files,
            commands::kimo_recents_note_opened,
            commands::kimo_recents_remove_file,
            commands::kimo_recents_clear,
            commands::kimo_recents_list_folders,
            commands::kimo_recents_add_folder,
            commands::kimo_recents_remove_folder,
            commands::kimo_recents_scan_folder,
            commands::kimo_lease_acquire,
            commands::kimo_lease_release,
            commands::kimo_lease_inspect,
            commands::kimo_lease_watch,
            commands::kimo_lease_unwatch,
            commands::kimo_recovery_dir,
            commands::kimo_recovery_list,
            commands::kimo_recovery_write,
            commands::kimo_recovery_read,
            commands::kimo_recovery_discard,
            commands::kimo_recovery_prune,
            commands::kimo_git_state,
            commands::kimo_git_watch,
            commands::kimo_git_unwatch,
            commands::kimo_git_merge_driver_status,
            commands::kimo_git_install_merge_driver,
            commands::kimo_fonts_list_local,
            commands::kimo_fonts_load_local,
            commands::kimo_fonts_cache_get,
            commands::kimo_fonts_cache_put,
            commands::kimo_fonts_cache_list,
            commands::kimo_fonts_cache_stats,
            commands::kimo_fonts_cache_clear,
            commands::kimo_fonts_fetch_remote,
            commands::kimo_fonts_open_cache_folder,
            commands::kimo_updater_status,
            commands::kimo_updater_check,
            commands::kimo_updater_download,
            commands::kimo_updater_restart,
            commands::kimo_window_state,
            commands::kimo_window_set_title,
            commands::kimo_window_set_document_edited,
            commands::kimo_window_open_settings,
            commands::kimo_window_confirm_close,
            commands::kimo_window_close,
            commands::kimo_settings_get_all,
            commands::kimo_settings_set,
            commands::kimo_launch_take_initial,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Kimo desktop app");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            // Finder double-click / "Open With" (file association). `kimo://` URLs are handled
            // by the deep-link plugin.
            let refs: Vec<String> = urls
                .iter()
                .filter(|u| u.scheme() == "file")
                .filter_map(|u| u.to_file_path().ok())
                .filter(|p| util::is_kimo_path(p))
                .map(|p| util::path_str(&p))
                .collect();
            if !refs.is_empty() {
                state::state(app).open_request(
                    app,
                    links::OpenRequest {
                        source: "file-association",
                        refs,
                        node: None,
                    },
                );
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows && window::primary_editor(app).is_none() {
                let _ = window::create_editor_window(app, "main");
            }
        }
        RunEvent::ExitRequested { api, code, .. } => {
            // Quit asks every editor window first (flush-before-close); the app exits when the
            // last one is gone. `app.exit(code)` / restart pass through.
            if code.is_none() && window::request_quit(app) {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            state::state(app).leases.release_all_own();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    fn ts_commands() -> Vec<String> {
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/platform/src/tauri.ts"
        ))
        .unwrap();
        let block = ts
            .split("export const TAURI_COMMANDS = [")
            .nth(1)
            .unwrap()
            .split(']')
            .next()
            .unwrap();
        block
            .lines()
            .filter_map(|l| {
                l.trim()
                    .strip_prefix('"')?
                    .split('"')
                    .next()
                    .map(String::from)
            })
            .collect()
    }

    /// ADR 0012: "a test asserts that the TS list is complete, and the Rust side should add a
    /// matching test when it lands".
    #[test]
    fn command_surface_matches_tauri_ts() {
        let ts = ts_commands();
        assert_eq!(ts.len(), 62);
        let rust: Vec<String> = super::command_list::COMMANDS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(rust, ts, "command_list.rs must mirror TAURI_COMMANDS");

        let lib =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs")).unwrap();
        let handler = lib
            .split("generate_handler![")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap();
        let registered: BTreeSet<String> = handler
            .lines()
            .filter_map(|l| {
                l.trim()
                    .strip_prefix("commands::")?
                    .strip_suffix(',')
                    .map(String::from)
            })
            .collect();
        assert_eq!(registered, ts.iter().cloned().collect::<BTreeSet<_>>());

        let cap: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/capabilities/default.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let perms: BTreeSet<String> = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str().map(String::from))
            .collect();
        for c in &ts {
            assert!(
                perms.contains(&format!("allow-{}", c.replace('_', "-"))),
                "capability misses {c}"
            );
        }
        let extra: Vec<_> = perms
            .iter()
            .filter(|p| {
                !p.starts_with("allow-kimo-")
                    && !["core:event:allow-listen", "core:event:allow-unlisten"]
                        .contains(&p.as_str())
            })
            .collect();
        assert!(extra.is_empty(), "unexpected permissions: {extra:?}");
    }
}
