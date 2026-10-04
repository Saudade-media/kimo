//! `kimo-mcp`: the stdio shim shipped inside the Kimo app (ADR 0008, ADR 0013 §7) and the
//! `kimo-socket/1` pieces the desktop app shares with it.
//!
//! The shim holds no tool logic: it frames, relays, heartbeats, answers from the embedded
//! `generated/tools.json` while the app is down, and exits with its parent.

pub mod conn;
pub mod launch;
pub mod offline;
pub mod paths;
pub mod protocol;
pub mod shim;
