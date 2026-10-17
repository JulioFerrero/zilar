---
id: T-1930
title: "iOS crash on recording a voice message: voice-recorder reads Platform.OS through a static import instead of a dynamic import('react-native') that trips the PushNotificationIOS getter"
status: merged
milestone: M5
branch: task/T-1930-ios-voice-crash
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1930: Recording a voice message no longer crashes iOS

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:**

> in ios the record audio crashes the app

The lead captured the crash on the iPhone (v0.2.10) with `devicectl … process launch --console`:

```
Unhandled JS Exception: Invariant Violation: `new NativeEventEmitter()` requires a non-null argument.
invariant ← NativeEventEmitter ← get PushNotificationIOS ← metroImportAll ← asyncRequire ← try
```

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/lib/voice-recorder.ts`:**
  - `platformOs` (`:104-111`) is `Effect.tryPromise({ try: () => import('react-native'), … })` mapped to `module.Platform.OS`;
  - `startEffect` (`:155-170`) yields it on every recording start (`:164`), unless `deps.platform` is given.
- **Why it crashes:** a dynamic `import()` of `react-native` runs Metro's `metroImportAll`, which reads every export getter. That includes the deprecated `PushNotificationIOS`, whose native module is absent from our iOS build, so its `NativeEventEmitter` throws. Metro's guarded module load reports that as fatal before `tryPromise` can catch it.
- **It is the only dynamic `react-native` import** in `apps/mobile/src`.
- **A static import is safe and normal here:** other `apps/mobile/src/lib/*.ts` files already `import … from 'react-native'` statically. `voice-recorder.ts` has no test file.

### Steps
1. **`voice-recorder.ts`:** add `import { Platform } from 'react-native';` and delete `platformOs`.
   - In `startEffect`, use `const os = deps?.platform ?? Platform.OS;`.
   - Leave the lazy `import('expo-audio')` (`loadExpoAudio`, `setAudioModeEffect`) as it is.
   - Update the doc comment of `buildRecordingOptions`/`startEffect` if it mentions the lazy platform read.
2. **No new tests:** voice is UI; the message pipeline is untouched.

### Allowed files
- `apps/mobile/src/lib/voice-recorder.ts`
- `work/T-1930-ios-voice-crash.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On iOS, holding the mic records a voice message instead of crashing the app.
- Android still records.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/lib/voice-recorder.ts`:
  - added `import { Platform } from 'react-native';` (static, next to the `effect` import);
  - deleted the `platformOs` effect, which was the only dynamic `import('react-native')` in `apps/mobile/src`;
  - `startEffect` now reads `const os = deps?.platform ?? Platform.OS;`.
- Left the lazy `import('expo-audio')` in `loadExpoAudio` and `setAudioModeEffect` untouched.
- No doc comment needed changing: the only one that mentioned the lazy platform read was the `platformOs` comment, which went away with the effect; the `buildRecordingOptions` and `startEffect` comments do not mention it.
- No new tests, per the spec: voice is UI and the message pipeline is untouched.

### Checks run

```
pnpm gate
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (1.9s)
PASS  lint  (2.8s)
PASS  typecheck  (11.0s)
PASS  effect  (2.2s)
PASS  tests @zilar/mobile  (7.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The two changed files are `apps/mobile/src/lib/voice-recorder.ts` and this task file. I ran no single test files while working: the change has no test of its own per the spec, so `pnpm gate` (which ran the `@zilar/mobile` suite) was the only test run. I re-ran `pnpm gate` after writing this Report and it passed again with the same lines (install 1.9s, format 0.9s, lint 1.7s, typecheck 1.2s, effect 1.0s, tests @zilar/mobile 5.0s).

### Notes for the lead

- I did not run the app on a device, so the acceptance ("on iOS, holding the mic records instead of crashing") still needs your phone smoke. The crash came from Metro's `metroImportAll` enumerating every `react-native` export getter; a static named import never touches the `PushNotificationIOS` getter, so that path is gone.
- The `deps?.platform` injection seam is unchanged, so any caller or test that passes a platform still behaves exactly as before.
- `Platform.OS` can be `'ios' | 'android' | 'windows' | 'macos' | 'web'`; `buildRecordingOptions` takes it as `string` and falls back to the shared preset for anything but iOS/Android, same as the old `'unknown'` fallback.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `923d98755`.
- **The diff is the whole fix:** `import { Platform } from 'react-native'` replaces the dynamic `import('react-native')`, whose `metroImportAll` touched `PushNotificationIOS` and crashed iOS (captured with `devicectl --console`).
- **Checked:** no dynamic `react-native` import remains in `apps/mobile/src`.
- **Next:** confirm on the iPhone with the next iOS build. Android already used the same path at runtime.
