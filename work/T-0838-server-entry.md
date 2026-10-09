---
id: T-0838
title: "S12 + S13: the server entry apps/server/src/index.ts on Effect — startup as one Effect program, shutdown by closing its Scope in the same order, NodeRuntime.runMain; local start/stop rehearsal"
status: merged
milestone: M5
branch: task/T-0838-server-entry
model: auto
effort: default
depends_on: [T-0837]
estimate: 1 day
---

# T-0838 (S12 + S13): the server entry on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md`, rows S12 and S13 (lines 351-352), accepted by Julio on 2026-10-09; one worker for both steps. After the gateway (T-0837) this is the last server file that `pnpm effect:map` reports as `needs-effect`, with signals H1, H3, W4 and W7. The plan flags "Julio: deploy risk", so nothing deploys before Julio's live checks. The server must start, serve and stop exactly as today.

### Verified facts (re-read the lines before editing; merges may move them)
`apps/server/src/index.ts` (550 lines) is a top-level module with no exports. In order, it:
- **Fail-fast setup (58-70):** `loadServerConfigOrExit(process.env)` at 58. `createMailer` at 63 inside try/catch: a `MailerConfigurationError` prints its message with `console.error` and calls `process.exit(1)`; any other error is rethrown.
- **Database (72-77):** `createDb` at 72, `registerSqlRuntime(db, …)` at 76, then `await runMigrations(db)` at 77, all before anything reads the database.
- **Stored mail settings (84-90):** `CurrentMailer`, and `await getMailSettings` at 86 only when `MAIL_TRANSPORT` is unset.
- **Storage checks (102-137):** `ensureWritableDir` for the sticker, avatar and background dirs at 103, 113 and 117; `warnOnEmptyStorageDir` at 104; `warnOnContainerLayerStorage` at 124; `warnOnGifConfig` at 133.
- **Components (139-401), built synchronously:** the admin client, auth, `assertRunnerHubConfig` (145, throws on bad config), the machine registry, the audit recorder, the announcer with the `gatewayRef` placeholder (175-182), the action adapters and gateway (207-253), the archive pool (256), `loadPushConfigOrExit` at 264, `createApp` at 266, the push component in try/catch (293-344, with the fire-and-forget `reconcileRoomSubscriptionOptions(...).catch` at 331), the listener warning (363), `createAgentGateway` at 368, and `gatewayRef = gateway` at 401.
- **Listen (410-414):** `await serveEdgeOnNode(app, { port, connectionGraceMs: 3_000 })`, then the log `'zilar-server listening'` with `{ port }`. CI waits for this exact line: `.github/workflows/images.yml:142-150` (T-0743).
- **Work started only after listening, never blocking (416-503):**
  - the runner hub: `startRunnerHub(...).then(...).catch(...)` at 421-436, only when `RUNNER_HUB_ENABLED`;
  - `void gateway.start().catch(...)` at 442, which redacts the master key in the message and stack before logging `'agent gateway failed to start'`;
  - `startApprovalsSweeper` at 456 and `startRecoveryStuckTimer` at 465;
  - `void actionGateway.recoverStuck().catch(...)` at 474;
  - `buildRoutineScheduler` at 485.
- **Shutdown (505-549):** `shutdown(signal)`, guarded by `shuttingDown`. It:
  1. logs `'shutting down'` with `{ signal }`;
  2. arms an unref'd 15 s force-exit, which logs `'shutdown timed out; exiting'` and calls `exit(1)`;
  3. stops, in this order: `closeNodeServer()`, `runnerHub.close()`, `pushComponent.stop()`, `gateway.stop()`, `approvalsSweeper.close()`, `recoveryStuck.close()`, `routineScheduler.stop()`, `disposeSqlRuntime(db)`, `close()`;
  4. calls `process.exit(0)`.

  It is wired to `SIGINT` and `SIGTERM` at 544-549.
- **The runtime:** `@effect/platform-node` 4.0.2 is a server dependency. Its `NodeRuntime.runMain` (in `node_modules/.pnpm/@effect+platform-node-shared@4.0.2_effect@4.0.2/node_modules/@effect/platform-node-shared/dist/NodeRuntime.d.ts:16-48`) interrupts the main fiber on SIGINT/SIGTERM and picks the exit code through a `teardown`. Read its `.js` to see exactly what it does on a signal and which exit code it uses, before relying on it.
- **Tests:** nothing imports `index.ts`. `apps/server/src/startup.test.ts` covers the storage helpers.

### What to build, in two commits
1. **S12, startup as one Effect program.** Move the body into a `startServer` Effect, in `index.ts` or in a new `apps/server/src/main.ts` that `index.ts` runs. Each step becomes an Effect step in the same order. The components may stay plain factory calls; use Layers only where it is simple, and say in the Report which you did.
   - The fire-and-forget sites (331, 421-436, 442, 474) become `Effect.runFork`, or forks that do not block startup, with the same log text and fields. The gateway start keeps its secret redaction.
   - The two fail-fast exits keep their messages and exit code 1: the mailer at 64-69, and the `...OrExit` loaders.
   - At the end of S12, shutdown may still use the old signal handlers.
2. **S13, shutdown by closing the Scope, and `NodeRuntime.runMain`.** Register ONE finalizer after everything has started. It runs exactly the old stop sequence, in the old order (HTTP server first, the SQL runtime last), and it must also run when shutdown begins while startup is still in flight. Do not rely on the reverse acquisition order: the HTTP server must stop first.
   Keep identical:
   - the `'shutting down'` log with `{ signal }` (it needs the signal name; if `runMain` cannot give it, keep a small signal listener that logs it and then interrupts the main fiber);
   - the 15 s force-exit with its log line and exit code 1;
   - exit code 0 after a clean shutdown;
   - a second signal during shutdown does nothing more;
   - the 3 s connection grace.

### Local rehearsal (required, after each commit; local docker stack only)
- The local stack runs in docker: `zilar-dev-postgres-1` on 127.0.0.1:5432, plus ejabberd and litellm.
- **Never connect to the live site.**
- **Never print `.env` values** (no `cat`, no `env`, no `set -x`).

Steps:
1. Link the env file: `ln -s /Users/julio/personal-projects/galena/apps/server/.env apps/server/.env`. Remove the link before every commit; it must never be committed.
2. Create a scratch database: `docker exec zilar-dev-postgres-1 createdb -U <the user from the local DATABASE_URL> zilar_t0838` (read the user without printing the URL). Point `DATABASE_URL` at it for the rehearsal only, overriding the env var on the command line.
3. Start the server with `PORT=3199 AGENT_GATEWAY_ENABLED=false RUNNER_HUB_ENABLED=false PUSH_ENABLED=false`, from `apps/server` with `pnpm exec tsx --env-file-if-exists=.env src/index.ts`, run in the background with its output saved to a file in your scratch area.
4. Wait for `zilar-server listening`, then `curl -s -o /dev/null -w '%{http_code}' localhost:3199/api/me` (expect 401).
5. Send SIGTERM to the server process, and check the log shows `shutting down` with `"signal":"SIGTERM"` and the exit code is 0.
6. Repeat with SIGINT.
7. Do the same once on the **old** code before your first commit, and compare the log lines.
8. At the end, drop the scratch database: `docker exec zilar-dev-postgres-1 dropdb -U <user> zilar_t0838`.

Put each run's result in the Report, without secrets.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, this whole `index.ts`, `apps/server/src/effect/node-serve.ts`, `apps/server/src/effect/sql.ts`, and the `NodeRuntime` files named above.

### Allowed files
`apps/server/src/index.ts`, `apps/server/src/main.ts` (new, optional), `apps/server/src/main.test.ts` (new, optional, for anything you can unit-test such as the shutdown order with fakes), `work/T-0838-server-entry.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server typecheck
pnpm exec oxlint apps/server/src/index.ts apps/server/src/main.ts
pnpm --filter @zilar/server exec vitest run --reporter=dot src/startup.test.ts src/app.test.ts
```
Plus the rehearsal above. If you add `main.test.ts`, run it 3 times.

### Acceptance
- **The file:** `index.ts` (and `main.ts`) are `effect` or `exempt` in `pnpm effect:map`, with no `async`, `try {`, `.then(` or `.catch(` of their own. A short `// effect-plain:` marker on a 3-line `index.ts` that only runs the program is fine.
- **The rehearsal:** start, the 401, and SIGTERM and SIGINT give the same log lines and exit codes as the old code.
- **The rest:** typecheck and oxlint are clean, and only Allowed files change.

---

## Report (written by the worker when done)

Two commits: S12 (`0c9ed0ec`, startup) and S13 (this one, shutdown and `runMain`). Wave mode: `pnpm gate` was not run.

### What was done
- **effect:map kinds:** `apps/server/src/index.ts` is `effect` (3 lines, no signals). `apps/server/src/main.ts` is `effect` with the weak signals W4 and W7 only (`Effect.catch(` matches the `.catch(` pattern; `process.env` is passed to `loadServerConfigOrExit` and `loadPushConfigOrExit`). No `async`, `await`, `try {`, `.then(` or `setTimeout` in either file. `main.test.ts` is a test file (not counted).
- **Layers or plain factories:** plain factory calls inside one `Effect.gen` (`startServer`). No Layers: the components are built by synchronous factories and the order matters, so Layers would not have been simpler.
- **`RunningServer`:** a small mutable record of the handles (logger, db, `closeDb`, `closeHttp`, runner hub, push, agent gateway, sweeper, recovery timer, routine scheduler). `startServer` fills each field as soon as the thing exists. It replaces the old `runnerHub` and `gatewayRef` variables (`isMachineOnline` and the announcer read `running.runnerHub` / `running.gateway`).
- **Old sites:**
  - each `await` became `Effect.promise(() => ...)`;
  - the mailer try/catch became `Effect.try` + `Effect.catch` (`MailerConfigurationError`: `console.error(message)`, `process.exit(1)`; any other error: `Effect.die(error)`);
  - the push try/catch became `Effect.try` + `Effect.catch` with the same two log lines;
  - the four fire-and-forget sites (push room reconcile, runner hub, `gateway.start()` with its secret redaction, `recoverStuck`) became `Effect.tryPromise` + `Effect.catch` (same log text and fields) + `Effect.forkDetach({ startImmediately: true })`. `startImmediately` keeps the old order: each call runs up to its first await before the next line, exactly like `void x().catch()`;
  - `Promise.resolve(false)` in the two `post` callbacks became one shared `post` (`Effect.runPromise(Effect.succeed(false))`);
  - the two `...OrExit` loaders run in `Effect.sync` and keep their own exits.
- **S13, shutdown:** `index.ts` is `NodeRuntime.runMain(serverProgram, { teardown: serverTeardown })`. `serverProgram` = `Effect.scoped` of: `emptyRunning()`, ONE `Effect.addFinalizer(() => shutdownServer(running))`, a signal logger, `startServer(running)`, `Effect.never`.
  - **Deviation from the spec text:** the finalizer is registered BEFORE startup, not after, and reads the handles from `RunningServer`. That is what makes it run correctly when shutdown begins while startup is in flight (it stops only what exists); a finalizer registered after startup could not.
  - `shutdownServer`: forks the 15 s force-exit (`'shutdown timed out; exiting'`, exit 1) with `Effect.forkDetach`, then runs `stopServer` in the old order (HTTP server, runner hub, push, gateway, sweeper, recovery timer, routine scheduler, `disposeSqlRuntime`, `closeDb`). The force-exit fiber is interrupted when the stop ends (found by a test: otherwise it would still fire 15 s later).
  - `runMain` (read in `platform-node-shared/dist/NodeRuntime.js`) interrupts the main fiber on SIGINT/SIGTERM, then calls the teardown, then `process.exit(code)` when a signal was received. The default teardown gives 130 for interruption, so `serverTeardown` maps "interruption only" to 0 and leaves every other case to `Runtime.defaultTeardown` (failure = 1).
  - `runMain` does not give the signal name, so `logShutdownSignals` adds a listener per signal that logs `'shutting down'` with `{ signal }` once; a second signal logs nothing.

### Rehearsal (local docker stack, scratch database `zilar_t0838` created with the postgres superuser because the `zilar` role cannot create databases, dropped at the end; `.env` symlink removed before each commit; no `.env` values printed; `NODE_ENV=test` so pino writes JSON)
Log lines compared without time, pid, hostname and request id.

| Run | Old (before S12) | S12 | S13 |
| --- | --- | --- | --- |
| start + `/api/me` | `push is disabled`, `zilar-server listening` `{port:3199}`, `agent gateway is disabled`, 401 | identical | identical |
| SIGTERM | `shutting down` `{signal:"SIGTERM"}`, exit 0 | identical | identical |
| SIGINT | `shutting down` `{signal:"SIGINT"}`, exit 0 | identical | identical |
| runner hub + gateway + routines + tools on (SIGTERM / SIGINT) | adds `runner hub listening` `{port:3197}`, exit 0 | identical | identical |
| push on with a bad host | `push component error`, `push component failed to start` (warn), 401, exit 0 | identical | not rerun |
| unfinished request open at SIGTERM | exit 0 after 3016 ms | not run | exit 0 after 3011 ms |
| two SIGTERMs 2 ms apart | not run | not run | one `shutting down`, exit 0 |
| `STICKER_STORAGE_DIR=/proc/nope` | message `STICKER_STORAGE_DIR (/proc/nope) is not writable: ...`, exit 1 | identical | identical |
| invalid config (`NODE_ENV` bad) | `Invalid server configuration: ...`, exit 1 | identical | identical |
| database refuses the login | uncaught `SqlError` with stack, exit 1 | not run | `ERROR effect/sql/SqlError: ...` with stack, exit 1 |

Not rehearsed: the 15 s force-exit and the `MailerConfigurationError` exit (config validation rejects every input that reaches it, so no env var triggers it). The force-exit and the in-flight stop are covered by `main.test.ts`. A signal sent while the server is still in startup could not be hit reliably: startup takes tens of ms after the module loads, so the signal either arrived before `runMain` installed its handlers (default kill, as before) or after the server was up.

### Checks (real results)
- `pnpm --filter @zilar/server typecheck`: clean.
- `pnpm exec oxlint apps/server/src/index.ts apps/server/src/main.ts apps/server/src/main.test.ts`: clean (exit 0). Prettier check: clean.
- `pnpm --filter @zilar/server exec vitest run --reporter=dot src/startup.test.ts src/app.test.ts src/main.test.ts`: 3 files, 32 tests passed (startup + app 22 as before S13; main.test.ts 10). `main.test.ts` alone, 3 runs: 10 passed each time.
- New `main.test.ts` (10 tests): stop order with fakes (HTTP first; the SQL runtime is already disposed when `closeDb` runs and still registered while the routine scheduler stops), partial startup, nothing started, a failing step ends the sequence, force-exit fires on a hung stop, no force-exit when the stop is in time, the finalizer runs once under a double interrupt, teardown codes (interrupt 0, success 0, failure 1, defect 1).

### Behaviour differences
1. A SIGINT/SIGTERM that arrives while startup is in flight (after `runMain` has installed its handlers) now stops gracefully with exit 0; before, the handlers were installed only after startup, so it killed the process by the signal. This is what the spec asked for.
2. A startup defect (database refusing, a thrown factory, `assertRunnerHubConfig`) now ends with the scope closing (whatever was started is stopped), the cause printed by Effect's default logger (`ERROR ...` with the stack) and exit 1. Before it was Node's uncaught-error print and exit 1. The text of the print differs; the exit code is the same.
3. After a startup defect the shutdown finalizer also runs (with its 15 s force-exit); before, nothing was cleaned up because the process crashed.
4. Otherwise none: log lines, fields, order, fail-fast messages and codes, non-blocking starts, stop order, force-exit text and code, the 3 s grace and exit 0 on a clean stop matched in every rehearsal above.

### Unsure
- `runMain` also holds a keep-alive interval while the main fiber runs; the process stays up through `Effect.never` and the listening server, and every stop ends in `process.exit`, so nothing else is needed. Only the rehearsal above shows this; I did not read a long-run test.
- The finalizer registered before startup differs from the spec's "after everything has started"; I chose it to meet the in-flight requirement.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5 (chain). The lead reviewed the Report and `main.ts` (stop sequence, force-exit, teardown, signal log).
- **Shape:** `index.ts` is 3 lines that run `NodeRuntime.runMain(serverProgram, { teardown: serverTeardown })`. `main.ts` holds `startServer`; the one finalizer runs `stopServer` in the old order under the 15 s force-exit, and an interrupt-only exit gives code 0.
- **Rehearsal** (local docker): SIGTERM, SIGINT, a double signal, an open request and fail-fast config give the same lines and exit codes as the old code. `main.test.ts` covers the stop order and the force-exit.
- **Behaviour:** a signal during startup now stops cleanly with exit 0, where before it killed the process. A startup defect prints Effect's error and still exits 1.
- **Before the next deploy:** the CI image smoke checks `zilar-server listening`. Julio checks the live start, and a redeploy (SIGTERM) for a clean stop.
