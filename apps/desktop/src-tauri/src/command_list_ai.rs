// The M6 command surface (ADR 0014 §4, §11), mirrored from `TAURI_SECRETS_COMMANDS`
// (packages/platform/src/secrets.ts) and `TAURI_CLI_COMMANDS` (packages/platform/src/cli-agents.ts).
// Kept apart from the frozen `COMMANDS`; shared by `build.rs` (app manifest permissions) and
// the parity test in `lib.rs`. Keep the TS order.
pub const SECRETS_COMMANDS: &[&str] = &[
    "kimo_secret_has",
    "kimo_secret_set",
    "kimo_secret_delete",
    "kimo_secret_list",
    "kimo_secret_hint",
    "kimo_ai_request",
    "kimo_ai_abort",
];

pub const CLI_COMMANDS: &[&str] = &[
    "kimo_cli_which",
    "kimo_cli_exec",
    "kimo_cli_home_file_exists",
    "kimo_cli_has_env",
    "kimo_cli_prepare_workspace",
    "kimo_cli_spawn",
    "kimo_cli_write",
    "kimo_cli_close_stdin",
    "kimo_cli_kill",
];

/// User skills (ADR 0014 §10), mirrored from `TAURI_SKILLS_COMMANDS`
/// (packages/platform/src/skills.ts). Editor windows and the document host only.
pub const SKILLS_COMMANDS: &[&str] = &[
    "kimo_skills_root",
    "kimo_skills_list",
    "kimo_skills_read",
    "kimo_skills_watch",
    "kimo_skills_unwatch",
];

/// The Settings window detects CLIs and manages keys, but never spawns or drives processes
/// (and never loads skills).
pub const AI_SETTINGS_EXCLUDED: &[&str] = &[
    "kimo_cli_prepare_workspace",
    "kimo_cli_spawn",
    "kimo_cli_write",
    "kimo_cli_close_stdin",
    "kimo_cli_kill",
    "kimo_skills_root",
    "kimo_skills_list",
    "kimo_skills_read",
    "kimo_skills_watch",
    "kimo_skills_unwatch",
];
