---
id: T-0920
title: "Store core phase 2a: one GroupDetail type, a per-group detail cache and applyTopicRow in packages/client-core, both stores on them, tests first"
status: todo
milestone: M5
branch: task/T-0920-store-core-group-detail
model: auto
effort: default
depends_on: [T-0919]
estimate: 1 day
---

# T-0920: Store core phase 2a, group detail and topic rows

## Spec (written by Claude, do not edit)

### Why
This is the first half of the groups item of phase 2 in `docs/STORE_CORE_PLAN.md` (section 9). The second half, the create, role, invite and member actions, is a later task.

The behaviour rows are in section 2.3. The lead re-checked the code on main on 2026-10-10.
- **R14 (group detail cache).**
  - Web caches per chat: `apps/web/src/store/effects/groupMembers.ts:40-46` sets `groupMembers` and `groupInfos` by `chatId`.
  - Mobile caches per group: `apps/mobile/src/store/effects/groups.ts:73` holds `groupDetails`, with the fetch at `:128-136` and a `groupDetailsRevision` bump at `:85`. One GET serves every topic row.
  - The plan picks mobile.
- **R17 (`applyTopicRow` on an archived topic).**
  - Web drops the row: `apps/web/src/store/effects/groups.ts:49-61`, with the archived check at `:61`.
  - Mobile keeps it and applies prefs: `apps/mobile/src/store/effects/groups.ts:265`.
  - The plan picks web's drop plus mobile's prefs.
- **One `GroupDetail` type.** The contract has it (`packages/api-contract/src/groups.ts:120-137`), and web re-exports it (`apps/web/src/lib/api.ts:168`). Mobile still declares its own `GroupDetail` (`apps/mobile/src/lib/chat-api.ts:70-82`).

### What to build
1. **Tests first,** committed on the old code:
   - web: a new `apps/web/src/store/realStore.groups.test.tsx`;
   - mobile: a new `apps/mobile/src/store/real-store.group-detail.test.ts`.

   They cover a group detail load, two topic rows of the same group, a member list shown in a topic, and an archived topic arriving in a topic update. Then one failing commit with the new expectations:
   - web loads the group detail once for two topics of the same group (R14);
   - mobile drops an archived topic row (R17).
2. **One type:** mobile `apps/mobile/src/lib/chat-api.ts` uses the contract `GroupDetail` instead of its own. The contract type has `background` and other fields mobile lacks, so make the mobile code tolerate them. If a field differs in meaning, stop and report it.
3. **Core:** a new `packages/client-core/src/store/groups.ts` with a per-group detail cache (fetch once per group id; a forced refresh re-fetches) and `applyTopicRow` with the R17 rule. Add a test file, and lines in the Phase 2 section of `index.ts`.
4. **Both stores bind to it.** On web, `groupInfos` and `groupMembers` stay keyed by chat id for the screens, filled from the per-group cache. Facades and existing tests stay unedited.
5. **Behaviour:** R14 and R17 only.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2.3 and 9, `packages/client-core/src/store/*`, the two groups effect files and `apps/web/src/store/effects/groupMembers.ts` with their tests, and `apps/mobile/src/lib/chat-api.ts`.

### Allowed files
`packages/client-core/src/store/groups.ts`, `packages/client-core/src/store/groups.test.ts`, `packages/client-core/src/store/index.ts` (Phase 2 section only), `apps/web/src/store/effects/groups.ts`, `apps/web/src/store/effects/groupMembers.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.groups.test.tsx`, `apps/mobile/src/store/effects/groups.ts`, `apps/mobile/src/store/real-store.group-detail.test.ts`, `apps/mobile/src/lib/chat-api.ts`, `work/T-0920-store-core-group-detail.md`.

T-0918 changes the mobile polling, lifecycle, ports, runtime and `real-store.ts` in parallel. Do not touch them.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store src/lib
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
- The Report gives the lines per side and the type differences found.
- Live check for Julio: group and topic screens, member lists, and archiving a topic, on web and mobile.

---

## Report (written by the worker when done)

## Review (written by Claude)
