//! Signed Tauri updater (board 19). The feed is `UPDATE_FEED_PLACEHOLDER` (packages/platform
//! types.ts) with `{channel}` filled in. It never restarts on its own: `kimo_updater_restart`
//! installs the downloaded bytes and relaunches only when the frontend asks (after every
//! session reported "Saved to disk").

use crate::error::{invalid, io_msg, R};
use crate::util::now_ms;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::UpdaterExt;

pub const UPDATE_FEED_PLACEHOLDER: &str =
    "https://github.com/kimo-design/kimo/releases/latest/download/latest-{channel}.json";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub channel: String,
    pub notes_url: Option<String>,
    pub published_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "state",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UpdaterStatus {
    Idle,
    Checking,
    UpToDate {
        checked_at: u64,
    },
    Available {
        info: UpdateInfo,
    },
    Downloading {
        info: UpdateInfo,
        received: u64,
        total: Option<u64>,
    },
    Ready {
        info: UpdateInfo,
    },
    Error {
        message: String,
    },
}

#[derive(Default)]
pub struct UpdaterState {
    status: Mutex<Option<UpdaterStatus>>,
    update: Mutex<Option<(tauri_plugin_updater::Update, UpdateInfo)>>,
    bytes: Mutex<Option<Vec<u8>>>,
}

impl UpdaterState {
    pub fn status(&self) -> UpdaterStatus {
        self.status
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(UpdaterStatus::Idle)
    }

    fn set<Rt: Runtime>(&self, app: &AppHandle<Rt>, s: UpdaterStatus) {
        *self.status.lock().unwrap() = Some(s.clone());
        let _ = app.emit("kimo://updater-status", s);
    }

    fn fail<Rt: Runtime>(
        &self,
        app: &AppHandle<Rt>,
        message: String,
    ) -> crate::error::PlatformErrorPayload {
        self.set(
            app,
            UpdaterStatus::Error {
                message: message.clone(),
            },
        );
        io_msg(message)
    }

    pub async fn check<Rt: Runtime>(
        &self,
        app: &AppHandle<Rt>,
        channel: &str,
    ) -> R<Option<UpdateInfo>> {
        if channel != "stable" && channel != "beta" {
            return Err(invalid(format!("Unknown update channel {channel:?}")));
        }
        self.set(app, UpdaterStatus::Checking);
        let feed = UPDATE_FEED_PLACEHOLDER.replace("{channel}", channel);
        let endpoint = url::Url::parse(&feed).map_err(|e| self.fail(app, e.to_string()))?;
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .and_then(|b| b.build())
            .map_err(|e| self.fail(app, format!("Updater unavailable: {e}")))?;
        let found = updater
            .check()
            .await
            .map_err(|e| self.fail(app, format!("Update check failed: {e}")))?;
        match found {
            None => {
                *self.update.lock().unwrap() = None;
                self.set(
                    app,
                    UpdaterStatus::UpToDate {
                        checked_at: now_ms(),
                    },
                );
                Ok(None)
            }
            Some(update) => {
                let info = UpdateInfo {
                    version: update.version.clone(),
                    current_version: update.current_version.clone(),
                    channel: channel.to_string(),
                    notes_url: update
                        .raw_json
                        .get("notesUrl")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    published_iso: update.date.and_then(|d| {
                        d.format(&time::format_description::well_known::Rfc3339)
                            .ok()
                    }),
                };
                *self.update.lock().unwrap() = Some((update, info.clone()));
                *self.bytes.lock().unwrap() = None;
                self.set(app, UpdaterStatus::Available { info: info.clone() });
                Ok(Some(info))
            }
        }
    }

    pub async fn download<Rt: Runtime>(&self, app: &AppHandle<Rt>) -> R<()> {
        let Some((update, info)) = self.update.lock().unwrap().clone() else {
            return Err(invalid("No update to download"));
        };
        self.set(
            app,
            UpdaterStatus::Downloading {
                info: info.clone(),
                received: 0,
                total: None,
            },
        );
        let mut received: u64 = 0;
        let mut last_emit = 0u64;
        let progress_app = app.clone();
        let progress_info = info.clone();
        let bytes = update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    let now = now_ms();
                    if now - last_emit >= 250 {
                        last_emit = now;
                        let s = UpdaterStatus::Downloading {
                            info: progress_info.clone(),
                            received,
                            total,
                        };
                        let _ = progress_app.emit("kimo://updater-status", s);
                    }
                },
                || {},
            )
            .await
            .map_err(|e| self.fail(app, format!("Update download failed: {e}")))?;
        *self.bytes.lock().unwrap() = Some(bytes);
        self.set(app, UpdaterStatus::Ready { info });
        Ok(())
    }

    /// Installs the verified download and relaunches. Called by the frontend only.
    pub fn restart<Rt: Runtime>(&self, app: &AppHandle<Rt>) -> R<()> {
        let update = self.update.lock().unwrap().clone();
        let bytes = self.bytes.lock().unwrap().take();
        let (Some((update, _)), Some(bytes)) = (update, bytes) else {
            return Err(invalid("No downloaded update to install"));
        };
        update
            .install(bytes)
            .map_err(|e| self.fail(app, format!("Update install failed: {e}")))?;
        app.request_restart();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_json_matches_contract() {
        let info = UpdateInfo {
            version: "0.5.0".into(),
            current_version: "0.4.2".into(),
            channel: "stable".into(),
            notes_url: None,
            published_iso: None,
        };
        assert_eq!(
            serde_json::to_value(UpdaterStatus::Idle).unwrap(),
            serde_json::json!({"state":"idle"})
        );
        assert_eq!(
            serde_json::to_value(UpdaterStatus::UpToDate { checked_at: 5 }).unwrap(),
            serde_json::json!({"state":"up-to-date","checkedAt":5})
        );
        let v = serde_json::to_value(UpdaterStatus::Downloading {
            info,
            received: 1,
            total: None,
        })
        .unwrap();
        assert_eq!(v["state"], "downloading");
        assert_eq!(v["info"]["currentVersion"], "0.4.2");
        assert_eq!(v["total"], serde_json::Value::Null);
    }
}
