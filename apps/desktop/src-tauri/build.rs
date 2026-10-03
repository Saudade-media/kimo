// The app manifest turns every `kimo_*` command into an `allow-kimo-…` permission, so the
// capability file can grant exactly the command surface and nothing else (ADR 0012 §5).
include!("src/command_list.rs");

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
