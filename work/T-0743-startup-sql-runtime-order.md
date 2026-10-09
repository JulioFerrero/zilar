---
id: T-0743
title: "HOTFIX 2: the server crashes at start when MAIL_TRANSPORT is unset (getMailSettings runs before registerSqlRuntime); register the runtime right after createDb, and make the CI image smoke start against a real throwaway Postgres and require 'zilar-server listening'"
status: todo
milestone: M5
branch: task/T-0743-startup-sql-runtime-order
model: auto
effort: low
depends_on: [T-0739]
estimate: 0.1 day
---

# T-0743: the server must reach "listening"

## Spec (written by Claude, do not edit)

### Why
After T-0739, the lead ran main's server image (`371a79f6`) locally against an empty `postgres:17`, with no `MAIL_TRANSPORT` set. Migrations ran, and then the server crashed:
`Error: No effect/sql runtime registered for this database at sqlRuntimeFor (/app/src/effect/sql.ts:101) at runSql (/app/src/setup/settings.ts:45) at getMailSettings (/app/src/setup/settings.ts:56) at /app/src/index.ts:82`.
The T-0739 smoke step uses an unreachable database, so it cannot see crashes that happen after the connection.

### Verified facts (do not re-derive)
- **Startup order in `apps/server/src/index.ts`:**
  - `const { db, close } = createDb(config.DATABASE_URL)` at line 72;
  - `await runMigrations(db)` at line 73;
  - `getMailSettings(db, …)` at line 82, inside `if (config.MAIL_TRANSPORT === undefined)`;
  - `registerSqlRuntime(db, config.DATABASE_URL)` only at line 102, after a comment at lines 100-101.
- **`registerSqlRuntime`** returns the existing runtime when one is already registered (`apps/server/src/effect/sql.ts:88-96`), so calling it earlier is safe, and `createApp` reuses it (`apps/server/src/app.ts:256`).
- **The success line** is `logger.info({ port: boundPort }, 'zilar-server listening')`, at `index.ts:413`.
- **The T-0739 smoke step** is "Smoke-start the server image (before any push)" (`.github/workflows/images.yml:121`). It runs with `DATABASE_URL` pointing at `127.0.0.1:1` and fails only on module errors.

### What to build
1. **`index.ts`:** move `registerSqlRuntime(db, config.DATABASE_URL)` to directly after `createDb` (line 72), before `runMigrations`, and move its comment with it. Remove the later call. Nothing else changes.
2. **`images.yml`, the smoke step:**
   - create a docker network and start `postgres:17` on it (user, password and database `smoke`, with `--rm`); wait for `pg_isready`;
   - run the server image on that network with `DATABASE_URL=postgres://smoke:smoke@<pg container>:5432/smoke`, the same placeholder env as now, and **no** `MAIL_TRANSPORT`;
   - pass only if the output contains `zilar-server listening` within 90 s, then stop both containers;
   - fail if the output has the module-error grep **or** never shows the listening line;
   - print the last 40 lines either way, and update the comment above the step.
3. **Prove it locally:** build the image from the worktree root (`docker build -f apps/server/Dockerfile -t zilar-server:smoke .`), run the same sequence by hand with local container names only, and paste the listening line into the Report. Also show that the image built from main **without** your `index.ts` change fails (stash only `index.ts`). Then restore your change.

### Read first
`AGENTS.md`, `apps/server/src/index.ts` (lines 60-110), `apps/server/src/effect/sql.ts` (lines 85-105), `.github/workflows/images.yml` (lines 110-150).

### Allowed files
`apps/server/src/index.ts`, `.github/workflows/images.yml`, `work/T-0743-startup-sql-runtime-order.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The locally built image logs `zilar-server listening` against a throwaway `postgres:17` with no `MAIL_TRANSPORT`.
- The old `index.ts` fails the new smoke.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
