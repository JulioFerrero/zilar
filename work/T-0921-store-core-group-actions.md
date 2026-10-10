---
id: T-0921
title: "Store core phase 2b: the group, topic and channel actions (create, patch, members, AIs, roles, leave, settings, join, invite) in packages/client-core, both stores on them, tests first"
status: todo
milestone: M5
branch: task/T-0921-store-core-group-actions
model: auto
effort: default
depends_on: [T-0920]
estimate: 1.5 day
---

# T-0921: Store core phase 2b, group, topic and channel actions

## Spec (written by Claude, do not edit)

### Why
This is the second half of the groups item of phase 2 in `docs/STORE_CORE_PLAN.md` (section 9). T-0920 (merged) put the per-group detail cache and `applyTopicRow` in `packages/client-core/src/store/groups.ts`.

The actions are still written twice. The lead listed them on main on 2026-10-10.
- **Web, `apps/web/src/store/effects/groups.ts`:**
  - topics: `refreshGeneralTopic` `:112`, `createTopic` `:123`, `patchTopic` `:149`, `addTopicAi` and `removeTopicAi` `:171-181`, `addTopicMember` and `removeTopicMember` `:191-205`, `setTopicRoles` `:215`, `refreshTopicRow` `:229`, `leaveTopic` `:239`;
  - channels and groups: `createChannel` `:331`, `createGroup` `:360`, `leaveChannel` `:386`, `changeChannelRole` `:403`;
  - group settings: `setMembersCanCreateTopics` `:440`, `setGroupBackground` `:459`, `setGroupListener` `:478`, `setGroupVisibility` `:498`;
  - joining, AIs and invites: `joinPublicGroup` `:519`, `addGroupAi` and `removeGroupAi` `:532-549`, `createInvite` `:566`.
- **Mobile, `apps/mobile/src/store/effects/groups.ts`:** the same actions sit in the `actions: GroupActions` object from `:313`, with `topicIdFor` at `:297`, `ensureGroupRoles` at `:157` and `ensureTopicRoles` at `:183`.

R15 in plan section 2.3: web's create opens the chat and returns its JID, while mobile's returns the group id and does not open it. Navigation differs, so keep per-app facades over a shared core action.

### What to build
1. **Tests first,** committed on the old code, for each action group:
   - web: a new `apps/web/src/store/realStore.group-actions.test.tsx`;
   - mobile: a new `apps/mobile/src/store/real-store.group-actions.test.ts`.

   Cover: create a topic, a group and a channel; patch a topic; add and remove a member and an AI; set roles; leave a topic and a channel; the four group settings; joining a public group; and an action that fails, showing the error each app shows today.
2. **Core:** extend `packages/client-core/src/store/groups.ts` (or add `group-actions.ts`) with the shared action Effects over the core ports and ctx. Add their tests, and lines in the Phase 2 section of `index.ts`.
3. **Both stores:** their action functions become thin facades: web opens the chat, mobile returns the group id (R15). The facade names and signatures stay.
4. **T-0920's follow-ups:**
   - delete the dead mobile `loadingGroupMembers` (declared in `apps/mobile/src/store/effects/runtime.ts`, built in `real-store.ts`);
   - give web's shared loading set separate keys for group ids and chat ids (`apps/web/src/store/effects/groupMembers.ts:60`).
5. **No behaviour change.** If an action behaves differently between the apps beyond R15, list it in the Report and keep each app's current behaviour, behind a flag if needed. No existing test is edited.
6. **Split rule:** if the diff passes about 800 lines, stop after the topic actions, report, and the lead will chain the rest.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2.3 and 9, the Report of `work/T-0920-store-core-group-detail.md`, `packages/client-core/src/store/*`, and both groups effect files with their tests.

### Allowed files
`packages/client-core/src/store/groups.ts`, `packages/client-core/src/store/group-actions.ts`, `packages/client-core/src/store/groups.test.ts`, `packages/client-core/src/store/group-actions.test.ts`, `packages/client-core/src/store/index.ts` (Phase 2 section only), `apps/web/src/store/effects/groups.ts`, `apps/web/src/store/effects/groupMembers.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts` (wiring only), `apps/web/src/store/realStore.group-actions.test.tsx`, `apps/mobile/src/store/effects/groups.ts`, `apps/mobile/src/store/effects/runtime.ts` (only the `loadingGroupMembers` removal), `apps/mobile/src/store/real-store.ts` (only the `loadingGroupMembers` removal and wiring), `apps/mobile/src/store/real-store.group-actions.test.ts`, `work/T-0921-store-core-group-actions.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the store tests 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and each per-app difference.
- Live check for Julio: create a topic, a group and a channel; change roles; invite; leave; and change group settings, on web and mobile.

---

## Report (written by the worker when done)

## Review (written by Claude)
