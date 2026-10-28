# Updater toasts (board 19 wsHiA / aF0vX) — integration

One controller per app (desktop main window):

```tsx
const updater = useMemo(
  () => createUpdaterController({ platform, flushAll: () => sessionManager.flushAll() }),
  [platform, sessionManager],
)
useEffect(() => { updater.start(); return () => updater.dispose() }, [updater])
// render once, anywhere (fixed bottom-center):
<UpdateToastHost controller={updater} />
```

Guarantees (tested): background download only while `updates.download` is on; one "ready"
toast per session; `platform.updater.restart()` is called only after `flushAll()` resolved
`ok: true`; a failed or throwing flush shows "Restart after saving N files? · Save & restart"
instead. The web build has no updater (`capabilities.updater` false): `start()` is a no-op.
