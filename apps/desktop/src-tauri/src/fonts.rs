//! Fonts (board 19): installed families via `fontdb` (CoreText/DirectWrite/fontconfig font
//! dirs + Settings extra folders), a content-addressed cache in `~/.kimo/fonts`
//! (`<key>.<ext>` + `index.json`), and remote fetches limited to Google Fonts.

use crate::error::{blocked, ctx, invalid, io_msg, not_found, R};
use crate::util::{now_ms, path_str, read_json, sha256_hex, write_json};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontStyle {
    pub postscript_name: String,
    pub full_name: String,
    pub weight: u16,
    pub italic: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontFamily {
    pub family: String,
    pub styles: Vec<LocalFontStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontCacheEntry {
    pub key: String,
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    pub source: String,
    pub bytes: u64,
    pub cached_at: u64,
}

/// `Omit<FontCacheEntry, "key" | "bytes" | "cachedAt">`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontCacheMeta {
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub count: u64,
    pub bytes: u64,
    pub dir: String,
}

#[derive(Default)]
pub struct LocalFonts {
    db: Mutex<Option<(Vec<String>, fontdb::Database)>>,
}

impl LocalFonts {
    fn with_db<T>(&self, extra: &[String], f: impl FnOnce(&fontdb::Database) -> T) -> T {
        let mut g = self.db.lock().unwrap();
        let stale = g.as_ref().map_or(true, |(e, _)| e != extra);
        if stale {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            for dir in extra {
                db.load_fonts_dir(dir);
            }
            *g = Some((extra.to_vec(), db));
        }
        f(&g.as_ref().unwrap().1)
    }

    /// Forces a rescan on the next call (font installed, Settings changed).
    pub fn invalidate(&self) {
        *self.db.lock().unwrap() = None;
    }

    pub fn list(&self, extra: &[String]) -> Vec<LocalFontFamily> {
        self.with_db(extra, |db| {
            let mut fams: BTreeMap<String, Vec<LocalFontStyle>> = BTreeMap::new();
            for face in db.faces() {
                let Some((family, _)) = face.families.first() else {
                    continue;
                };
                if face.post_script_name.is_empty() {
                    continue;
                }
                let full_name = db
                    .with_face_data(face.id, full_name)
                    .flatten()
                    .unwrap_or_else(|| {
                        format!(
                            "{family} {}",
                            style_label(face.weight.0, face.style != fontdb::Style::Normal)
                        )
                    });
                let styles = fams.entry(family.clone()).or_default();
                if styles
                    .iter()
                    .any(|s| s.postscript_name == face.post_script_name)
                {
                    continue;
                }
                styles.push(LocalFontStyle {
                    postscript_name: face.post_script_name.clone(),
                    full_name,
                    weight: face.weight.0,
                    italic: face.style != fontdb::Style::Normal,
                });
            }
            fams.into_iter()
                .map(|(family, mut styles)| {
                    styles.sort_by_key(|a| (a.weight, a.italic));
                    LocalFontFamily { family, styles }
                })
                .collect()
        })
    }

    /// The font file holding `postscript_name` (the whole file for collections).
    pub fn load(&self, extra: &[String], postscript_name: &str) -> R<Vec<u8>> {
        let found = self.with_db(extra, |db| {
            let face = db.faces().find(|f| f.post_script_name == postscript_name)?;
            match &face.source {
                fontdb::Source::File(p) => Some(Err(p.clone())),
                fontdb::Source::SharedFile(p, _) => Some(Err(p.clone())),
                fontdb::Source::Binary(b) => Some(Ok((**b).as_ref().to_vec())),
            }
        });
        match found {
            None => Err(not_found(format!("No installed font {postscript_name}"))),
            Some(Ok(bytes)) => Ok(bytes),
            Some(Err(path)) => fs::read(&path).map_err(ctx(&path_str(&path))),
        }
    }
}

fn full_name(data: &[u8], index: u32) -> Option<String> {
    let face = ttf_parser::Face::parse(data, index).ok()?;
    let names = face.names();
    let mut fallback = None;
    for i in 0..names.len() {
        let n = names.get(i)?;
        if n.name_id != ttf_parser::name_id::FULL_NAME {
            continue;
        }
        if let Some(s) = n.to_string() {
            if n.language_id == 0x0409 {
                return Some(s);
            }
            fallback.get_or_insert(s);
        }
    }
    fallback
}

fn style_label(weight: u16, italic: bool) -> String {
    let w = match weight {
        0..=149 => "Thin",
        150..=249 => "ExtraLight",
        250..=349 => "Light",
        350..=449 => "Regular",
        450..=549 => "Medium",
        550..=649 => "SemiBold",
        650..=749 => "Bold",
        750..=849 => "ExtraBold",
        _ => "Black",
    };
    if italic {
        format!("{w} Italic")
    } else {
        w.to_string()
    }
}

// --- cache --------------------------------------------------------------------------------------

/// File extension from the font's magic bytes.
pub fn font_ext(bytes: &[u8]) -> &'static str {
    match bytes.get(..4) {
        Some(b"wOF2") => "woff2",
        Some(b"wOFF") => "woff",
        Some(b"OTTO") => "otf",
        Some(b"ttcf") => "ttc",
        _ => "ttf",
    }
}

pub struct FontCache {
    pub dir: PathBuf,
    lock: Mutex<()>,
}

impl FontCache {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: Mutex::new(()),
        }
    }
    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }
    fn index(&self) -> BTreeMap<String, FontCacheEntry> {
        read_json(&self.index_path())
            .ok()
            .flatten()
            .unwrap_or_default()
    }
    fn valid_key(key: &str) -> bool {
        key.len() == 16
            && key
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    }
    fn file_for(&self, key: &str) -> Option<PathBuf> {
        let rd = fs::read_dir(&self.dir).ok()?;
        rd.flatten().map(|e| e.path()).find(|p| {
            p.file_stem().and_then(|s| s.to_str()) == Some(key)
                && p.extension().is_some_and(|e| e != "json")
        })
    }

    pub fn get(&self, key: &str) -> R<Option<Vec<u8>>> {
        if !Self::valid_key(key) {
            return Err(invalid(format!("Invalid font cache key {key:?}")));
        }
        let Some(p) = self.file_for(key) else {
            return Ok(None);
        };
        let bytes = fs::read(&p).map_err(ctx(&path_str(&p)))?;
        // Content-addressed: a corrupted file is a miss.
        if sha256_hex(&bytes)[..16] != *key {
            let _ = fs::remove_file(&p);
            return Ok(None);
        }
        Ok(Some(bytes))
    }

    pub fn put(&self, meta: FontCacheMeta, bytes: &[u8]) -> R<FontCacheEntry> {
        if !["google", "document", "file", "pack"].contains(&meta.source.as_str()) {
            return Err(invalid(format!("Unknown font source {:?}", meta.source)));
        }
        let _g = self.lock.lock().unwrap();
        let key = sha256_hex(bytes)[..16].to_string();
        let path = self.dir.join(format!("{key}.{}", font_ext(bytes)));
        if !path.exists() {
            crate::fs_ops::write_atomic(&path, bytes, true)?;
        }
        let entry = FontCacheEntry {
            key: key.clone(),
            family: meta.family,
            weight: meta.weight,
            italic: meta.italic,
            source: meta.source,
            bytes: bytes.len() as u64,
            cached_at: now_ms(),
        };
        let mut idx = self.index();
        idx.insert(key, entry.clone());
        write_json(&self.index_path(), &idx)?;
        Ok(entry)
    }

    pub fn list(&self) -> Vec<FontCacheEntry> {
        let mut v: Vec<_> = self
            .index()
            .into_values()
            .filter(|e| self.file_for(&e.key).is_some())
            .collect();
        v.sort_by_key(|a| std::cmp::Reverse(a.cached_at));
        v
    }

    pub fn stats(&self) -> CacheStats {
        let list = self.list();
        CacheStats {
            count: list.len() as u64,
            bytes: list.iter().map(|e| e.bytes).sum(),
            dir: path_str(&self.dir),
        }
    }

    pub fn clear(&self) -> R<()> {
        let _g = self.lock.lock().unwrap();
        let rd = match fs::read_dir(&self.dir) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(ctx(&path_str(&self.dir))(e)),
        };
        for e in rd.flatten() {
            if e.path().is_file() {
                fs::remove_file(e.path()).map_err(ctx(&path_str(&e.path())))?;
            }
        }
        Ok(())
    }
}

// --- remote -------------------------------------------------------------------------------------

pub const REMOTE_HOSTS: &[&str] = &["fonts.googleapis.com", "fonts.gstatic.com"];
const MAX_REMOTE_BYTES: usize = 32 * 1024 * 1024;

/// `https://fonts.googleapis.com/…` or `https://fonts.gstatic.com/…` only.
pub fn check_remote_url(raw: &str) -> R<url::Url> {
    let u = url::Url::parse(raw).map_err(|_| invalid(format!("Not a URL: {raw}")))?;
    let host_ok = u.host_str().is_some_and(|h| REMOTE_HOSTS.contains(&h));
    if u.scheme() != "https" || !host_ok || u.port().is_some() || !u.username().is_empty() {
        return Err(blocked(format!("Host not allowed: {raw}")));
    }
    Ok(u)
}

pub async fn fetch_remote(url: url::Url) -> R<Vec<u8>> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let ok = attempt.url().scheme() == "https"
                && attempt
                    .url()
                    .host_str()
                    .is_some_and(|h| REMOTE_HOSTS.contains(&h))
                && attempt.previous().len() < 5;
            if ok {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Kimo/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| io_msg(e.to_string()))?;
    let mut res = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| io_msg(format!("Fetching {url}: {e}")))?;
    if !res.status().is_success() {
        let code = if res.status().as_u16() == 404 {
            "NOT_FOUND"
        } else {
            "IO"
        };
        return Err(crate::error::PlatformErrorPayload::new(
            code,
            format!("Fetching {url}: HTTP {}", res.status()),
        ));
    }
    let mut out = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| io_msg(format!("Fetching {url}: {e}")))?
    {
        out.extend_from_slice(&chunk);
        if out.len() > MAX_REMOTE_BYTES {
            return Err(io_msg(format!("Fetching {url}: response too large")));
        }
    }
    Ok(out)
}

pub fn ensure_dir(dir: &Path) -> R<()> {
    fs::create_dir_all(dir).map_err(ctx(&path_str(dir)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_put_get_list_clear() {
        let d = tempfile::tempdir().unwrap();
        let c = FontCache::new(d.path().join("fonts"));
        assert_eq!(c.stats().count, 0);
        let bytes = b"wOF2-fake-font-bytes".to_vec();
        let meta = FontCacheMeta {
            family: "Inter".into(),
            weight: 400,
            italic: false,
            source: "google".into(),
        };
        let e = c.put(meta.clone(), &bytes).unwrap();
        assert_eq!(e.key, sha256_hex(&bytes)[..16]);
        assert!(c.dir.join(format!("{}.woff2", e.key)).exists());
        assert_eq!(c.get(&e.key).unwrap().unwrap(), bytes);
        assert_eq!(c.get("0000000000000000").unwrap(), None);
        assert_eq!(c.get("../x").unwrap_err().code, "INVALID");
        c.put(meta, &bytes).unwrap();
        assert_eq!(c.list().len(), 1);
        let s = c.stats();
        assert_eq!((s.count, s.bytes), (1, bytes.len() as u64));
        let json = serde_json::to_value(&c.list()[0]).unwrap();
        assert!(json.get("cachedAt").is_some());
        c.clear().unwrap();
        assert_eq!(c.stats().count, 0);
    }

    #[test]
    fn pack_is_a_separate_store() {
        // Board 28: the offline font pack reuses the cache layout in its own dir; clearing
        // the cache never touches it, and unknown sources are refused.
        let d = tempfile::tempdir().unwrap();
        let cache = FontCache::new(d.path().join("fonts"));
        let pack = FontCache::new(d.path().join("font-pack"));
        let meta = FontCacheMeta {
            family: "Lora".into(),
            weight: 600,
            italic: false,
            source: "pack".into(),
        };
        let e = pack.put(meta.clone(), b"OTTO-fake-lora").unwrap();
        assert_eq!(e.source, "pack");
        assert!(pack.dir.join(format!("{}.otf", e.key)).exists());
        cache.clear().unwrap();
        assert_eq!(pack.stats().count, 1);
        let bad = FontCacheMeta {
            source: "web".into(),
            ..meta
        };
        assert_eq!(pack.put(bad, b"x").unwrap_err().code, "INVALID");
        pack.clear().unwrap();
        assert_eq!(pack.stats().count, 0);
    }

    #[test]
    fn remote_allowlist() {
        assert!(check_remote_url("https://fonts.gstatic.com/s/inter/v1/a.woff2").is_ok());
        assert!(check_remote_url("https://fonts.googleapis.com/css2?family=Inter").is_ok());
        for bad in [
            "http://fonts.gstatic.com/a.woff2",
            "https://evil.com/a.woff2",
            "https://fonts.gstatic.com.evil.com/a",
            "https://user@fonts.gstatic.com/a",
            "https://fonts.gstatic.com:8443/a",
        ] {
            assert_eq!(check_remote_url(bad).unwrap_err().code, "BLOCKED", "{bad}");
        }
    }

    #[test]
    fn lists_some_local_fonts() {
        let f = LocalFonts::default();
        let fams = f.list(&[]);
        // CI images may have no fonts; when there are some, they load.
        if let Some(style) = fams.iter().flat_map(|f| f.styles.iter()).next() {
            assert!(!f.load(&[], &style.postscript_name).unwrap().is_empty());
        }
        assert_eq!(
            f.load(&[], "No-Such-Font-PS").unwrap_err().code,
            "NOT_FOUND"
        );
    }
}
