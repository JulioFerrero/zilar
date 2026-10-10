---
id: T-0983
title: "Size split T40: apps/server/src/contact-requests/service.ts (730 lines) into contact-requests/{queries,reads,errors}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0983-split-server-contact-requests
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0983: Split `contact-requests/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/contact-requests/service.ts` is 730 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #36 (task T40): `contact-requests/queries.ts`, `contact-requests/reads.ts`, `contact-requests/errors.ts`, under `apps/server/src/`. `contact-requests/service.ts` becomes the barrel.

Move the code unchanged, and skip both Dedup items:
- `isUniqueViolation` crosses files;
- the pending-insert helper would change the SQL code paths, which is a separate task with tests.

Who can send, accept and block requests is permissions code.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #36, and `apps/server/src/contact-requests/service.ts`.

### Allowed files
`apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/queries.ts`, `apps/server/src/contact-requests/reads.ts`, `apps/server/src/contact-requests/errors.ts`, `work/T-0983-split-server-contact-requests.md`.

### Checks
```bash
pnpm gate
```
Also run any kept server test that imports `contact-requests` (find them with grep), with `--reporter=dot`, and list them.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did
Split `apps/server/src/contact-requests/service.ts` (730 lines) into three new
modules and left the old path a barrel, following `docs/audit/split-rules.md`
and the §2.2 #36 entry:
- `contact-requests/queries.ts` — shared row types + the three limit constants,
  handle resolution, contact/pair probes, the row-to-view mapper and
  `profilesByUserEffect`/`findActionableEffect` (plan ranges 68–144, 377–494).
- `contact-requests/reads.ts` — `listContactRequests`, `relationFor`,
  `OtherUserProfile`, `profileForHandle` (plan ranges 397–442, 640–730).
- `contact-requests/errors.ts` — `notFound`, `isPendingPairViolation`
  (plan ranges 90–93, 341–376).
- `contact-requests/service.ts` — keeps the header, the mutating service
  functions (`createContactRequest`, `acceptContactRequest`,
  `decideContactRequest`, `declineContactRequest`, `cancelContactRequest`) and
  re-exports the same public names it exported before.

Both Dedup items were skipped as the spec says: `isUniqueViolation` crosses
files, and the pending-insert helper would change the SQL code paths.

### Files changed
- `apps/server/src/contact-requests/service.ts` (modified)
- `apps/server/src/contact-requests/queries.ts` (new)
- `apps/server/src/contact-requests/reads.ts` (new)
- `apps/server/src/contact-requests/errors.ts` (new)
- `work/T-0983-split-server-contact-requests.md` (this Report + status)

### Line counts (item 8)
```
old  service.ts   730
new  service.ts   385
new  queries.ts   203
new  reads.ts     156
new  errors.ts     45
```
Every file is at most 400 lines; no `max-lines` warning appears.

### Export diff (item 8)
`git show HEAD:.../service.ts | grep -E "^export"` (before) against
`grep -E "^export"` on the barrel + the three new files.

Before (17 public names):
```
export const MAX_PENDING_OUTGOING = 20;
export const RE_REQUEST_COOLDOWN_DAYS = 7;
export const MAX_LIST_ROWS = 100;
export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export interface ContactRequestRow {
export interface ContactRequestView {
export interface ContactRequestsDeps {
export function resolveHandleUser(
export async function createContactRequest(
export function isPendingPairViolation(error: unknown): boolean {
export async function listContactRequests(
export async function acceptContactRequest(
export async function declineContactRequest(
export async function cancelContactRequest(
export async function relationFor(
export interface OtherUserProfile {
export async function profileForHandle(
```
After (barrel re-exports; same names and kinds):
```
export { MAX_LIST_ROWS } from './queries';
export { isPendingPairViolation, MAX_PENDING_OUTGOING, RE_REQUEST_COOLDOWN_DAYS,
         resolveHandleUser };          // values (re-exported from ./queries,
                                       // ./errors bindings used locally)
export type { ContactRequestsDeps };
export { listContactRequests, profileForHandle, relationFor } from './reads';
export type { OtherUserProfile } from './reads';
export type { ContactRequestRow, ContactRequestStatus, ContactRequestView } from './queries';
export async function createContactRequest(
export async function acceptContactRequest(
export async function declineContactRequest(
export async function cancelContactRequest(
```
The new files additionally export internal helpers (`serviceNow`, `auditFor`,
`isContactEffect`, `pendingBetweenEffect`, `toView`, `profilesByUserEffect`,
`findActionableEffect`, `notFound`) that are not part of the barrel's public
API; the barrel's set is byte-for-byte the 17 names above.

### Checks
- `pnpm install` (required first): Done in 19s.
- Kept server tests that import `contact-requests`: **none exist**.
  `grep -rln "contact-requests" apps/server --include="*.ts"` returns only
  `app.ts` (imports `./contact-requests/api`) and one comment; no `*.test.ts`
  imports the module, and no test mentions `contactRequest`/`contact_requests`.
  So there were no single test files to run with `--reporter=dot`.
- `pnpm gate` (from the repo root):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.6s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (1.1s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
The `scope:` line lists no files outside the Allowed files.

### Deviations from the plan (rule 4 adjustment)
The plan's ranges would leave `service.ts` at ~408 lines (header/types `1–67`
+ `createContactRequest` `145–340` + `accept/decide/decline/cancel`
`495–639`), over the 400 limit. Rule 4 allows one more move along a boundary
the entry names, so I moved the shared row types and the three limit
constants into `queries.ts` (the base module) rather than a fourth file:
- all four types (`ContactRequestStatus`, `ContactRequestRow`,
  `ContactRequestView`, `ContactRequestsDeps`) and
  `MAX_PENDING_OUTGOING`/`RE_REQUEST_COOLDOWN_DAYS`/`MAX_LIST_ROWS` now live in
  `queries.ts`, re-exported from the barrel.
- This keeps the barrel ≤400 and avoids a `service ↔ queries` import cycle
  (`queries` imports neither `reads` nor `service`; `reads → queries`,
  `service → queries/reads/errors`). The constants' comment still reads
  "the outgoing cap above" because the three constants stay in original order.
- All mutating service functions stayed in `service.ts`, matching the
  `roles/service.ts` precedent.

### Effect ratchet (rule 6)
No `// effect-plain:` marker was needed: `queries.ts` and `reads.ts` import
`Effect` as a value and `errors.ts` imports `SqlError` from `effect/sql`, so
all three are `effect` files. `pnpm gate`'s `effect` step passed.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `contact-requests/service.ts` (730 lines) is now 385 lines, plus `queries` (203), `reads` and `errors`. The code moved unchanged.
- **Gap found:** no test covers contact requests, and who can send, accept and block a request is permissions code. That goes in a follow-up task.
- **Check:** the gate passed.
