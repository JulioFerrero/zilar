---
id: T-1694
title: "Size split of apps/server/src/approvals/service.ts (387 lines): move verifyApproval and ApprovalVerifyResult (with their comment) into a new approvals/verify.ts and re-export them from service.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1694-split-approvals-service
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1694: Split verifyApproval out of approvals/service.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/approvals/service.ts` is 387 of 400 lines. The approval rules work (SEC-13b, the AI computer access) will touch it. `verifyApproval` is the engine-side check and stands alone.

### Facts (the lead read them on 2026-10-16)
- **`service.ts`:**
  - imports `:1-22`, among them:
    - `Effect` (`:2`), `SqlClient` (`:3`), `ServerDatabase` (`:4`), `runSql` (`:5`);
    - `safeHashEquals` from `./access` (`:8`);
    - `toApprovalRow`, `type ApprovalSqlRow` from `./queries` (`:10`);
    - `ApprovalDecision` and others from `./schemas` (`:11-22`);
  - `createApprovalEffect :34`, `createApproval :147` and `decideApproval :170-304`;
  - **the block to move:** `export interface ApprovalVerifyResult :306-309`, then the comment (`:311-321`) and `export async function verifyApproval(db, params, now) :322-364`;
  - then the re-exports `:366-387`.
  - `safeHashEquals` is used only inside `verifyApproval` (`:345`).
- **Importers:**
  - `apps/server/src/actions/queries.ts:3` (`import { verifyApproval } from '../approvals/service';`);
  - `apps/server/src/approvals/service.test.ts:18` (imports `verifyApproval` from `./service`).
- **The folder `apps/server/src/approvals/`** has no `verify.ts`.

### Steps
1. **Create `apps/server/src/approvals/verify.ts`** with `ApprovalVerifyResult`, the comment and `verifyApproval`, moved **word for word**, plus the imports they need. It must not import from `./service`.
2. **`service.ts`:**
   - delete the block;
   - add `export { verifyApproval, type ApprovalVerifyResult } from './verify';` next to the other re-exports, so both importers keep working unchanged;
   - drop the imports it no longer uses (`safeHashEquals` at least).
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/approvals/verify.ts`
- `apps/server/src/approvals/service.ts`
- `work/T-1694-split-approvals-service.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/approvals/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`service.ts` is about 330 lines,** and `verify.ts` holds the function unchanged.
- **`service.test.ts` passes,** including its `verifyApproval` block.

---

## Report (written by the worker when done)

### What I did

Pure move of the approval verification out of `apps/server/src/approvals/service.ts`.

- Created `apps/server/src/approvals/verify.ts` (67 lines) holding `ApprovalVerifyResult`, its comment and `verifyApproval`, moved word for word. Its own imports: `Effect`, `SqlClient`, `type ServerDatabase`, `runSql`, `safeHashEquals`, `toApprovalRow`/`type ApprovalSqlRow`, `type ApprovalDecision`. It does not import from `./service`.
- `service.ts` (now 328 lines, was 387): deleted the moved block, added `export { verifyApproval, type ApprovalVerifyResult } from './verify';` after the other re-exports, and dropped `safeHashEquals` from the `./access` import (it was used only inside `verifyApproval`). All other imports are still used.
- Both importers (`actions/queries.ts:3`, `approvals/service.test.ts:18`) are unchanged and keep working through the re-export.
- No behaviour change, no new tests.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/service.test.ts` → `Test Files 1 passed (1)`, `Tests 47 passed (47)`.
- `pnpm gate` from the repo root → exit 0, summary:
  - `PASS  install (frozen)  (10.2s)`
  - `PASS  format  (5.8s)`
  - `PASS  lint  (5.9s)`
  - `PASS  typecheck  (20.7s)`
  - `PASS  effect  (7.7s)`
  - `PASS  tests @zilar/server  (152.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Notes for the lead

Nothing blocked. Only the three Allowed files changed (`verify.ts` new, `service.ts`, this task file). `service.ts` is 328 lines against the "about 330" acceptance target.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `verify.ts` exactly; `service.ts` gained only the re-export and dropped `safeHashEquals` from its import.
- **The tests:** the lead ran `src/approvals` in the worktree: 4 files, 85 tests passed, including the `verifyApproval` block.
- **Result:** `approvals/service.ts` drops from 387 to 328 lines.
