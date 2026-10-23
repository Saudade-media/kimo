//! Deep links and open requests. `parse_deep_link` mirrors `parseDeepLink` in
//! `packages/platform/src/links.ts` exactly (deep links come from untrusted pages).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeepLink {
    pub path: String,
    pub node: Option<String>,
    /// Board 27 §1 "Copy link to page": the page to open on.
    pub page: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    /// `file-association` | `deep-link` | `argv` | `launch-queue` | `second-instance`.
    pub source: &'static str,
    pub refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    /// Board 41 section 5: a multiplayer join link (`kimo://join#<relay>/<room>/<token>/<key>`)
    /// or pairing link (`kimo://pair#<relay>/<token>`, ADR 0017), whole. `refs` is empty; the web
    /// app tells them apart, parses and validates them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join: Option<String>,
}

/// `parseJoinDeepLink` in `packages/platform/src/links.ts`: the whole `kimo://join#...` or
/// `kimo://pair#...` (or `kimo:join#...`) link, or None for any other URL or an empty fragment.
pub fn parse_join_link(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw).ok()?;
    if u.scheme() != "kimo" {
        return None;
    }
    let host = u.host_str().unwrap_or("");
    let action = if !host.is_empty() {
        host.to_string()
    } else {
        u.path().trim_start_matches('/').to_string()
    };
    if (action != "join" && action != "pair") || u.fragment().map_or(true, |f| f.is_empty()) {
        return None;
    }
    Some(raw.trim().to_string())
}

/// `isAbsolutePath`: POSIX absolute, Windows drive or UNC.
pub fn is_absolute_path(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/')
        || (b.len() >= 3
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b[2] == b'\\' || b[2] == b'/'))
        || p.starts_with("\\\\")
}

/// `isKimoPath`.
pub fn is_kimo_path(p: &str) -> bool {
    let l = p.to_lowercase();
    l.ends_with(".kimo") || l.ends_with(".kimoz")
}

/// A path a launch argument may open: a Kimo document or a pen.dev `.pen` file.
pub fn is_openable_path(p: &str) -> bool {
    is_kimo_path(p) || p.to_lowercase().ends_with(".pen")
}

fn valid_node_id(id: &str) -> bool {
    (6..=24).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// `kimo://open?path=<url-encoded absolute path>[&node=<id>][&page=<id>]`, strictly.
pub fn parse_deep_link(raw: &str) -> Option<DeepLink> {
    let u = url::Url::parse(raw).ok()?;
    if u.scheme() != "kimo" {
        return None;
    }
    let host = u.host_str().unwrap_or("");
    let action = if !host.is_empty() {
        host.to_string()
    } else {
        u.path().trim_start_matches('/').to_string()
    };
    if action != "open" {
        return None;
    }
    let get = |k: &str| {
        u.query_pairs()
            .find(|(name, _)| name == k)
            .map(|(_, v)| v.into_owned())
    };
    let path = get("path")?;
    if path.is_empty() || path.contains('\0') || !is_absolute_path(&path) || !is_kimo_path(&path) {
        return None;
    }
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return None;
    }
    let node = match get("node") {
        Some(n) if valid_node_id(&n) => Some(n),
        Some(_) => return None,
        None => None,
    };
    let page = match get("page") {
        Some(p) if valid_node_id(&p) => Some(p),
        Some(_) => return None,
        None => None,
    };
    Some(DeepLink { path, node, page })
}

/// Turns command-line arguments (argv minus the program, or a second instance's argv) into
/// open requests: `kimo:` URLs become deep-link requests, `.kimo`/`.kimoz`/`.pen` paths
/// (resolved against `cwd`) one `source` request.
pub fn requests_from_args(
    args: &[String],
    cwd: &std::path::Path,
    source: &'static str,
) -> Vec<OpenRequest> {
    let mut out = Vec::new();
    let mut files = Vec::new();
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        if a.to_lowercase().starts_with("kimo:") {
            if let Some(j) = parse_join_link(a) {
                out.push(OpenRequest {
                    source: "deep-link",
                    refs: vec![],
                    node: None,
                    page: None,
                    join: Some(j),
                });
                continue;
            }
            if let Some(l) = parse_deep_link(a) {
                out.push(OpenRequest {
                    source: "deep-link",
                    refs: vec![l.path],
                    node: l.node,
                    page: l.page,
                    join: None,
                });
            }
            continue;
        }
        if !is_openable_path(a) {
            continue;
        }
        let p = std::path::Path::new(a);
        let abs = if p.is_absolute() {
            p.to_path_buf()
        } else {
            cwd.join(p)
        };
        if let Ok(clean) = crate::util::clean_abs(&abs.to_string_lossy()) {
            files.push(clean.to_string_lossy().into_owned());
        }
    }
    if !files.is_empty() {
        out.insert(
            0,
            OpenRequest {
                source,
                refs: files,
                node: None,
                page: None,
                join: None,
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Same cases as packages/platform/test/platform.test.ts "deep links".
    #[test]
    fn parses_like_links_ts() {
        assert_eq!(
            parse_deep_link(
                "kimo://open?path=%2FUsers%2Fme%2Floom%2Fmarketing.kimo&node=Hero000001"
            ),
            Some(DeepLink {
                path: "/Users/me/loom/marketing.kimo".into(),
                node: Some("Hero000001".into()),
                page: None
            })
        );
        assert_eq!(
            parse_deep_link("kimo://open?path=%2Fa.kimo&page=Page000002")
                .unwrap()
                .page,
            Some("Page000002".into())
        );
        assert_eq!(
            parse_deep_link("kimo://open?path=C%3A%5Cdesign%5Ca.kimoz")
                .unwrap()
                .path,
            "C:\\design\\a.kimoz"
        );
        assert_eq!(
            parse_deep_link("kimo:open?path=%2Fa.kimo").unwrap().path,
            "/a.kimo"
        );
        assert_eq!(
            parse_deep_link("kimo:///open?path=%2Fa.kimo").unwrap().path,
            "/a.kimo"
        );
        assert_eq!(
            parse_deep_link("kimo://open?path=%2FUsers%2Fme%2Fmy+file.kimo")
                .unwrap()
                .path,
            "/Users/me/my file.kimo"
        );
        assert_eq!(
            parse_deep_link("kimo://open?path=%5C%5Cserver%5Cshare%5Ca.KIMO")
                .unwrap()
                .path,
            "\\\\server\\share\\a.KIMO"
        );
    }

    #[test]
    fn rejects_like_links_ts() {
        for bad in [
            "https://open?path=/a.kimo",
            "kimo://delete?path=/a.kimo",
            "kimo://open?path=a.kimo",
            "kimo://open?path=/etc/passwd",
            "kimo://open?path=/a/../b.kimo",
            "kimo://open?path=/a.kimo&node=bad/id",
            "kimo://open?path=/a.kimo&node=short",
            "kimo://open?path=/a.kimo&node=",
            "kimo://open?path=/a.kimo&page=bad/id",
            "kimo://open?path=%2Fa%00.kimo",
            "kimo://open?path=C%3A%5Ca%5C..%5Cb.kimo",
            "kimo://open",
            "not a url",
        ] {
            assert_eq!(parse_deep_link(bad), None, "{bad}");
        }
    }

    #[test]
    fn args_to_requests() {
        let cwd = std::path::Path::new("/work");
        let args: Vec<String> = [
            "--flag",
            "a.kimo",
            "/abs/b.kimoz",
            "design.PEN",
            "notes.txt",
            "kimo://open?path=%2Fc.kimo&node=Abc123xyz9",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let r = requests_from_args(&args, cwd, "argv");
        // `/work` is not absolute on Windows, so there only the deep link (always last) remains.
        let link = r.last().unwrap();
        #[cfg(unix)]
        assert_eq!(r.len(), 2);
        #[cfg(unix)]
        assert_eq!(
            r[0],
            OpenRequest {
                source: "argv",
                refs: vec![
                    "/work/a.kimo".into(),
                    "/abs/b.kimoz".into(),
                    "/work/design.PEN".into()
                ],
                node: None,
                page: None,
                join: None
            }
        );
        assert_eq!(
            *link,
            OpenRequest {
                source: "deep-link",
                refs: vec!["/c.kimo".into()],
                node: Some("Abc123xyz9".into()),
                page: None,
                join: None
            }
        );
        assert_eq!(
            serde_json::to_value(link).unwrap(),
            serde_json::json!({"source":"deep-link","refs":["/c.kimo"],"node":"Abc123xyz9"})
        );
    }

    #[test]
    fn join_links() {
        let frag = "https://relay.maya.studio/room1/token/key";
        for form in [
            format!("kimo://join#{frag}"),
            format!("kimo:join#{frag}"),
            "kimo://pair#https://relay.maya.studio/token".to_string(),
        ] {
            assert_eq!(parse_join_link(&form), Some(form.clone()), "{form}");
            // Not a file deep link.
            assert_eq!(parse_deep_link(&form), None);
        }
        for bad in [
            "kimo://join",
            "kimo://join#",
            "kimo://pair",
            "kimo://open?path=%2Fa.kimo",
            "https://kimo.app/join#x",
            "not a url",
        ] {
            assert_eq!(parse_join_link(bad), None, "{bad}");
        }
        let link = format!("kimo://join#{frag}");
        let r = requests_from_args(
            std::slice::from_ref(&link),
            std::path::Path::new("/work"),
            "argv",
        );
        assert_eq!(r.len(), 1);
        assert_eq!(
            serde_json::to_value(&r[0]).unwrap(),
            serde_json::json!({"source":"deep-link","refs":[],"join":link})
        );
    }
}
