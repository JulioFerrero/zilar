---
id: T-0920
title: "Store core phase 2a: one GroupDetail type, a per-group detail cache and applyTopicRow in packages/client-core, both stores on them, tests first"
status: merged
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

**Commits (in order)**
1. `df15d279` tests first, on the old code: web `realStore.groups.test.tsx` (3 guards) and mobile `real-store.group-detail.test.ts` (4 guards). Both passed on the old code.
2. `8cd620cd` the new expectations (both failed on the old code): web "loads the group detail once for two topics of the same group (R14)" (`getGroup` was called twice before the move) and mobile "drops an archived topic row (R17)" (the row stayed before the move).
3. `2adcff78` the move.

**What I did**
- **Core** (`packages/client-core/src/store/groups.ts`, new):
  - `ensureGroupDetail(api, store, groupId, force)`: a per-group detail cache behind a `cached`/`isLoading`/`begin`/`finish`/`publish` adapter. A cached detail returns without a request, an in-flight load is not started twice, `force` re-fetches an already cached group, and a failure is swallowed (the caller gets `undefined`). Generic over the detail type `D`, so each app keeps its own shape (like `pins.ts`/`prefs.ts` take their app row type).
  - `applyTopicRow(ctx, store, topic)`: re-reads `/api/chats`, drops an archived topic row, keeps a live row's local `lastMessage`/`unread`/`online`/`onlineCount`, and re-applies the saved chat prefs through `applyChatPrefs`.
  - One line added to the Phase 2 section of `index.ts`.
- **Web**: `effects/groupMembers.ts` `ensureGroupMembers` binds the core cache over the existing chat-keyed `groupInfos` (the cache is read by `detail.id`, the in-flight marks share `loadingGroupMembers`, and publish fills every row of the group, so a caller that shares an in-flight GET still gets its own chat-keyed entry). `effects/groups.ts` `applyTopicRow` is now the core function with a web `TopicRowStore` (`/api/chats` + `chatPrefs`). `groupInfos`/`groupMembers` stay keyed by chat id for the screens. Facades and existing tests unedited.
- **Mobile**: `effects/groups.ts` `ensureGroupDetail`/`ensureGroupMembers` bind the core cache over the store's group-keyed `groupDetails`/`loadingGroupDetails`; the `Deferred` waiter map is gone (publish fills every row of the group). `applyTopicRow` is the core function with a mobile `TopicRowStore`. `lib/chat-api.ts` drops its hand-written `GroupDetail`/`GroupMember`/`GroupAi` and derives them from the API contract.

**Behaviour**
- **R14:** web now loads a group detail once for every topic row of the group (it was once per chat id). Mobile was already per group. No visible change.
- **R17:** both apps drop an archived topic row and re-apply the saved prefs; mobile used to keep the archived row. A server list already excludes archived topics, so the drop matches what the next refresh would show.

**One GroupDetail type — the differences found**
- The contract `GroupMember.handle` is `string | null` (the wire sends `null` when unset); mobile's old type had `handle?: string`. Mobile `real-store.ts:465` and the mock `chat-store.ts:543` build a `MentionMember` (`handle?: string`) from `member.handle`, so the raw contract member does not typecheck there, and neither file is in the Allowed list. I kept the contract shape and narrowed that one field: mobile `GroupMember = Omit<ContractGroupMember,'handle'> & { handle?: string }`, `GroupDetail = Omit<ContractGroupDetail,'members'> & { members: GroupMember[] }`, `GroupAi = ContractGroupAi`. The generic core cache lets the two shapes interoperate.
- Extra contract fields mobile lacked (`background`, `listener`, `visibility`, `handle`, `avatarUrl`, `createdAt`, and `GroupMember.roles?`) are tolerated as optional; mobile already reads `roles` through `?? []`.
- No field differs in meaning; the only difference is the `handle` nullability above.

**Lines per side** (`git diff --numstat main`, source unless noted)
- Core: `groups.ts` +128, `index.ts` +2 = **+130**; tests `groups.test.ts` +209.
- Web: `groupMembers.ts` +51/-16, `groups.ts` +13/-35, `ctx.ts` +1/-1 = **+65/-52**; tests `realStore.groups.test.tsx` +174.
- Mobile: `effects/groups.ts` +55/-119, `lib/chat-api.ts` +16/-35 = **+71/-154 (net -83)**; tests `real-store.group-detail.test.ts` +179.

**Checks (real results)**
- `pnpm gate` (repo root): `gate: 11 changed file(s) against main`; `PASS install (frozen) 1.0s`, `PASS format 1.1s`, `PASS lint 0.5s`, `PASS typecheck 3.9s`, `PASS effect 0.9s`, `PASS tests @zilar/client-core 4.1s`, `PASS tests @zilar/mobile 2.1s`, `PASS tests @zilar/web 1.7s`; `scope: every changed file is inside the Allowed files`; ends `GATE PASS`.
- Store suites, 3 runs each: client-core `16 files, 157 passed` ×3; web `src/store` `23 files, 251 passed` ×3; mobile `src/store src/lib` `121 passed | 1 skipped, 1105 passed | 1 skipped` ×3.
- Single files while working: core `groups.test.ts` (10 passed); web `realStore.groups.test.tsx` (4) + `realStore.test.tsx`/`realStore.topics.test.tsx`/`reload.test.tsx` (159); mobile `real-store.group-detail.test.ts` (5) + `real-store.test.ts`/topics/general-only/topics-screen/selector-stability (108) + `src/lib` (763).
- `pnpm --filter @zilar/{client-core,web,mobile} typecheck` pass; `pnpm exec prettier --write` and `pnpm exec oxlint` on every changed file are clean.

**Deviations / things to flag**
- Mobile `loadingGroupMembers` (declared in `effects/runtime.ts`, filled in `real-store.ts`) now has no reader: the core's per-group in-flight marks replace it. Removing it needs `real-store.ts`/`runtime.ts`, which T-0918 owns, so I left it in place.
- Mobile's `GroupDetail` is the contract type with one field narrowed (the `handle` above), not the verbatim contract type. If the lead wants the raw contract type, the two `MentionMember` sites in `real-store.ts`/`chat-store.ts` need `member.handle ?? undefined`.
- The core `ensureGroupDetail` is generic over the detail type (so the ledger's contract type and mobile's normalized type both fit), following the `prefs.ts`/`pins.ts` pattern.

**Live check for Julio (web and mobile):** group and topic screens, member lists, and archiving a topic, on web and mobile.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 3 nits and 1 follow-up.**
- **The move:** `packages/client-core/src/store/groups.ts` holds the per-group detail cache and `applyTopicRow`, and both stores bind to it. Mobile uses the contract `GroupDetail`, and no field differs in meaning.
- **Tests first:** guards, then the R14 and R17 expectations, then the move.
- **Behaviour:**
  - R14: web loads a group's detail once for all its topics;
  - R17: mobile drops an archived topic row and keeps prefs.
- **Follow-ups for the groups-actions task:**
  - delete the now-dead mobile `loadingGroupMembers` (`effects/runtime.ts`, `real-store.ts`);
  - the shared web loading set relies on group ids and chat ids never colliding.
- **Check:** the combined check passes.
- **Live check for Julio:** group and topic screens, member lists, and archiving a topic, on web and mobile.
