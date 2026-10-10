---
id: T-0963
title: "Size split T18: apps/server/src/actions/gateway.ts (1,036 lines) into actions/{decisions,recovery,queries,support}.ts, the old path a barrel; its own runPromise site onto runSql"
status: merged
milestone: M5
branch: task/T-0963-split-server-actions-gateway
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0963: Split `actions/gateway.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/actions/gateway.ts` is 1,036 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #14 (task T18): `actions/decisions.ts`, `actions/recovery.ts`, `actions/queries.ts`, `actions/support.ts`, under `apps/server/src/`. `actions/gateway.ts` becomes the barrel.

**In scope:** the file has one `sqlRuntimeFor(deps.db).runPromise(…)` site (grep for it). It moves onto `runSql` from `apps/server/src/effect/sql.ts:111`, the way other services already call it, with the same behaviour and errors.

**Out of scope:** the entry's cross-file `errorName` Dedup, which is task F6. This is the approvals and permissions gateway, so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #14, `apps/server/src/actions/gateway.ts`, and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/actions/gateway.ts`, `apps/server/src/actions/decisions.ts`, `apps/server/src/actions/recovery.ts`, `apps/server/src/actions/queries.ts`, `apps/server/src/actions/support.ts`, `work/T-0963-split-server-actions-gateway.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/actions/gateway.ts` (1,036 lines) into `decisions.ts`, `recovery.ts`, `queries.ts`, `support.ts`, with `gateway.ts` as the (now pure) barrel. Code was moved unchanged; only `export` was added to helpers that are now needed across files, plus the in-scope `sqlRuntimeFor(deps.db).runPromise(...)` → `runSql(deps.db, ...)` change. No importer changed; the barrel re-exports the same 15 names with the same kinds.

### In-scope change (`sqlRuntimeFor` → `runSql`)

The one site (old line 481, inside the approval path) now calls `runSql(deps.db, Effect.gen(...))` from `apps/server/src/effect/sql.ts:111`. The `Effect`/`SqlClient` transaction and its error handling are byte-for-byte the old code; only the runner changed (it still runs on the runtime registered for `deps.db`, so behaviour and errors are identical). The now-unused `sqlRuntimeFor` import was dropped. No other `sqlRuntimeFor` remains under `actions/` (`grep` empty).

The entry's other Dedup items (`errorName` → `agents/gateway/contracts.ts`, `truncateText`/`truncateSummary` → `web-tools/guarded-fetch.ts`, `safeStringify` → `effect/logger.ts`) are cross-file, so they are left for task F6, as the spec says: the helpers moved unchanged.

### Files (`wc -l`)

| File | Lines |
| --- | --- |
| `apps/server/src/actions/gateway.ts` (old, `git show HEAD:`) | 1036 |
| `apps/server/src/actions/gateway.ts` (barrel, after) | 107 |
| `apps/server/src/actions/decisions.ts` | 399 |
| `apps/server/src/actions/queries.ts` | 337 |
| `apps/server/src/actions/recovery.ts` | 139 |
| `apps/server/src/actions/support.ts` | 95 |

Every new file and the barrel are at most 400 lines; no `max-lines` warning.

### Where each piece went

- `gateway.ts` (barrel): `RequestOutcome`, `ActionGatewayLogger`, `ActionGatewayDependencies`, `ActionGateway`, `RequestParams`, `DeniedReason`, `createActionGateway`, `listActions`, and the re-exports.
- `decisions.ts`: `runRequest`, `runAllowedAction`, `runAutoApprovedAction`, `runApprovalPath`, plus the `APPROVAL_TTL_MS` and `MAX_STORED_ARGS_BYTES` constants.
- `queries.ts`: `cancelPending`, `finishPending`, `writeAllowAudit`, `writeResultAudit`, `readAiStatus`, `isAiInGroup`, `isAiInTopic` and `runOnApprovalDecided` (the pending-transition driver), plus the private `AiStatusRow` alias.
- `recovery.ts`: the stuck timer (`RecoveryStuckHandle`, `StartRecoveryStuckTimerOptions`, `startRecoveryStuckTimer`), `runRecoverStuck`, and `STUCK_RUNNING_MS`.
- `support.ts`: `truncateText`, `truncateSummary`, `sanitiseModelText`, `safeStringify`, `errorName`, `safeAnnounce`, and `RESULT_SUMMARY_MAX`.

### Deviations from the spec (split-rules items 4 and 6)

1. **`onDecided` moved to `queries.ts`, and `runRequest`/`runAllowedAction` to `decisions.ts`.** As planned, `decisions.ts` = auto-approved + approval path + `onDecided` is 406 lines of code before imports; with imports it is over 400. Rule 4 allows one more split along a boundary the entry names: `onDecided` is the "pending transitions" work the entry assigns to `queries.ts`, so it moved there (queries 161 → 337). The entry leaves `runRequest`/`runAllowedAction` in the barrel, but that would make the barrel `needs-effect` (its remaining `async` + `try/catch` with no `effect` import). Rule 6 only sanctions the `effect-plain` marker on a *new* file, so instead the barrel keeps only the types, `createActionGateway` and `listActions` (no async/try → `plain`), and the two decision functions moved to `decisions.ts`, which imports `effect` and stays `effect`. All four target files are used and every file is ≤400 lines.
2. **Shared constants live in the module that uses them** (`APPROVAL_TTL_MS`/`MAX_STORED_ARGS_BYTES` in `decisions.ts`, `STUCK_RUNNING_MS` in `recovery.ts`, `RESULT_SUMMARY_MAX` in `support.ts`) rather than all in the barrel. The barrel re-exports each with the same name and kind. This keeps the runtime import graph a DAG (each new module reads its constants locally) while the public dependency interfaces stay in the barrel as type-only imports; no import cycle exists.
3. **`support.ts` carries the rule-6 marker**, `// effect-plain: moved unchanged from apps/server/src/actions/gateway.ts (size split)`, as its first line. It holds moved-unchanged code (`safeAnnounce` is `async` with `try/catch`) but no `effect` value import, so the ratchet would otherwise classify it `needs-effect` (H1, W4). This is the only marker added; markers now 17/25.
4. **Formatting only:** the added `export` pushed `runRecoverStuck`'s one-line signature past the column limit, so Prettier wrapped it across four lines. The body is unchanged.

### Moved-unchanged proof

I diffed every moved range of `git show HEAD:...gateway.ts` against its destination; the only differences are the added `export` keywords, the `runSql` change above, and the wrapped `runRecoverStuck` signature.

### Export list (before → after)

Before, `gateway.ts` exported 15 names: `ActionAnnouncer`, `RequestOutcome`, `ActionGatewayLogger`, `ActionGatewayDependencies`, `ActionGateway`, `RequestParams`, `DeniedReason`, `createActionGateway`, `APPROVAL_TTL_MS`, `STUCK_RUNNING_MS`, `RESULT_SUMMARY_MAX`, `MAX_STORED_ARGS_BYTES`, `RecoveryStuckHandle`, `StartRecoveryStuckTimerOptions`, `startRecoveryStuckTimer`.

After, the barrel declares or re-exports exactly those 15 names with the same kinds:

```ts
export type { ActionAnnouncer };
export type RequestOutcome = ...;
export interface ActionGatewayLogger { ... }
export interface ActionGatewayDependencies { ... }
export interface ActionGateway { ... }
export interface RequestParams { ... }
export type DeniedReason = PolicyDenialReason;
export function createActionGateway(...): ActionGateway { ... }
export { APPROVAL_TTL_MS, MAX_STORED_ARGS_BYTES } from './decisions';
export { STUCK_RUNNING_MS, startRecoveryStuckTimer } from './recovery';
export type { RecoveryStuckHandle, StartRecoveryStuckTimerOptions } from './recovery';
export { RESULT_SUMMARY_MAX } from './support';
```

The new modules also export internal helpers the siblings need (`runRequest`, `runOnApprovalDecided`, `cancelPending`, `writeAllowAudit`, `readAiStatus`, `isAiInTopic`, `runRecoverStuck`, `errorName`, `safeAnnounce`, `safeStringify`, `sanitiseModelText`, `truncateText`, `truncateSummary`, plus the four constants). None of these was exported by the old file, and the barrel does not re-export them, so the public surface is unchanged.

### Commands run

- `pnpm install`: done (resolved 1262, done).
- Checks (run twice, after the barrel import fix): `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts` → `Test Files 2 passed (2)`, `Tests 77 passed (77)`, exit 0.
- `pnpm gate` (from the repo root): the first run failed only on `typecheck` (`src/actions/gateway.ts: Module './decisions' has no exported member 'runOnApprovalDecided'` — it lives in `queries.ts`); the import was fixed (Allowed file) and the final run:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.8s)
PASS  effect  (0.7s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The gate skips the server tests step because `apps/server/src/actions/` holds no test files; the two Checks test files were run directly (above).

### Problems / open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `actions/gateway.ts` (1,036 lines) becomes a barrel plus `decisions` (399), `queries` (337), `recovery` (139) and `support`.
- **The one `runPromise` site** is now `runSql`, the same call.
- **Check:** the 77 approval tests pass (service and rules), and so does the gate.
