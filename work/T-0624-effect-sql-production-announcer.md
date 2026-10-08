---
id: T-0624
title: "effect/sql: actions/production-announcer.ts reads (the approval row, the AI jid and owner, the topic or group room) off drizzle; same card, same skips and log lines; tests unchanged"
status: todo
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

## Review (written by Claude)
