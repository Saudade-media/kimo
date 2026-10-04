//! M6 built-in agent services of the desktop shell (ADR 0014 §4, §11): provider keys in the OS
//! keychain, the AI request relay (keys injected in Rust, responses streamed as events) and the
//! local agent CLI host. Commands live in `ai_commands.rs`; their names in
//! `command_list_ai.rs` mirror `TAURI_SECRETS_COMMANDS` / `TAURI_CLI_COMMANDS`.

pub mod cli;
pub mod cloud;
pub mod relay;
pub mod secrets;

use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Where streamed events go (a webview in the app, a channel in tests).
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

/// Emits to the window that started the request / process.
pub struct WindowSink<Rt: Runtime> {
    pub app: AppHandle<Rt>,
    pub label: String,
}

impl<Rt: Runtime> EventSink for WindowSink<Rt> {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.app.emit_to(self.label.as_str(), event, payload);
    }
}

pub struct AiServices {
    pub secrets: Arc<secrets::Secrets>,
    pub relay: Arc<relay::Relay>,
    pub cli: Arc<cli::CliHost>,
    /// `~/.kimo/skills` (ADR 0014 §10).
    pub skills: Arc<crate::skills::SkillsService>,
}

impl AiServices {
    pub fn new(home: PathBuf, kimo_home: PathBuf, shim_path: String) -> Self {
        let ai_dir = kimo_home.join("ai");
        let skills = Arc::new(crate::skills::SkillsService::new(&kimo_home));
        let secrets = Arc::new(secrets::Secrets::new(
            secrets::default_store(),
            ai_dir.join("secret-accounts.json"),
        ));
        let relay = Arc::new(relay::Relay::new(
            secrets.clone(),
            ai_dir.join("key-origins.json"),
            relay::RelayConfig::default(),
        ));
        let cli = Arc::new(cli::CliHost::new(cli::CliConfig::new(
            home, kimo_home, shim_path,
        )));
        cli.install_global();
        Self {
            secrets,
            relay,
            cli,
            skills,
        }
    }

    /// App exit: abort relayed requests and stop spawned CLIs.
    pub fn shutdown(&self) {
        self.relay.abort_all();
        self.cli.shutdown();
    }
}

pub fn services<Rt: Runtime>(app: &AppHandle<Rt>) -> Option<Arc<AiServices>> {
    app.try_state::<Arc<AiServices>>()
        .map(|s| s.inner().clone())
}

#[cfg(test)]
pub mod tests_support {
    use super::EventSink;
    use serde_json::Value;
    use std::sync::Arc;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

    pub struct ChannelSink(UnboundedSender<Value>);

    impl EventSink for ChannelSink {
        fn emit(&self, _event: &str, payload: Value) {
            let _ = self.0.send(payload);
        }
    }

    impl ChannelSink {
        pub fn pair() -> (Arc<dyn EventSink>, UnboundedReceiver<Value>) {
            let (tx, rx) = unbounded_channel();
            (Arc::new(ChannelSink(tx)), rx)
        }

        async fn collect(
            mut rx: UnboundedReceiver<Value>,
            done: impl Fn(&Value) -> bool,
        ) -> Vec<Value> {
            let mut out = Vec::new();
            loop {
                let next = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
                    .await
                    .expect("event within 10 s")
                    .expect("channel open");
                let end = done(&next);
                out.push(next);
                if end {
                    return out;
                }
            }
        }

        /// Relay events of one request until `end`.
        pub async fn collect_until_end(rx: UnboundedReceiver<Value>, id: &str) -> Vec<Value> {
            let id = id.to_string();
            Self::collect(rx, move |v| {
                v["requestId"] == id.as_str() && v["end"] == true
            })
            .await
        }

        /// CLI events of one process until its exit event (`code` key present).
        pub async fn collect_until_exit(rx: UnboundedReceiver<Value>, id: &str) -> Vec<Value> {
            let id = id.to_string();
            Self::collect(rx, move |v| {
                v["processId"] == id.as_str() && v.get("code").is_some()
            })
            .await
        }
    }
}
