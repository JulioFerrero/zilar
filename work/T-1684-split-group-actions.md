---
id: T-1684
title: "Size split of apps/mobile/src/store/effects/group-actions.ts (393 lines): move the nine role actions (groupRoles … refreshTopicRoles) into a new effects/group-roles-actions.ts with makeGroupRolesActions, spread next to the other action makers in groups.ts — a pure move"
status: merged
milestone: M5
branch: task/T-1684-split-group-actions
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1684: Split the role actions out of the phone group-actions.ts

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/store/effects/group-actions.ts` is 393 of 400 lines, so no group action can be added. The folder already splits actions into makers (`group-membership-actions.ts`, `group-settings-actions.ts`), and the role actions are the next clean block.

### Facts (the lead read them on 2026-10-16)
- **`group-actions.ts`:**
  - `export interface GroupActionHelpers :29-42` (it includes `groupRolesById`, `topicRolesById`, `bumpRevision`, `ensureGroupRoles` and `ensureTopicRoles`);
  - `export function makeGroupActions(ctx: StoreCtx, helpers: GroupActionHelpers): GroupActions :45`, which destructures `ctx` and `ctx.ports` (`roles: rolesApi` among them) at `:46-62` and returns one object literal from `:63`;
  - **the role block** is the last nine entries: `groupRoles :311`, `refreshGroupRoles :317`, `createGroupRole :318`, `renameGroupRole :327`, `deleteGroupRole :341`, `setGroupRoleMembers :352`, `setTopicRoles :369`, `topicRoles :381` and `refreshTopicRoles :391`, through the object's end.
- **`apps/mobile/src/store/effects/groups.ts`** (292 lines):
  - `export type GroupActions = Pick<ChatStoreState, …>` (`:24`);
  - `:272-289` builds `actions: GroupActions & GroupMembershipActions & GroupSettingsActions = { ...makeGroupActions(ctx, {…}), ...makeGroupMembershipActions(ctx, {…}), ...makeGroupSettingsActions(ctx, {…}) }`.
- **The sibling pattern** is `apps/mobile/src/store/effects/group-settings-actions.ts`: a `…Helpers` interface, `export type GroupSettingsActions = Pick<ChatStoreState, 'patchGroupSettings'>` and `makeGroupSettingsActions(ctx, helpers)`.
- **The folder** has no `group-roles-actions.ts`.

### Steps
1. **Create `apps/mobile/src/store/effects/group-roles-actions.ts`** following the sibling pattern:
   - `GroupRolesHelpers` (only what the nine entries read, for example `groupRolesById`, `topicRolesById`, `bumpRevision`, `ensureGroupRoles`, `ensureTopicRoles`);
   - `export type GroupRolesActions = Pick<ChatStoreState, 'groupRoles' | 'refreshGroupRoles' | 'createGroupRole' | 'renameGroupRole' | 'deleteGroupRole' | 'setGroupRoleMembers' | 'setTopicRoles' | 'topicRoles' | 'refreshTopicRoles'>`;
   - `makeGroupRolesActions(ctx, helpers)` returning the nine entries moved **word for word** with their comments.
2. **`group-actions.ts`:**
   - delete the nine entries;
   - make `makeGroupActions` return `Omit<GroupActions, keyof GroupRolesActions>`;
   - drop helper fields and imports that nothing else in the file uses. Keep `GroupActionHelpers` fields that `groups.ts` still passes only if they're used; otherwise remove them from both places.
3. **`groups.ts`:** add `...makeGroupRolesActions(ctx, {…})` to the `actions` literal, after `makeGroupActions`. The `actions` type stays `GroupActions & GroupMembershipActions & GroupSettingsActions`.
4. **No behaviour change, no new tests.**

### Allowed files
- `apps/mobile/src/store/effects/group-roles-actions.ts`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `work/T-1684-split-group-actions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`group-actions.ts` is about 315 lines,** and `group-roles-actions.ts` holds the nine actions unchanged.
- **`groups.ts` stays under 400 lines,** and the mobile typecheck and tests pass.

---

## Report (written by the worker when done)

### What I did

Pure move, no behaviour change. The nine role actions (`groupRoles`,
`refreshGroupRoles`, `createGroupRole`, `renameGroupRole`, `deleteGroupRole`,
`setGroupRoleMembers`, `setTopicRoles`, `topicRoles`, `refreshTopicRoles`) now
live in a new sibling file.

- **`apps/mobile/src/store/effects/group-roles-actions.ts` (141 lines, new):**
  follows the `group-settings-actions.ts` pattern — a `GroupRolesHelpers`
  interface (`groupRolesById`, `topicRolesById`, `bumpRevision`,
  `ensureGroupRoles`, `ensureTopicRoles`, `actionStore` — only what the nine
  entries read), `export type GroupRolesActions = Pick<ChatStoreState, …>` with
  the nine keys, and `makeGroupRolesActions(ctx, helpers)` returning the nine
  entries moved **word for word**, comments included.
- **`apps/mobile/src/store/effects/group-actions.ts` (393 → 300 lines):** the
  nine entries are deleted; `makeGroupActions` now returns
  `Omit<GroupActions, keyof GroupRolesActions>`. Dropped the helper fields
  nothing in the file still reads (`groupRolesById`, `topicRolesById`,
  `ensureGroupRoles`, `ensureTopicRoles`), the now-unused `rolesApi` port
  destructure, and the now-unused imports (`ApproverRole`, `SetTopicRolesInput`,
  `TopicRole`, `CustomGroupRole`). `GroupActionHelpers` keeps only
  `groupDetails`, `bumpRevision`, `ensureGroupDetail`, `actionStore`,
  `applyTopicRow`, `joinRoomQuietly`, `refreshQuietly`, `removeTopicMemberEffect`.
- **`apps/mobile/src/store/effects/groups.ts` (292 → 297 lines):** added
  `...makeGroupRolesActions(ctx, { groupRolesById, topicRolesById, bumpRevision,
  ensureGroupRoles, ensureTopicRoles, actionStore })` right after `makeGroupActions`,
  and moved those four fields out of the `makeGroupActions(ctx, {…})` call. The
  `actions` type stays `GroupActions & GroupMembershipActions & GroupSettingsActions`.

### Checks run

`pnpm gate` from the repo root, ending:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.8s)
PASS  lint  (2.9s)
PASS  typecheck  (10.2s)
PASS  effect  (2.0s)
PASS  tests @zilar/mobile  (4.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No mobile test file in this worktree covers the role actions (it has only
`real-store.*.test.ts` and `offline-cache.test.ts`), so I ran no single test
before the gate; the gate's `tests @zilar/mobile` step covers the package.

### Notes for the lead

- `group-actions.ts` is 300 lines, not the ~315 the spec estimated — the move
  plus the dropped unused imports/helper fields removed a bit more than
  expected. Still far under the 400-line cap, and the nine actions are unchanged.
- The import of `GroupRolesActions` into `group-actions.ts` is type-only, so
  there is no runtime import cycle; `group-roles-actions.ts` imports
  `ChatStoreState` rather than `GroupActions`, again type-only, so the two files
  do not cycle at runtime either.
- Size gate passed for all changed source files.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the nine role entries in `group-roles-actions.ts` equal the removed lines; only the maker's frame (helpers interface, `Pick` type, function header) is new. `groups.ts` spreads the new maker next to the others.
- **Result:** `group-actions.ts` drops from 393 to 300 lines; `groups.ts` is 297.

