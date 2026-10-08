---
id: T-0624
title: "effect/sql: actions/production-announcer.ts reads (the approval row, the AI jid and owner, the topic or group room) off drizzle; same card, same skips and log lines; tests unchanged"
status: merged
milestone: M5
branch: task/T-0624-effect-sql-production-announcer
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.25 day
---

# T-0624: the production announcer on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive; read the whole file, 132 lines)
- **`apps/server/src/actions/production-announcer.ts`** has four reads in `approvalRequested`, all with `deps.db` (the top-level db) and `LIMIT 1`:
  - 56-60: the whole `approvals` row by id. A missing row logs `approval row missing for announcer; skipping card` and returns;
  - 65-69: `ais.jid` and `ais.owner` by id. A missing row returns;
  - 76-80: `topics.room_localpart` by id, when `topicId` is set;
  - 85-89: `groups.room_localpart` by id, when `groupId` is not null.
- **The approval row** goes to `buildApprovalCardPayload` and `approvalCardBody` (`apps/server/src/actions/announce.ts`). It must keep the camelCase shape of `typeof approvals.$inferSelect` (type-only import). `transformResultNames: snakeToCamel` gives that, and T-0614 keeps jsonb keys as written.
- **The test** is `apps/server/src/actions/production-announcer.test.ts`.

### What to build
1. Move the four reads to effect/sql, with the same order, skips, log lines and payload. The file keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** `production-announcer.test.ts` and `announce.test.ts` pass **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/actions/production-announcer.ts` and `apps/server/src/actions/announce.ts`.

### Allowed files
`apps/server/src/actions/production-announcer.ts`, `work/T-0624-effect-sql-production-announcer.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/production-announcer src/actions/announce
pnpm gate
```

### Acceptance
- The announcer reads on effect/sql and posts the same card.
- Every test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Moved all four reads in `createProductionAnnouncer().approvalRequested` from drizzle to `effect/sql`, in the same order, with the same skips and log lines:
  1. the whole `approvals` row by id (`SELECT * FROM approvals WHERE id = $1 LIMIT 1`) — missing row still warns `approval row missing for announcer; skipping card` and returns;
  2. `ais.jid` and `ais.owner` by id — missing row still returns silently;
  3. `topics.room_localpart` by id when `topicId` is set;
  4. `groups.room_localpart` by id when `groupId` is not null.
- Added a private `runSql(db, effect)` helper that runs a query through `sqlRuntimeFor(db).runPromise(...)`, following `apps/server/src/pins/service.ts`.
- The approval row is typed as `typeof approvals.$inferSelect` and selected via `sql<ApprovalRow>`; `transformResultNames: snakeToCamel` returns the camelCase shape, so `buildApprovalCardPayload` and `approvalCardBody` receive exactly what they did before.
- Removed the `drizzle-orm` and value `db/schema` imports: `production-announcer.ts` now imports only `type { approvals }`, `Effect`, `SqlClient`/`SqlError` (types), `sqlRuntimeFor`, the XMPP provisioning helpers and the `announce` module.
- `outcome` was untouched (it does no database read).

### Files changed
- `apps/server/src/actions/production-announcer.ts`
- `work/T-0624-effect-sql-production-announcer.md`

### Commands and real results
- `pnpm install`: done in 14.9s, 1173 packages, no errors (3 deprecated transitive warnings only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/production-announcer src/actions/announce`: 2 test files passed, 14 tests passed, 0 failed.
- `pnpm gate` (repo root), summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (22.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (12.7s)
  PASS  tests @zilar/server  (7.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / problems
- None. `production-announcer.test.ts` and `announce.test.ts` are unchanged and green.

### Open questions
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is 9062831b, the current HEAD.
- **Lead check of the diff:**
  - the same four reads run in the same order, with the same skips;
  - the approval row stays the camelCase `$inferSelect` shape;
  - every value is passed as a bound parameter;
  - only the type import from `db/schema` is left.
