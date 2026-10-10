---
id: T-0923
title: "Store core phase 2c: the channel and group actions (create, leave, roles, settings, join, AIs, invite, archive, lists) in packages/client-core, both stores on them, tests first"
status: todo
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

## Review (written by Claude)
