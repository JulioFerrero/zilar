---
id: T-1097
title: "Split apps/mobile/src/store/effects/groups.ts (586 lines): the GroupActions object moves to group-actions.ts behind a helpers parameter, pure relocation"
status: todo
milestone: M5
branch: task/T-1097-split-mobile-store-effects-groups
model: auto
effort: default
depends_on: [T-1093]
estimate: 0.2 day
---

# T-1097: Split the mobile `store/effects/groups.ts`

## Spec (written by Claude, do not edit)

### Why
- **The rule:** Julio's 400-line limit (2026-10-10).
- **The file:** `apps/mobile/src/store/effects/groups.ts` has 586 lines. It is one closure, `makeGroups(ctx)` (`:81`):
  - **the shared state** it destructures (`:82-92`);
  - **the helpers:** `bumpRevision` (`:94`), `groupDetailStore` (`:101`), `ensureGroupDetail` (`:124`), `ensureGroupRoles` (`:134`), `ensureTopicRoles` (`:160`), `ensureGroupMembers` (`:184`), `joinGroups` (`:202`), `topicRowStore` (`:225`), `applyTopicRow` (`:235`), `actionStore` (`:240`), `joinRoomQuietly` (`:246`), `refreshQuietly` (`:259`) and `removeTopicMemberEffect` (`:265`);
  - **the `actions: GroupActions` object,** from `:276` to about `:583`, which is about 300 lines;
  - **the return** at `:585`: `{ actions, ensureGroupDetail, ensureGroupMembers, joinGroups }`.
- **Why it can be split now:** it waited for the mock rebuild, which is done.
- **The plan:** `docs/audit/size-plan.md` §2.3 #54.

### What to build
1. **A new `apps/mobile/src/store/effects/group-actions.ts`** exports `makeGroupActions(ctx: StoreCtx, helpers: GroupActionHelpers): GroupActions`.
   - `GroupActionHelpers` is an interface naming exactly the closure helpers and values the `actions` body uses.
   - The `actions` object literal moves into it **unchanged**, apart from reading those names from `helpers` (destructure them at the top) and from `ctx`.
2. **In `groups.ts`,** `makeGroups` builds the helpers as today and calls `const actions = makeGroupActions(ctx, { … })`. The return value stays the same.
3. **`GroupActions` and `Groups`** (`:30`, `:66`) stay exported from `groups.ts`, so **no importer changes**. If `group-actions.ts` needs `GroupActions`, import it as a type from `./groups`, or move it and re-export it from `groups.ts`.
4. **Constraints:**
   - this is a pure relocation: no dedup and no renames;
   - every file is at most 400 lines;
   - no other files change.
5. **The Report:**
   - the before/after line counts;
   - the list of fields in `GroupActionHelpers`;
   - the output of `git diff main -M --stat`.

### Read first
`AGENTS.md`, `apps/mobile/src/store/effects/groups.ts`, and `apps/mobile/src/store/effects/runtime.ts` (the home of `StoreCtx`, found with `grep -rn "StoreCtx" apps/mobile/src/store/effects | head`).

### Allowed files
`apps/mobile/src/store/effects/groups.ts`, `apps/mobile/src/store/effects/group-actions.ts`, `work/T-1097-split-mobile-store-effects-groups.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass, including the mobile store tests that the gate runs.
- Every file is at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
