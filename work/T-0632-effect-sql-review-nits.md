---
id: T-0632
title: "Review nits from T-0625, T-0627 and T-0629: the stale drizzle note in files/api.ts, the duplicated effect/sql comment in routines/service.ts, and the inline approval/topic row types in actions/gateway.ts as Pick<$inferSelect>; comments and types only, no behaviour change"
status: merged
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

### What I did
Fixed the three review nits; comments and types only, no runtime/SQL change.

1. **`apps/server/src/files/api.ts`** (header, lines 4-6): the comment no longer
   says the handlers use "the drizzle file-row read". It now says the file-row
   read runs on the `effect/sql` client and the rest of the DB rewrite is a
   separate lane.
2. **`apps/server/src/routines/service.ts`**: deleted the duplicated
   "Every query runs on the `effect/sql` client…" block above `runSql` (was
   92-94) and merged its second sentence ("The exported functions stay `async`
   so routes and tests keep their shape during the transition.") into the
   first block at lines 7-11, which is the one that names the
   `deleteRoutinesForAiInGroup` exception.
3. **`apps/server/src/actions/gateway.ts`**: added a type-only import
   `import type { approvals, groupAis, topics } from '../db/schema';` (line 8)
   and replaced the five inline row shapes with `Pick<typeof ….$inferSelect, …>`,
   matching `AiStatusRow`/`PendingActionRow`:
   - `runOnApprovalDecided` re-read: `Pick<typeof approvals.$inferSelect, 'status' | 'expiresAt'>`
   - post-verify re-read: `Pick<typeof approvals.$inferSelect, 'status'>`
   - `runRecoverStuck` orphan re-read: `Pick<typeof approvals.$inferSelect, 'id' | 'expiresAt' | 'status'>`
   - `isAiInGroup`: `Pick<typeof groupAis.$inferSelect, 'aiId'>`
   - `isAiInTopic`: `Pick<typeof topics.$inferSelect, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>`
   The value import on line 7 (`ais, pendingActions`) is unchanged and still
   serves the drizzle transaction at ~478-511 (`tx.insert(pendingActions)`).
   The `SELECT` lists, column aliases and logic are byte-identical.

### Files changed
- `apps/server/src/files/api.ts`
- `apps/server/src/routines/service.ts`
- `apps/server/src/actions/gateway.ts`
- `work/T-0632-effect-sql-review-nits.md` (front matter + this report)

### Commands run
- `pnpm install` — done in 10.7s, 1173 packages, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files src/routines/service src/actions/gateway` — 3 test files passed, 79 tests passed, 0 failed (38.6s).
- `pnpm gate` (first run) — `FAIL format` on `apps/server/src/actions/gateway.ts` (my multi-line `Pick<…>` type args were not prettier-shaped); everything else passed and scope was clean. Fixed by running `pnpm exec prettier --write apps/server/src/actions/gateway.ts` (only that file, only my edited regions changed).
- `pnpm gate` (second run) — passed:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (16.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (9.4s)
  PASS  tests @zilar/server  (24.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- Spec offered two options for nit 2; I took the "merge the second sentence
  into the first block" option so the `async` transition note is kept.
- For nit 3 the spec says "type-only imports of `approvals`, `groupAis` and
  `topics`". I added a separate `import type { … } from '../db/schema'` line,
  matching the existing pattern used by ~20 other server files (e.g.
  `topics/access.ts:11`). For the topic row I wrote `'archivedAt'` (the
  camelCase field the effect/sql reader returns), not the `archived_at`
  column, matching the previous inline type.

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is 658718b5, the current HEAD.
- **Lead check:**
  - the SQL text is unchanged;
  - the gateway row types now use `Pick<$inferSelect>` with type-only imports;
  - the two comments are fixed.
