---
id: T-1110
title: "Dedup S10 (slice 1): apps/server/src/groups/access.ts with findGroupMembership + isGroupManagerRole, adopted by roles/access.ts and invite-links/queries.ts; every answer and message unchanged"
status: todo
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

## Review (written by Claude)
