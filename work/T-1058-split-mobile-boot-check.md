---
id: T-1058
title: "Size split: apps/mobile/scripts/boot-check.mjs (805 lines) into boot-check-{proc,steps,launch}.mjs, moved unchanged"
status: todo
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

## Review (written by Claude)
