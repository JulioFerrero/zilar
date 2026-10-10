---
id: T-0921
title: "Store core phase 2b: the group, topic and channel actions (create, patch, members, AIs, roles, leave, settings, join, invite) in packages/client-core, both stores on them, tests first"
status: merged
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

**Scope: the split rule fired.** The full task (topics + channels/groups + settings + join/AI/invite, both apps, tests first) is far past the ~800-line cap. I did the topic half only, per spec item 6, and stopped before the group/channel/settings half so the lead can chain it. The diff is **+1037 / -160** (see lines per side), so the split is the cap, not an accident.

**Commits (in order)**
1. `f54c14b1` tests first, on the old code: web `realStore.group-actions.test.tsx` (7 tests) and mobile `real-store.group-actions.test.ts` (7 tests). Both passed on the old code (I ran them: web 7 passed, mobile 7 passed).
2. the move commit: `packages/client-core/src/store/group-actions.ts` and both stores on it.

**What I did**
- **Core** (`packages/client-core/src/store/group-actions.ts`, new, +155): the shared topic effects over `CoreCtx` and the app adapter.
  - `topicIdFor(ctx, store, chatId)`: the topic id and group id of the chat's topic (row first, then the store's remembered map), with web/mobile's exact `'This topic is not available yet.'` failure.
  - `changeTopic(ctx, store, chatId, call, before?)`: resolve the topic, call the route, run the app `before` hook, repaint the row through the T-0920 `applyTopicRow` (R17).
  - `createTopic(ctx, store, chatId, create)`: resolve the group, create, optional `rememberTopic`, `apply`, find the new row, optional `requireRow` failure (`'the new topic did not appear in the chat list'`), `fallbackRowId`, `joinRoom`, and answer the row id.
  - `leaveTopic(ctx, store, hooks, chatId)`: `currentUserId` guard, `Effect.exit(removeMember(...))`, and web's 404 rule (`isNotFound` → `refreshTopicRow` → `refreshChats` → silent) with mobile passing `isNotFound: () => false`.
  - One line in the Phase 2 section of `index.ts`.
- **Web** (`effects/groups.ts`, +71/-76): `createTopic`, `patchTopic`, `addTopicAi`, `removeTopicAi`, `addTopicMember`, `removeTopicMember`, `setTopicRoles` and `leaveTopic` are now thin facades over the core, keeping Ports for the route and the web-only hooks (`ctx.quietArchiveIds`, `refreshTopicRow`, `refreshChats`, `openHistory`, `joinRoomQuietly`). Removed the local `topicIdFor` and `changeTopic`. `refreshGeneralTopic` and `refreshTopicRow` stay in web (see deviations).
- **Web follow-up** (`effects/groupMembers.ts`, +8/-4): the shared `loadingGroupMembers` set keys group loads under `group:<id>`, so a group id can never collide with a chat id.
- **Mobile** (`effects/groups.ts`, +91/-76): the same eight actions delegate to the core; the app hooks are `h.groupIdForChat`, `h.rememberTopicRoles`, `orElse(applyTopicRow(...))` (best-effort apply), `topic.chatJid` fallback and `joinRoomQuietly`. `removeTopicMember` keeps its `failAfter(..., refreshQuietly)` wrapper, and `leaveTopic` reuses that wrapper as `removeMember`.
- **Mobile follow-up**: the dead `loadingGroupMembers` is gone (`effects/runtime.ts` field, `real-store.ts` declaration and `s` wiring).

**Tests**
- New: `packages/client-core/src/store/group-actions.test.ts` (11), `apps/web/src/store/realStore.group-actions.test.tsx` (7), `apps/mobile/src/store/real-store.group-actions.test.ts` (7). Cover create topic, patch, add/remove member, add/remove AI, set roles, leave topic, and a failing write that surfaces the error.
- No existing test was edited.

**Per-app differences (kept, not unified)**
- **createTopic (R15):** web requires the new row in the list, joins the room and calls `openHistory` (opens it); mobile returns the row id, remembers the topic roles, swallows a failed re-read and falls back to the response's `chatJid`.
- **patchTopic:** web marks a deliberate self-archive quiet (`quietArchiveIds`); mobile remembers the topic roles. (Unified under the core `before` hook.)
- **setTopicRoles:** mobile remembers the topic roles; web has no topic-roles cache.
- **removeTopicMember:** mobile refreshes the list quietly on failure (`failAfter`); web rethrows so the caller re-checks the row.
- **leaveTopic:** web re-checks a 404 and swallows only when the topic really left; mobile just propagates the remove failure (its `removeTopicMember` already refreshed).
- No other behaviour difference was found.

**Deviations**
- **Split (spec item 6):** stopped after the topic actions. Not moved, left for the chained task: channels/groups (`createChannel`, `createGroup`, `leaveChannel`, `changeChannelRole`), group settings (`setMembersCanCreateTopics`, `setGroupBackground`, `setGroupListener`, `setGroupVisibility`), join/AI/invite (`joinPublicGroup`, `addGroupAi`, `removeGroupAi`, `createInvite`), and the new tests for them.
- `refreshGeneralTopic` and `refreshTopicRow` stay in `apps/web/src/store/effects/groups.ts`. They are web-only navigation helpers over web's `refreshChats`/`refreshChatsOrThrow` and have no mobile action object entry, so moving them would put web-only code in core with no second store. Flagging it for the lead.
- Mobile's `archiveTopic`, `listTopicMembers`, `listTopicAis`, the roles CRUD, invite-link actions and `setMembersCanCreateTopics` are not listed in the spec and were left as they are.

**Checks (real results)**
- `pnpm gate` (repo root): `gate: 11 changed file(s) against main`; `PASS install (frozen) 1.0s`, `PASS format 1.1s`, `PASS lint 1.0s`, `PASS typecheck 3.7s`, `PASS effect 0.8s`, `PASS tests @zilar/client-core 3.7s`, `PASS tests @zilar/mobile 5.8s`, `PASS tests @zilar/web 1.4s`; `scope: every changed file is inside the Allowed files`; ends `GATE PASS`.
- Store tests 3 runs (per spec): core `group-actions.test.ts` 11 passed ×3; web `realStore.group-actions.test.tsx` 7 passed ×3; mobile `real-store.group-actions.test.ts` 7 passed ×3.
- Single tests while working: web `realStore.group-actions.test.tsx` passed, plus `realStore.groups.test.tsx` + `realStore.topics.test.tsx` 26 passed; mobile `real-store.group-actions.test.ts` passed, plus `real-store.topics`/`group-detail`/`roles`/`channels`/`topics-screen` 36 passed.
- `pnpm --filter @zilar/{client-core,web,mobile} typecheck` pass; `pnpm exec prettier --write` on every changed file.

**Lines per side (merge-base diff; tests first + move)**
- Core: `group-actions.ts` +155, `group-actions.test.ts` +272, `index.ts` +2 = **+429**.
- Web: `effects/groups.ts` +71/-76, `effects/groupMembers.ts` +8/-4 = **+79/-80**; test `realStore.group-actions.test.tsx` +214.
- Mobile: `effects/groups.ts` +91/-76, `effects/runtime.ts` 0/-1, `real-store.ts` 0/-2 = **+91/-79**; test `real-store.group-actions.test.ts` +224.
- Total **+1037 / -160** (includes the two test files from the tests-first commit).

**Live check for Julio (this half):** create a topic, patch it, add/remove a member and an AI, set roles, and leave a topic, on web and mobile.

## Review (written by Claude)

**Lead, 2026-10-10: approved for the topic half. The rest is chained to T-0923 under the split rule.**
- **The move:** the topic actions are in `packages/client-core/src/store/group-actions.ts`: create, patch, AIs, members, roles, refresh and leave. Both stores keep their facades.
- **Tests first:** the tests are committed before the move.
- **Behaviour:** none changed. The per-app differences are kept, as listed in the Report.
- **T-0920 follow-ups done:**
  - the dead mobile `loadingGroupMembers` is gone;
  - web's loading set keys groups as `group:`.
- **Nits for T-0923:**
  - mobile's local `topicIdFor` still serves `archiveTopic`, `listTopicMembers` and `listTopicAis`;
  - a stale comment at `apps/web/src/store/effects/groupMembers.ts:57`.
- **Check:** the combined check passes.
- **Live check for Julio:** create a topic, change its members, AIs and roles, and leave it, on web and mobile.
