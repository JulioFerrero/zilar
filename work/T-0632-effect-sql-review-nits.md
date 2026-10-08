---
id: T-0632
title: "Review nits from T-0625, T-0627 and T-0629: the stale drizzle note in files/api.ts, the duplicated effect/sql comment in routines/service.ts, and the inline approval/topic row types in actions/gateway.ts as Pick<$inferSelect>; comments and types only, no behaviour change"
status: todo
milestone: M5
branch: task/T-0632-effect-sql-review-nits
model: auto
effort: low
depends_on: [T-0629]
estimate: 0.1 day
---

# T-0632: three review nits

## Spec (written by Claude, do not edit)

### Why
The pre-reviews of T-0625, T-0627 and T-0629 each found one nit. They are comment and type fixes only.

### Verified facts (do not re-derive)
1. **`apps/server/src/files/api.ts:4-5`:** the header still says handlers use "the drizzle file-row read; the DB rewrite is a separate lane". T-0625 moved that read to effect/sql.
2. **`apps/server/src/routines/service.ts`:** two comment blocks say "Every query runs on the `effect/sql` client…", one at **7-9** and one at **92-94**. Keep the one at 7-9, which names the `deleteRoutinesForAiInGroup` exception. Delete the one above `runSql` at 92-94, or merge its second sentence into the first block.
3. **`apps/server/src/actions/gateway.ts`** has inline row types on effect/sql reads:
   - 603-606: `{ status: string; expiresAt: Date }`;
   - 653: `{ status: string }`;
   - 783-786: `{ id; expiresAt: Date; status: string }`;
   - 917: `{ aiId: string }`;
   - about 941-948: the topic columns.

   `AiStatusRow` and `PendingActionRow` (117-118) already use `Pick<typeof ….$inferSelect, …>` and `typeof ….$inferSelect`. Use the same, with **type-only** imports of `approvals`, `groupAis` and `topics`. The value import at line 7 still serves the drizzle transaction at 478-511, so keep that import working.

### What to build
- Fix items 1-3 as above.
- No runtime change: the selected columns, the SQL and the logic stay byte-identical.

### Read first
`AGENTS.md`, plus the three files at the lines above.

### Allowed files
`apps/server/src/files/api.ts`, `apps/server/src/routines/service.ts`, `apps/server/src/actions/gateway.ts`, `work/T-0632-effect-sql-review-nits.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files src/routines/service src/actions/gateway
pnpm gate
```

### Acceptance
- The three nits are fixed, with no SQL or logic change.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
