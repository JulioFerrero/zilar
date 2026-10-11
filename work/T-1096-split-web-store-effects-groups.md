---
id: T-1096
title: "Split apps/web/src/store/effects/groups.ts (548 lines) into topics + group create + group settings, pure relocation"
status: todo
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

## Review (written by Claude)
