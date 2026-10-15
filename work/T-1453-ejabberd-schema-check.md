---
id: T-1453
title: "OPS-7: the server checks ejabberd's push_session, archive and muc_room column shapes at startup against a committed list; /health shows ejabberdSchema ok|drift|unknown; docs/ops/OPS_LOG.md records the manual SQL so far"
status: merged
milestone: M5
branch: task/T-1453-ejabberd-schema-check
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1453: ejabberd schema check

## Spec (written by Claude, do not edit)

### Why
OPS-7 (`docs/audit/ops-reliability-audit.md:81-90`; open per `docs/audit/findings-sweep-server.md`).

On 2026-10-11, `push_session` had a different shape at the same `schema_version`, and push broke with `internal-server-error` while `/health` stayed green (`work/T-1146-ejabberd-push-enable-audit.md:150-160`). Nothing in the server reads ejabberd's table shapes.

**Not in this task:** pinning the image by digest. That is a production change for Julio.

### Facts (the lead read them, 2026-10-15)
- **Production's ejabberd shapes** (the lead read them on prod with `psql`, read-only), the committed list to check against:
  - `archive`: `username text, timestamp bigint, peer text, bare_peer text, xml text, txt text, id bigint, kind text, nick text, origin_id text, created_at timestamp without time zone`;
  - `muc_room`: `name text, host text, opts text, created_at timestamp without time zone`;
  - `push_session`: `username text, timestamp bigint, service text, node text, xml text`.
  - `schema_version` there includes `mod_mam_sql=2, mod_muc_sql=1, mod_push_sql=1`.
- **The archive pool:** the server already holds a pool on ejabberd's database, `createArchivePool(config.XMPP_ARCHIVE_DATABASE_URL)` (`apps/server/src/search/service.ts:15-18,37+`; `ArchivePool.query(text, values)`), created in `apps/server/src/main.ts:425-428`.
  - Its role, `zilar_archive`, has SELECT **only on `archive`** (`work/T-1156-deploy-hardening.md:136-144`), so `information_schema.columns` would hide the other two tables.
  - Read `pg_catalog` instead (`pg_attribute` joined to `pg_class` and `pg_namespace`, with `format_type(atttypid, atttypmod)`, `attnum > 0` and `NOT attisdropped`); it lists columns without table privileges.
- **`/health`:** the body is `HealthBody` in `apps/server/src/health.ts:18-33` (122 lines). `ejabberd` and `push` are informational and never make the container unhealthy (`:40-44`).
- **`apps/server/src/main.ts` is 572 lines.** The gate refuses any growth of a file already above 400 lines. Wire the check without adding lines there, for example by passing the existing `archivePool` into an existing deps object you extend in a smaller file, or by moving an existing block out of `main.ts` to make room.

### What to build
1. **New `apps/server/src/xmpp/schema-check.ts`:**
   - `EJABBERD_EXPECTED_COLUMNS` (the list above);
   - `checkEjabberdSchema(pool: ArchivePool): Promise<'ok' | 'drift' | 'unknown'>`:
     - reads the three tables' columns from `pg_catalog` and compares the set of `name type` pairs per table;
     - any missing, extra or retyped column means `drift`, logged once at error level with table and column names only;
     - a query failure means `unknown`, logged at warn.
2. **Run it** once at startup when the archive pool exists, and cache the result. `HealthBody` gains an optional `ejabberdSchema: 'ok' | 'drift' | 'unknown'`, informational like `ejabberd` and `push`. Without an archive pool, the field is absent.
3. **New `docs/ops/OPS_LOG.md`:** a dated log of the manual production SQL so far, with the SQL text and **no secrets**:
   - 2026-10-11: the `push_session` drop and `schema_version` row delete, then the ejabberd restart (from T-1146);
   - the SEC-4 `REVOKE`/`GRANT` for `zilar_archive` (from T-1156);
   - the instance-owner reset key `instance.owner_user_id` (T-1450, already in `docs/ops/log-access.md`; link to it).
   - Add a header line: every manual production SQL gets a row here.

### Tests
In `apps/server/src/xmpp/schema-check.test.ts`, with a fake `ArchivePool`:
- matching rows give `ok`;
- a missing or retyped `push_session` column gives `drift`;
- a throwing query gives `unknown`.

### Allowed files
- `apps/server/src/xmpp/schema-check.ts`, `apps/server/src/xmpp/schema-check.test.ts`
- `apps/server/src/health.ts`, `apps/server/src/main.ts` (no growth)
- one small existing wiring file if needed (name it in the Report)
- `docs/ops/OPS_LOG.md`
- `work/T-1453-ejabberd-schema-check.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/xmpp/schema-check src/health --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the tests pass.
- After deploy, `/health` shows `"ejabberdSchema":"ok"`.

---

## Report (written by the worker when done)

**Status: done, ready for review.**

### What I did
1. **`apps/server/src/xmpp/schema-check.ts`** (new):
   - `EJABBERD_EXPECTED_COLUMNS`: the committed `name type` list for `archive`, `muc_room`, `push_session`, exactly as the lead read it on production.
   - `checkEjabberdSchema(pool: ArchivePool): Promise<'ok' | 'drift' | 'unknown'>`: reads the three tables' columns with one `pg_catalog` query (`pg_attribute` ⋈ `pg_class` ⋈ `pg_namespace`, `format_type`, `attnum > 0`, `not attisdropped`, filtered to `current_schema()`), compares the `name type` sets per table, and logs once at error level with table and column **names only**. A failing query logs a fixed line at warn and returns `unknown`.
   - `startEjabberdSchemaCheck(pool, logger)`: runs the check once and caches the result (module-level, like `health-status.ts`); returns the pool so the startup call stays a single expression. `ejabberdSchemaStatus()` reads the cache.
2. **`apps/server/src/health.ts`**: `HealthBody` gains the optional `ejabberdSchema: 'ok' | 'drift' | 'unknown'`; `healthBody()` includes it only once a check has started, so it is absent without an archive pool. Informational, like `ejabberd` and `push` — it never changes the 200/503.
3. **`apps/server/src/main.ts`** (no growth, 572 lines before and after): the existing archive-pool expression now wraps `createArchivePool(...)` in `startEjabberdSchemaCheck(..., logger)`. To stay at 572 I added one import line and removed the blank line after the archive-pool block; I reworded that block's one-line comment to mention the check. No new file was needed as a wiring file: the check runs from `main.ts` (allowed) and the result lives in `schema-check.ts`.
4. **`docs/ops/OPS_LOG.md`** (new): header ("every SQL statement run by hand on production gets a row here") plus dated entries — 2026-10-11 `push_session` drop + `schema_version` delete + restart (T-1146); 2026-10-12 SEC-4 `zilar_archive` `REVOKE`/`GRANT` (T-1156); 2026-10-15 instance-owner reset, linked to `docs/ops/log-access.md`. No secrets or connection strings.

### Files changed
- `apps/server/src/xmpp/schema-check.ts` (new)
- `apps/server/src/xmpp/schema-check.test.ts` (new)
- `apps/server/src/health.ts`
- `apps/server/src/main.ts` (572 → 572 lines)
- `docs/ops/OPS_LOG.md` (new)
- `work/T-1453-ejabberd-schema-check.md`

### Commands (real results)
- `pnpm install`: done, 10.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/schema-check src/health`: **5 passed** (2 files). First run of this after the initial write was green; a second run after the Effect rework was green too.
- `pnpm gate` (final tree): `GATE PASS` — PASS install (frozen) / format / lint / typecheck / effect / tests @zilar/server; `scope: every changed file is inside the Allowed files`; `size: every changed source file is within 400 lines`.
  - The first gate run FAILED the `effect` step: `apps/server/src/xmpp/schema-check.ts needs Effect (H1, W4)`. I rewrote the query as `Effect.runPromise(Effect.tryPromise(...).pipe(Effect.orElseSucceed(...)))` so the file imports Effect as a value; the second run passed.

### Deviations and notes
- `checkEjabberdSchema` takes an optional `logger?: Logger` as a second parameter (the spec wrote it as `(pool)`) so the drift/unknown lines can be logged without a module-global logger. Calls with one argument still typecheck.
- The result is cached in `schema-check.ts` (not in `HealthCheckDeps`): `createHealthCheck` is called in `app.ts` (not an Allowed file), so a deps-based wiring would have added a second out-of-scope file. This keeps every changed file inside the Allowed list.
- The check runs on first `/health` after startup at the latest; `startEjabberdSchemaCheck` sets the cache to `unknown` synchronously, so `/health` shows `"ejabberdSchema":"unknown"` until the query returns, then `"ok"`/`"drift"`.
- `OPS_LOG.md` dates: 2026-10-11 is exact (T-1146); 2026-10-12 is T-1156's approval date (the task file does not record the exact production run date); 2026-10-15 is T-1450's approval date. I wrote the SQL text from `docs/audit/ejabberd-push-enable.md:253-256` and `work/T-1156-deploy-hardening.md:140-142`.

### Open questions
- None blocking. The one thing worth a look: should the SEC-4 and instance-owner entries carry the exact run dates rather than the task approval dates? I used the dates available in the repo.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- The check reads `pg_catalog` (`pg_attribute` and `format_type`, no dropped columns), so the archive-only role sees all three tables.
- The wiring in `main.ts` is net zero lines.
- `/health` gains an optional `ejabberdSchema`.
- The tests (5) pass locally.
- `docs/ops/OPS_LOG.md` records the manual SQL without secrets.
- After deploy, the lead checks `/health` shows `"ejabberdSchema":"ok"`.
