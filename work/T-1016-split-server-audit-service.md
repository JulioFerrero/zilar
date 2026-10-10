---
id: T-1016
title: "Size split T82: apps/server/src/audit/service.ts (514 lines) into audit/{schema,recorder,list}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-1016-split-server-audit-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1016: Split `audit/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/audit/service.ts` is 514 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #78 (task T82): `audit/schema.ts`, `audit/recorder.ts`, `audit/list.ts`, under `apps/server/src/`. `audit/service.ts` keeps `MAX_AUDIT_LIST_LIMIT` and becomes the barrel.

Move the code unchanged, and skip all three Dedup items, because they cross files. Who may read which audit entries (the group-admin and private-topic filters in the list) is permissions code: not one line of it changes.

Three kept tests import `../audit/service`:
- `apps/server/src/approvals/rules.test.ts`;
- `apps/server/src/approvals/sweeper.test.ts`;
- `apps/server/src/invite-links/invite-links.test.ts`.

They must pass unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #78, and `apps/server/src/audit/service.ts`.

### Allowed files
`apps/server/src/audit/service.ts`, `apps/server/src/audit/schema.ts`, `apps/server/src/audit/recorder.ts`, `apps/server/src/audit/list.ts`, `work/T-1016-split-server-audit-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/approvals/rules.test.ts src/approvals/sweeper.test.ts src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/audit/service.ts` per `docs/audit/size-plan.md` §2.2 #78, moving code unchanged and skipping all three Dedup items (they cross files). `service.ts` is now the barrel and keeps `MAX_AUDIT_LIST_LIMIT`.

- `audit/schema.ts` — `ACTION_PATTERN`, `MAX_DETAIL_BYTES`, the Effect schemas, `entrySchema`, `AuditEntry`, `firstIssueMessage`, `decodeEntry`, `serialisedSize`.
- `audit/recorder.ts` — `AuditLogger`, `AuditRecorder`, `CreateAuditRecorderInput`, `createAuditRecorder`, `recordAudit`, `randomId`.
- `audit/list.ts` — `DEFAULT_AUDIT_LIST_LIMIT`, cursor helpers, `PublicAuditEntry`, `ListAuditPage`, `ListAuditOptions`, `listAuditForGroup`, `listAuditForAi`, the private-topic filter and `clampLimit`.
- `audit/service.ts` — thin barrel re-exporting every name it exported before.

The only extra export is `decodeEntry` from `schema.ts` (non-exported before), needed by `recorder.ts`; the barrel does not re-export it, so the public surface of `./service` is unchanged.

### Files changed

`apps/server/src/audit/service.ts`, `apps/server/src/audit/schema.ts` (new), `apps/server/src/audit/recorder.ts` (new), `apps/server/src/audit/list.ts` (new), `work/T-1016-split-server-audit-service.md`.

### `wc -l`

| file | lines |
| --- | --- |
| `audit/service.ts` (old) | 514 |
| `audit/service.ts` (barrel) | 12 |
| `audit/schema.ts` | 130 |
| `audit/recorder.ts` | 74 |
| `audit/list.ts` | 315 |

### Export list, before → after

Before (`grep -E "^export"` on the old `service.ts`):

```
export type AuditEntry
export interface AuditLogger
export interface AuditRecorder
export interface CreateAuditRecorderInput
export function createAuditRecorder
export async function recordAudit
export { MAX_AUDIT_LIST_LIMIT }
export const DEFAULT_AUDIT_LIST_LIMIT
export interface PublicAuditEntry
export interface ListAuditPage
export interface ListAuditOptions
export async function listAuditForGroup
export async function listAuditForAi
```

After (barrel `service.ts`):

```
export { MAX_AUDIT_LIST_LIMIT } from '@zilar/api-contract';
export type { AuditEntry } from './schema';
export { createAuditRecorder, recordAudit } from './recorder';
export type { AuditLogger, AuditRecorder, CreateAuditRecorderInput } from './recorder';
export { DEFAULT_AUDIT_LIST_LIMIT, listAuditForAi, listAuditForGroup } from './list';
export type { ListAuditOptions, ListAuditPage, PublicAuditEntry } from './list';
```

Same names and kinds; no importer needed a change. `schema.ts` additionally exports `decodeEntry` for `recorder.ts` only.

### Commands run

- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/approvals/rules.test.ts src/approvals/sweeper.test.ts src/invite-links/invite-links.test.ts` → `Test Files 3 passed (3)`, `Tests 57 passed (57)`.
- `pnpm gate` (from repo root) summary:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (0.9s)
PASS  lint  (1.1s)
PASS  typecheck  (3.3s)
PASS  effect  (1.1s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Effect ratchet

No `// effect-plain:` marker was needed: all three new files make a value import from `effect`, so the ratchet classifies them as `effect`, not `needs-effect`.

### Notes / deviations

- Dedup items skipped as the spec instructs.
- Behaviour unchanged; permission code (group-admin check, private-topic filter) moved verbatim.
- No new tests, no test edits.

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `audit/service.ts` (514 lines) becomes the barrel plus `audit/{schema,recorder,list}`, the largest `list.ts` at 315. The code moved verbatim, including the group-admin and private-topic filters.
- **Check:** the lead ran `rules.test.ts`, `sweeper.test.ts` and `invite-links.test.ts` on the branch (3 files, 57 tests passed), and the gate passed.
