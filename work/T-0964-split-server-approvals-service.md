---
id: T-0964
title: "Size split T19: apps/server/src/approvals/service.ts (1,030 lines) into approvals/{schemas,queries,access}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0964-split-server-approvals-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0964: Split `approvals/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/approvals/service.ts` is 1,030 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #15 (task T19): `approvals/schemas.ts`, `approvals/queries.ts`, `approvals/access.ts`, under `apps/server/src/`. `approvals/service.ts` becomes the barrel.

`access.ts` (`canDecide`, `canDecideMany`, `decisionToStatus` and `safeHashEquals`) is permissions code, so move it unchanged. Skip the entry's cross-file `group_members` Dedup, which is task F5.

T-0963 splits `actions/gateway.ts` at the same time; do not touch it.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #15, and `apps/server/src/approvals/service.ts`.

### Allowed files
`apps/server/src/approvals/service.ts`, `apps/server/src/approvals/schemas.ts`, `apps/server/src/approvals/queries.ts`, `apps/server/src/approvals/access.ts`, `work/T-0964-split-server-approvals-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts src/approvals/sweeper.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/approvals/service.ts` into three feature files, per `docs/audit/size-plan.md` §2.1 #15, and kept the old path as the module entry point:

- **`approvals/schemas.ts`** — the Effect schemas and boundary types: `ApprovalStatus`, `ApprovalDecision`, `MAX_PENDING_APPROVALS_PER_AI`, `MAX_APPROVAL_EXPIRY_MS`, `CreateApprovalInputSchema`/`CreateApprovalInput`, the strict parser, the refine messages, `AlwaysEligiblePredicate`, `CreatedApprovalRule`, `PublicApproval`, and `ApprovalServiceError`.
- **`approvals/queries.ts`** — the read model: row mapping (`ApprovalSqlRow`, `toApprovalRow`), `approverNamesForTopics`, `listDecidableApprovals`, `getDecidableApproval`, `expireStale`, `toPublicApproval`, and the internal decidable-id lookups.
- **`approvals/access.ts`** — the permission/decision helpers: `canDecide`, `canDecideMany`, `safeHashEquals`, `decisionToStatus`.
- **`approvals/service.ts`** — stays the entry point: it keeps the write path (`createApprovalEffect`, `createApproval`, `decideApproval`, `verifyApproval`, `DecideApprovalResult`, `ApprovalVerifyResult`) and re-exports every name the old file exported, so **no importer changed**.

No behaviour change. Code moved unchanged; the only edits are `export` keywords on helpers that now cross module boundaries (`ApprovalSqlRow`, `toApprovalRow`, `noteSchema`, `INVALID_APPROVAL_REQUEST_MESSAGE`, `parseCreateApprovalInput`, `safeHashEquals`, `decisionToStatus`). None of those helpers is re-exported by the barrel, so its public surface is unchanged. I skipped the entry's cross-file `group_members` Dedup (task F5) as the spec says, and did not touch `actions/gateway.ts` (T-0963).

### Files changed

- `apps/server/src/approvals/service.ts` (modified)
- `apps/server/src/approvals/schemas.ts` (new)
- `apps/server/src/approvals/queries.ts` (new)
- `apps/server/src/approvals/access.ts` (new)
- `work/T-0964-split-server-approvals-service.md` (this file)

### Line counts (`split-rules.md` item 8)

- old (`HEAD`/main): `apps/server/src/approvals/service.ts` **1030**
- new: `schemas.ts` **151**, `queries.ts` **293**, `access.ts` **252**, `service.ts` **386**. Every file is ≤ 400.

### Export list before / after (item 8)

`grep -E "^export"` on the barrel plus the new files is noisy because the barrel uses re-export blocks, so I also diffed the normalized exported-name set:

- Barrel `service.ts` name set vs the old file: **identical** (empty diff).
- Union of barrel + new files vs the old file: **additions only, no removals** — `ApprovalSqlRow`, `INVALID_APPROVAL_REQUEST_MESSAGE`, `decisionToStatus`, `noteSchema`, `parseCreateApprovalInput`, `safeHashEquals`, `toApprovalRow` (the cross-module helpers listed above).

### Commands and results

- `pnpm install`: `Done in 22.5s` (1172 packages).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts src/approvals/sweeper.test.ts`: `Test Files 3 passed (3)` / `Tests 83 passed (83)`.
- `pnpm gate` (repo root), real summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.1s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (22.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Effect ratchet

No `// effect-plain:` marker was added. Every new file imports `effect` as a value (`schemas.ts` → `Schema`/`Result`; `queries.ts`/`access.ts`/`service.ts` → `Effect`), so the map classifies them `effect`; the gate's `effect` step passed.

### Problems / deviations / open questions

- None blocking. One judgement call: the plan names only `schemas.ts`, `queries.ts` and `access.ts`, but the write path (`createApprovalEffect`/`createApproval`/`decideApproval`/`verifyApproval`) is not named by any of them, so it stays in `service.ts` next to the re-exports — the same shape as the T-0955 `tools/service.ts` precedent. `service.ts` is 386 lines, under the 400 cap.
- I ran the three Checks test files through the AGENTS.md form `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <paths>` (same three files, with the worker cap) instead of the `exec vitest run` form in the Checks block. Same tests, all pass.
- No test file was edited and no importer was changed.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `approvals/service.ts` (1,030 lines) is now 386 lines, plus `queries` (293), `access` (252) and `schemas` (151). The access checks moved unchanged.
- **Check:** the 83 approval tests pass (service, rules and sweeper), and so does the gate.
