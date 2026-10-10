---
id: T-0924
title: "Store core phase 2d: one ChatEntry schema in packages/api-contract and one summariesFor in packages/client-core, both apps on them, mobile's lenient parsing kept, tests first"
status: merged
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

**Status:** done, ready for review.

### What I did

- **Tests first (commit `ebd4a778`, on the old code).** Added the two guard
  files and ran them green before any move:
  - `apps/web/src/store/effects/chatRows.summaries.test.ts` — 5 passed.
  - `apps/mobile/src/lib/topics.summaries.test.ts` — 6 passed.
- **Contract.** Added `DmChatEntry`, `GroupChatEntry` and the `ChatEntry`
  union to `packages/api-contract/src/chats.ts` (reusing the contract's
  `GroupBackground`), with `packages/api-contract/src/chats.test.ts`. `ChatList.chats`
  stays `Schema.Array(Schema.Unknown)` for the reason the comment gives.
  `export * from './chats'` in the index already exports `ChatEntry`, so the
  index needed no new line.
- **Core.** New `packages/client-core/src/store/chat-rows.ts` with the one
  `summariesFor` (plus `chatEntryTopics` for the lenient topic validation) and
  its test `chat-rows.test.ts`; added the Phase 2 line to
  `packages/client-core/src/store/index.ts`.
- **Web.** `apps/web/src/lib/api.ts` uses the contract union and re-exports its
  `GroupBackground`; `apps/web/src/store/effects/chatRows.ts` keeps
  `mergeWithPainted` and re-exports the core `summariesFor`.
- **Mobile.** `apps/mobile/src/lib/chat-api.ts` derives `ChatEntry` from the
  contract and its `parseChatEntry` now also parses/keeps `visibility`,
  `handle`, group `avatarUrl` and `background` (still per-entry, dropping
  malformed topic rows); `apps/mobile/src/lib/topics.ts`
  `summariesForTopicsEntry` binds to the core `summariesFor`.
- **Behaviour change (only one):** mobile group rows now also carry the four
  web fields (`visibility`, `handle`, `avatarUrl`, `groupBackground`). Data is
  added; screens are unchanged.

### Field differences found between the two entry shapes

| Field (group entry) | Web (before) | Mobile (before) |
| --- | --- | --- |
| `visibility` | present, `api.ts:126`, row `chatRows.ts:75` | absent |
| `handle` | present, `api.ts:129`, row `chatRows.ts:76` | absent |
| `avatarUrl` | present for groups, `api.ts:136`, row `chatRows.ts:78` | group entries had no `avatarUrl` (DMs only) |
| `background` | present, `api.ts:138`, row `chatRows.ts:80` (`groupBackground`) | absent |
| `topics` | `unknown[]`, `api.ts:135` | `Topic[]`, `chat-api.ts:59` |
| DM `userId` | optional, `api.ts:94` | required (`Schema.String`), `chat-api.ts:106` |
| DM `avatarUrl` | strict optional string, `api.ts:97` | lenient optional string (wrong type reads absent), `chat-api.ts:133` |

Entry types: web declared its own at `api.ts:143`; mobile hand-wrote its own at
`chat-api.ts:29-60`. Two summary mappers: web `chatRows.ts:163`, mobile
`topics.ts:98` wrapped by `real-store.ts:102`. Mobile's DM `avatarUrl` leniency
is kept (nothing in this task changes it).

### Commands run (real results)

- `pnpm install` — done (10.5s).
- Guard tests, old code: web 5 passed; mobile 6 passed (committed first).
- `pnpm --filter @zilar/api-contract test ... src/chats.test.ts` — 4 passed.
- `pnpm --filter @zilar/client-core test ... src/store/chat-rows.test.ts` — 10 passed.
- `pnpm --filter @zilar/web test ... chatRows.summaries.test.ts chatRows.test.ts
realStore.topics.test.tsx api.topics.test.ts api.test.ts api.decode.test.ts` —
  6 files, 149 passed.
- `pnpm --filter @zilar/mobile test ... topics.summaries.test.ts topics.test.ts
chat-api.test.ts chat-api.topics.test.ts real-store.topics.test.ts` — 5 files,
  55 passed.
- `pnpm gate` (from the repo root):
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/api-contract  (1.0s)
  PASS  tests @zilar/client-core  (4.1s)
  PASS  tests @zilar/mobile  (1.5s)
  PASS  tests @zilar/web  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed

`packages/api-contract/src/chats.ts`, `packages/api-contract/src/chats.test.ts`,
`packages/client-core/src/store/chat-rows.ts`,
`packages/client-core/src/store/chat-rows.test.ts`,
`packages/client-core/src/store/index.ts` (Phase 2 section),
`apps/web/src/lib/api.ts`, `apps/web/src/store/effects/chatRows.ts`,
`apps/web/src/store/effects/chatRows.summaries.test.ts`,
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/topics.ts`,
`apps/mobile/src/lib/topics.summaries.test.ts`.

### Deviations / open questions

- The guard test for mobile imports `summariesFor` from `../store/real-store`
  (not from `./topics`): that is mobile's top-level entry, so it also covers
  the DM case, which `summariesForTopicsEntry` never handled. The file still
  lives where the spec named it.
- `apps/mobile/src/store/real-store.ts` is untouched (its `summariesFor` keeps
  handling DMs); `ports.rows` stays for the later task.
- Nothing named in "Read first" was left unread; no existing test was edited.

### Live check for Julio (not run by me)

Web and mobile chat list, with DMs, AIs, groups with topics, and a channel.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The move:**
  - `ChatEntry` is in `packages/api-contract/src/chats.ts`, and `ChatList.chats` stays `Unknown`;
  - one `summariesFor` is in `packages/client-core/src/store/chat-rows.ts`;
  - web `chatRows.ts` and mobile `lib/topics.ts` bind to it.
- **Mobile parsing:** stays lenient.
- **Tests first:** guards on the old code.
- **Behaviour:** the only change is that mobile group rows also carry `visibility`, `handle`, `avatarUrl` and `groupBackground`.
- **Nits for later:**
  - mobile `DmEntrySchema` still requires `userId`, while the contract type has it optional (stricter, as before);
  - web `chatEntryTopics` at `apps/web/src/lib/api.ts:105` has no production caller left.
- **Check:** the combined check passes, and the lead runs the phone smoke.
- **Live check for Julio:** the chat list on web and mobile, with DMs, AIs, groups with topics, and a channel.
