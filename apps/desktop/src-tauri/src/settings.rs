//! App settings (`<app config dir>/settings.json`), validated against the keys of
//! `packages/platform/src/settings.ts`. Reads are lenient (`normalizeSettings`); writes reject
//! unknown keys and invalid values with `INVALID`.

use crate::error::{invalid, R};
use crate::util::{read_json, write_json};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

/// Every key with its default (mirrors `SETTINGS_DEFAULTS`).
pub fn defaults() -> Map<String, Value> {
    let v = json!({
        "files.autosave": true,
        "files.autosaveIntervalMs": 2000,
        "files.recoverySnapshotMs": 30000,
        "files.onExternalChange": "merge-and-tell",
        "files.pauseAutosaveDuringGit": true,
        "files.newFilesDir": null,
        "privacy.noThirdPartyFetch": false,
        "ai.webAccess": true,
        "ai.recentModels": [],
        "multiplayer.relayUrl": null,
        "multiplayer.displayName": "",
        "multiplayer.showCursors": true,
        "multiplayer.fetchAssets": true,
        "multiplayer.relaySetup": null,
        "fonts.google": true,
        "fonts.extraFolders": [],
        "fonts.embedInKimoz": true,
        "general.appearance": "system",
        "general.onLaunch": "last-files",
        "general.canvasZoom": "trackpad",
        "general.duplicateMain": "ask",
        "canvas.snapToObjects": true,
        "canvas.snapToPixelGrid": true,
        "canvas.pixelGrid": true,
        "canvas.rulers": false,
        "canvas.nudge": "1/10",
        "canvas.layerNames": true,
        "updates.download": true,
        "updates.channel": "stable",
    });
    match v {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

fn one_of(v: &Value, choices: &[&str]) -> bool {
    v.as_str().is_some_and(|s| choices.contains(&s))
}
fn positive_ms(v: &Value) -> bool {
    // Integer in [250, 3_600_000] (JS numbers: accept integral floats too).
    let n = v
        .as_i64()
        .or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64));
    n.is_some_and(|n| (250..=3_600_000).contains(&n))
}

/// Mirrors `isValidSetting`. `None` for an unknown key.
pub fn validate(key: &str, v: &Value) -> Option<bool> {
    Some(match key {
        "files.autosave"
        | "files.pauseAutosaveDuringGit"
        | "privacy.noThirdPartyFetch"
        | "ai.webAccess"
        | "fonts.google"
        | "fonts.embedInKimoz"
        | "canvas.snapToObjects"
        | "canvas.snapToPixelGrid"
        | "canvas.pixelGrid"
        | "canvas.rulers"
        | "canvas.layerNames"
        | "multiplayer.showCursors"
        | "multiplayer.fetchAssets"
        | "updates.download" => v.is_boolean(),
        "files.autosaveIntervalMs" | "files.recoverySnapshotMs" => positive_ms(v),
        "files.onExternalChange" => one_of(v, &["merge-and-tell", "ask"]),
        "files.newFilesDir" => v.is_null() || v.as_str().is_some_and(|s| !s.is_empty()),
        "multiplayer.relayUrl" => {
            v.is_null() || v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 2048)
        }
        "multiplayer.displayName" => v.as_str().is_some_and(|s| s.chars().count() <= 80),
        "multiplayer.relaySetup" => v.is_null() || (v.is_object() && v.to_string().len() <= 8192),
        "fonts.extraFolders" => v
            .as_array()
            .is_some_and(|a| a.iter().all(|x| x.as_str().is_some_and(|s| !s.is_empty()))),
        "ai.recentModels" => v.as_array().is_some_and(|a| {
            a.len() <= 2
                && a.iter().all(|x| {
                    ["provider", "model"].iter().all(|k| {
                        x.get(k)
                            .and_then(Value::as_str)
                            .is_some_and(|s| !s.is_empty())
                    })
                })
        }),
        "general.appearance" => one_of(v, &["system", "light", "dark"]),
        "general.onLaunch" => one_of(v, &["last-files", "home"]),
        "general.canvasZoom" => one_of(v, &["trackpad", "mouse"]),
        "general.duplicateMain" => one_of(v, &["ask", "instance", "component"]),
        "canvas.nudge" => one_of(v, &["1/10", "0.5/5", "8/16"]),
        "updates.channel" => one_of(v, &["stable", "beta"]),
        _ => return None,
    })
}

/// Mirrors `normalizeSettings`: unknown keys dropped, invalid values → default.
pub fn normalize(raw: Option<&Value>) -> Map<String, Value> {
    let mut out = defaults();
    if let Some(Value::Object(m)) = raw {
        for (k, v) in m {
            if validate(k, v) == Some(true) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

pub struct SettingsStore {
    path: PathBuf,
    values: Mutex<Option<Map<String, Value>>>,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            values: Mutex::new(None),
        }
    }

    pub fn all(&self) -> Map<String, Value> {
        let mut g = self.values.lock().unwrap();
        if g.is_none() {
            let raw = read_json::<Value>(&self.path).ok().flatten();
            *g = Some(normalize(raw.as_ref()));
        }
        g.clone().unwrap()
    }

    pub fn get(&self, key: &str) -> Value {
        self.all().get(key).cloned().unwrap_or(Value::Null)
    }

    pub fn set(&self, key: &str, value: Value) -> R<()> {
        match validate(key, &value) {
            None => return Err(invalid(format!("Unknown setting \"{key}\""))),
            Some(false) => return Err(invalid(format!("Invalid value for \"{key}\": {value}"))),
            Some(true) => {}
        }
        let mut next = self.all();
        next.insert(key.to_string(), value);
        write_json(&self.path, &Value::Object(next.clone()))?;
        *self.values.lock().unwrap() = Some(next);
        Ok(())
    }

    /// `googleFontsAllowed`.
    pub fn google_fonts_allowed(&self) -> bool {
        let all = self.all();
        all.get("fonts.google")
            .and_then(Value::as_bool)
            .unwrap_or(true)
            && !all
                .get("privacy.noThirdPartyFetch")
                .and_then(Value::as_bool)
                .unwrap_or(false)
    }

    pub fn extra_font_folders(&self) -> Vec<String> {
        self.get("fonts.extraFolders")
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_settings_ts() {
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/platform/src/settings.ts"
        ))
        .unwrap();
        let block = ts
            .split("export const SETTINGS_DEFAULTS")
            .nth(1)
            .unwrap()
            .split("satisfies Settings")
            .next()
            .unwrap();
        let keys: Vec<&str> = block
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"')?.split('"').next())
            .collect();
        let d = defaults();
        assert_eq!(keys.len(), 29);
        assert_eq!(d.len(), 29);
        for k in keys {
            assert!(d.contains_key(k), "{k}");
            assert_eq!(validate(k, &d[k]), Some(true), "{k}");
        }
    }

    #[test]
    fn validate_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let s = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(s.get("files.autosaveIntervalMs"), json!(2000));
        assert_eq!(s.set("nope", json!(1)).unwrap_err().code, "INVALID");
        assert_eq!(
            s.set("files.autosaveIntervalMs", json!(100))
                .unwrap_err()
                .code,
            "INVALID"
        );
        assert_eq!(
            s.set("files.autosaveIntervalMs", json!(1.5))
                .unwrap_err()
                .code,
            "INVALID"
        );
        assert_eq!(
            s.set("updates.channel", json!("nightly")).unwrap_err().code,
            "INVALID"
        );
        s.set("multiplayer.relaySetup", json!({ "path": "local", "secretMode": "auto" }))
            .unwrap();
        assert_eq!(
            s.set("multiplayer.relaySetup", json!("local")).unwrap_err().code,
            "INVALID"
        );
        s.set("privacy.noThirdPartyFetch", json!(true)).unwrap();
        assert!(!s.google_fonts_allowed());
        let again = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(again.get("privacy.noThirdPartyFetch"), json!(true));
        let n = normalize(Some(
            &json!({"files.autosave": "yes", "x": 1, "general.appearance": "dark"}),
        ));
        assert_eq!(n["files.autosave"], json!(true));
        assert_eq!(n["general.appearance"], json!("dark"));
        assert!(!n.contains_key("x"));
    }

    #[test]
    fn recent_models_hold_two_picks() {
        let dir = tempfile::tempdir().unwrap();
        let s = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(s.get("ai.recentModels"), json!([]));
        let two = json!([
            {"provider": "cli:claude-code", "model": "claude-sonnet-5-5"},
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"}
        ]);
        s.set("ai.recentModels", two.clone()).unwrap();
        assert_eq!(s.get("ai.recentModels"), two);
        let three = json!([{"provider": "a", "model": "b"}, {"provider": "a", "model": "c"}, {"provider": "a", "model": "d"}]);
        assert_eq!(s.set("ai.recentModels", three).unwrap_err().code, "INVALID");
        assert_eq!(
            s.set("ai.recentModels", json!([{"provider": ""}]))
                .unwrap_err()
                .code,
            "INVALID"
        );
    }

    #[test]
    fn web_access_defaults_on() {
        let dir = tempfile::tempdir().unwrap();
        let s = SettingsStore::new(dir.path().join("settings.json"));
        assert_eq!(s.get("ai.webAccess"), json!(true));
        assert_eq!(
            s.set("ai.webAccess", json!("no")).unwrap_err().code,
            "INVALID"
        );
        s.set("ai.webAccess", json!(false)).unwrap();
        assert_eq!(s.get("ai.webAccess"), json!(false));
    }
}
