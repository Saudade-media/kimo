//! Settings › Files › Default app for .kimo and .kimoz (board 37 D15).
//!
//! macOS: Launch Services answers which app opens each extension's content type
//! (`LSCopyDefaultRoleHandlerForContentType`) and sets it (`LSSetDefaultRoleHandlerForContentType`).
//! Windows and Linux report `unknown`: the Settings row is hidden there.

use crate::error::R;
use serde::Serialize;
use tauri::AppHandle;

/// The extensions Kimo claims (`bundle.fileAssociations` in tauri.conf.json).
pub const EXTENSIONS: [&str; 2] = ["kimo", "kimoz"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DefaultAppStatus {
    Default,
    Other,
    Unknown,
}

/// `default` only when every extension opens with `bundle_id` (case-insensitive, as Launch
/// Services compares bundle ids).
pub fn status_from(bundle_id: &str, handlers: &[Option<String>]) -> DefaultAppStatus {
    if handlers.is_empty() {
        return DefaultAppStatus::Unknown;
    }
    if handlers.iter().all(|h| {
        h.as_deref()
            .is_some_and(|h| h.eq_ignore_ascii_case(bundle_id))
    }) {
        DefaultAppStatus::Default
    } else {
        DefaultAppStatus::Other
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2_foundation::NSString;
    use std::ffi::c_void;

    type CFStringRef = *const c_void;
    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: CFStringRef,
            tag: CFStringRef,
            conforming_to: CFStringRef,
        ) -> CFStringRef;
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
        ) -> CFStringRef;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler_bundle_id: CFStringRef,
        ) -> i32;
    }

    fn cf(s: &NSString) -> CFStringRef {
        s as *const NSString as CFStringRef
    }

    /// Takes ownership of a +1 CFString (toll-free bridged to NSString).
    unsafe fn owned(p: CFStringRef) -> Option<Retained<NSString>> {
        unsafe { Retained::from_raw(p as *mut NSString) }
    }

    pub fn content_type(ext: &str) -> Option<Retained<NSString>> {
        let class = NSString::from_str("public.filename-extension");
        let tag = NSString::from_str(ext);
        unsafe {
            owned(UTTypeCreatePreferredIdentifierForTag(
                cf(&class),
                cf(&tag),
                std::ptr::null(),
            ))
        }
    }

    pub fn handler(ext: &str) -> Option<String> {
        let uti = content_type(ext)?;
        let h = unsafe {
            owned(LSCopyDefaultRoleHandlerForContentType(
                cf(&uti),
                K_LS_ROLES_ALL,
            ))
        }?;
        Some(h.to_string())
    }

    pub fn set_handler(ext: &str, bundle_id: &str) -> Result<(), String> {
        let uti = content_type(ext).ok_or_else(|| format!("macOS has no file type for .{ext}"))?;
        let id = NSString::from_str(bundle_id);
        let status =
            unsafe { LSSetDefaultRoleHandlerForContentType(cf(&uti), K_LS_ROLES_ALL, cf(&id)) };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "macOS refused to open .{ext} files with Kimo (error {status})"
            ))
        }
    }
}

pub fn status(app: &AppHandle) -> DefaultAppStatus {
    #[cfg(target_os = "macos")]
    {
        let id = app.config().identifier.clone();
        let handlers: Vec<Option<String>> = EXTENSIONS.iter().map(|e| mac::handler(e)).collect();
        status_from(&id, &handlers)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        DefaultAppStatus::Unknown
    }
}

pub fn make_default(app: &AppHandle) -> R<()> {
    #[cfg(target_os = "macos")]
    {
        let id = app.config().identifier.clone();
        for ext in EXTENSIONS {
            mac::set_handler(ext, &id).map_err(crate::error::io_msg)?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(crate::error::blocked(
            "Set Kimo as the default app in your system settings",
        ))
    }
}

/// `kimo_default_app_status`: whether .kimo and .kimoz open with this Kimo.
#[tauri::command]
pub async fn kimo_default_app_status(app: AppHandle) -> R<DefaultAppStatus> {
    Ok(status(&app))
}

/// `kimo_default_app_set`: makes this Kimo the default app for .kimo and .kimoz.
#[tauri::command]
pub async fn kimo_default_app_set(app: AppHandle) -> R<()> {
    make_default(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_only_when_every_extension_opens_with_kimo() {
        let k = Some("dev.kimo.app".to_string());
        assert_eq!(
            status_from("dev.kimo.app", &[k.clone(), k.clone()]),
            DefaultAppStatus::Default
        );
        assert_eq!(
            status_from("dev.kimo.app", &[k.clone(), Some("com.other".into())]),
            DefaultAppStatus::Other
        );
        assert_eq!(
            status_from("dev.kimo.app", &[k, None]),
            DefaultAppStatus::Other
        );
        assert_eq!(
            status_from("DEV.kimo.app", &[Some("dev.kimo.app".into())]),
            DefaultAppStatus::Default
        );
        assert_eq!(status_from("dev.kimo.app", &[]), DefaultAppStatus::Unknown);
    }
}
