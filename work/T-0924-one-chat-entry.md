---
id: T-0924
title: "Store core phase 2d: one ChatEntry schema in packages/api-contract and one summariesFor in packages/client-core, both apps on them, mobile's lenient parsing kept, tests first"
status: todo
milestone: M5
branch: task/T-0924-one-chat-entry
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0924: One ChatEntry schema and one summariesFor

## Spec (written by Claude, do not edit)

### Why
This is the phase 2 item "One `ChatEntry` schema ... and one `summariesFor` (F1g)" in `docs/STORE_CORE_PLAN.md:431`. The lead read main on 2026-10-10.

- **The contract does not describe an entry.** `packages/api-contract/src/chats.ts:14-16` declares `ChatList.chats` as `Schema.Array(Schema.Unknown)`. The comment at `:4-8` explains why: each client validates entries with its own schema.
- **Web's schema:** `apps/web/src/lib/api.ts` has `dmEntrySchema` `:90`, `groupEntrySchema` `:110`, `chatEntrySchema` `:141`, and `ChatEntry` `:143`.
- **Mobile's type:** `apps/mobile/src/lib/chat-api.ts` hand-writes `ChatEntry` at `:29` and parses leniently in `parseChatEntry` `:235` (used at `:316`).
- **Two `summariesFor`:**
  - web: `apps/web/src/store/effects/chatRows.ts:163`;
  - mobile: `summariesForTopicsEntry` at `apps/mobile/src/lib/topics.ts:98`, wrapped by `summariesFor` at `apps/mobile/src/store/real-store.ts:102`.
- **They differ (plan row at `docs/STORE_CORE_PLAN.md:42`):** web rows carry `visibility`, `handle`, `avatarUrl` and `groupBackground`; mobile rows do not.

### What to build
1. **Tests first,** committed on the old code: a new `packages/client-core/src/store/chat-rows.test.ts` would fail to import, so start with guards in a new `apps/mobile/src/lib/topics.summaries.test.ts` and a new `apps/web/src/store/effects/chatRows.summaries.test.ts`. They cover:
   - a DM entry, including an AI DM;
   - a group with topics, a legacy group without topics, and a channel;
   - an archived topic;
   - for mobile, a malformed entry that the lenient parser skips today.
2. **The contract:** add `ChatEntry` (DM and group entries, the union) to `packages/api-contract/src/chats.ts`, and export it from the index. Keep `ChatList.chats` as `Unknown`, for the reason the comment gives. Add a contract test.
3. **Web:** `apps/web/src/lib/api.ts` uses the contract schema instead of its own.
4. **Mobile:**
   - `apps/mobile/src/lib/chat-api.ts` derives its `ChatEntry` type from the contract;
   - `parseChatEntry` stays lenient: it decodes each entry on its own and skips a bad one, as today (audit F5).
5. **One `summariesFor`:** in a new `packages/client-core/src/store/chat-rows.ts`, with a test and a line in the Phase 2 section of `packages/client-core/src/store/index.ts`. Web `chatRows.ts` and mobile `lib/topics.ts` bind to it. Mobile rows now also carry the four web fields. That is the only behaviour change: data is added, screens are unchanged.
6. `ports.rows` stays for now; a later task removes it. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `docs/STORE_CORE_PLAN.md` sections 2 and 9, the four files above with their tests, and `packages/api-contract/src/lenient.ts`.

### Allowed files
`packages/api-contract/src/chats.ts`, `packages/api-contract/src/chats.test.ts`, `packages/api-contract/src/index.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/chat-rows.test.ts`, `packages/client-core/src/store/index.ts` (Phase 2 section only), `apps/web/src/lib/api.ts`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/store/effects/chatRows.summaries.test.ts`, `apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/topics.ts`, `apps/mobile/src/lib/topics.summaries.test.ts`, `work/T-0924-one-chat-entry.md`.

T-0918 changes mobile `real-store.ts`, ports and lifecycle in parallel, and T-0922 changes the send files and the core `ports.ts`. Do not touch them.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- The guard commit comes before the move.
- No existing test is edited.
- The Report lists each field difference found between the two entry shapes, and the lines per side.
- Live check for Julio: the chat list on web and mobile, with DMs, AIs, groups with topics, and a channel.

---

## Report (written by the worker when done)

## Review (written by Claude)
