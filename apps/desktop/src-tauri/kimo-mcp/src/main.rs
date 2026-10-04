//! `kimo-mcp [--client <slug>] [--launch]`: MCP over stdio, relayed to the running Kimo app.

use kimo_mcp::shim::{run, Options};

const USAGE: &str = "Usage: kimo-mcp [--client <slug>] [--launch]

MCP server over stdio for the running Kimo desktop app (kimo-socket/1).

  --client <slug>  Name this agent host (claude-code, codex, gemini-cli, cursor, vscode, …)
  --launch         Start Kimo in the background if it is not running (waits up to 15 s)
  --version        Print the version
  --help           Show this help

Without the app, initialize and tools/list are answered from the bundled manifest and every
tools/call fails with APP_NOT_RUNNING; use `kimo mcp` for headless editing.";

fn main() {
    let mut client = None;
    let mut launch = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--client" => client = args.next().filter(|s| !s.is_empty()),
            s if s.starts_with("--client=") => {
                client = Some(s["--client=".len()..].to_string()).filter(|s| !s.is_empty())
            }
            "--launch" => launch = true,
            "--version" | "-V" => {
                println!("kimo-mcp {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                return;
            }
            other => {
                eprintln!("kimo-mcp: unknown argument {other}\n\n{USAGE}");
                std::process::exit(2);
            }
        }
    }
    std::process::exit(run(Options::from_env(client, launch)));
}
