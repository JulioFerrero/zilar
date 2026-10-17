---
id: T-1800
title: "post_blocks in DMs: the owner's DM with an AI offers post_blocks too; the card is sent as a chat message to the owner (read-only, not recorded for responses)"
status: merged
milestone: M5
branch: task/T-1800-post-blocks-in-dms
model: auto
effort: default
depends_on: [T-1792]
estimate: 30 min
---

# T-1800: Cards in DMs

## Spec (written by Claude, do not edit)

### Why
`post_blocks` cards work only in groups and topics. In the owner's DM the model never sees the tool, so a "weather card please" in a DM gets plain text. This task offers the tool in DMs too. The card goes to the owner as a `chat` message. DM cards stay read-only in this task: they aren't recorded in `block_cards`, so taps answer 404, the same as tool cards.

### Facts (read by the lead on 2026-10-17)
- **The DM tool list:** `apps/server/src/agents/tools/definitions.ts:310-319` `buildTools(actions, opts)` returns the persona tools, the memory tools and `request_action`, with no `post_blocks`. `buildGroupTools` (`:332-351`) appends `POST_BLOCKS_TOOL_DEF` at `:347`.
- **The DM turn:** `apps/server/src/agents/gateway/dm-turn-input.ts` has `ownerJid` (`:26`, the DM peer). It calls `executeToolCall(session, chatKey, undefined, desk, { unattended: scheduled === true })` at `:107-118` and `buildTools(...)` at `:122`.
- **The executor:** `apps/server/src/agents/gateway/tool-exec.ts` (281 lines). `executeToolCall(session, chatKey, context?, desk?, options?: { unattended?: boolean })` is at `:97-103`. The group-only guard is at `:126-147`. At `:215-224`, `post_blocks` returns `invalid: unknown tool` when `context === undefined`; otherwise it calls `runPostBlocksEffect(session, call, { roomJid, groupId, topicId })`.
- **The runner:** `apps/server/src/agents/gateway/post-blocks.ts` (140 lines).
  - `PostBlocksChat` is `{ roomJid, groupId?, topicId? }` (`:27-31`).
  - `postCard` sends `send(session, chat.roomJid, 'groupchat', fallback, { payload })` (`:51`).
  - `POSTED_TEXT` says "in this room" (`:33-34`).
  - `recordPosted` (T-1791) records every posted card.
- **Tests:** `apps/server/src/agents/gateway/post-blocks.test.ts` covers the group path.

### Steps
1. **`buildTools`:** append `POST_BLOCKS_TOOL_DEF` after the base tools, before the desk tools, like `buildGroupTools`.
2. **`executeToolCall`'s options** gain `dmJid?: string`. At `:215`, when `context === undefined`:
   - with `options.dmJid` set, run `runPostBlocksEffect(session, call, { roomJid: options.dmJid, kind: 'chat' })`;
   - without it, keep `invalid: unknown tool`.
3. **`dm-turn-input.ts`** passes `dmJid: ownerJid` in those options.
4. **`post-blocks.ts`:**
   - `PostBlocksChat` gains `kind?: 'groupchat' | 'chat'` (default `'groupchat'`), and `postCard` sends with it.
   - For `kind: 'chat'`, skip `recordPosted`, since a DM card isn't interactive yet.
   - Make `POSTED_TEXT` say "in this chat".
5. **Tests (message pipeline, 1):** in `post-blocks.test.ts`, a DM call (`kind: 'chat'`) sends one `chat` message to the given JID and calls the record callback zero times.
6. Keep every file at most 400 lines.

### Allowed files
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `work/T-1800-post-blocks-in-dms.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- In the owner's DM the model can post a card, which arrives as a `chat` message with the blocks payload.
- Group behaviour is unchanged.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/agents/tools/definitions.ts`: `buildTools` (DM turns) now appends
  `POST_BLOCKS_TOOL_DEF` after the base tools and before the desk tools, exactly like
  `buildGroupTools`, so the owner's DM offers `post_blocks`.
- `apps/server/src/agents/gateway/tool-exec.ts`: `executeToolCall`'s options gained
  `dmJid?: string`. In the `post_blocks` branch a context-free turn (the DM) now runs
  `runPostBlocksEffect(session, call, { roomJid: options.dmJid, kind: 'chat' })`; without
  a `dmJid` it still answers `invalid: unknown tool`. The group path is untouched.
- `apps/server/src/agents/gateway/dm-turn-input.ts`: passes
  `{ unattended: …, dmJid: ownerJid }` to the executor, so a DM card goes to the DM peer.
- `apps/server/src/agents/gateway/dm-turn.ts`: `DmTurnContext.executeToolCall`'s options
  now include `dmJid?: string`, matching `tool-exec.ts`, so the DM call needs no cast.
- `apps/server/src/agents/gateway/post-blocks.ts`: `PostBlocksChat` gained
  `kind?: 'groupchat' | 'chat'` (default `groupchat`); `postCard` sends with that kind;
  a `chat` card skips `recordPosted` (read-only until a later task, so taps answer 404);
  the result text depends on `kind`: "in this room" for `groupchat`, "in this chat" for a DM.
- `apps/server/src/agents/gateway/post-blocks.test.ts`: added the DM test (one `chat`
  message to the given JID with the blocks payload, record callback called zero times,
  "in this chat" wording); the three group tests keep the "in this room" wording.
- Every changed file is within 400 lines (largest: `definitions.ts`, 356).

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/post-blocks.test.ts`:
  1 file passed, 5 tests passed.
- `pnpm gate` from the repo root (7 changed files): `PASS install (frozen)`,
  `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`;
  scope, migration, images and size checks all clean; `GATE PASS`.
  Afterwards only this Report text changed; the code the gate checked is unchanged.

### Notes for the lead

- The result text depends on the card kind: a group card keeps the original "in this room"
  sentence, a DM card says "in this chat". Group behaviour (message kind, recording,
  result shape) is otherwise unchanged.
- DM cards are not recorded in `block_cards`, so no card row exists and a tap answers 404,
  as the spec asks.
- No dependencies added, no migrations.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `5fb6860b9`, after one lead fix round.
- **DM turns:**
  - they offer `post_blocks`;
  - the executor sends a `chat` card to `ownerJid` (from the session, never from the model);
  - a DM card isn't recorded, so it stays read-only.
- The options type in `dm-turn.ts` is widened, and the result text says "room" in groups and "chat" in DMs.
- **Tests:** the DM test covers the runner.
- **Follow-ups:**
  - two stale "group room" comments (`tool-loop.ts:69`, `blocks-tool.ts:6-7`);
  - interactive DM cards (see NOW.md).
- **Live check after the deploy:** ask an AI for a card in its owner's DM.

