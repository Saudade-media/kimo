//! Kimo desktop shell. M0 only hosts the web editor; fs/dialog/watch, deep
//! links, the MCP socket host and the updater arrive at M4/M5 (teardown 9.2).

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Kimo desktop app");
}
