---
id: T-1115
title: "Dedup S11 (slice 1): tools and routines use groups/access.ts — delete their two private findMembership copies and the four inline owner/admin checks; every answer unchanged"
status: merged
milestone: M5
branch: task/T-1115-tools-routines-membership
model: auto
effort: default
depends_on: [T-1110]
estimate: 0.1 day
---

# T-1115: Tools and routines use the shared membership read

## Spec (written by Claude, do not edit)

### Why
Julio approved the permission dedups, "moved unchanged", on 2026-10-11. T-1110 created `apps/server/src/groups/access.ts`, with `findGroupMembership(db, groupId, userId)` (the row or `undefined`) and `isGroupManagerRole(role)`.

**What the lead read:**
- **Two private copies** of the same membership query (`SELECT role FROM group_members WHERE group_id = … AND user_id = … LIMIT 1`, returning `row ?? null`):
  - `apps/server/src/tools/access.ts:234-244`, `findMembership`;
  - `apps/server/src/routines/reads.ts:73-83`, `findMembership`.
- **Their callers all test `!membership`,** so `null` and `undefined` behave the same:
  - `apps/server/src/tools/access.ts:44` and `:109`;
  - `apps/server/src/tools/routes.ts:125` (imported at `:30`; a 404 when missing);
  - `apps/server/src/routines/access.ts:68` and `:98` (imported at `:5`);
  - `apps/server/src/routines/api.ts:83` (imported at `:24`; a 404 when missing).
- **Four inline manager checks,** each `membership.role === 'owner' || membership.role === 'admin'`:
  - `apps/server/src/tools/access.ts:48` and `:113`;
  - `apps/server/src/routines/access.ts:72` and `:102`.

### What to build
1. **Delete both `findMembership` functions.** Every caller imports `findGroupMembership` from `../groups/access` and calls it with the same arguments. Keep the `!membership` checks and their answers (`return null`, or the 404 `HttpError`) exactly as they are.
2. **Replace the four inline checks** with `isGroupManagerRole(membership.role)`.
3. **Remove the imports that become unused** (`Effect`, `SqlClient`, `runSql`) only where nothing else uses them.
4. **No answer changes.** Say so in the Report with a short list of every call site, before and after.
5. **Tests** (permissions):
   - there are no tests next to `tools/` or `routines/`, so run `apps/server/src/groups/access.test.ts` and paste the result;
   - add no new tests.
6. **No other files change.**

### Read first
`AGENTS.md`, `apps/server/src/groups/access.ts`, `apps/server/src/tools/access.ts`, `apps/server/src/tools/routes.ts`, `apps/server/src/routines/reads.ts`, `apps/server/src/routines/access.ts`, and `apps/server/src/routines/api.ts`.

### Allowed files
`apps/server/src/tools/access.ts`, `apps/server/src/tools/routes.ts`, `apps/server/src/routines/reads.ts`, `apps/server/src/routines/access.ts`, `apps/server/src/routines/api.ts`, `work/T-1115-tools-routines-membership.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/access.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function findMembership" apps/server/src` prints nothing.

---

## Report (written by the worker when done)

### What I did

Deleted both private `findMembership` copies and pointed every caller at
`findGroupMembership` from `apps/server/src/groups/access.ts`; replaced the
four inline `owner`/`admin` checks with `isGroupManagerRole`. No behaviour
changed: the calls take the same arguments, the `!membership` checks and their
answers (`return null`, or the 404 `HttpError`) are untouched, and `undefined`
vs `null` is irrelevant because every caller only tests truthiness.

### Files changed (all inside Allowed files)

- `apps/server/src/tools/access.ts` — removed the local `findMembership`
  (formerly lines 234-244); imported `findGroupMembership`/`isGroupManagerRole`
  from `../groups/access`; call sites at former `:44` and `:109` now call
  `findGroupMembership(...)`; the two inline checks at former `:48`/`:113` are
  now `isGroupManagerRole(membership.role)`. Kept `Effect`/`SqlClient`/`runSql`
  (still used by `toolAccess`, `toolAccessIncludingDeleted`, `listToolsForGroup`
  and `findOwnedAiRow`).
- `apps/server/src/tools/routes.ts` — import swapped from `./access` to
  `../groups/access`; the `listForGroup` 404 check (formerly `:125`) calls
  `findGroupMembership`.
- `apps/server/src/routines/reads.ts` — removed the local `findMembership`
  (formerly lines 73-83). Kept `Effect`/`SqlClient`/`runSql`, used by the four
  remaining reads.
- `apps/server/src/routines/access.ts` — imported `findGroupMembership`/
  `isGroupManagerRole` from `../groups/access`; calls at former `:68`/`:98` and
  checks at former `:72`/`:102` updated.
- `apps/server/src/routines/api.ts` — import swapped from `./reads` to
  `../groups/access`; the `listForGroup` 404 check (formerly `:83`) calls
  `findGroupMembership`.

### Every call site, before → after (answers unchanged)

| Site | Before | After | Answer |
| --- | --- | --- | --- |
| `tools/access.ts` `toolAccess` | `await findMembership(db, tool.groupId as string, userId)`; `manager: role === 'owner' \|\| role === 'admin'` | `await findGroupMembership(...)`; `manager: isGroupManagerRole(role)` | same (`null` when missing; same boolean) |
| `tools/access.ts` `toolAccessIncludingDeleted` | `await findMembership(db, row.groupId, userId)`; inline check | `await findGroupMembership(...)`; `isGroupManagerRole(role)` | same |
| `tools/routes.ts` `listForGroup` | `findMembership(db, groupId, user.id)` then `if (!membership) throw 404` | `findGroupMembership(...)`, same `if` + 404 | same |
| `routines/access.ts` `accessFor` | `findMembership(db, routine.groupId as string, userId)`; inline check | `findGroupMembership(...)`; `isGroupManagerRole(role)` | same |
| `routines/access.ts` `deletedAccessFor` | `findMembership(db, routine.groupId, userId)`; inline check | `findGroupMembership(...)`; `isGroupManagerRole(role)` | same |
| `routines/api.ts` `listForGroup` | `findMembership(db, groupId, user.id)` then `if (!membership) throw 404` | `findGroupMembership(...)`, same `if` + 404 | same |

No public/exported signatures changed (both deleted functions were only
module-local, though declared `export`); nothing outside the six files changed.

### Commands and real results

- `pnpm install` — done, 16 workspace projects, 1172 packages.
- `pnpm --filter @zilar/server exec vitest run src/groups/access.test.ts --reporter=dot` — `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm gate` — GATE PASS (summary in the block below). Files changed outside Allowed files: none.

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.7s)
PASS  lint  (3.0s)
PASS  typecheck  (8.5s)
PASS  effect  (2.5s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The `tests @zilar/server` step is skipped because there are no test files next
to `tools/` or `routines/`; the spec's test step is `groups/access.test.ts`,
which I ran separately above.

### Acceptance

- `grep -rn "function findMembership" apps/server/src` prints nothing (verified: no match for `findMembership` anywhere under `apps/server/src`).
- No new tests added, per spec; the only test run was the existing `groups/access.test.ts`.

### Problems / deviations / open questions

None. No new dependencies. Nothing blocked.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** both private `findMembership` copies (`tools/access.ts`, `routines/reads.ts`) are deleted. All 6 callers use `findGroupMembership` with the same arguments, and every `!membership` branch is unchanged (`return null`, or the 404). The 4 inline owner/admin checks are now `isGroupManagerRole(membership.role)`. The lead read every changed line.
- **Tests and checks:** the gate passed, and `groups/access.test.ts` is green. There are no tests next to `tools/` or `routines/`.
