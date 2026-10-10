---
id: T-1058
title: "Size split: apps/mobile/scripts/boot-check.mjs (805 lines) into boot-check-{proc,steps,launch}.mjs, moved unchanged"
status: merged
milestone: M5
branch: task/T-1058-split-mobile-boot-check
model: auto
effort: default
depends_on: [T-1042]
estimate: 0.25 day
---

# T-1058: Split `boot-check.mjs`

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/scripts/boot-check.mjs` (805 lines) is the only file the T-1042 `max-lines` rule newly warned on. It is the `boot:ios` script (`apps/mobile/package.json:10`). It is a boot file, so every piece **moves unchanged**: no renames, no rewrites, no behaviour change. The lead read its sections on main (2026-10-10):
- **1-37:** the header comment, imports and constants;
- **38-249:** the process helpers (`BootCheckError`, `spawned`, `say`, `usage`, `parseArgs`, `parseSeconds`, `findWorkspaceRoot`, `runCapture`, `runStreamed`, `runToFile`, `spawnToLog`, `stopSpawned`, `delay`, `tailFile`);
- **251-327:** step 1 (native project) and step 2 (JS dependencies);
- **329-375:** the simulator helpers;
- **376-664:** launch and watch (`isPidAlive` … `isBundledIn`);
- **665-805:** `main()` and its call.

### What to build
1. **`apps/mobile/scripts/boot-check-proc.mjs`:** `BootCheckError`, `spawned`, `say`, and the run, spawn, stop, delay and tail helpers, exported.
2. **`apps/mobile/scripts/boot-check-steps.mjs`:** step 1, step 2 and the simulator helpers, exported. It imports what it needs from `./boot-check-proc.mjs`, `./pods.ts` and `node:*`.
3. **`apps/mobile/scripts/boot-check-launch.mjs`:** launch and watch, exported. It imports from `./boot-check-proc.mjs`, `./log-watch.ts` and `node:*`.
4. **`apps/mobile/scripts/boot-check.mjs`:** keeps the shebang, the header comment, the constants, `usage`, `parseArgs`, `parseSeconds`, `findWorkspaceRoot`, `main()` and the final `main().then(...)`, and imports the rest.
   - Where a moved function uses a constant or `mobileRoot`/`scriptsDir`, move that constant with it, or export it from one module. Never define it twice.
   - `spawned` must stay **one** shared array, the one the SIGINT handler stops.
5. **Size:** every file is at most 400 lines.
6. **Unchanged bodies:** every function body is byte-identical to main apart from an added `export`. In the Report, show a sorted comparison of the non-import lines, old file against the four new files: the only differences may be `export`/`import` lines.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `apps/mobile/scripts/boot-check.mjs`, `apps/mobile/scripts/log-watch.ts`, and `apps/mobile/scripts/pods.ts`.

### Allowed files
`apps/mobile/scripts/boot-check.mjs`, `apps/mobile/scripts/boot-check-proc.mjs`, `apps/mobile/scripts/boot-check-steps.mjs`, `apps/mobile/scripts/boot-check-launch.mjs`, `work/T-1058-split-mobile-boot-check.md`.

### Checks
```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/scripts/boot-check.mjs --help
pnpm gate
```

### Acceptance
- The Checks pass, and `--help` prints the same usage text as on main (include both outputs in the Report).
- The line comparison in the Report shows only `export`/`import` differences.

---

## Report (written by the worker when done)

Status: done. All bodies moved unchanged; only `export` keywords and the import
blocks differ.

### Files and sizes

`wc -l` on main and on this branch:

```
old apps/mobile/scripts/boot-check.mjs (main): 805
new apps/mobile/scripts/boot-check.mjs:        270
new apps/mobile/scripts/boot-check-proc.mjs:   134
new apps/mobile/scripts/boot-check-steps.mjs:  130
new apps/mobile/scripts/boot-check-launch.mjs: 305
```

Every file is under 400 lines and no `max-lines` warning appears.

### Export list before and after

Old file had no `export` lines (it is a script). After the split, the barrel
`boot-check.mjs` still exports nothing and the three new modules export the
moved names:

- `boot-check-proc.mjs`: `mobileRoot`, `BootCheckError`, `spawned`, `say`,
  `runCapture`, `runStreamed`, `runToFile`, `spawnToLog`, `stopSpawned`,
  `delay`, `tailFile`.
- `boot-check-steps.mjs`: `readAutolinkingPods`, `missingNativePods`,
  `checkNativeProject`, `checkJsDependencies`, `findSimulator`, `ensureBooted`.
- `boot-check-launch.mjs`: `isPidAlive`, `assertPortFree`, `tryConnect`,
  `waitForMetro`, `readAppJson`, `verifyBakedMetroPort`, `launchApp`,
  `queryAppLog`, `createLineReader`, `watchBoot`, `isBundledIn`.

`grep -E "^export"` on main prints `(none)`; on the four new files it prints the
list above (the barrel has none). Constants stay unexported because only the
module that owns them uses them; `mobileRoot` is shared and is exported from
`boot-check-proc.mjs` (the one module both other modules can import without a
cycle). `spawned` is the single array in `boot-check-proc.mjs`; the SIGINT
handler in the barrel imports it and stops it, so there is still exactly one.

### Line comparison

Sorted comparison of the non-import lines, old file against the four new files,
after stripping a leading `export ` (so "moved + export" matches "moved") and
dropping blank/import lines:

```
old lines: 731 new lines: 731
SORTED-NON-IMPORT-NON-BLANK-LINES-IDENTICAL
```

So every non-import, non-blank line is accounted for; the only textual
differences are the added `export` keywords and the `import` blocks (and blank
lines around them).

### Commands and real results

- `pnpm install`: `Done in 11.1s using pnpm v10.32.1` (warnings: one unmet peer
  `@types/react-dom`), exit 0.
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/scripts/boot-check.mjs --help`:
  printed the usage text (below), exit 0. The same command fed main's file from
  `git show` (run from `apps/mobile/scripts`) printed byte-identical usage, so
  `--help` is unchanged:
  ```
  Usage: pnpm --filter @zilar/mobile boot:ios --device <udid> [options]

  Build, install and launch the Zilar iOS app on a simulator and fail loudly if
  it does not come up.

  Options:
    --device <udid>    Simulator UDID to boot, install and launch on (required).
    --port <n>         Metro port (default 8082; 8081 is refused).
    --timeout <s>      Seconds to wait for the bundle (default 90).
    --settle <s>       Seconds to watch after the bundle loaded (default 5).
    -h, --help         Show this help.
  ```
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot scripts/log-watch.test.ts scripts/pods.test.ts`:
  `Test Files 2 passed (2)`, `Tests 26 passed (26)`.
- `pnpm gate` (repo root): summary lines
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.7s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- No new tests were written (spec: move unchanged; no behaviour change).
- Each new file starts directly with its imports; the barrel keeps the shebang
  and the T-0031 header comment exactly as on main.
- `METRO_READY_TIMEOUT_MS`, `APP_LOG_WINDOW_SECONDS` and `APP_LOG_POLL_MS` moved
  with `waitForMetro`/`watchBoot` into `boot-check-launch.mjs`;
  `DEFAULT_PORT`/`DEFAULT_TIMEOUT_SECONDS`/`DEFAULT_SETTLE_SECONDS`/`FORBIDDEN_PORT`
  stayed in the barrel with `usage`/`parseArgs`. None is defined twice.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `apps/mobile/scripts/boot-check.mjs` (805 lines) is now four files:
  - `boot-check.mjs`, 270 lines;
  - `boot-check-proc.mjs`, 134;
  - `boot-check-steps.mjs`, 130;
  - `boot-check-launch.mjs`, 305.

  Each one is under 400.
- **The lead's line check:** a sorted comparison of the non-import lines, main's file against the four new files, shows no difference in either direction.
- **The shared array:** `spawned` is one array, exported from `boot-check-proc.mjs:14`. `spawnToLog` pushes to it, and the SIGINT cleanup in `boot-check.mjs:255` reads it.
- **The lead ran it:**
  - `--help` prints exactly the same text as on main;
  - `--device NOPE` runs through steps 1 and 2 and fails cleanly with "simulator NOPE was not found";
  - the worktree stayed clean.
- **Check:** the gate passed.
