---
id: T-0838
title: "S12 + S13: the server entry apps/server/src/index.ts on Effect — startup as one Effect program, shutdown by closing its Scope in the same order, NodeRuntime.runMain; local start/stop rehearsal"
status: todo
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

## Review (written by Claude)
