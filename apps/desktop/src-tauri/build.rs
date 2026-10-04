// The app manifest turns every `kimo_*` command into an `allow-kimo-…` permission, so the
// capability files can grant exactly the command surface and nothing else (ADR 0012 §5,
// ADR 0013 §11: the MCP commands live in their own list).
include!("src/command_list.rs");
include!("src/command_list_mcp.rs");

fn main() {
    let all: Vec<&'static str> = COMMANDS.iter().chain(MCP_COMMANDS).copied().collect();
    let _ = MCP_HOST_ONLY_COMMANDS;
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(all.leak())),
    )
    .expect("failed to run tauri-build");
}
