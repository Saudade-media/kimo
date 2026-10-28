//! macOS overlay title bar (board 20 Topbar, 48 pt tall): the traffic lights and the title bar
//! double-click.
//!
//! Tao insets the lights with the size of the system's old 12 pt buttons in mind and never moves
//! them vertically. macOS 26 draws 14 pt buttons at a 23 pt pitch, so the lights sat about 8 pt
//! above the topbar's middle and their right edge ran into the breadcrumb. This module reads the
//! real `standardWindowButton` frames, centers the buttons on the topbar and reports the right
//! edge of the zoom button, which the web uses as the topbar's leading inset.
//!
//! The geometry helpers below are only called by the macOS code, but they stay platform-neutral
//! so their unit tests run on every platform.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;

/// Height of the Settings sidebar's lights row (board 19; board 20's editor topbar before tabs).
pub const TOPBAR_HEIGHT: f64 = 48.0;
/// Board 44 §1 "Tab Strip" (6LTyzBnoUm): the editor window's tab strip hosts the lights, 46 pt.
pub const TAB_STRIP_HEIGHT: f64 = 46.0;
/// The close button's left edge, the design's padding-left (02d TrafficLights) and the `x` of
/// `window::TRAFFIC_LIGHTS`.
pub const LIGHTS_X: f64 = 16.0;
/// Corrections below this many points are not worth a relayout.
pub const TOLERANCE: f64 = 0.25;

/// Vertical center of the lights, measured from the window's top edge.
pub fn center_target() -> f64 {
    TOPBAR_HEIGHT / 2.0
}

/// The lights' center for window `label`: editor windows center them on the board 44 tab strip,
/// Settings on its 48 pt lights row.
pub fn center_target_for(label: &str) -> f64 {
    if crate::window::is_editor_label(label) {
        TAB_STRIP_HEIGHT / 2.0
    } else {
        center_target()
    }
}

/// New `y` of a button inside its titlebar container (AppKit's y axis points up) that moves
/// its center from `current_center_from_top` to `target_center_from_top`.
pub fn corrected_origin_y(
    origin_y: f64,
    current_center_from_top: f64,
    target_center_from_top: f64,
) -> f64 {
    origin_y + (current_center_from_top - target_center_from_top)
}

/// Right edge of the zoom button in window points (Tao places the close button's left edge
/// at the 16 pt of `window::TRAFFIC_LIGHTS`).
pub fn lights_right(zoom_origin_x: f64, zoom_width: f64) -> f64 {
    zoom_origin_x + zoom_width
}

/// The topbar's leading inset for a lights right edge. The design's 68 is the right edge of
/// the 12 pt lights (16 + 3 × 12 + 2 × 8); the 8 pt topbar gap and the breadcrumb's own
/// 4 pt padding add the 12 pt of air, so the inset is the edge itself, rounded up.
pub fn topbar_inset(lights_right: f64) -> u32 {
    lights_right.ceil().max(0.0) as u32
}

/// System setting "Double-click a window's title bar to" (`AppleActionOnDoubleClick`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TitlebarAction {
    Zoom,
    Minimize,
    None,
}

/// Maps the preference value. Missing means the system default (zoom); `Fill` (macOS 15+) is
/// the zoom button's own behavior; unknown values do nothing rather than guess.
pub fn titlebar_action(pref: Option<&str>) -> TitlebarAction {
    match pref {
        None | Some("Maximize") | Some("Fill") => TitlebarAction::Zoom,
        Some("Minimize") => TitlebarAction::Minimize,
        _ => TitlebarAction::None,
    }
}

#[cfg(target_os = "macos")]
pub use mac::{double_click, lights_right_of, schedule};

#[cfg(not(target_os = "macos"))]
pub fn lights_right_of(_label: &str) -> Option<f64> {
    None
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSButton, NSWindow, NSWindowButton};
    use objc2_foundation::{ns_string, NSUserDefaults};
    use std::collections::{HashMap, HashSet};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{Emitter, Manager, Runtime, WebviewWindow};

    fn lights() -> &'static Mutex<HashMap<String, f64>> {
        static M: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
        M.get_or_init(Default::default)
    }

    fn pending() -> &'static Mutex<HashSet<String>> {
        static M: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        M.get_or_init(Default::default)
    }

    /// Last measured right edge of the zoom button for this window.
    pub fn lights_right_of(label: &str) -> Option<f64> {
        lights().lock().unwrap().get(label).copied()
    }

    struct Buttons {
        close: Retained<NSButton>,
        mini: Retained<NSButton>,
        zoom: Retained<NSButton>,
        window_height: f64,
    }

    fn buttons(win: &NSWindow) -> Option<Buttons> {
        Some(Buttons {
            close: win.standardWindowButton(NSWindowButton::CloseButton)?,
            mini: win.standardWindowButton(NSWindowButton::MiniaturizeButton)?,
            zoom: win.standardWindowButton(NSWindowButton::ZoomButton)?,
            window_height: win.frame().size.height,
        })
    }

    /// Button rectangle in window coordinates (y up from the window's bottom edge).
    fn in_window(b: &NSButton) -> objc2_foundation::NSRect {
        b.convertRect_toView(b.bounds(), None)
    }

    fn center_from_top(b: &NSButton, window_height: f64) -> f64 {
        let r = in_window(b);
        window_height - (r.origin.y + r.size.height / 2.0)
    }

    /// One pass on the main thread. Returns the remaining vertical error and the zoom
    /// button's right edge.
    fn pass(win: &NSWindow, target: f64) -> Option<(f64, f64)> {
        let b = buttons(win)?;
        let err = center_from_top(&b.close, b.window_height) - target;
        let dx = LIGHTS_X - in_window(&b.close).origin.x;
        if err.abs() > TOLERANCE || dx.abs() > TOLERANCE {
            for btn in [&b.close, &b.mini, &b.zoom] {
                let mut o = btn.frame().origin;
                o.y = corrected_origin_y(o.y, center_from_top(btn, b.window_height), target);
                o.x += dx;
                btn.setFrameOrigin(o);
            }
        }
        let z = in_window(&b.zoom);
        Some((err, lights_right(z.origin.x, z.size.width)))
    }

    /// Centers the lights on the topbar and publishes their right edge, now and again a few
    /// times: Tao re-insets the titlebar container on its next draw, and AppKit resets the
    /// buttons when leaving fullscreen or changing the title. Coalesces bursts (live resize).
    pub fn schedule<Rt: Runtime>(w: &WebviewWindow<Rt>) {
        if !crate::window::has_overlay_chrome(w.label()) {
            return;
        }
        if !pending().lock().unwrap().insert(w.label().to_string()) {
            return;
        }
        let w = w.clone();
        let target = center_target_for(w.label());
        std::thread::spawn(move || {
            for delay_ms in [0u64, 60, 120, 250, 500] {
                std::thread::sleep(Duration::from_millis(delay_ms));
                let w2 = w.clone();
                let _ = w.run_on_main_thread(move || {
                    let Ok(ptr) = w2.ns_window() else { return };
                    // SAFETY: Tauri hands out the live NSWindow of this window and we are on
                    // the main thread; the reference does not outlive the closure.
                    let win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                    if let Some((_, edge)) = pass(win, target) {
                        let right = f64::from(topbar_inset(edge));
                        let changed = {
                            let mut g = lights().lock().unwrap();
                            g.insert(w2.label().to_string(), right) != Some(right)
                        };
                        if changed {
                            let _ = w2.app_handle().emit_to(
                                w2.label(),
                                "kimo://window-state",
                                crate::window::window_state(&w2),
                            );
                        }
                    }
                });
            }
            pending().lock().unwrap().remove(w.label());
        });
    }

    /// Runs the system's title bar double-click action on the window.
    pub fn double_click<Rt: Runtime>(w: &WebviewWindow<Rt>) -> tauri::Result<()> {
        let w2 = w.clone();
        w.run_on_main_thread(move || {
            let pref = NSUserDefaults::standardUserDefaults()
                .stringForKey(ns_string!("AppleActionOnDoubleClick"))
                .map(|s| s.to_string());
            let Ok(ptr) = w2.ns_window() else { return };
            // SAFETY: as in `schedule`.
            let win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            let none: Option<&AnyObject> = None;
            match titlebar_action(pref.as_deref()) {
                TitlebarAction::Zoom => {
                    if win
                        .standardWindowButton(NSWindowButton::ZoomButton)
                        .is_some_and(|z| z.isEnabled())
                    {
                        win.performZoom(none);
                    }
                }
                TitlebarAction::Minimize => win.performMiniaturize(none),
                TitlebarAction::None => {}
            }
        })
    }
}
