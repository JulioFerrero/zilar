---
id: T-0031
title: Mobile boot check — a script that proves the iOS app actually starts
status: review
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

Built `apps/mobile/scripts/boot-check.mjs`, exposed as
`pnpm --filter @galena/mobile boot:ios`, with pure logic in two modules and
Vitest tests for both:

1. **Native project matches dependencies** — runs
   `pnpm exec expo-modules-autolinking resolve --platform ios --json` (verified
   on this machine; 22 pods including `ExpoSecureStore`), compares the pod
   names with the `PODS:` block of `ios/Podfile.lock` via
   `findMissingPods()` in `scripts/pods.ts`. If `ios/` is missing it runs
   `expo prebuild --platform ios`; if pods are missing it runs `pod install`,
   re-checks, and fails listing what is still missing.
2. **JS dependencies** — see "deviations" for the exact method: byte-compare
   `node_modules/.pnpm/lock.yaml` against `pnpm-lock.yaml` (fail fast when
   stale) plus a real `pnpm install --frozen-lockfile --offline`.
3. **Build/install/launch** — refuses port 8081 outright, fails fast if the
   requested port is busy (it never stops a process it did not start), starts
   Metro (`pnpm exec expo start --port <n>`, default 8082) in its own process
   group with output to `metro.log`, waits until the port accepts connections
   (probing `127.0.0.1` and `::1`), then runs
   `pnpm exec expo run:ios --no-bundler --device <udid>` with
   `RCT_METRO_PORT=<n>` in the environment so the port is baked into the
   installed app's `Info.plist` (`RCTMetroPort`). Before launching it reads
   that key back with `plutil` and refuses to launch if it is not exactly the
   check's port (an empty value would make the app fall back to 8081). It then
   terminates the copy `run:ios` launched and launches a clean instance,
   capturing the PID.
4. **Detecting a broken app** — watches `metro.log` and the simulator's app
   log (`simctl spawn <udid> log show --last 10s --info --predicate …`,
   appended to `app.log`, lines timestamp-filtered to this launch) with
   `evaluateWatch()`/`findFailureReason()` from `scripts/log-watch.ts`:
   fails on `Cannot find native module`, `Unable to resolve`,
   `Invariant Violation`, `Bundling failed`, a standalone `ERROR` (red box),
   the app process exiting (PID liveness), or no `Bundled` line within
   `--timeout` (default 90 s). It **passes only after** `Bundled` appears in
   the Metro log **and** the app log shows the JS app actually ran
   (`Running "main" with {…}"` — `isFirstRenderLine()`), then after the
   settle window (`--settle`, default 5 s) with no failure.
5. **Cleanup/report** — always takes a screenshot and saves `metro.log`,
   `app.log` and `build.log` under `apps/mobile/.expo/boot-check/<timestamp>/`
   (git-ignored), prints the folder, stops Metro through its own child handle
   (process-group `SIGTERM`/`SIGKILL`, never `kill`/`pkill` by name or port),
   and exits non-zero with a one-line `FAIL:` reason.

### Files changed

- `apps/mobile/scripts/boot-check.mjs` (new) — the CLI/orchestration
- `apps/mobile/scripts/pods.ts` (new) — pure autolinking ↔ Podfile.lock comparison
- `apps/mobile/scripts/pods.test.ts` (new) — 8 Vitest tests
- `apps/mobile/scripts/log-watch.ts` (new) — pure log classification
- `apps/mobile/scripts/log-watch.test.ts` (new) — 18 Vitest tests
- `apps/mobile/package.json` — only the `scripts` block (added `boot:ios`)
- `apps/mobile/README.md` — a "Boot check" section + one row in the Scripts table
- `work/T-0031-mobile-boot-check.md` — status + this Report

No other files touched (`git status` shows only the above). `ios/` and
`.expo/` are git-ignored; nothing was committed there.

### Commands run and real results

- `pnpm install`: `Lockfile is up to date … Done in 825ms` — exit 0.
- `pnpm format:check`: `All matched files use Prettier code style!` — exit 0.
- `pnpm lint`: `Found 0 warnings and 0 errors.` — exit 0.
- `pnpm typecheck`: `Tasks: 8 successful, 8 total` — exit 0.
- `pnpm exec turbo test --force`: `Tasks: 8 successful, 8 total` — exit 0
  (final run). Mobile package alone: `Test Files 16 passed | 2 skipped (18)`,
  `Tests 120 passed | 2 skipped (122)`; the skipped two are the pre-existing
  gated integration tests. The named tests exist and pass:
  `scripts/pods.test.ts (8 tests)`, `scripts/log-watch.test.ts (18 tests)`.
- `pnpm build`: `Tasks: 2 successful, 2 total` — exit 0.

**Integration check (real output, exit 0):**

```
$ pnpm --filter @galena/mobile boot:ios --device A3E0C081-CEA4-453B-ABA1-23EE7D044E54
[boot-check] artifacts: /Users/julio/personal-projects/galena-T-0031/apps/mobile/.expo/boot-check/2026-09-28T09-55-35-381Z
[boot-check] device: A3E0C081-CEA4-453B-ABA1-23EE7D044E54 | metro port: 8082
[boot-check] autolinking expects 22 iOS pods
[boot-check] native project matches the autolinked dependencies
[boot-check] JS dependencies match the lockfile
[boot-check] starting Metro on port 8082 (log: .../2026-09-28T09-55-35-381Z/metro.log)
[boot-check] building and installing with expo run:ios --no-bundler (this can take a while)
[boot-check] build and install finished
[boot-check] installed app points at Metro port 8082
[boot-check] launched com.julioferrero.galena (pid 28576)
[boot-check] stopping the Metro process it started
[boot-check] artifacts: .../2026-09-28T09-55-35-381Z
[boot-check] screenshot: .../2026-09-28T09-55-35-381Z/screenshot.png
[boot-check] metro log: .../2026-09-28T09-55-35-381Z/metro.log
[boot-check] app log:   .../2026-09-28T09-55-35-381Z/app.log
[boot-check] PASS: bundle loaded and the JS app ran, no errors for 5s of settle time
```

Evidence in the saved logs: `metro.log` contains
`iOS Bundled 2292ms node_modules/.pnpm/expo-router@…/expo-router/entry.js (4021 modules)`
(and three benign `WARN Sending onAnimatedValueUpdate with no listeners registered`);
`app.log` contains, for our PID 28576,
`[com.facebook.react.log:javascript] Running "main" with {"rootTag":11,"initialProps":{},"fabric":true}`.

**Screenshot** (opened, `.../2026-09-28T09-55-35-381Z/screenshot.png`): it shows
the **"Sign in to Galena"** screen, not the splash — bold title "Sign in to
Galena", an **Email** field with the placeholder `you@example.com` and a
focused caret, a blue **Continue** button, and the iOS software keyboard raised
(the field auto-focuses). Status bar reads `11:57 Mon Sep 28`, Wi-Fi, 100 %
battery; the app runs in an iPhone-sized window on the iPad's home-screen
wallpaper. No red box, no error overlay.

**Missing-pod detection demonstrated** (copy of `Podfile.lock` in a temp
folder with all 4 `ExpoSecureStore` lines removed; no tracked file touched):

```
$ node … -e "…findMissingPods(expected, tampered)…"
expected pods from autolinking: 22
missing from tampered Podfile.lock:  ["ExpoSecureStore"]
missing from real Podfile.lock:      []
```

**Safety:** the iPhone simulator `DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8` and
Metro on 8081 (still served by pid 74464) were never touched; after each run
port 8082 was free and no boot-check process was left behind.

### Problems, deviations from the spec, open questions

- **Item 2 method (spec asked which):** pnpm has no `--dry-run`, so the check
  fails fast by byte-comparing `node_modules/.pnpm/lock.yaml` (written by the
  last install) with `pnpm-lock.yaml`, then runs the spec's
  `pnpm install --frozen-lockfile --offline` as the second line of defence.
  Both are ~1 s when healthy; together they catch the "stale node_modules"
  failure from the Goal.
- **Metro readiness probe:** `expo start` with `--localhost` binds only
  `[::1]`; the first run failed with "Metro did not listen on port 8082
  within 60s" even though Metro was up. Fixed by dropping `--localhost`
  (default binds all interfaces, like a normal `expo start`) and probing both
  `127.0.0.1` and `::1`.
- **`expo run:ios` rejects `--port` together with `--no-bundler`** (the CLI
  throws "–port and –no-bundler are mutually exclusive"). The port instead
  reaches the app through the `RCT_METRO_PORT` environment variable, which
  xcodebuild resolves into the `RCTMetroPort` `Info.plist` key; the script
  verifies that key on the installed app before launching (safety net against
  the app falling back to 8081).
- **First `ERROR` pattern was too broad:** a real run failed on
  `Socket SO_ERROR [61: Connection refused]` (the app probing localhost:8097).
  The pattern now requires a standalone `ERROR` token, with a regression test
  built from that exact log line. The connection to :8097 is benign (nothing
  listens there during a boot check) and does not affect rendering.
- **Passing means "actually rendered" (lead's review of run 2):** run 2's
  screenshot showed only the splash because the check failed before render.
  The check now requires `Running "main" with {…}` (RN mounting the root
  component) in the app log — timestamp-filtered to the launch being watched,
  so `run:ios`'s earlier auto-launch cannot count — before it settles and
  screenshots. If that evidence never appears it fails with
  `bundle loaded but no evidence the JS app ran within 90s …`.
- **App log source:** a persistent `log stream` child was replaced by polling
  `simctl spawn … log show --last 10s`, because the sandbox blocks the `kill`
  command and an orphaned streamer inside the simulator could not be cleaned
  up through a child handle. Cleanup of everything the script starts is done
  only via child process handles (process-group signals), per the lead.
- **No zod:** the spec allows no dependencies, so the boundary JSON is
  validated manually inside the pure functions (they throw descriptive errors
  on unexpected shapes; covered by tests).
- **Load-induced flake in `pnpm exec turbo test --force`:** with other
  worktrees running vitest in parallel (load average 87), pre-existing
  `@galena/web` tests failed twice with `Test timed out in 5000ms`
  (`ChatShell.test.tsx`, `MessageActions.test.tsx`). Same command passed 8/8
  on the first attempt in this session and on the final attempt;
  `pnpm --filter @galena/web test` alone passes 85/85. Nothing in this task
  touches `apps/web`.

### Blocked / needs a decision

- (none — status is review)


---

## Review (written by Claude)
