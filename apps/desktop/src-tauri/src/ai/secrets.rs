//! Provider keys in the OS keychain (ADR 0014 §4): service `kimo`, account `provider.<id>`
//! (macOS Keychain, Windows Credential Manager, Secret Service on Linux). Values never leave
//! Rust except into the relay's outgoing request; nothing here logs or formats a value.
//!
//! The keychain cannot enumerate one service's entries portably, so `list` reads a names-only
//! index (`<kimo home>/ai/secret-accounts.json`) and drops names whose entry is gone. Tests use
//! [`MemoryStore`]; the real keychain only runs with `KIMO_TEST_KEYCHAIN=1`.

use crate::error::{invalid, io_msg, R};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

/// Keychain service name (lead decision; `SECRET_SERVICE` in secrets.ts).
pub const SERVICE: &str = "kimo";

/// A secret value that never prints itself.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(v: impl Into<String>) -> Self {
        Self(v.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(••••)")
    }
}

/// The raw store (keychain or memory). Errors carry no value.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> R<Option<Secret>>;
    fn set(&self, account: &str, value: &str) -> R<()>;
    /// Ok(false) when there was nothing to delete.
    fn delete(&self, account: &str) -> R<bool>;
}

/// The OS keychain through the `keyring` crate.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self {
            service: service.into(),
        }
    }
    fn entry(&self, account: &str) -> R<keyring::Entry> {
        keyring::Entry::new(&self.service, account)
            .map_err(|e| io_msg(format!("Keychain unavailable: {}", keyring_msg(&e))))
    }
}

/// Error text without any secret (keyring errors never include values, but be explicit).
fn keyring_msg(e: &keyring::Error) -> String {
    match e {
        keyring::Error::NoEntry => "no entry".into(),
        keyring::Error::PlatformFailure(_) => "platform failure".into(),
        keyring::Error::NoStorageAccess(_) => "no access to the credential store".into(),
        keyring::Error::BadEncoding(_) => "stored value is not UTF-8".into(),
        keyring::Error::TooLong(attr, _) => format!("{attr} too long"),
        keyring::Error::Invalid(attr, _) => format!("invalid {attr}"),
        keyring::Error::Ambiguous(_) => "ambiguous entry".into(),
        _ => "keychain error".into(),
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> R<Option<Secret>> {
        match self.entry(account)?.get_password() {
            Ok(v) => Ok(Some(Secret(v))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(io_msg(format!("Keychain read failed: {}", keyring_msg(&e)))),
        }
    }
    fn set(&self, account: &str, value: &str) -> R<()> {
        self.entry(account)?
            .set_password(value)
            .map_err(|e| io_msg(format!("Keychain write failed: {}", keyring_msg(&e))))
    }
    fn delete(&self, account: &str) -> R<bool> {
        match self.entry(account)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(io_msg(format!(
                "Keychain delete failed: {}",
                keyring_msg(&e)
            ))),
        }
    }
}

/// In-memory test double (and `KIMO_SECRETS_BACKEND=memory` for automated app runs).
#[derive(Default)]
pub struct MemoryStore {
    m: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> R<Option<Secret>> {
        Ok(self.m.lock().unwrap().get(account).cloned().map(Secret))
    }
    fn set(&self, account: &str, value: &str) -> R<()> {
        self.m.lock().unwrap().insert(account.into(), value.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> R<bool> {
        Ok(self.m.lock().unwrap().remove(account).is_some())
    }
}

/// Validates `service` (must be `kimo`) and `account` (`provider.<id>`, `providerAccount`).
pub fn check_account(service: &str, account: &str) -> R<()> {
    if service != SERVICE {
        return Err(invalid(format!("Unknown keychain service \"{service}\"")));
    }
    let id = account
        .strip_prefix("provider.")
        .ok_or_else(|| invalid("Keychain accounts are provider.<id>"))?;
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && id.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b':' | b'.' | b'_' | b'-')
        });
    if !ok {
        return Err(invalid(format!("Invalid provider account {account}")));
    }
    Ok(())
}

/// The provider id of an account (`provider.anthropic` → `anthropic`).
pub fn provider_of(account: &str) -> &str {
    account.strip_prefix("provider.").unwrap_or(account)
}

/// Masked suffix for the key field: the last 4 characters, only for values long enough that
/// 4 characters reveal little (shorter values report presence with an empty hint).
pub fn hint_of(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 12 {
        return String::new();
    }
    chars[chars.len() - 4..].iter().collect()
}

/// Keychain + names-only index. `on_change` hooks (key-origin pins) run after set/delete.
pub struct Secrets {
    store: Box<dyn SecretStore>,
    index_path: PathBuf,
    lock: Mutex<()>,
}

impl Secrets {
    pub fn new(store: Box<dyn SecretStore>, index_path: PathBuf) -> Self {
        Self {
            store,
            index_path,
            lock: Mutex::new(()),
        }
    }

    fn read_index(&self) -> BTreeSet<String> {
        crate::util::read_json::<Vec<String>>(&self.index_path)
            .ok()
            .flatten()
            .unwrap_or_default()
            .into_iter()
            .collect()
    }

    fn write_index(&self, names: &BTreeSet<String>) -> R<()> {
        crate::util::write_json(&self.index_path, &names.iter().collect::<Vec<_>>())
    }

    pub fn has(&self, account: &str) -> R<bool> {
        Ok(self.store.get(account)?.is_some())
    }

    /// The value, for the relay only (never returned over IPC).
    pub fn get(&self, account: &str) -> R<Option<Secret>> {
        self.store.get(account)
    }

    pub fn set(&self, account: &str, value: &str) -> R<()> {
        if value.is_empty() {
            return Err(invalid("Empty secret"));
        }
        if value.len() > 16 * 1024 {
            return Err(invalid("Secret too long"));
        }
        let _g = self.lock.lock().unwrap();
        self.store.set(account, value)?;
        let mut idx = self.read_index();
        if idx.insert(account.to_string()) {
            self.write_index(&idx)?;
        }
        Ok(())
    }

    pub fn delete(&self, account: &str) -> R<()> {
        let _g = self.lock.lock().unwrap();
        self.store.delete(account)?;
        let mut idx = self.read_index();
        if idx.remove(account) {
            self.write_index(&idx)?;
        }
        Ok(())
    }

    /// Accounts with a stored secret, sorted. Index names whose entry is gone are pruned.
    pub fn list(&self) -> R<Vec<String>> {
        let _g = self.lock.lock().unwrap();
        let idx = self.read_index();
        let mut live = BTreeSet::new();
        for a in &idx {
            if self.store.get(a)?.is_some() {
                live.insert(a.clone());
            }
        }
        if live != idx {
            self.write_index(&live)?;
        }
        Ok(live.into_iter().collect())
    }

    pub fn hint(&self, account: &str) -> R<Option<String>> {
        Ok(self.store.get(account)?.map(|s| hint_of(s.expose())))
    }
}

/// The store the app uses: the OS keychain, or memory when `KIMO_SECRETS_BACKEND=memory`.
pub fn default_store() -> Box<dyn SecretStore> {
    if std::env::var("KIMO_SECRETS_BACKEND").as_deref() == Ok("memory") {
        Box::new(MemoryStore::default())
    } else {
        Box::new(KeyringStore::new(SERVICE))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(store: Box<dyn SecretStore>, account: &str) {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(store, dir.path().join("idx.json"));
        let _ = s.delete(account);
        assert!(!s.has(account).unwrap());
        assert_eq!(s.hint(account).unwrap(), None);
        s.set(account, "sk-ant-api03-abcdefghij3f9a").unwrap();
        assert!(s.has(account).unwrap());
        assert_eq!(s.hint(account).unwrap().as_deref(), Some("3f9a"));
        assert_eq!(
            s.get(account).unwrap().unwrap().expose(),
            "sk-ant-api03-abcdefghij3f9a"
        );
        assert_eq!(s.list().unwrap(), vec![account.to_string()]);
        s.set(account, "short").unwrap();
        assert_eq!(s.hint(account).unwrap().as_deref(), Some(""));
        s.delete(account).unwrap();
        assert!(!s.has(account).unwrap());
        assert!(s.list().unwrap().is_empty());
        // Deleting twice is fine.
        s.delete(account).unwrap();
    }

    #[test]
    fn memory_round_trip() {
        round_trip(Box::new(MemoryStore::default()), "provider.anthropic");
    }

    /// Opt-in: touches the real OS keychain under a throwaway service.
    #[test]
    fn keychain_round_trip_opt_in() {
        if std::env::var("KIMO_TEST_KEYCHAIN").as_deref() != Ok("1") {
            return;
        }
        let account = format!("provider.test-{}", std::process::id());
        round_trip(Box::new(KeyringStore::new("kimo-test")), &account);
    }

    #[test]
    fn list_prunes_entries_removed_elsewhere() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(Box::new(MemoryStore::default()), dir.path().join("i.json"));
        s.set("provider.openai", "sk-1234567890abcdef").unwrap();
        s.set("provider.gemini", "AIza1234567890abcdef").unwrap();
        s.store.delete("provider.openai").unwrap();
        assert_eq!(s.list().unwrap(), vec!["provider.gemini".to_string()]);
        let idx = std::fs::read_to_string(dir.path().join("i.json")).unwrap();
        assert!(!idx.contains("abcdef"), "index holds names only");
    }

    #[test]
    fn validates_service_and_account() {
        assert!(check_account("kimo", "provider.anthropic").is_ok());
        assert!(check_account("kimo", "provider.custom:ollama").is_ok());
        assert_eq!(
            check_account("other", "provider.x").unwrap_err().code,
            "INVALID"
        );
        for bad in [
            "anthropic",
            "provider.",
            "provider.A",
            "provider.a/b",
            "provider.-a",
        ] {
            assert!(check_account("kimo", bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn secret_debug_is_masked() {
        assert_eq!(format!("{:?}", Secret::new("sk-live")), "Secret(••••)");
    }
}
