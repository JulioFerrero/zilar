---
id: T-1096
title: "Split apps/web/src/store/effects/groups.ts (548 lines) into topics + group create + group settings, pure relocation"
status: merged
milestone: M5
branch: task/T-1096-split-web-store-effects-groups
model: auto
effort: default
depends_on: [T-1093]
estimate: 0.2 day
---

# T-1096: Split the web `store/effects/groups.ts`

## Spec (written by Claude, do not edit)

### Why
- **The rule:** Julio's 400-line limit (2026-10-10).
- **The file:** `apps/web/src/store/effects/groups.ts` has 548 lines, all top-level functions that take `ctx`:
  - **shared helpers:** `groupIdOf` (`:48`), `groupTarget` (`:53`), `groupChangeStore` (`:64`), `topicRowStore` (`:74`), `applyTopicRow` (`:82`), `actionStore` (`:87`) and `joinRoomQuietly` (`:93`);
  - **topic effects:** `refreshGeneralTopic` (`:103`) through `leaveTopic` (`:242`);
  - **group creation:** `repaintCreatedGroup` (`:260`), `openCreatedGroup` (`:304`), `createChannel` (`:319`), `createGroup` (`:353`) and `createInvite` (`:544`);
  - **group settings:** `leaveChannel` (`:384`) through `removeGroupAi` (`:528`).
- **Why it can be split now:** it waited for the mock rebuild, which is done.
- **The plan:** `docs/audit/size-plan.md` §2.3 #64.

### What to build
1. **Move, unchanged:**
   - the topic effects (`:103-259`) to `apps/web/src/store/effects/topics.ts`;
   - the group creation (`:260-383` and `createInvite`) to `apps/web/src/store/effects/groupCreate.ts`;
   - the settings (`:384-543`) to `apps/web/src/store/effects/groupSettings.ts`.
2. **The shared helpers** (`:40-102`) go in `apps/web/src/store/effects/groupShared.ts`, exported for the three files. Put a helper in a single file instead when only that file uses it.
3. **`groups.ts` becomes a re-export barrel** of every name it exported before, so **no importer changes**.
4. **Constraints:**
   - this is a pure relocation: no dedup (the plan's `changeGroupSetting` is not part of this task) and no renames;
   - every file is at most 400 lines;
   - no other files change.
5. **The Report:** the before/after line counts, and the list of exported names before and after (`grep -c "^export"`, plus the names).

### Read first
`AGENTS.md`, `apps/web/src/store/effects/groups.ts`, and `apps/web/src/store/effects/ctx.ts`.

### Allowed files
`apps/web/src/store/effects/groups.ts`, `apps/web/src/store/effects/topics.ts`, `apps/web/src/store/effects/groupCreate.ts`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupShared.ts`, `work/T-1096-split-web-store-effects-groups.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass, including the web store tests that the gate runs.
- Every file is at most 400 lines.

---

## Report (written by the worker when done)

**Status:** review. Pure relocation, no behavior change.

### What I did
Split `apps/web/src/store/effects/groups.ts` (548 lines) into three topic modules plus a shared module, and
turned `groups.ts` into a re-export barrel:

- `groupShared.ts` — the shared helpers from `:47-100`.
- `topics.ts` — the topic effects (`:103-256`).
- `groupCreate.ts` — `repaintCreatedGroup`, `openCreatedGroup`, `createChannel`, `createGroup`, `createInvite`
  (`:258-379` and `:544-548`), plus the `CreateOptions` type it is the only user of.
- `groupSettings.ts` — `leaveChannel` … `removeGroupAi` (`:384-542`).
- `groups.ts` — barrel re-exporting every name it exported before. `realStore.ts` (the only importer) is unchanged.

### Line counts (before → after)
| file | before | after |
| --- | --- | --- |
| `groups.ts` | 548 | 27 |
| `topics.ts` | – | 176 |
| `groupCreate.ts` | – | 151 |
| `groupSettings.ts` | – | 177 |
| `groupShared.ts` | – | 73 |

Every file is ≤ 400 lines.

### Exported names
`grep -c "^export"`:
- before: `groups.ts` = 22 (all `export const`).
- after: `groups.ts` = 3 (`export { … } from` statements re-exporting the same 22 names).

Before and after name sets are identical (verified by diffing the sorted names):
`addGroupAi, addTopicAi, addTopicMember, changeChannelRole, createChannel, createGroup, createInvite, createTopic,
joinPublicGroup, leaveChannel, leaveTopic, patchTopic, refreshGeneralTopic, refreshTopicRow, removeGroupAi,
removeTopicAi, removeTopicMember, setGroupBackground, setGroupListener, setGroupVisibility,
setMembersCanCreateTopics, setTopicRoles`.

`groupShared.ts` additionally exports the helpers shared across the new modules: `groupIdOf`, `groupChangeStore`,
`applyTopicRow`, `actionStore`, `joinRoomQuietly`. `groupTarget` and `topicRowStore` are used only inside
`groupShared.ts`, so they stay module-private (spec: "put a helper in a single file when only that file uses it").

### Commands (real results)
- `pnpm install` — ok, 1172 packages, done in 25s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.lifecycle.test.tsx` —
  `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` — summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.0s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/web  (4.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 6 changed files are the 5 effect modules plus this task file; nothing outside Allowed files.

### Deviations / notes
- `docs/audit/size-plan.md` §2.3 #64 maps the helpers into `topics.ts` / `groupSettings.ts` with no
  `groupShared.ts`; the task spec names `groupShared.ts` and lists it under Allowed files, so I followed the task
  spec and put the cross-module helpers there. No importer changes, no dedup, no renames.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** web `effects/groups.ts` goes from 548 lines to a 27-line barrel, with `topics.ts` (176), `groupCreate.ts` (151), `groupSettings.ts` (177) and `groupShared.ts` (73). Every old export is still available from `groups.ts`.
- **The lead's line check,** sorted and ignoring indentation: the only differences are the new header comments, the shared helpers gaining `export`, and the import lists. Every function body is identical.
- **Tests:** the lead ran `vitest run src/store` on the branch, and all 41 tests pass. The gate passed too.
