---
id: T-1359
title: "Android: the push wake task is not defined when the app is cold-started in the background (expo-router loads _layout lazily) — add an entry file that imports polyfills and the wake task before expo-router/entry, so a killed app posts the notification without being opened"
status: merged
milestone: M5
branch: task/T-1359-headless-wake-entry
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1359: Headless wake entry

## Spec (written by Claude, do not edit)

### Why
The lead's live test on Julio's phone, 2026-10-14 13:52, after T-1357 and T-1358: the push reaches the phone ("Successful broadcast to app.zilar.chat"), and Android cold-starts the app in the background. Logcat then shows:
```
13:52:59.643 I/TaskService: Registered task with name 'zilar-background-notification' …
13:52:59.728 I/TaskService: Started headless task 1 to keep JS timers alive for 'app.zilar.chat'
13:52:59.916 W/ReactNativeJS: No task registered for key expo-task-manager
```
So no notification is posted until the user opens the app. In test 5 the task only finished at 13:51:54, right after "Running main", when Julio opened Zilar, and the notification appeared then.

**Cause:**
- `TaskManager.defineTask` runs at module scope in `apps/mobile/src/lib/push/background.ts` (`if (!MOCK_MODE) { TaskManager.defineTask(WAKE_TASK, …) }`, near the end of the file);
- that module is imported only by `apps/mobile/src/app/_layout.tsx:3`;
- `apps/mobile/package.json:5` has `"main": "expo-router/entry"`, which evaluates routes (and `_layout`) only when the root component renders. That never happens in a headless start, so the task is undefined when the JS headless task fires.

### What to do
1. **Add `apps/mobile/index.ts`:**
   ```ts
   // Headless starts (an FCM wake with no UI) never render the router, so the
   // wake task must be defined here, before expo-router's entry.
   import '@/lib/polyfills';
   import '@/lib/push/background';
   import 'expo-router/entry';
   ```
   Check that the `@/` alias resolves from the app root for Metro (babel `module-resolver` or the tsconfig `paths`, whichever this app uses; cite it). If it doesn't, use relative paths `./src/lib/...`.
2. **Set `"main": "index.ts"`** in `apps/mobile/package.json`.
3. **Remove the duplicate imports** of polyfills and background in `_layout.tsx` only if keeping them would cause harm. Module caching makes the second import a no-op, so leaving them is fine; say which you chose.
4. **Check that `background.ts`'s module-scope imports are safe in a headless context** (no React rendering, no `window` UI APIs at import time). Name any risky one.
5. **Tests:** none; this is entry wiring. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/package.json`, `apps/mobile/src/app/_layout.tsx:1-10`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/babel.config.js`, `apps/mobile/metro.config.js`, `apps/mobile/tsconfig.json`; the Expo docs on using `expo-task-manager` with expo-router (define tasks in the entry file).

### Allowed files
`apps/mobile/index.ts`, `apps/mobile/package.json`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/tsconfig.json`, `work/T-1359-headless-wake-entry.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's phone check** (adb, app killed, then a DM): logcat shows no "No task registered", and the notification appears without opening the app.

---

## Report (written by the worker when done)

### What I did

1. **Added `apps/mobile/index.ts`** exactly as the spec's snippet: it imports
   `@/lib/polyfills`, then `@/lib/push/background`, then `expo-router/entry`, so
   `TaskManager.defineTask(WAKE_TASK, …)` runs at module scope before the router
   entry is evaluated.
2. **`apps/mobile/package.json`**: changed `"main"` from `"expo-router/entry"` to
   `"index.ts"`.
3. **`_layout.tsx`: left its two imports unchanged** (chose "leave them"). Module
   caching makes the second `@/lib/polyfills` / `@/lib/push/background` import a
   no-op, and their comment documents the ordering intent. Removing them would be
   churn in a file other tasks also touch.
4. **`background.ts`: updated only its header comment** (lines 8-9) so it no
   longer says the root layout imports it; it now names `index.ts` as the Metro
   entry. No code changed.
5. No tests added (entry wiring only, per the spec).

### `@/` alias resolution (spec point 1)

The app uses Expo's tsconfig `paths` resolution, not `babel-plugin-module-resolver`
(there is no such plugin in `babel.config.js`, and no `module-resolver` entry
anywhere in `apps/mobile`). `tsconfig.json` maps `"@/*": ["./src/*"]`, relative to
the tsconfig directory. Expo CLI enables this by default and resolves it relative
to the project root, **not** the importing file, so it works from a root-level
`index.ts`:
- `@expo/cli/build/src/start/server/metro/instantiateMetro.js:291` —
  `isTsconfigPathsEnabled: exp.experiments?.tsconfigPaths ?? true`.
- `.../withMetroMultiPlatform.js:410` — installs
  `createTypescriptResolver({ projectRoot: config.projectRoot, … })`.
- `.../createTypescriptResolver.js` — resolves `compilerOptions.paths`/`baseUrl`
  from the tsconfig, keyed on `projectRoot`; its only exclusions are
  relative/absolute specifiers and specifiers imported from inside `node_modules`.
`index.ts` is at the app root and is not in node_modules, so `@/lib/...` resolves
to `apps/mobile/src/lib/...`. (`_layout.tsx` already relies on the same alias with
no babel plugin, which is the same mechanism in production.)

### Module-scope imports safe for a headless context (spec point 4)

I read every module in `background.ts`'s import graph that runs at import time
(`polyfills.ts`, `mock/gate.ts`, `auth.ts`, `session-token.ts`,
`effect/api-client.ts`, `effect/runtime.ts`, `push/active-chat.ts`,
`push/channels.ts`, `push/last-received.ts`) and grepped the graph for
`window.` / `document.` / `navigator.` — no matches. None renders anything or
touches a web/UI global at import time. Two worth naming:
- **`../auth`** pulls in `better-auth/react`, so React is imported at module
  scope in a headless context. It is only a hook library import; nothing renders
  and `createZilarAuthClient` is not called at import time. Safe.
- **`expo-notifications` / `expo-task-manager`** register native modules at
  import; on a headless start these are exactly what must load, and they do no UI
  work at import. Safe.
`polyfills.ts` only installs shims when the global is missing, so it is a no-op
where Hermes/Expo already provides them.

### Commands and results

- `pnpm install` — Done in 10.7s (peer-dependency warning only:
  `@types/react-dom 19.3.0` vs `@types/react@19.2.18`; pre-existing).
- `pnpm gate` (from the repo root) — summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single-file tests were run: the spec says this task has none, and the change
  is entry wiring. The gate's nearest-tests step ran `@zilar/mobile`.

### Files changed

- `apps/mobile/index.ts` (new)
- `apps/mobile/package.json`
- `apps/mobile/src/lib/push/background.ts` (comment only)
- `work/T-1359-headless-wake-entry.md` (this report + status)

All four are in the Allowed files, and the gate confirms no file outside scope
changed.

### Problems / deviations / open questions

- No deviation from the spec.
- **Acceptance not verified here:** the second acceptance item is the lead's
  phone check (adb, app killed, then a DM: no "No task registered" in logcat and
  the notification appears without opening the app). I cannot run adb or check a
  physical device, so this remains for the lead/Julio. The code change is
  limited to moving the task definition ahead of the router entry, which is the
  documented cause; the runtime behaviour needs the on-device check.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean; the packet is current for `e14f4c92`.**
- **Phone check of the branch build:**
  - the push for test 8 was sent at 12:02:00Z, and the closed app fetched `/api/push/preview` at 12:02:02Z by itself (before this change, only when Julio opened it).
  - Julio didn't see a notification for test 8. That's separate: the component's error reply made ejabberd disable push (T-1360). The post step is re-checked with a full logcat after T-1360.
