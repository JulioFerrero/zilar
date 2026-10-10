---
id: T-0978
title: "Size split T36: apps/server/src/roles/service.ts (763 lines) into roles/{schemas,access,queries,sync}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0978-split-server-roles-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0978: Split `roles/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/roles/service.ts` is 763 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #32 (task T36): `roles/schemas.ts`, `roles/access.ts`, `roles/queries.ts`, `roles/sync.ts`, under `apps/server/src/`. `roles/service.ts` becomes the barrel.

Skip the entry's Dedup items (`isUniqueViolation`, `mapRoleError`, and the member-role reads), because they cross files. This is permissions code (`require*` and the role holders), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #32, and `apps/server/src/roles/service.ts`.

### Allowed files
`apps/server/src/roles/service.ts`, `apps/server/src/roles/schemas.ts`, `apps/server/src/roles/access.ts`, `apps/server/src/roles/queries.ts`, `apps/server/src/roles/sync.ts`, `work/T-0978-split-server-roles-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/roles/roles.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/roles/service.ts` (763 lines) into `roles/schemas.ts`, `roles/access.ts`, `roles/queries.ts` and `roles/sync.ts` per `split-rules.md` and `size-plan.md` §2.2 #32. `roles/service.ts` stays the barrel: it re-exports every name it exported before and keeps the five mutating operations (`createRole`, `renameRole`, `deleteRole`, `setRoleMembers`, `dropMemberRoles`) plus the `mapRoleError`/`isUniqueViolation`/`auditEntry` helpers. The entry's Dedup items are skipped as the task says (they cross files), and §2.2 #32 relocates only ~420 of the 763 lines, so the mutations and error helpers stay where they are, as the plan intends. No file outside the Allowed files changed; every importer still imports from `roles/service.ts` and finds the same names.

Layering (no import cycles beyond the pre-existing one): `schemas` (types + error shapes) ← `access` (permissions + holder/topic-role reads) ← `queries` (role reads); `sync` ← `schemas`; the barrel composes all four. The only cycle is the pre-existing `roles/service.ts` ↔ `topics/rooms.ts` one (`syncTopicRoom` vs `topicRoleHolderIds`), unchanged by the split.

### Files (wc -l)

| File | Lines |
| --- | ---: |
| `apps/server/src/roles/service.ts` (old, `git show HEAD:`) | 763 |
| `apps/server/src/roles/service.ts` (barrel, after) | 385 |
| `apps/server/src/roles/schemas.ts` | 48 |
| `apps/server/src/roles/access.ts` | 165 |
| `apps/server/src/roles/queries.ts` | 153 |
| `apps/server/src/roles/sync.ts` | 49 |

Every file is at most 400 lines, so no `max-lines` warning can appear.

### Export list

Before (`grep -E "^export"` on old `service.ts`), 18 names: `MAX_ROLES_PER_GROUP` (const), `GroupRoleRow` (type re-export), `GroupRoleView` (interface), `GroupRoleDetail` (interface), `RolesServiceDeps` (interface), `GROUP_NOT_FOUND` (const), `ROLE_NOT_FOUND` (const), `toRoleDetail`, `listRoles`, `roleHoldersByGroup`, `createRole`, `renameRole`, `deleteRole`, `setRoleMembers`, `dropMemberRoles`, `topicRoleHolderIds`, `holdsTopicRole`, `rolesOfTopic` (functions).

After, the barrel exposes exactly those 18, with the same names and kinds:
- `export { GROUP_NOT_FOUND, MAX_ROLES_PER_GROUP, ROLE_NOT_FOUND } from './schemas';`
- `export type { GroupRoleDetail, GroupRoleRow, GroupRoleView, RolesServiceDeps } from './schemas';`
- `export { holdsTopicRole, topicRoleHolderIds } from './access';`
- `export { listRoles, roleHoldersByGroup, rolesOfTopic, toRoleDetail } from './queries';`
- `createRole`, `renameRole`, `deleteRole`, `setRoleMembers`, `dropMemberRoles` are declared in the barrel.

The new modules also export the internal names their siblings need (`requireGroupMembership`, `requireGroupManager`, `requireRoleInGroup`, `holdersOfRole`, `topicRoleHolderIds`, `holdsTopicRole`, `toRoleDetail`, `listRoles`, `roleHoldersByGroup`, `rolesOfTopic`, `syncTopicsWithRoles`, `MAX_ROLES_PER_GROUP`, `GROUP_NOT_FOUND`, `ROLE_NOT_FOUND`, `toMissingGroup`, `toMissingRole`). None are re-exported by the barrel, so its public surface is unchanged. `holderUserIds` stays private to `access.ts`.

### Unchanged-code check

A normalized comparison (block/line comments removed, import and re-export statements removed, `export` prefixes stripped, whitespace collapsed, token multiset) of `git show HEAD:apps/server/src/roles/service.ts` against the barrel plus the four new modules is **identical**: every code token of the original is present, none lost or edited. No new test was written and no test edited (item 5).

### Deviation (split-rules item 1)

Rule 1 says the plan's line ranges can drift. §2.2 #32 puts `schemas.ts` at 13–34 and `access.ts` at 35–129, but the two `*_NOT_FOUND` shapes and their `toMissingGroup`/`toMissingRole` constructors (35–53) are declarations, not permission checks, so they live in `schemas.ts` with the other declarations and `access.ts` holds exactly what its entry description names (`require*` + holder lookups + topic role reads). Everything else follows the entry's ranges.

### Effect ratchet (split-rules item 6)

No marker was added. `schemas.ts` has no drift signals and no Effect import (`plain`); `access.ts`, `queries.ts` and `sync.ts` import `effect/sql` as a value (`effect`, not `needs-effect`), so the ratchet cannot fire. The gate's `effect` step passed.

### Commands run

- `pnpm install` — done (23.8s).
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/roles/roles.test.ts` — `1 passed (1)`, `22 passed (22)`.
- `pnpm gate` (repo root, final run):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (1.2s)
PASS  lint  (1.1s)
PASS  typecheck  (3.6s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (12.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `roles/service.ts` (763 lines) is now 385 lines, plus `access` (165), `queries`, `schemas` and `sync`. The permission checks moved unchanged.
- **Check:** the 22 roles tests pass, and so does the gate.
