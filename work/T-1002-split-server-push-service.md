---
id: T-1002
title: "Size split T64: apps/server/src/push/service.ts (561 lines) into push/{delivery,archive-scan,candidates}.ts, the old path keeps types and re-exports"
status: merged
milestone: M5
branch: task/T-1002-split-server-push-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1002: Split `push/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/push/service.ts` is 561 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #60 (task T64): `push/delivery.ts`, `push/archive-scan.ts`, `push/candidates.ts`, under `apps/server/src/`. `push/service.ts` keeps the deps and outcome types, the TaggedErrors, and re-exports of every name it exports today.

Move the code unchanged, and skip all three Dedup items, because they cross files. This is the push path of the message pipeline: who gets a notification and when must not change. The folder already holds other files; leave them as they are.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #60, and `apps/server/src/push/service.ts`.

### Allowed files
`apps/server/src/push/service.ts`, `apps/server/src/push/delivery.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `work/T-1002-split-server-push-service.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/push/service.ts` into the three files of size-plan §2.2 #60,
moving the code unchanged. `service.ts` stays the barrel and keeps the deps/outcome
types and the TaggedErrors; `handleIncomingPush` is re-exported from `delivery.ts`.
No behaviour changed on the push path. No importer outside the task's files changed
(only `apps/server/src/push/component.ts` imports this module, via the barrel).

### Files changed (one source file per task)

| File | wc -l (new) |
| --- | ---: |
| `apps/server/src/push/service.ts` (old) | 561 |
| `apps/server/src/push/service.ts` (barrel) | 63 |
| `apps/server/src/push/delivery.ts` | 204 |
| `apps/server/src/push/archive-scan.ts` | 142 |
| `apps/server/src/push/candidates.ts` | 182 |

Every new file and the barrel are ≤ 400 lines. No Dedup item was applied: all three
(`bareJidOf`/`ownBareJid` → shared helper, `isMuted`/topic/group lookups, the
`awaitDb` wrapper) cross files, and the spec says to skip them.

### Export list before and after (`grep -E "^export"`)

Before (old `service.ts`, 4 names):

```
export interface PushLogger
export interface PushServiceDeps
export type PushOutcome
export async function handleIncomingPush
```

After (barrel + new files):

```
apps/server/src/push/service.ts: export interface PushLogger
apps/server/src/push/service.ts: export interface PushServiceDeps
apps/server/src/push/service.ts: export type PushOutcome
apps/server/src/push/service.ts: export class Undecryptable
apps/server/src/push/service.ts: export class ArchiveUnavailable
apps/server/src/push/service.ts: export class SendFailed
apps/server/src/push/service.ts: export { handleIncomingPush } from './delivery'
apps/server/src/push/delivery.ts: export async function handleIncomingPush
apps/server/src/push/archive-scan.ts: export interface ArchiveCandidate
apps/server/src/push/archive-scan.ts: export const newestMessageForUserEffect
apps/server/src/push/candidates.ts: export async function resolveCandidate
```

Additions are cross-file necessities, all within the task's own files:
- `Undecryptable`/`ArchiveUnavailable`/`SendFailed`: they stay declared in the barrel
  (as the spec asks) but the moved `delivery.ts` and `archive-scan.ts` must raise and
  catch them, so they had to be exported from the barrel.
- `ArchiveCandidate` + `newestMessageForUserEffect` (archive-scan) and
  `resolveCandidate` (candidates): internal before, now imported by a sibling module.
No previously-exported name changed name or kind.

### Commands run (real results)

- `pnpm install` → `Done in 13.7s` (only a pre-existing peer-dependency warning in
  `apps/mobile` for `@types/react-dom`; unrelated to this task).
- `pnpm gate` (from repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.9s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  effect  (0.9s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test files were run: `apps/server/src/push/` contains no test files and no
test imports this module, so the gate had no nearby tests (rule 5: wrote no tests,
edited no test). The `effect` step passed, so no ratchet marker was needed (the new
modules import `effect` as a value, i.e. they are `effect`, not `needs-effect`).

### Deviations from the spec / notes

- The plan's parenthetical "(25–96)" suggests `service.ts` also keeps the internal
  helpers at 75–106 (`dropped`, `awaitDb`, `OpenDevice`, `DroppedReason`, the ARCHIVE
  constants, `ArchiveCandidate`). I followed the spec sentence instead ("keeps the deps
  and outcome types, the TaggedErrors, and re-exports") and moved each helper next to
  its only consumer: `dropped`/`awaitDb`/`OpenDevice`/`DroppedReason`/
  `NOTIFIED_REMEMBERED`/`markNotified` and the `DeliveryError` union → `delivery.ts`;
  the ARCHIVE constants and `ArchiveCandidate` → `archive-scan.ts`. This keeps the
  barrel thin and avoids extra cross-imports.
- The barrel and `delivery.ts`/`archive-scan.ts` now form a module cycle through the
  TaggedErrors (`service` re-exports `handleIncomingPush` from `delivery`;
  `delivery`/`archive-scan` import the error classes from `service`). ESM/TS resolve
  it because the classes are only referenced inside function bodies, never at module
  evaluation; `pnpm gate` (lint + typecheck + runtime-less tests) passes. Called out
  because `split-rules.md` item 3 says to stop only when a cycle forces an *external*
  importer to change — none did.

### Security checklist

Not applicable: this is a pure code move with no request logging, queries, auth or
audit changes. No secrets touched/printed. No new route, no new write, no deletes.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `push/service.ts` (561 lines) keeps the types and the TaggedErrors, plus `delivery` (204), `candidates` (182) and `archive-scan` (142). The code moved unchanged.
- **The nit:** `service.ts` re-exports from `delivery.ts`, and `delivery.ts` imports the TaggedErrors from `service.ts`, which is an import cycle. The classes are used only inside function bodies.
- **The lead checked the cycle at runtime:** with `tsx`, `delivery.ts` loads first and then `service.ts`, and both expose `handleIncomingPush` and the error classes as functions.
- **Check:** the gate passed.
