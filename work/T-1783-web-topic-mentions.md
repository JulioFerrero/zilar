---
id: T-1783
title: "Topic people W3 (web): the @ list offers only the topic's people and AIs; after sending, a mention of someone not in the topic shows the sender a centred 'X isn't in Topic' row with an Add key"
status: merged
milestone: M5
branch: task/T-1783-web-topic-mentions
model: auto
effort: default
depends_on: [T-1777]
estimate: 45 min
---

# T-1783: Web @ list filtered to the topic, plus the "isn't in" row

## Spec (written by Claude, do not edit)

### Why
Julio hit the bug himself: the web @ list offers a group AI that isn't in the topic, so the mention silently does nothing (`docs/design/mockups/topic-people/README.md:3`). The approved fix is plan **W3** (`docs/plan/topic-people.md` §3.2 and §3.3):
- the @ list shows only who's in the topic;
- a mention of someone who isn't in shows the **sender only** a row with an **Add** key (`Main.dc.html:55-59`, `README.md:28`).

### Facts (read by the lead on 2026-10-17)
- **The candidates:** `apps/web/src/components/composer/useMentions.ts` (222 lines) builds them at `:71-80` from `storeApi.getState().groupMembers(chatId)`. That is the whole group, people and AIs together, as `MentionMember { jid, name, handle? }` (`packages/chat-core/src/types.ts:52-56`).
  - It is built in `apps/web/src/store/effects/groupMembers.ts:22-41`: a person's jid is `${userId.toLowerCase()}@${domain}`; an AI's jid is `ai.jid`.
  - The hook gets `chatId`, `meJid`, `isGroup` and `storeApi` (`:43-58`).
- **The topic data (T-1777):** the chat row's `chat.topic` has `isGeneral`, `memberIds?` (user ids) and `ais?` (`{ id, name, avatarUrl? }`).
  - `inTopic(topic, { kind, id })` lives in `packages/chat-core/src/topics.ts:69-83`. General is everyone.
  - The group detail is `storeApi.getState().groupInfo(chatId)` (`GroupDetail`): `members[]` has `userId`, `name` and `avatarUrl?`; `ais[]` has `aiId`, `jid`, `name`, `ownerId` and `avatarUrl?` (`packages/api-contract/src/groups.ts:90-110`). Note: the AI's id field is **`aiId`**, not `id`, so build `aiIdByJid` as `jid → aiId`.
- **The send:** `apps/web/src/components/Composer.tsx` (239 lines), `send()` at `:108-128`, calls `sendText(chatId, value, { replyTo?, mentions? })` with `mentions.mentions` (`UiMention { jid, name, begin, end }`).
  - Chat switches are tracked with `trackedChatId` (`:30-31`).
  - It renders `ComposerControls` inside a `div` (`:210-239`).
- **The adds:** `storeApi.getState().addTopicAi(chatId, aiId)` and `addTopicMember(chatId, userId)` (`apps/web/src/store/groupStoreTypes.ts:51,55`) reject on failure. Since T-1769 the server adds the group half first when needed, and accepts public topics.
- **The board row** (`docs/design/mockups/topic-people/Main.dc.html:55-59`): a centred `role="status"` pill.
  - Style: padding `6px 6px 6px 12px`, radius 14, background `#141414`, border `1px solid #232323`, gap 10.
  - Contents: a 22 px avatar, the text `Deepseek isn't in Financial` (14px, `#a1a1a1`) and a light key `Add`.

### Steps
1. **One shared helper in `packages/chat-core/src/topics.ts`:** `mentionInTopic(topic, jid, aiIdByJid: ReadonlyMap<string, string>): boolean`. Phone W4 will reuse it.
   - Return `true` when `topic.isGeneral`, or when `topic.memberIds` is `undefined` (an older server, so don't filter).
   - For an AI (`aiIdByJid.has(jid)`), call `inTopic(topic, { kind: 'ai', id })`.
   - Otherwise it's a person: compare the jid's localpart, lowercased, with `memberIds` (lowercased).
   - Export it from `index.ts` if `topics.ts` isn't already re-exported (check).
2. **`useMentions.ts`:** when the chat has a `topic`, filter `members` with `mentionInTopic`. Read the topic from `state.chats` and build `aiIdByJid` from `groupInfo(chatId)?.ais`. Non-topic chats are unchanged.
3. **The new `apps/web/src/components/topic/TopicNotInRow.tsx`,** drawn to the board row: avatar (seed = display name, the real picture when the group detail has one), `{name} isn't in {topic title}`, and an `Add` key with a busy state. If the add fails, show a muted "Couldn't add" in place of the key.
4. **`Composer.tsx`:**
   - After a successful `sendText` in a topic, collect the sent mentions that fail `mentionInTopic`, deduplicated by jid, and keep them in state as `{ jid, name, kind, id, avatarUrl? }`, where `id` is the AI's id or the person's `userId` from `groupInfo`.
   - Render one `TopicNotInRow` per entry, centred, just above `ComposerControls`.
   - **Add** calls `addTopicAi` or `addTopicMember`. On success, remove the entry.
   - Clear all entries on a chat switch and replace them on the next send.
   - Keep `Composer.tsx` at most 400 lines.
5. **A new Cosmos fixture,** `apps/web/src/components/topic/TopicNotInRow.fixture.tsx`, with three states: idle, busy and failed.
6. **No tests.**

### Allowed files
- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/composer/useMentions.ts`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/topic/TopicNotInRow.tsx`
- `apps/web/src/components/topic/TopicNotInRow.fixture.tsx`
- `work/T-1783-web-topic-mentions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In a topic, @ offers only its people and AIs. General and DMs are unchanged.
- Mentioning someone outside the topic shows the sender the board's row, and Add puts them in.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/topics.ts`** — added `mentionInTopic(topic, jid, aiIdByJid)`. It returns `true` for `isGeneral` and for a topic whose `memberIds` is `undefined` (an older server, so nothing is filtered). An AI is found through `aiIdByJid` (a jid → `aiId` map) and checked with the existing `inTopic(topic, { kind: 'ai', id })`; any other jid is a person, matched by its lowercased localpart against `memberIds` (lowercased). `topics.ts` was already re-exported from `packages/chat-core/src/index.ts` (line 49), so no `index.ts` change was needed.
- **`apps/web/src/components/composer/useMentions.ts`** — in a group chat with a `topic`, the candidate `members` are now filtered through `mentionInTopic`. The topic is read from `state.chats` (`chatId`), and `aiIdByJid` is built from `state.groupInfo(chatId)?.ais` as `jid → aiId` (using the group AI's `aiId`, per the lead's correction). DMs and non-topic chats are unchanged; General (`isGeneral`) never filters.
- **`apps/web/src/components/topic/TopicNotInRow.tsx`** (new) — the board row (`Main.dc.html:55-59`): a `role="status"` pill (radius 14, `#141414`, `1px solid #232323`, `padding 6px 6px 6px 12px`, gap 10), a 22 px avatar (seed = display name, `avatarUrl` when the group detail has one), `{name} isn't in {topic title}`, and a light `Add` key (the `Button` default `key-primary` variant, `--accent: #ededed`). A failed add shows a muted "Couldn't add" in place of the key.
- **`apps/web/src/components/Composer.tsx`** (338 lines, ≤ 400) — after a send in a topic, `surfaceNotInTopic` collects the sent mentions that fail `mentionInTopic`, deduplicated by jid, into `{ jid, name, kind, id, avatarUrl? }` where `id` is the AI's `aiId` or the person's `userId` from `groupInfo`. One row is rendered per entry, centred just above `ComposerControls`. The entries are cleared on a chat switch and replaced on every send (a send with no misses / a General topic / a non-topic chat clears them).
- **`apps/web/src/components/topic/TopicNotInRow.fixture.tsx`** (new) — three states: Idle, Busy, Failed.

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topics.test.ts` → **1 file, 6 tests passed**.
- `pnpm gate` (from the repo root) → **GATE PASS**, with:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/chat-core
  SKIP  tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did not run format, lint or typecheck on their own; the gate runs them once.

### Notes for the lead

- **One deviation, forced by the effect ratchet.** Step 3 reads as if `TopicNotInRow` owns its busy/failed state, but the `effect` gate rejects `async`/`await`/`.then`/`try` in a component (it failed the first `pnpm gate` on `void call.then(`). So the file exports two things: the presentational `TopicNotInRow` (takes `state: 'idle' | 'busy' | 'failed'` + `onAdd`) that the fixture renders, and `AddToTopicRow`, the container the Composer uses, which owns one Add call per row through `useAction` + `Effect.tryPromise` and calls `onAdded` on success. This matches the existing `TopicActionButtons` pattern ("the row owns its call") and lets the fixture show all three states statically.
- Because each row owns its own call, the Composer's entries stay exactly `{ jid, name, kind, id, avatarUrl? }` as the spec asks; no extra status field was added.
- `aiIdByJid` uses the group AI's `aiId` (corrected by the lead); `addTopicAi(chatId, aiId)` gets that value.
- No tests were added (the spec says none).

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `a74d98f05`.
- **`mentionInTopic`** (chat-core):
  - General and an older server with no `memberIds` are never filtered;
  - an AI is checked by `aiId` against `topic.ais`;
  - a person is checked by the jid's localpart against `memberIds`.
- **`useMentions`** filters the candidates with it, so a topic's @ list offers only its people and AIs.
- **`Composer`:** after a send, each sent mention outside the topic gets one `AddToTopicRow`, in a centred column above the controls. Add calls `addTopicAi` or `addTopicMember`, which add the group half first on the server since T-1769.
- **Cosmos vs `Main.dc.html:55-59`:** the 22 px avatar, the "Deepseek isn't in Financial" text in 14 px muted, and the light Add key match. In the fixture the row spans the whole width; in the composer it hugs its content, like the board.
- **Next:** the phone twin, W4.

