//! Plain-text clipboard writes from Rust (audit G3): WKWebView only lets a page write the
//! clipboard during a user gesture, and a native menu item (Help › Copy diagnostics) is not one.
//! macOS writes `NSPasteboard.generalPasteboard` on the main thread. Windows and Linux reject
//! with `BLOCKED`, so the page falls back to `navigator.clipboard` (their webviews allow it).

use crate::error::R;
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
pub fn write_text<Rt: Runtime>(app: &AppHandle<Rt>, text: String) -> R<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        // SAFETY: an AppKit constant, read on the main thread.
        let ok = pb.setString_forType(&NSString::from_str(&text), unsafe {
            NSPasteboardTypeString
        });
        let _ = tx.send(ok);
    })
    .map_err(|e| crate::error::io_msg(format!("Could not reach the clipboard: {e}")))?;
    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(true) => Ok(()),
        Ok(false) => Err(crate::error::io_msg("The clipboard refused the text")),
        Err(_) => Err(crate::error::io_msg("The clipboard did not answer")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn write_text<Rt: Runtime>(_app: &AppHandle<Rt>, _text: String) -> R<()> {
    Err(crate::error::blocked(
        "No native clipboard on this platform; the page writes it",
    ))
}
