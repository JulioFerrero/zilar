---
id: T-0923
title: "Store core phase 2c: the channel and group actions (create, leave, roles, settings, join, AIs, invite, archive, lists) in packages/client-core, both stores on them, tests first"
status: merged
milestone: M5
branch: task/T-0923-store-core-group-actions-2
model: auto
effort: default
depends_on: [T-0921]
estimate: 1 day
---

# T-0923: Store core phase 2c, channel and group actions

## Spec (written by Claude, do not edit)

### Why
T-0921 (merged) moved the topic actions into `packages/client-core/src/store/group-actions.ts` and stopped under the 800-line split rule. This task moves the rest, as T-0921's Report lists:
- **channels and groups:** `createChannel`, `createGroup`, `leaveChannel`, `changeChannelRole`;
- **group settings:** `setMembersCanCreateTopics`, `setGroupBackground`, `setGroupListener`, `setGroupVisibility`;
- **joining, AIs and invites:** `joinPublicGroup`, `addGroupAi`, `removeGroupAi`, `createInvite`;
- **the topic leftovers that still use mobile's local `topicIdFor`:** `archiveTopic`, `listTopicMembers`, `listTopicAis`.

They live in `apps/web/src/store/effects/groups.ts` and in the `actions` object of `apps/mobile/src/store/effects/groups.ts`. Re-check the lines with grep, because T-0921 moved them.

R15 (plan section 2.3): web's create opens the chat and returns its JID; mobile's returns the group id. Keep the per-app facades.

### What to build
1. **Tests first,** committed on the old code. Add cases to T-0921's test files, which are new files and so not "existing tests":
   - `apps/web/src/store/realStore.group-actions.test.tsx`;
   - `apps/mobile/src/store/real-store.group-actions.test.ts`.

   Cover each action above, plus one failing action with its error text.
2. **Core:** extend `group-actions.ts` and its test.
3. **Both stores:** thin facades. Delete mobile's local `topicIdFor` once nothing uses it (`apps/mobile/src/store/effects/groups.ts`), and fix the stale comment at `apps/web/src/store/effects/groupMembers.ts:57` (T-0921's nits).
4. **No behaviour change.** List any per-app difference you keep. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), the Report of `work/T-0921-store-core-group-actions.md`, `packages/client-core/src/store/group-actions.ts` with its test, and both groups effect files.

### Allowed files
`packages/client-core/src/store/group-actions.ts`, `packages/client-core/src/store/group-actions.test.ts`, `packages/client-core/src/store/groups.ts`, `packages/client-core/src/store/index.ts` (Phase 2 section only), `apps/web/src/store/effects/groups.ts`, `apps/web/src/store/effects/groupMembers.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts` (wiring only), `apps/web/src/store/realStore.group-actions.test.tsx`, `apps/mobile/src/store/effects/groups.ts`, `apps/mobile/src/store/real-store.group-actions.test.ts`, `work/T-0923-store-core-group-actions-2.md`.

T-0922 changes the send files, the core `ports.ts` and `ctx.ts`, and mobile `real-store.ts` and `runtime.ts` in parallel. Do not touch them.

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
- The test commit comes before the move.
- No existing test is edited.
- The Report gives the lines per side.
- Live check for Julio: create a group and a channel, change channel roles and group settings, join a public group, add and remove group AIs, and invite, on web and mobile.

---

## Report (written by the worker when done)

**Scope: the rest of the group/channel actions (phase 2c).** Re-checked with grep, as the spec asked: the listed actions are **not** all in both stores. `createChannel`, `createGroup`, `leaveChannel` and `changeChannelRole` are in both. The four group settings, `joinPublicGroup`, `addGroupAi`, `removeGroupAi` and `createInvite` are **web-only** (mobile runs them from screens, not the store). `archiveTopic`, `listTopicMembers` and `listTopicAis` are **mobile-only**. I moved each app's existing copy to core and deleted mobile's local `topicIdFor`. Per-app differences are kept (R15): web's create opens the chat and returns its JID, mobile's returns the group id; web's list refresh throws, mobile's is quiet.

**Commits (in order)**
1. `f4300b07` tests first, on the old code: web `realStore.group-actions.test.tsx` (+10 tests, 17 total) and mobile `real-store.group-actions.test.ts` (+7 tests, 14 total). Both passed on the old code (I ran them: web 17 passed, mobile 14 passed).
2. the move commit (this one): the core effects below and both stores on them.

**What I did**
- **Core** `packages/client-core/src/store/group-actions.ts` (+161/-5): five new shared effects over `CoreCtx` and the app adapter —
  - `leaveChannel(store, refreshList, chatId)`: resolve group + caller or fail `'This channel is not available yet.'`, remove, then the app's refresh.
  - `changeGroup(store, chatId, notAvailable, call, refresh)`: resolve the group and domain, call the route, apply the detail (or `reloadDetail` for mobile), optionally refresh the list. Web's settings/AIs/channel role and mobile's channel role run on it.
  - `createGroupChannel(store, notFound)`: call the app's create, repaint/locate the new row, open the chat, answer the id. Web requires the row and opens the chat JID; mobile answers the group id and opens nothing (R15).
  - `joinPublicGroup(ctx, store, groupId)`: join, refresh, answer the General chat id.
  - `createInvite(create)`: answer the invite URL.
- **Web** `effects/groups.ts` (+114/-110): `createChannel`, `createGroup`, `leaveChannel`, `changeChannelRole`, the four settings, `joinPublicGroup`, `addGroupAi`, `removeGroupAi` and `createInvite` are thin facades over the core. Removed the local `resolveGroup` and `createAndOpen`/`changeGroup`; kept the repaint (R15) and `openCreatedGroup` as the web hooks.
- **Web** `effects/groupMembers.ts` (+2/-2) and `effects/ctx.ts` (+1/-1): fixed the stale comment — the loading set is now only group-keyed, so "also serves chat-keyed loads" (and the `ctx.ts` field comment "by chat id or group id") no longer held.
- **Mobile** `effects/groups.ts` (+91/-83): `createChannel`, `createGroup`, `leaveChannel`, `changeChannelRole` delegate to the core; `archiveTopic`, `listTopicMembers` and `listTopicAis` now use the core `topicIdFor` instead of the local one, which is deleted. Mobile's input validation stays in its `create` hook.

**Tests**
- New cases, tests first: core `group-actions.test.ts` +11 (22 total); web `realStore.group-actions.test.tsx` +10 (17 total); mobile `real-store.group-actions.test.ts` +7 (14 total). Every action above is covered, plus a failing action with its error text (web `'Could not change the role.'`; mobile `'Could not create the channel.'` and the empty-title validation).
- No existing test was edited (T-0921's two files were new; I only added cases).

**Per-app differences kept (no behaviour change)**
- **create (R15):** web repaints the list, requires the new row (fails `'the new group/channel did not appear in the chat list'`), joins the room, loads members and opens the chat, returning the chat JID; mobile trims/validates the title and description, refreshes quietly, returns the group id and opens nothing.
- **leaveChannel refresh:** web `refreshChatsOrThrow`, mobile `refreshQuietly`.
- **changeChannelRole:** web repaints the detail from the response and refreshes the list; mobile reloads the detail (`ensureGroupDetail(force)`) + revision bump, then refreshes quietly.
- **topic leftovers:** mobile's `archiveTopic` stays best-effort (`orElse(applyTopicRow, undefined)` + quiet refresh); only the id comes from the core `topicIdFor`, so the flow is unchanged.
- No other difference found.

**Checks (real results)**
- Store tests, 3 runs (single files): core `group-actions.test.ts` 22 passed ×3; web `realStore.group-actions.test.tsx` 17 passed ×3; mobile `real-store.group-actions.test.ts` 14 passed ×3.
- `pnpm --filter @zilar/web typecheck` and `pnpm --filter @zilar/mobile typecheck` pass (run while wiring the facades).
- `pnpm gate` (repo root): `gate: 9 changed file(s) against main`; `PASS install (frozen) 1.0s`, `PASS format 1.2s`, `PASS lint 0.9s`, `PASS typecheck 4.6s`, `PASS effect 0.8s`, `PASS tests @zilar/client-core 1.2s`, `PASS tests @zilar/mobile 1.2s`, `PASS tests @zilar/web 1.4s`; `scope: every changed file is inside the Allowed files`; ends `GATE PASS`.
- `pnpm exec prettier --write` on every changed file: only the mobile test file needed a reflow (it was fixed and the gate then passed).

**Lines per side (merge-base 8a2f24ba)**
- Core: `group-actions.ts` +161/-5, `group-actions.test.ts` +205/-2 = **+366/-7**.
- Web: `effects/groups.ts` +114/-110, `effects/groupMembers.ts` +2/-2, `effects/ctx.ts` +1/-1 = **+117/-113**; test `realStore.group-actions.test.tsx` +143.
- Mobile: `effects/groups.ts` +91/-83; test `real-store.group-actions.test.ts` +121/-2.
- Total **+838/-205** (test files included).

**Deviations / open questions**
- The spec lists the four group settings, `joinPublicGroup`, `addGroupAi`, `removeGroupAi` and `createInvite` as present in both stores, but mobile has them in screens (`directory-api`, the topics switch API, the invite sheet), not in the store. I moved each app's existing copy to core; mobile had nothing to move for those. Not a behaviour change.
- `joinPublicGroup` and `createInvite` end up as single-caller core effects (web only), like T-0921's `refreshTopicRow`; they are in core because the spec lists them.

**Live check for Julio:** on web, create a group and a channel, change a channel role and the group settings, join a public group, add/remove a group AI, and create an invite; on mobile, create a group and a channel, change a channel role, leave a channel, and archive a topic.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 3 nits.**
- **The move:** the channel and group-detail actions, joining and invites are in core `group-actions.ts`. The stores keep thin facades, and the behaviour is unchanged.
- **Tests first:** the tests are committed before the move.
- **Finding:** mobile keeps some of these actions in screens (`directory-api`, the topics switch, invite) instead of the store, so they are not in both stores. Moving the screens onto the store is a follow-up.
- **Nits:**
  - a dead `?? ''` at `apps/web/src/store/effects/groups.ts:344,377`;
  - `changeGroup` runs both apply and reload when both are set, while its comment says "or";
  - the facade tests check the call, and the core tests check the repaint.
- **Check:** the combined check passes.
- **Live check for Julio:** create a group and a channel, change channel roles and group settings, join a public group, change group AIs, and invite, on web and mobile.
