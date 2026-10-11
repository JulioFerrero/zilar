---
id: T-1097
title: "Split apps/mobile/src/store/effects/groups.ts (586 lines): the GroupActions object moves to group-actions.ts behind a helpers parameter, pure relocation"
status: merged
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

### What I did
Pure relocation, as specified: the `GroupActions` object literal moved out of
`makeGroups` into a new `makeGroupActions(ctx, helpers)` in
`apps/mobile/src/store/effects/group-actions.ts`. The literal is byte-for-byte
the original apart from reading its closure names from the `helpers` parameter
(destructured at the top) and `get`/`h`/the `ports` slices/`run`/`coreCtx`/
`forkSession` from `ctx`. `makeGroups` builds the helpers as before and calls
`const actions = makeGroupActions(ctx, { … })`; the return value is unchanged.
`GroupActions` and `Groups` stay exported from `groups.ts` (no importer
changes); `group-actions.ts` imports `GroupActions` as a type from `./groups`.

Files changed:
- `apps/mobile/src/store/effects/groups.ts` (modified)
- `apps/mobile/src/store/effects/group-actions.ts` (new)
- `work/T-1097-split-mobile-store-effects-groups.md` (this report)

### Before / after line counts
| File | Before | After |
| --- | --- | --- |
| `apps/mobile/src/store/effects/groups.ts` | 586 | 281 |
| `apps/mobile/src/store/effects/group-actions.ts` | — (new) | 371 |

Both files are at most 400 lines.

### `GroupActionHelpers` fields
Read from the `helpers` parameter (destructured at the top of `makeGroupActions`):

| Field | Type |
| --- | --- |
| `groupDetails` | `Map<string, GroupDetail>` |
| `groupRolesById` | `Map<string, CustomGroupRole[]>` |
| `topicRolesById` | `Map<string, { roles: TopicRole[]; approverRole: ApproverRole \| null }>` |
| `bumpRevision` | `() => void` |
| `ensureGroupDetail` | `(groupId, force?) => Effect<void, never, Ports>` |
| `ensureGroupRoles` | `(groupId, force?) => Effect<void, unknown>` |
| `ensureTopicRoles` | `(chatId, force?) => Effect<void, unknown>` |
| `actionStore` | `() => GroupActionStore` |
| `applyTopicRow` | `(topic) => Effect<void, unknown>` |
| `joinRoomQuietly` | `(rowId) => Effect<void, never>` |
| `refreshQuietly` | `Effect<void, never, Ports>` |
| `removeTopicMemberEffect` | `(chatId, userId) => Effect<void, unknown, Ports>` |

Everything else the body needs (`get`, `h`, `ctx.ports.topics`,
`ctx.ports.inviteLinks`, `ctx.ports.roles`, `ctx.ports.groups`, `ctx.run`,
`ctx.coreCtx`, `ctx.forkSession`) is read from `ctx`, per the spec.

### Commands run (real results)
- `pnpm install`: `Done in 17.7s using pnpm v10.32.1` (peer-dependency warnings only).
- `pnpm --filter mobile test --maxWorkers=2 --reporter=dot src/store`:
  `Test Files 7 passed (7)` / `Tests 40 passed (40)`.
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.2s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.5s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### `git diff main -M --stat`
```
 apps/mobile/src/store/effects/groups.ts          | 339 ++---------------------
 docs/audit/simplify-status.md                    |  11 +-
 work/NOW.md                                      |  17 --
 work/T-1097-split-mobile-store-effects-groups.md |   2 +-
 4 files changed, 19 insertions(+), 350 deletions(-)
```
New file `apps/mobile/src/store/effects/group-actions.ts` is untracked and so
does not appear above (it is created by this task). `docs/audit/simplify-status.md`
and `work/NOW.md` are **not** my changes: they are already committed on this
branch ahead of `main` (`git status --short` shows only `groups.ts`,
`group-actions.ts` and this task file). The gate agrees: 3 changed files, all
inside the Allowed files.

### Deviations / problems
None. Pure relocation: no dedup, no renames, no other files touched.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** mobile `effects/groups.ts` goes from 586 to 281 lines. The `GroupActions` object moves to `group-actions.ts` (371 lines), as `makeGroupActions(ctx, helpers)` with a typed `GroupActionHelpers`. `makeGroups` returns the same shape.
- **The lead's line check,** sorted and ignoring indentation: the only differences are the helpers interface, the destructuring, `const actions =` replaced by `return {`, and the `ports` destructure split between the two files. Every action body is identical.
- **Tests:** the lead ran `vitest run src/store` on the branch, and all 7 files pass (40 tests). The gate passed too.
- **No phone smoke:** the bodies are unchanged and only their home moved.
