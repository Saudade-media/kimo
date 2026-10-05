//! Board 32 "Dock activity" (desing.pen JzzEa): the macOS Dock tile animates while any agent
//! works, i.e. a built-in Agent turn reported by an editor window (`kimo_dock_agent_activity`),
//! an MCP `tools/call` in flight in the relay (socket or HTTP), or one received / answered in
//! the last [`ACTIVITY_WINDOW_MS`]. It stops after [`IDLE_GRACE_MS`] with nothing working, at
//! the end of the current beat, and hands the tile back to the normal icon (`contentView = nil`).
//!
//! The frames are pre-rendered by `apps/desktop/scripts/dock-frames.ts` ([`crate::dock_frames`]).
//! Playback is a short-lived thread that paces the frames and pushes each one to the main thread
//! (`NSDockTile.display()`); it exits with the animation, so idle costs nothing. Windows and
//! Linux only track the state (the static icon never changes).

use crate::dock_frames::{MOTION, MOTION_FPS, REDUCED, REDUCED_FPS};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// An MCP call received or answered this recently still counts as working.
pub const ACTIVITY_WINDOW_MS: u64 = 2000;
/// The loop keeps running this long after the last working moment (no flicker between bursts).
pub const IDLE_GRACE_MS: u64 = 1500;
/// An agent source that has not re-reported `working` for this long is dropped (reload, crash).
/// The web side re-sends every 5 s while a turn runs.
pub const AGENT_STALE_MS: u64 = 15_000;
/// A `tools/call` never answered (host gone) stops counting after this long.
pub const CALL_STALE_MS: u64 = 300_000;

/// What is working right now, with the debounce. Times are ms on any monotonic clock.
#[derive(Debug, Default)]
pub struct Activity {
    /// Agent source → last `working` report.
    agents: HashMap<String, u64>,
    /// (connection, JSON-RPC id key) → start of an in-flight `tools/call`.
    calls: HashMap<(String, String), u64>,
    last_mcp: Option<u64>,
    last_busy: Option<u64>,
}

impl Activity {
    pub fn agent(&mut self, source: &str, working: bool, now: u64) {
        if working {
            self.agents.insert(source.to_string(), now);
        } else if self.agents.remove(source).is_some() {
            self.last_busy = Some(now);
        }
    }

    pub fn call_started(&mut self, conn: &str, id: &str, now: u64) {
        self.calls.insert((conn.to_string(), id.to_string()), now);
        self.last_mcp = Some(now);
    }

    pub fn call_finished(&mut self, conn: &str, id: &str, now: u64) {
        if self
            .calls
            .remove(&(conn.to_string(), id.to_string()))
            .is_some()
        {
            self.last_mcp = Some(now);
        }
    }

    pub fn connection_closed(&mut self, conn: &str) {
        self.calls.retain(|(c, _), _| c != conn);
    }

    /// Any agent working now (no grace).
    pub fn working(&mut self, now: u64) -> bool {
        self.agents
            .retain(|_, t| now.saturating_sub(*t) < AGENT_STALE_MS);
        self.calls
            .retain(|_, t| now.saturating_sub(*t) < CALL_STALE_MS);
        !self.agents.is_empty()
            || !self.calls.is_empty()
            || self
                .last_mcp
                .is_some_and(|t| now.saturating_sub(t) < ACTIVITY_WINDOW_MS)
    }

    /// Debounced: true while working and for [`IDLE_GRACE_MS`] after the last working moment.
    pub fn animate(&mut self, now: u64) -> bool {
        if self.working(now) {
            self.last_busy = Some(now);
            return true;
        }
        self.last_busy
            .is_some_and(|t| now.saturating_sub(t) < IDLE_GRACE_MS)
    }
}

/// One playback step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Show this image of [`crate::dock_frames::IMAGES`] (or `FLAT_IMAGES`, same indices).
    Show(usize),
    /// Hand the tile back to the normal icon.
    Done,
}

/// Walks a frame sequence; once asked to stop it plays on to the next rest frame (a frame that
/// shows the same image as frame 0, i.e. the static icon), so a beat is never cut mid-turn.
#[derive(Debug)]
pub struct Player {
    seq: &'static [u8],
    frame: usize,
}

impl Player {
    pub fn new(seq: &'static [u8]) -> Self {
        Self { seq, frame: 0 }
    }

    pub fn frame(&self) -> usize {
        self.frame
    }

    fn at_rest(&self) -> bool {
        self.seq[self.frame] == self.seq[0]
    }

    pub fn step(&mut self, animate: bool) -> Step {
        if !animate && self.at_rest() {
            return Step::Done;
        }
        let img = self.seq[self.frame] as usize;
        self.frame = (self.frame + 1) % self.seq.len();
        Step::Show(img)
    }
}

// --- Service --------------------------------------------------------------------------------------

struct Service {
    epoch: Instant,
    state: Mutex<Activity>,
    running: AtomicBool,
    app: OnceLock<tauri::AppHandle>,
}

fn service() -> &'static Service {
    static S: OnceLock<Service> = OnceLock::new();
    S.get_or_init(|| Service {
        epoch: Instant::now(),
        state: Mutex::new(Activity::default()),
        running: AtomicBool::new(false),
        app: OnceLock::new(),
    })
}

impl Service {
    fn now(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn lock(&self) -> MutexGuard<'_, Activity> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn update(&self, f: impl FnOnce(&mut Activity, u64)) {
        let now = self.now();
        f(&mut self.lock(), now);
        self.kick();
    }

    fn animate(&self) -> bool {
        let now = self.now();
        self.lock().animate(now)
    }

    /// Starts the player when something works and it is not running yet.
    fn kick(&self) {
        let Some(app) = self.app.get() else { return };
        if !cfg!(target_os = "macos")
            || !self.animate()
            || self.running.swap(true, Ordering::SeqCst)
        {
            return;
        }
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("kimo-dock-activity".into())
            .spawn(move || play(app));
        if spawned.is_err() {
            self.running.store(false, Ordering::SeqCst);
        }
    }
}

/// Setup: playback needs the app handle (the state is tracked before that too).
pub fn install(app: &tauri::AppHandle) {
    let _ = service().app.set(app.clone());
}

/// The app icon (`icons/128x128@2x.png`, 256 px) for runs outside an `.app` bundle, where
/// macOS would otherwise show the generic executable icon once the tile is handed back.
pub static FALLBACK_ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// True when `exe` runs from inside an `.app` bundle (`Kimo.app/Contents/MacOS/kimo-desktop`).
pub fn in_app_bundle(exe: &std::path::Path) -> bool {
    exe.parent()
        .filter(|d| d.ends_with("Contents/MacOS"))
        .and_then(|d| d.parent()?.parent())
        .and_then(|b| b.extension())
        .is_some_and(|e| e == "app")
}

/// `kimo_dock_agent_activity`: one agent controller's turn state (`source` is window-scoped).
pub fn report_agent(source: &str, working: bool) {
    service().update(|a, now| a.agent(source, working, now));
}

/// The relay received a `tools/call` request.
pub fn mcp_call_started(conn: &str, id: &str) {
    service().update(|a, now| a.call_started(conn, id, now));
}

/// The host answered a request (a no-op unless it was a tracked `tools/call`).
pub fn mcp_call_finished(conn: &str, id: &str) {
    service().update(|a, now| a.call_finished(conn, id, now));
}

pub fn mcp_connection_closed(conn: &str) {
    service().update(|a, _| a.connection_closed(conn));
}

/// An in-flight `tools/call` for the length of a scope (Streamable HTTP requests).
pub struct McpCallGuard {
    conn: String,
    id: String,
}

impl McpCallGuard {
    pub fn new(conn: &str, id: &str) -> Self {
        mcp_call_started(conn, id);
        Self {
            conn: conn.to_string(),
            id: id.to_string(),
        }
    }
}

impl Drop for McpCallGuard {
    fn drop(&mut self) {
        mcp_call_finished(&self.conn, &self.id);
    }
}

/// Board 32 rule "Icon treatment": the treated frames match the Dock's idle icon from macOS 26.
pub fn treated_icons(macos_major: isize) -> bool {
    macos_major >= 26
}

/// True when a JSON-RPC message (object or batch) contains a `tools/call` request.
pub fn is_tools_call(body: &[u8]) -> bool {
    fn one(v: &serde_json::Value) -> bool {
        v.get("method").and_then(|m| m.as_str()) == Some("tools/call")
    }
    match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(serde_json::Value::Array(a)) => a.iter().any(one),
        Ok(v) => one(&v),
        Err(_) => false,
    }
}

/// The playback thread: paces frames until the player is done, then exits (re-checking for a
/// report that raced the exit).
fn play(app: tauri::AppHandle) {
    let s = service();
    loop {
        let (seq, fps): (&'static [u8], u32) = if mac::reduce_motion() {
            (&REDUCED, REDUCED_FPS)
        } else {
            (&MOTION, MOTION_FPS)
        };
        let period = Duration::from_secs_f64(1.0 / f64::from(fps));
        let mut player = Player::new(seq);
        let mut next = Instant::now();
        let mut shown = None;
        loop {
            match player.step(s.animate()) {
                // The rest of a beat repeats one image: no main-thread hop, no Dock redraw.
                Step::Show(i) if shown == Some(i) => {}
                Step::Show(i) => {
                    shown = Some(i);
                    let _ = app.run_on_main_thread(move || mac::show(i));
                }
                Step::Done => {
                    let _ = app.run_on_main_thread(mac::restore);
                    break;
                }
            }
            next += period;
            std::thread::sleep(next.saturating_duration_since(Instant::now()));
        }
        s.running.store(false, Ordering::SeqCst);
        if !s.animate() || s.running.swap(true, Ordering::SeqCst) {
            return;
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use crate::dock_frames::{FLAT_IMAGES, IMAGES};
    use objc2::rc::Retained;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage, NSImageScaling, NSImageView, NSWorkspace};
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize};
    use std::cell::RefCell;

    struct Tile {
        view: Retained<NSImageView>,
        /// Decoded on first use, then kept for the app's lifetime (~57 small images).
        images: Vec<Option<Retained<NSImage>>>,
        attached: bool,
    }

    thread_local! {
        static TILE: RefCell<Option<Tile>> = const { RefCell::new(None) };
    }

    /// macOS 26+ draws app icons with the system icon treatment (rim, depth, shaded mark), and
    /// the frames carry the same treatment; earlier macOS shows the flat icon.
    fn frames() -> &'static [&'static [u8]] {
        let os = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        if super::treated_icons(os.majorVersion) {
            &IMAGES
        } else {
            &FLAT_IMAGES
        }
    }

    /// System Settings › Accessibility › Display › Reduce motion (read at each start).
    pub fn reduce_motion() -> bool {
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
    }

    /// Main thread: shows image `index` in the Dock tile.
    pub fn show(index: usize) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        TILE.with_borrow_mut(|slot| {
            let tile = slot.get_or_insert_with(|| {
                let view = NSImageView::new(mtm);
                // Images are sized to the tile (below): drawn 1:1, never resampled.
                view.setImageScaling(NSImageScaling::ScaleNone);
                Tile {
                    view,
                    images: vec![None; frames().len()],
                    attached: false,
                }
            });
            let Some(bytes) = frames().get(index) else {
                return;
            };
            if tile.images[index].is_none() {
                let data = NSData::with_bytes(bytes);
                let image = NSImage::initWithData(NSImage::alloc(), &data);
                // 256 px frames as a 128 pt image: the 2x tile maps pixels 1:1.
                let points = f64::from(crate::dock_frames::SIZE) / 2.0;
                if let Some(i) = &image {
                    i.setSize(NSSize::new(points, points));
                }
                tile.images[index] = image;
            }
            let Some(image) = &tile.images[index] else {
                return;
            };
            tile.view.setImage(Some(image));
            let dock = NSApplication::sharedApplication(mtm).dockTile();
            if !tile.attached {
                tile.view
                    .setFrame(NSRect::new(NSPoint::new(0.0, 0.0), dock.size()));
                dock.setContentView(Some(&tile.view));
                tile.attached = true;
            }
            dock.display();
        });
    }

    /// Main thread: the normal app icon again.
    pub fn restore() {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        TILE.with_borrow_mut(|slot| {
            if let Some(tile) = slot.as_mut() {
                tile.attached = false;
            }
        });
        let app = NSApplication::sharedApplication(mtm);
        let dock = app.dockTile();
        dock.setContentView(None);
        // In a bundle, clearing the content view brings back the system-drawn bundle icon.
        // Outside one (`tauri dev`, a bare binary) it would show the generic executable icon
        // (it drops the runtime `applicationIconImage`), so set Kimo's icon again.
        let bundled = std::env::current_exe()
            .map(|e| super::in_app_bundle(&e))
            .unwrap_or(false);
        if !bundled {
            let data = NSData::with_bytes(super::FALLBACK_ICON);
            if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) {
                // SAFETY: main thread; a valid, non-nil image.
                unsafe { app.setApplicationIconImage(Some(&icon)) };
            }
        }
        dock.display();
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    pub fn reduce_motion() -> bool {
        false
    }
    pub fn show(_index: usize) {}
    pub fn restore() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dock_frames::{FLAT_IMAGES, IMAGES, SIZE};

    #[test]
    fn restore_icon_outside_a_bundle() {
        use std::path::Path;
        assert!(in_app_bundle(Path::new(
            "/Applications/Kimo.app/Contents/MacOS/kimo-desktop"
        )));
        assert!(!in_app_bundle(Path::new(
            "/repo/apps/desktop/src-tauri/target/release/kimo-desktop"
        )));
        assert!(!in_app_bundle(Path::new(
            "/tmp/Contents/MacOS/kimo-desktop"
        )));
        // The fallback is the shipped 256 px app icon (PNG, IHDR width/height 256).
        assert_eq!(&FALLBACK_ICON[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&FALLBACK_ICON[16..24], &[0, 0, 1, 0, 0, 0, 1, 0]);
    }

    #[test]
    fn idle_until_something_works() {
        let mut a = Activity::default();
        assert!(!a.animate(0));
        assert!(!a.animate(10_000));
    }

    #[test]
    fn agent_turn_animates_then_grace() {
        let mut a = Activity::default();
        a.agent("main:agent-1", true, 1000);
        assert!(a.animate(1000));
        assert!(a.animate(5000)); // still within AGENT_STALE_MS of the report
        a.agent("main:agent-1", false, 6000);
        assert!(!a.working(6000));
        assert!(a.animate(6000 + IDLE_GRACE_MS - 1));
        assert!(!a.animate(6000 + IDLE_GRACE_MS));
    }

    #[test]
    fn any_of_several_sources_keeps_it_running() {
        let mut a = Activity::default();
        a.agent("main:a", true, 0);
        a.agent("editor-2:a", true, 0);
        a.agent("main:a", false, 100);
        assert!(a.working(200));
        a.agent("editor-2:a", false, 300);
        assert!(!a.working(300));
        // Ending an unknown source is not activity.
        let mut b = Activity::default();
        b.agent("x", false, 0);
        assert!(!b.animate(0));
    }

    #[test]
    fn silent_agent_source_goes_stale() {
        let mut a = Activity::default();
        a.agent("main:a", true, 0);
        assert!(a.working(AGENT_STALE_MS - 1));
        assert!(!a.working(AGENT_STALE_MS));
        // Re-reports keep it alive.
        a.agent("main:a", true, 20_000);
        assert!(a.working(20_000 + AGENT_STALE_MS - 1));
    }

    #[test]
    fn mcp_call_in_flight_then_activity_window_then_grace() {
        let mut a = Activity::default();
        a.call_started("c_1", "7", 0);
        assert!(a.working(60_000)); // long tool call
        a.call_finished("c_1", "7", 60_000);
        assert!(a.working(60_000 + ACTIVITY_WINDOW_MS - 1));
        assert!(a.animate(60_000 + ACTIVITY_WINDOW_MS - 1));
        let end = 60_000 + ACTIVITY_WINDOW_MS;
        assert!(!a.working(end));
        assert!(a.animate(end + IDLE_GRACE_MS - 2));
        assert!(!a.animate(end + IDLE_GRACE_MS));
    }

    #[test]
    fn burst_of_calls_never_drops_between_calls() {
        let mut a = Activity::default();
        let mut t = 0;
        for i in 0..10 {
            a.call_started("c_1", &i.to_string(), t);
            a.call_finished("c_1", &i.to_string(), t + 50);
            t += 2500; // gaps longer than the activity window, shorter than window + grace
            for probe in (t - 2500..t).step_by(100) {
                assert!(a.animate(probe), "dropped at {probe}");
            }
        }
    }

    #[test]
    fn closed_connection_and_stale_calls_stop_counting() {
        let mut a = Activity::default();
        a.call_started("c_1", "1", 0);
        a.connection_closed("c_1");
        assert!(!a.working(ACTIVITY_WINDOW_MS));
        a.call_started("c_2", "1", 0);
        assert!(!a.working(CALL_STALE_MS));
        // Finishing an untracked id is not activity.
        let mut b = Activity::default();
        b.call_finished("c_9", "1", 0);
        assert!(!b.working(0));
    }

    #[test]
    fn tools_call_detection() {
        assert!(is_tools_call(
            br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}"#
        ));
        assert!(is_tools_call(
            br#"[{"method":"ping","id":1},{"method":"tools/call","id":2}]"#
        ));
        assert!(!is_tools_call(br#"{"method":"tools/list","id":1}"#));
        assert!(!is_tools_call(b"not json"));
    }

    /// Frame tables: frame 0 is the static icon in both loops, the motion loop ends on a rest
    /// (seamless: frame N == frame 0), and every index points at an image.
    #[test]
    fn frame_tables_loop_seamlessly() {
        assert_eq!(SIZE, 256);
        assert_eq!((MOTION.len(), MOTION_FPS), (60, 30));
        assert_eq!((REDUCED.len(), REDUCED_FPS), (30, 10));
        assert_eq!(MOTION[0], 0);
        assert_eq!(REDUCED[0], 0);
        assert_eq!(*MOTION.last().unwrap(), MOTION[0]);
        for &i in MOTION.iter().chain(REDUCED.iter()) {
            assert!((i as usize) < IMAGES.len());
        }
        // 0–1400 ms turns (frames 1..=41 differ from the icon), 1400–2000 ms rests.
        assert!(MOTION[1..42].iter().all(|&i| i != 0));
        assert!(MOTION[42..].iter().all(|&i| i == 0));
        // The reduced loop breathes symmetrically.
        for k in 1..REDUCED.len() {
            assert_eq!(REDUCED[k], REDUCED[REDUCED.len() - k]);
        }
        assert_eq!(IMAGES.len(), FLAT_IMAGES.len());
        assert!(treated_icons(26) && !treated_icons(15));
        for png in IMAGES.iter().chain(FLAT_IMAGES.iter()) {
            assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        }
    }

    #[test]
    fn player_finishes_the_beat_before_stopping() {
        let mut p = Player::new(&MOTION);
        // Run into the middle of the turn.
        for &img in &MOTION[..10] {
            assert_eq!(p.step(true), Step::Show(img as usize));
        }
        // Stop requested at frame 10: plays on through the turn (frames 10..=41) …
        for &img in &MOTION[10..42] {
            assert_eq!(p.step(false), Step::Show(img as usize));
        }
        // … and hands back at the first rest frame.
        assert_eq!(p.frame(), 42);
        assert_eq!(p.step(false), Step::Done);
    }

    #[test]
    fn player_wraps_and_a_new_report_cancels_the_stop() {
        let mut p = Player::new(&MOTION);
        for _ in 0..MOTION.len() {
            p.step(true);
        }
        assert_eq!(p.frame(), 0); // seamless wrap
        p.step(true);
        assert_eq!(p.step(false), Step::Show(MOTION[1] as usize));
        assert_eq!(p.step(true), Step::Show(MOTION[2] as usize));
        // Idle at the very start: nothing is shown.
        assert_eq!(Player::new(&REDUCED).step(false), Step::Done);
        // Reduced motion stops only at the end of its cycle.
        let mut r = Player::new(&REDUCED);
        r.step(true);
        let mut shown = 1;
        while r.step(false) != Step::Done {
            shown += 1;
        }
        assert_eq!(shown, REDUCED.len());
    }
}
