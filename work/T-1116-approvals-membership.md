---
id: T-1116
title: "Dedup S11 (slice 2): approvals and groups/queries use groups/access.ts — one isGroupManager() replaces the two isGroupAdmin-style queries; inline owner/admin checks use isGroupManagerRole; every answer unchanged"
status: merged
milestone: M5
branch: task/T-1116-approvals-membership
model: auto
effort: default
depends_on: [T-1115]
estimate: 0.15 day
---

# T-1116: Approvals use the shared membership read

## Spec (written by Claude, do not edit)

### Why
Julio approved the permission dedups, "moved unchanged", on 2026-10-11. This continues T-1110 and T-1115 on `apps/server/src/groups/access.ts`: `findGroupMembership(db, groupId, userId)` returns the row or `undefined`, and `isGroupManagerRole(role)` is true for `'owner'` and `'admin'`.

**What the lead read:**
- **`apps/server/src/approvals/rules.ts:278-294`** is the exported `isGroupAdmin(db, groupId, userId)`. It runs the same `SELECT role FROM group_members WHERE group_id … AND user_id … LIMIT 1` and returns `membership !== undefined && (role === 'owner' || role === 'admin')`. Its callers:
  - `apps/server/src/approvals/api.ts:162`, `:277`, `:326` and `:496` (imported at `:35`);
  - `apps/server/src/approvals/service.ts:222` (imported at `:7`).
- **`apps/server/src/approvals/access.ts:68-76`** repeats that query and check inline.
- **`apps/server/src/approvals/access.ts:220-221`:** `const role = row.groupId === null ? undefined : memberRoles.get(row.groupId); decisions.set(row.id, role === 'owner' || role === 'admin');`.
- **`apps/server/src/groups/queries.ts:155`:** `const isAdmin = viewer.role === 'owner' || viewer.role === 'admin';`.
- **Out of scope:** `apps/server/src/audit/list.ts:208-225` has its own `isGroupAdmin` that also `INNER JOIN groups`, a different query, so it stays.

### What to build
1. **`apps/server/src/groups/access.ts`:**
   - widen `isGroupManagerRole`'s parameter to `string`. The result is unchanged: true only for `'owner'` and `'admin'`;
   - add `isGroupManager(db, groupId, userId): Promise<boolean>`, which returns `membership !== undefined && isGroupManagerRole(membership.role)`, using `findGroupMembership`.
2. **`approvals/rules.ts`:** delete `isGroupAdmin`. `approvals/api.ts` and `approvals/service.ts` import `isGroupManager` from `../groups/access` and call it with the same arguments.
3. **`approvals/access.ts:68-76`:** use `return isGroupManager(db, groupId, userId);`.
4. **`approvals/access.ts:221`:** use `role !== undefined && isGroupManagerRole(role)`.
5. **`groups/queries.ts:155`:** use `isGroupManagerRole(viewer.role)`.
6. **Remove imports that become unused,** only where nothing else needs them.
7. **No answer changes.** List every call site before and after in the Report.
8. **Tests** (permissions):
   - run `apps/server/src/approvals/rules.test.ts`, `apps/server/src/approvals/service.test.ts` and `apps/server/src/groups/access.test.ts`, and paste the results;
   - if a test imports `isGroupAdmin` from `./rules`, switch that import to `isGroupManager` from `../groups/access`, and change nothing else in the test;
   - add one case to `groups/access.test.ts` for `isGroupManager`: false for a non-member, false for a member, true for an admin.

### Read first
`AGENTS.md`, `apps/server/src/groups/access.ts`, `apps/server/src/groups/access.test.ts`, the approvals files above, and `apps/server/src/groups/queries.ts:140-160`.

### Allowed files
`apps/server/src/groups/access.ts`, `apps/server/src/groups/access.test.ts`, `apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/api.ts`, `apps/server/src/approvals/service.ts`, `apps/server/src/approvals/access.ts`, `apps/server/src/approvals/rules.test.ts`, `apps/server/src/approvals/service.test.ts`, `apps/server/src/groups/queries.ts`, `work/T-1116-approvals-membership.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/access.test.ts src/approvals/rules.test.ts src/approvals/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "isGroupAdmin" apps/server/src | grep -v audit/` prints nothing.

---

## Report (written by the worker when done)

### What I did
Moved the approvals and groups reads onto the shared `groups/access.ts` helpers.

- `groups/access.ts`: widened `isGroupManagerRole(role: string)` (result unchanged: true only for `'owner'`/`'admin'`); added `isGroupManager(db, groupId, userId)` built on `findGroupMembership` and `isGroupManagerRole`.
- `approvals/rules.ts`: deleted the exported `isGroupAdmin`. No imports became unused there (`SqlClient`, `Effect`, `runSql`, `ServerDatabase` are still used by the other rule functions).
- `approvals/api.ts`: dropped `isGroupAdmin` from the `./rules` import, added `import { isGroupManager } from '../groups/access'`, renamed all four call sites.
- `approvals/service.ts`: dropped `isGroupAdmin` from the `./rules` import, added `import { isGroupManager } from '../groups/access'`, renamed the one call site.
- `approvals/access.ts`: `canDecide` tail now `return isGroupManager(db, groupId, userId);`; `canDecideMany` now `role !== undefined && isGroupManagerRole(role)` (the `!== undefined` guard is required now that the helper takes `string`).
- `groups/queries.ts`: `const isAdmin = isGroupManagerRole(viewer.role);` (added the `./access` import).
- `groups/access.test.ts`: added a case for `isGroupManager` (true for owner/admin, false for a plain member and a non-member, using `testSql` to promote one member to admin). No test imported `isGroupAdmin`, so no test import needed switching.

### Call sites before -> after (answers unchanged)
- `approvals/api.ts:162` `isGroupAdmin(deps.db, approval.groupId as string, user.id)` -> `isGroupManager(...)` same args
- `approvals/api.ts:277` `isGroupAdmin(deps.db, updated.groupId as string, user.id)` -> `isGroupManager(...)` same args
- `approvals/api.ts:326` `isGroupAdmin(deps.db, groupId, user.id)` -> `isGroupManager(...)` same args
- `approvals/api.ts:496` `isGroupAdmin(db, rule.groupId, userId)` -> `isGroupManager(...)` same args
- `approvals/service.ts:222` `isGroupAdmin(db, row.groupId, params.userId)` -> `isGroupManager(...)` same args
- `approvals/access.ts:68-76` inline `SELECT role FROM group_members ... role === 'owner' || role === 'admin'` -> `isGroupManager(db, groupId, userId)`
- `approvals/access.ts:221` `role === 'owner' || role === 'admin'` -> `role !== undefined && isGroupManagerRole(role)`
- `groups/queries.ts:155` `viewer.role === 'owner' || viewer.role === 'admin'` -> `isGroupManagerRole(viewer.role)`
- `approvals/rules.ts:280` exported `isGroupAdmin` definition: deleted.
- Left alone (spec): `audit/list.ts` has its own `isGroupAdmin` with an `INNER JOIN groups`.

The underlying query is identical (`SELECT role FROM group_members WHERE group_id = ... AND user_id = ... LIMIT 1`), and the owner/admin predicate is identical, so every answer is unchanged.

### Files changed
`apps/server/src/groups/access.ts`, `apps/server/src/groups/access.test.ts`, `apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/api.ts`, `apps/server/src/approvals/service.ts`, `apps/server/src/approvals/access.ts`, `apps/server/src/groups/queries.ts`, plus this task file.

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/access.test.ts src/approvals/rules.test.ts src/approvals/service.test.ts`: `Test Files 3 passed (3)`, `Tests 80 passed (80)`.
- `grep -rn "isGroupAdmin" apps/server/src | grep -v audit/`: no matches.
- `pnpm gate`:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (18.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations / open questions
None. No deviations from the spec.

## Review (written by Claude)


**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **`groups/access.ts`:** `isGroupManagerRole` now takes a `string` (still true only for owner and admin), and a new `isGroupManager(db, groupId, userId)` reads the membership and checks the role.
- **Approvals:** `isGroupAdmin` in `approvals/rules.ts` is deleted, and its 5 callers (`approvals/api.ts` ×4, `approvals/service.ts`) call `isGroupManager` with the same arguments. `approvals/access.ts` uses `isGroupManager` and, for the batch map, `role !== undefined && isGroupManagerRole(role)`.
- **`groups/queries.ts:155`** uses `isGroupManagerRole(viewer.role)`.
- **`audit/list.ts`** keeps its own `isGroupAdmin`, which joins `groups`, as the spec said.
- **Tests:** the lead ran `groups/access`, `approvals/rules` and `approvals/service` on the branch: 80 green, including the new `isGroupManager` case (owner, admin, member, stranger). The gate passed.
