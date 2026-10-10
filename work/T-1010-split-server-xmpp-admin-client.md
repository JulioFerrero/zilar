---
id: T-1010
title: "Size split T71: apps/server/src/xmpp/admin-client.ts (539 lines) into xmpp/admin/{schemas,types,errors,client}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-1010-split-server-xmpp-admin-client
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1010: Split `xmpp/admin-client.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/xmpp/admin-client.ts` is 539 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #67 (task T71): `xmpp/admin/schemas.ts`, `admin/types.ts`, `admin/errors.ts`, `admin/client.ts`, under `apps/server/src/`. `xmpp/admin-client.ts` becomes the barrel; `apps/server/src/test-support.ts` imports from it and must keep working unchanged.

Move the code unchanged, and skip the Dedup, because it crosses files. This client creates XMPP accounts and rooms, so not one line of its logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #67, and `apps/server/src/xmpp/admin-client.ts`.

### Allowed files
`apps/server/src/xmpp/admin-client.ts`, `apps/server/src/xmpp/admin/schemas.ts`, `apps/server/src/xmpp/admin/types.ts`, `apps/server/src/xmpp/admin/errors.ts`, `apps/server/src/xmpp/admin/client.ts`, `work/T-1010-split-server-xmpp-admin-client.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/xmpp/admin-client.ts` into the four files of size-plan §2.3
#67, moving the code unchanged:

- `xmpp/admin/schemas.ts` — the schema constants (including the private `NameSchema`,
  `PasswordSchema`, `BareJidSchema`) and their inferred types.
- `xmpp/admin/types.ts` — `CreateRoomOptions`, `AddRosterItemOptions`, `CreatedResult`,
  `SendDirectInvitationOptions`, `EjabberdAdminClient`, `FetchLike`, and the private
  `ApiResponse`.
- `xmpp/admin/errors.ts` — `EjabberdApiError` plus `errorText`/`isErrorBody`/
  `mentionsAlreadyExists`/`firstIssueMessage`.
- `xmpp/admin/client.ts` — `createEjabberdAdminClient`, `basicAuthHeader`, `parseName`,
  `splitBareJid` and `PUSH_SUBSCRIPTION_NODES`.

`xmpp/admin-client.ts` stays a thin barrel re-exporting every name it exported before
with the same names and kinds. No logic changed: only the `const`/`function`/`type`
declarations moved, and the internal schemas that a sibling module now needs gained an
`export`. No importer outside the task's files changed (29 importers, all via the
barrel; `main.ts` uses the value `createEjabberdAdminClient`).

### Files changed (one source file per task)

| File | wc -l |
| --- | ---: |
| `apps/server/src/xmpp/admin-client.ts` (old) | 539 |
| `apps/server/src/xmpp/admin-client.ts` (barrel) | 28 |
| `apps/server/src/xmpp/admin/schemas.ts` | 74 |
| `apps/server/src/xmpp/admin/types.ts` | 73 |
| `apps/server/src/xmpp/admin/errors.ts` | 75 |
| `apps/server/src/xmpp/admin/client.ts` | 361 |

Every new file and the barrel are ≤ 400 lines, so no further split was needed.

### Export list before and after (`grep -E "^export"`)

Before (old `admin-client.ts`, 16 names: 6 values, 10 types):

```
export const RoomAffiliationSchema
export type  RoomAffiliation
export const RosterSubscriptionSchema
export type  RosterSubscription
export const RosterEntrySchema
export type  RosterEntry
export const RoomAffiliationEntrySchema
export type  RoomAffiliationEntry
export type  CreateRoomOptions
export type  AddRosterItemOptions
export type  CreatedResult
export type  SendDirectInvitationOptions
export type  EjabberdAdminClient
export type  FetchLike
export class EjabberdApiError
export function createEjabberdAdminClient
```

After (barrel re-exports all 16, same names and kinds):

```
apps/server/src/xmpp/admin-client.ts: export { RoomAffiliationEntrySchema, RoomAffiliationSchema, RosterEntrySchema, RosterSubscriptionSchema } from './admin/schemas'
apps/server/src/xmpp/admin-client.ts: export type { RoomAffiliation, RoomAffiliationEntry, RosterEntry, RosterSubscription } from './admin/schemas'
apps/server/src/xmpp/admin-client.ts: export type { AddRosterItemOptions, CreateRoomOptions, CreatedResult, EjabberdAdminClient, FetchLike, SendDirectInvitationOptions } from './admin/types'
apps/server/src/xmpp/admin-client.ts: export { EjabberdApiError } from './admin/errors'
apps/server/src/xmpp/admin-client.ts: export { createEjabberdAdminClient } from './admin/client'
apps/server/src/xmpp/admin/schemas.ts: export const NameSchema
apps/server/src/xmpp/admin/schemas.ts: export const PasswordSchema
apps/server/src/xmpp/admin/schemas.ts: export const RoomAffiliationSchema
apps/server/src/xmpp/admin/schemas.ts: export type  RoomAffiliation
apps/server/src/xmpp/admin/schemas.ts: export const RosterSubscriptionSchema
apps/server/src/xmpp/admin/schemas.ts: export type  RosterSubscription
apps/server/src/xmpp/admin/schemas.ts: export const RosterEntrySchema
apps/server/src/xmpp/admin/schemas.ts: export type  RosterEntry
apps/server/src/xmpp/admin/schemas.ts: export const RoomAffiliationEntrySchema
apps/server/src/xmpp/admin/schemas.ts: export type  RoomAffiliationEntry
apps/server/src/xmpp/admin/schemas.ts: export const MutationResultSchema
apps/server/src/xmpp/admin/schemas.ts: export const CheckAccountResultSchema
apps/server/src/xmpp/admin/schemas.ts: export const RoomOptionNameSchema
apps/server/src/xmpp/admin/schemas.ts: export const RoomOptionValueSchema
apps/server/src/xmpp/admin/schemas.ts: export const SubscriptionNickSchema
apps/server/src/xmpp/admin/schemas.ts: export const RosterNickSchema
apps/server/src/xmpp/admin/schemas.ts: export const RosterGroupsSchema
apps/server/src/xmpp/admin/schemas.ts: export const InvitationTargetsSchema
apps/server/src/xmpp/admin/types.ts:   export type  CreateRoomOptions
apps/server/src/xmpp/admin/types.ts:   export type  AddRosterItemOptions
apps/server/src/xmpp/admin/types.ts:   export type  CreatedResult
apps/server/src/xmpp/admin/types.ts:   export type  SendDirectInvitationOptions
apps/server/src/xmpp/admin/types.ts:   export type  EjabberdAdminClient
apps/server/src/xmpp/admin/types.ts:   export type  FetchLike
apps/server/src/xmpp/admin/types.ts:   export type  ApiResponse
apps/server/src/xmpp/admin/errors.ts:  export class EjabberdApiError
apps/server/src/xmpp/admin/errors.ts:  export function errorText
apps/server/src/xmpp/admin/errors.ts:  export function isErrorBody
apps/server/src/xmpp/admin/errors.ts:  export function mentionsAlreadyExists
apps/server/src/xmpp/admin/errors.ts:  export function firstIssueMessage
apps/server/src/xmpp/admin/client.ts:  export function createEjabberdAdminClient
```

No previously-exported name changed name or kind. The additions are cross-file
necessities, all inside the task's own files: the internal schema constants
(`NameSchema`…`InvitationTargetsSchema`) and `ApiResponse` are now imported by a
sibling module, and the error helpers are imported by `client.ts`.

### Commands run (real results)

- `pnpm install` → `Done in 12.3s`.
- `pnpm gate` (from repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.3s)
PASS  lint  (1.4s)
PASS  typecheck  (5.0s)
PASS  effect  (1.9s)
PASS  tests @zilar/server  (3.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 6 changed files are the 5 Allowed source files plus this task file. No single test
files were run: no test file imports this module (checked with grep, no matches), so the
gate's `tests @zilar/server` step is the only test run (rule 5: wrote no tests, edited no
test). The `effect` step passed with no ratchet marker needed: `schemas.ts`, `errors.ts`
and `client.ts` import `effect` as a value, and `types.ts` and the barrel hit no
needs-effect signal.

### Deviations from the spec / notes

- **Dedup skipped**, as the spec says: the only item (`isErrorBody`/`errorText` +
  `firstIssueMessage` → shared helpers, §2.7) crosses files.
- **Helper placement.** The plan's `admin/errors.ts` line range `163–248` also spans
  `basicAuthHeader` (163–165), `parseName` (227–240) and `splitBareJid` (242–248). I moved
  those three to `admin/client.ts`, next to their only consumer, following the plan's
  named list for `errors.ts` (only `EjabberdApiError`/`errorText`/`isErrorBody`/
  `mentionsAlreadyExists`/`firstIssueMessage`) and the same choice the merged T-1002 split
  documented. `PUSH_SUBSCRIPTION_NODES` (line 37, outside the plan's `schemas.ts` ranges)
  also moved to `client.ts`, its only consumer.
- No line of the client's HTTP logic changed; the `pnpm gate` typecheck and the existing
  server test suite pass.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `xmpp/admin-client.ts` (539 lines) becomes the barrel plus `xmpp/admin/{schemas,types,errors,client}`, the largest `client.ts` at 361. The code moved unchanged.
- **The importer still works:** `test-support.ts:14,21` still imports from the barrel, and the gate's typecheck covers it.
- **The nit:** the Report says §2.3 instead of §2.2. It's a typo.
- **Check:** the gate passed.
