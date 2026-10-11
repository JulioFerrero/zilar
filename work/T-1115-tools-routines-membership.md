---
id: T-1115
title: "Dedup S11 (slice 1): tools and routines use groups/access.ts — delete their two private findMembership copies and the four inline owner/admin checks; every answer unchanged"
status: todo
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

## Review (written by Claude)
