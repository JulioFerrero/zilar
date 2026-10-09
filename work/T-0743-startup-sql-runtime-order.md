---
id: T-0743
title: "HOTFIX 2: the server crashes at start when MAIL_TRANSPORT is unset (getMailSettings runs before registerSqlRuntime); register the runtime right after createDb, and make the CI image smoke start against a real throwaway Postgres and require 'zilar-server listening'"
status: merged
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

### What changed
- `apps/server/src/index.ts`: `registerSqlRuntime(db, config.DATABASE_URL)` now sits directly after `createDb` (line 76), before `runMigrations`, with its comment moved along. The later call and its comment (after `ensureWritableDir`) are removed. Nothing else changed.
- `.github/workflows/images.yml`: the "Smoke-start the server image" step now starts `postgres:17` on a docker network (user, password and database `smoke`, `--rm`), waits for `pg_isready -h 127.0.0.1`, then runs the server image on that network with `DATABASE_URL=postgres://smoke:smoke@<pg container>:5432/smoke` and no `MAIL_TRANSPORT`. It polls the logs for 90 s; it passes only when the output has `zilar-server listening`. It fails on the module-error grep or on a missing listening line. It prints the last 40 lines either way, and the comment above the step is updated. A trap removes both containers and the network.

### Local proof (throwaway names only, all removed afterwards)
- Fixed image (`docker build -f apps/server/Dockerfile -t t0743-server:proof .`, exit 0), against `t0743-pg` (postgres:17, TCP ready after 1 s), no `MAIL_TRANSPORT`. Listening line:
  `{"level":30,"time":1791532959046,"pid":18,"hostname":"83538c1e35ab","port":3000,"msg":"zilar-server listening"}`
  The container was still running after 20 s.
- Old `index.ts` (HEAD, built as `t0743-server:old`, exit 0; only `index.ts` was stashed, then restored): same database and env. The container exited with
  `Error: No effect/sql runtime registered for this database` (thrown at the `sqlRuntimeFor` path, from `getMailSettings`). No listening line, `Running: false`.
- The CI step script, extracted from the workflow with js-yaml and run with only the names changed (`t0743-ci-net`, `t0743-ci-pg`, `t0743-ci-srv`, image `t0743-server:ci`, `--platform linux/amd64` dropped so the lead's `zilar-server:smoke` tag is not touched): exit 0, listening line in the output, and afterwards 0 containers and 0 networks left. The YAML parses, and the script passes `bash -n`.
- Not verified: the `--platform linux/amd64` build itself (it ran on the native arch only), and the old-image failure through the CI script (checked by hand, see above).

### Commands and results
- `pnpm install`: done (exit 0).
- `pnpm exec prettier --write apps/server/src/index.ts .github/workflows/images.yml`: both unchanged.
- No single tests were run by hand; the gate ran the nearest tests.
- `pnpm gate` (repo root, exit 0):
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS tests @zilar/server`
  - `gate: 2 changed file(s) against main`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations and open questions
- None against the spec. Unsure only about the untested amd64 CI build (see above).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.3 min). The lead reviewed the diff directly.
- **The fix:** `registerSqlRuntime` moved directly after `createDb`, before migrations and mail settings.
- **The smoke step:** it now starts a throwaway `postgres:17` on its own network, requires `zilar-server listening` within 90 s, fails on module errors as well, and always cleans up through a trap.
- **Local proof:** the fixed image logs listening, and the old `index.ts` crashes with "No effect/sql runtime registered". The gate passed.
