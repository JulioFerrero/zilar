---
id: T-1466
title: "400-line rule: split apps/server/src/main.ts (572) into startup/ modules (lifecycle, boot, components) behind the same exports; boot order, logs and exit behaviour unchanged"
status: merged
milestone: M5
branch: task/T-1466-split-server-main
model: auto
effort: default
depends_on: [T-1460]
estimate: 0.4 day
---

# T-1466: Split server main.ts

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10): at most 400 lines per source file. The plan is `docs/audit/size-plan.md` item #38 (line 137). Its line numbers are older, so split by the sections it names.

**This file boots the server, and every merge auto-deploys: the boot order and its side effects must stay identical.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/main.ts`** is 572 lines.
- **The lifecycle part:**
  - `CONNECTION_GRACE_MS` (`:71`), `FORCE_EXIT_MS` (`:72`);
  - `interface RunningServer` (`:80`) and `emptyRunning()` (`:91`);
  - `stopServer` (`:111`), `shutdownServer` (`:142`), the private `logShutdownSignals` (`:165`) and `serverTeardown` (`:185`).
- **The program:** `serverProgram` (`:197`).
- **The boot:** `startServer(running)` (`:213` to the end). In order, it does:
  - config and logger;
  - the mailer, with an exit on `MailerConfigurationError`;
  - the db, `registerSqlRuntime` and `runMigrations` (`:240`);
  - `CurrentMailer` (`:247`);
  - the sticker, avatar and background dirs (`:255-282`), then the storage warnings (`:284`);
  - the admin client and auth (`:306-307`);
  - the runner hub config (`:309`), the machine registry (`:319`) and the audit recorder (`:332`);
  - the announcer and action gateway (`:334+`), then the rest of the components through to listen.
- **Importers:**
  - `apps/server/src/index.ts:2` imports `serverProgram` and `serverTeardown`;
  - `apps/server/src/main.test.ts:4` imports `emptyRunning` and `stopServer`.
- **No `apps/server/src/startup/` folder exists.**

### What to build
1. **`apps/server/src/startup/lifecycle.ts`:** the constants, `RunningServer`, `emptyRunning`, `stopServer`, `shutdownServer`, `logShutdownSignals` and `serverTeardown`, moved unchanged.
2. **`apps/server/src/startup/boot.ts`:** the fail-fast boot steps, from config through the storage dirs and warnings. Return what later steps need (`config`, `logger`, `db`, `currentMailer`, the dirs) as one object.
3. **`apps/server/src/startup/components.ts`:** the rest of `startServer` (auth, registries, gateways, hub and the listen). Split it into two files if needed, so each file is at 350 lines or fewer.
4. **`main.ts` keeps `serverProgram` and `startServer`** as a short orchestration of those steps, **in today's exact order**. It re-exports every name it exports today, so `index.ts` and `main.test.ts` don't change. It ends at 150 lines or fewer.
5. **No behaviour change:**
   - the same log lines and messages;
   - the same `process.exit` paths;
   - the same order of side effects (migrations before anything that reads the db, the hub after listen, and so on).
   - Moving code is fine; rewording or reordering is not. Keep the existing comments with the code they describe.

### Tests
None new. `apps/server/src/main.test.ts` and the full server suite must pass unchanged.

### Allowed files
- `apps/server/src/main.ts`
- new files under `apps/server/src/startup/`
- `work/T-1466-split-server-main.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate and the full server suite pass.
- After deploy, `/health` shows the new commit with every check ok, and the lead reads the boot log lines for errors.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/main.ts` (572 lines) into `startup/` modules behind the
same exports, with the boot order, log lines and exit paths unchanged. The
moved code is byte-for-byte identical to the old `main.ts` (verified with
`diff` against `git show HEAD:apps/server/src/main.ts`); the only edit inside
moved code is adding `export` to `logShutdownSignals` so `serverProgram`
(still in `main.ts`) can call it.

- `apps/server/src/startup/lifecycle.ts` (135 lines): `CONNECTION_GRACE_MS`,
  `FORCE_EXIT_MS`, `RunningServer`, `emptyRunning`, `stopServer`,
  `shutdownServer`, `logShutdownSignals`, `serverTeardown` — moved unchanged.
- `apps/server/src/startup/boot.ts` (151 lines): `bootServer(running)` holds the
  fail-fast steps from config through the storage-dir warnings. It returns one
  `BootedServer` object (`config`, `logger`, `db`, `closeDb`, `currentMailer`,
  `stickerDir`, `avatarDir`, `backgroundDir`). It still fills
  `running.logger`/`running.db`/`running.closeDb` at the same points as before,
  so a stop that begins mid-startup closes exactly what was started.
- `apps/server/src/startup/components.ts` (311 lines): `startComponents(boot,
  running)` holds the rest of the old `startServer` (auth, registries, action
  and agent gateways, app, HTTP listener, leader lock).
- `apps/server/src/main.ts` (64 lines): keeps the file overview, `serverProgram`
  (unchanged body) and `startServer` (now `bootServer` then `startComponents`),
  and re-exports every name it exported today from `startup/lifecycle.ts`.

### Files changed

- `apps/server/src/main.ts` (modified)
- `apps/server/src/startup/lifecycle.ts` (new)
- `apps/server/src/startup/boot.ts` (new)
- `apps/server/src/startup/components.ts` (new)
- `work/T-1466-split-server-main.md` (this file)

### Commands I ran (real results)

- `pnpm install` — done in 14s, 1137 packages.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/main.test.ts`
  — 1 file passed, 1 test passed.
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot`
  (the task's full-suite Check; I added `--maxWorkers=2` because AGENTS.md
  forbids `vitest run` without a worker cap) — **102 files passed / 717 tests
  passed** in 128s.
- `pnpm --filter @zilar/server build` — esbuild bundle OK (65ms), confirming
  the production bundle resolves the new modules (dist/ is gitignored).
- `pnpm gate` — summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (4.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations

- `logShutdownSignals` is now exported from `startup/lifecycle.ts` (it was
  module-private). `main.ts` does not re-export it, so the public surface is
  unchanged.
- `bootServer` takes `running` as well as returning an object, to keep the
  "fill each handle as soon as it exists" behaviour exactly (a failed migration
  still disposes the SQL pool on shutdown).
- Added `--maxWorkers=2` to the full server-suite command (see above).

### Note (not a change)

There is a pre-existing helper file `apps/server/src/startup.ts` (T-0120
writable-dir/GIF warnings) alongside the new `apps/server/src/startup/` folder.
`boot.ts` imports those helpers with `from '../startup'`, which resolves to
`startup.ts` (file beats directory, and there is no `startup/index.ts`);
typecheck, lint, tests and the production bundle all pass with this. I did not
move `startup.ts` because it is outside the Allowed files.

### Open questions

None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- `main.ts` drops from 572 to 64 lines, plus `startup/lifecycle.ts` (135), `boot.ts` (151) and `components.ts` (311).
- **The lead compared old and new:**
  - every non-import string literal is kept;
  - the `process.exit` count is the same (2);
  - the body order is the same: migrations, dirs, auth, runner hub, `createApp`, listen, agent gateway.
- The worker ran the full server suite: 102 files, 717 tests.
- After the deploy, the lead checks `/health` and the boot log.
