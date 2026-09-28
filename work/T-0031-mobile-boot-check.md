---
id: T-0031
title: Mobile boot check — a script that proves the iOS app actually starts
status: todo
milestone: M1
branch: task/T-0031-mobile-boot-check
model: opencode-go/deepseek-v4-pro
depends_on: []
estimate: 1 day
---

# T-0031: Mobile boot check

## Spec (written by Claude, do not edit)

### Goal
On 2026-09-28, T-0026 ("mobile sign-in for real") merged with every unit test,
the gated live integration and CI green, and **the app crashed on launch**:

```
Uncaught Error: Cannot find native module 'ExpoSecureStore'
```

`expo-secure-store` was in `package.json`, but `apps/mobile/ios/` (generated
and gitignored) had been set up before it was added, and nobody re-ran
`pod install`. So the module was never compiled in. The same morning, a stale
`node_modules` made Metro fail with `Unable to resolve "better-auth/client/plugins"`.
The fix was `pod install` + `pnpm install` + a rebuild. **Nothing in our checks
can see either failure**, because none of them start the app.

Build the check that does: one command that makes sure the native project
matches the dependencies, builds, installs, launches the app on a simulator, and
fails loudly if the JS bundle or the app reports an error.

### Read first
- `AGENTS.md` (mandatory)
- `apps/mobile/package.json`, `app.json`, `metro.config.js`, `README.md`
- `apps/mobile/ios/Podfile` and `Podfile.lock` (generated; read them, do not
  commit them — `ios/` is in `.gitignore`)
- Expo SDK 57 docs on autolinking: find the **real** command that lists the
  native modules autolinking resolves for iOS (e.g.
  `expo-modules-autolinking resolve --platform ios --json`). Verify it on this
  machine; do not guess its output shape.
- `xcrun simctl help` (`boot`, `install`, `launch`, `io … screenshot`,
  `spawn … log`), and `expo run:ios --help`

### Allowed files
- `apps/mobile/scripts/**` (new)
- `apps/mobile/package.json` — **only** the `scripts` block
- `apps/mobile/README.md` — a short "Boot check" section
- `work/T-0031-mobile-boot-check.md`

**Not allowed:** `apps/mobile/src/**`, `app.json`, `metro.config.js`, other apps,
`packages/**`, `.github/**`, `docs/**`. If the check needs one of those, say why
in the Report and stop.

### Allowed dependencies
None. Use Node's built-ins (`child_process`, `fs`, `path`), plus the tools
already on the machine: `xcrun`, `pod`, and `expo` via `pnpm exec`.

### What to build
A Node script, `apps/mobile/scripts/boot-check.mjs` (or `.ts` run with a tool the
package already has), exposed as `pnpm --filter @galena/mobile boot:ios`, with
`--device <udid>` and `--port <metro port>` options.

1. **Native project matches the dependencies.** Resolve the iOS native modules
   autolinking expects and compare them with the pods in `ios/Podfile.lock`.
   If any are missing (or `ios/` does not exist), run `pod install` (or the
   Expo prebuild step that creates `ios/`), then re-check, and **fail** if they
   still do not match. Put the comparison in a **pure function** in its own
   module. Tests (Vitest): the real failure case (the expected list has
   `ExpoSecureStore`, the lockfile does not → reported as missing); all present
   → OK; extra pods in the lockfile are fine.
2. **JS dependencies are installed.** Fail fast with a clear message if
   `pnpm install --frozen-lockfile --offline` would change `node_modules`, or
   pick an equally cheap and reliable way; say which in the Report. It must
   catch the "stale node_modules" failure described above.
3. **Build, install, launch.** Start Metro on `--port` (default **8082**, never
   8081) in the background with its output going to a log file, build and
   install with `expo run:ios --no-bundler`, and launch the app on the given
   simulator (booting it if needed).
4. **Detect a broken app.** Watch the Metro log and the simulator's app log for
   a bounded time (configurable, default 90 s). Fail on `Cannot find native
   module`, `Unable to resolve`, a red-box `ERROR`, `Invariant Violation`, or
   the app process exiting. **Pass** only after the bundle has loaded
   (`Bundled` in the Metro log) and no failure appeared within a settle window.
   Keep the patterns in a pure function with tests built from the real log lines
   quoted in the Goal above.
5. **Always clean up and report.** Save a screenshot and both logs to a folder
   printed at the end, stop the Metro process **the script itself started** (by
   its child process handle, never `kill`/`pkill` by name or port), and exit
   non-zero on failure with a one-line reason.

### Integration check (you run it)
- Use the **iPad simulator `A3E0C081-CEA4-453B-ABA1-23EE7D044E54`** and port
  **8082**. The iPhone simulator `DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8` and
  Metro on **8081** are in use by Julio: never launch on, shut down or erase that
  simulator, and never stop a process you did not start.
- Run `pnpm --filter @galena/mobile boot:ios --device A3E0C081-CEA4-453B-ABA1-23EE7D044E54`
  and paste the real output. Open the screenshot and describe what it shows
  (it should be the "Sign in to Galena" screen).
- **Prove it catches the real failure**, without touching tracked files: run the
  comparison from item 1 against a copy of `Podfile.lock` in a temp folder with
  the `ExpoSecureStore` entries removed, and paste the output showing it is
  reported missing.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] The named tests for items 1 and 4 exist and pass.
- [ ] A real passing run on the iPad simulator is pasted in the Report, with the
      screenshot description.
- [ ] The missing-pod detection is demonstrated as described.
- [ ] Only allowed files touched. The iPhone simulator and Metro on 8081 were
      never touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Running this in CI (GitHub's macOS runners are a separate decision for Julio).
- Android.
- Changing any app code, even if the boot check finds a real bug. Report it.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)
