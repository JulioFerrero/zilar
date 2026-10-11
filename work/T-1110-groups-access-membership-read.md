---
id: T-1110
title: "Dedup S10 (slice 1): apps/server/src/groups/access.ts with findGroupMembership + isGroupManagerRole, adopted by roles/access.ts and invite-links/queries.ts; every answer and message unchanged"
status: merged
milestone: M5
branch: task/T-1110-groups-access-membership-read
model: auto
effort: default
depends_on: [T-1109]
estimate: 0.2 day
---

# T-1110: The first shared group-membership read

## Spec (written by Claude, do not edit)

### Why
Julio approved the security dedups, "moved unchanged", on 2026-10-11. This is S10 in `docs/audit/dedup-status.md` §5: about 40 SQL sites re-read `group_members` themselves, and `apps/server/src/groups/access.ts` does not exist.

**This first slice covers the two `requireGroupManager` functions only** (read by the lead):
- **`apps/server/src/roles/access.ts:11-29`, `requireGroupMembership`:**
  - it runs `SELECT group_id, user_id, role FROM group_members WHERE group_id = … AND user_id = … LIMIT 1`;
  - if there is no row it throws `toMissingGroup()`, a 404, so ids cannot be probed;
  - it returns the row.
- **`:31-40`, `requireGroupManager`:** it throws `HttpError(403, 'forbidden', 'Only group owners and admins can manage roles')` when the role is `'member'`.
- **`apps/server/src/invite-links/queries.ts:26-56`, a private `requireGroupManager`:**
  - it reads the `groups` row, then the membership role with the same `group_members` query shape;
  - for a missing group or no membership it throws `HttpError(404, 'not_found', 'Group not found')`;
  - for `'member'` it throws `HttpError(403, 'forbidden', 'Only owners and admins can manage invite links')`;
  - it returns `{ id, title }`.

### What to build
1. **A new `apps/server/src/groups/access.ts`** exports:
   - `findGroupMembership(db, groupId, userId): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' } | undefined>`, the exact query from `roles/access.ts:17-23` returning the first row or `undefined`;
   - `isGroupManagerRole(role): boolean`, true for `'owner'` and `'admin'`.
2. **`roles/access.ts`:** `requireGroupMembership` uses `findGroupMembership` and keeps its `toMissingGroup()` throw. `requireGroupManager` uses `!isGroupManagerRole(membership.role)` and keeps its own 403 and message.
3. **`invite-links/queries.ts`:** its private `requireGroupManager` keeps the `groups` read and its own 404 and 403 messages, but takes the membership from `findGroupMembership` and the check from `isGroupManagerRole`. The return value is unchanged.
4. **The invariant: no answer changes.** Every status, code, message and return shape stays exactly as it is. Say so in the Report with a before/after table for both callers: missing group, non-member, member, admin and owner.
5. **Tests** (permissions are a crucial area):
   - run `apps/server/src/roles/roles.test.ts` and `apps/server/src/invite-links/invite-links.test.ts` and paste the results. Do not edit them;
   - add `apps/server/src/groups/access.test.ts` with three cases for `findGroupMembership` (no row, member, owner) and `isGroupManagerRole`, using the server's test DB helpers. Copy how `roles.test.ts` seeds a group.
6. **No other files change.** The other callers are later slices.

### Read first
`AGENTS.md`, `apps/server/src/roles/access.ts`, `apps/server/src/invite-links/queries.ts`, `apps/server/src/roles/schemas.ts` (`toMissingGroup`), and `apps/server/src/roles/roles.test.ts` (the test setup).

### Allowed files
`apps/server/src/groups/access.ts`, `apps/server/src/groups/access.test.ts`, `apps/server/src/roles/access.ts`, `apps/server/src/invite-links/queries.ts`, `work/T-1110-groups-access-membership-read.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/access.test.ts src/roles/roles.test.ts src/invite-links/invite-links.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the no-change table.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/groups/access.ts`:
  - `findGroupMembership(db, groupId, userId)` runs the exact `group_members` query from `roles/access.ts:17-23` and returns the first row or `undefined`.
  - `isGroupManagerRole(role)` is `true` for `'owner'` and `'admin'`.
- `apps/server/src/roles/access.ts`: `requireGroupMembership` now takes its row from `findGroupMembership` and keeps its `toMissingGroup()` throw; `requireGroupManager` uses `!isGroupManagerRole(membership.role)` and keeps its own 403 and message.
- `apps/server/src/invite-links/queries.ts`: the private `requireGroupManager` keeps the `groups` read and its own 404/403 messages, takes the membership from `findGroupMembership`, and the check from `isGroupManagerRole`. Its return value `{ id, title }` is unchanged.
- Added `apps/server/src/groups/access.test.ts` with two cases: the three membership reads (no row for a stranger and for a missing group, `member`, `owner`) and the three `isGroupManagerRole` values. It seeds the group through `POST /api/groups` exactly like `roles.test.ts`.

### Invariant: no answer changes

Every status, code, message and return shape is identical before and after for both callers.

`roles/access.ts` (`requireGroupMembership` + `requireGroupManager`):

| Case | Before | After |
| --- | --- | --- |
| missing group | 404 `not_found` "Group not found" | 404 `not_found` "Group not found" |
| non-member | 404 `not_found` "Group not found" | 404 `not_found` "Group not found" |
| member | 403 `forbidden` "Only group owners and admins can manage roles" | 403 `forbidden` "Only group owners and admins can manage roles" |
| admin | membership row, no throw | membership row, no throw |
| owner | membership row, no throw | membership row, no throw |

`invite-links/queries.ts` (private `requireGroupManager`):

| Case | Before | After |
| --- | --- | --- |
| missing group | 404 `not_found` "Group not found" | 404 `not_found` "Group not found" |
| non-member | 404 `not_found` "Group not found" | 404 `not_found` "Group not found" |
| member | 403 `forbidden` "Only owners and admins can manage invite links" | 403 `forbidden` "Only owners and admins can manage invite links" |
| admin | returns `{ id, title }` | returns `{ id, title }` |
| owner | returns `{ id, title }` | returns `{ id, title }` |

### Commands I ran

- `pnpm install` — done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/access.test.ts src/roles/roles.test.ts src/invite-links/invite-links.test.ts` — 3 files passed, 45 tests passed.
- `pnpm gate` (from the repo root) — first run FAIL on `format` for `apps/server/src/invite-links/queries.ts`; I collapsed the ternary to one line and re-ran. Final summary:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.4s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (0.6s)
PASS  tests @zilar/server  (17.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 5 changed files are the four the task allows plus this task file.

### Deviations / open questions

None. No dependencies added; no other files changed.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `apps/server/src/groups/access.ts` has `findGroupMembership` (the exact query from `roles/access.ts`) and `isGroupManagerRole`. `roles/access.ts` and the private `requireGroupManager` in `invite-links/queries.ts` use them. Each keeps its own 404 and 403 codes, messages and return shape; the lead read every changed line.
- **One deliberate edge:** `role === 'member'` became `!isGroupManagerRole(role)`. `group_members.role` is plain `text` with no CHECK (`drizzle/0003_shocking_boom_boom.sql:13`), so an unexpected value is now denied where it used to be allowed. This only fails safer, and the code writes only owner, admin or member.
- **Tests:** the lead ran `groups/access`, `roles/roles` and `invite-links/invite-links` on the branch: 45 green. The gate passed.
- **Next slices (S11):** the other `group_members` readers in `approvals/`, `tools/`, `routines/`, `audit/` and `topics/`.
