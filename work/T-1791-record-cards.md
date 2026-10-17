---
id: T-1791
title: "Blocks Wave 2 B8b: post_blocks records each posted card in block_cards (origin id, AI, room, group, topic, data), and the room reflection re-keys it with the stanza id"
status: merged
milestone: M5
branch: task/T-1791-record-cards
model: auto
effort: default
depends_on: [T-1790]
estimate: 30 min
---

# T-1791: Record AI cards for interaction

## Spec (written by Claude, do not edit)

### Why
Interactive cards (Wave 2, `docs/plan/message-blocks.md` §8) need the server to know each card it posted. A tap's route (B9) can then find the card, merge the answers and correct it as the AI. T-1790 added the storage (`apps/server/src/message-blocks/cards.ts`: `recordCard`, `rekeyCard`). This task records the cards.

### Facts (read by the lead on 2026-10-17)
- **The runner:** `apps/server/src/agents/gateway/post-blocks.ts` (113 lines).
  - `createPostBlocksRunner(logger, send)` (`:34-37`); `postCard` returns `{ ok: true, id: sent.id }` (`:41-54`). The id is the origin id the gateway chose.
  - `runPostBlocksEffect` builds the payload with `buildBlocksPayload` and posts it (`:56-104`); an empty id means the kill switch dropped the send (`:93-99`).
  - `PostBlocksChat` is `{ roomJid }` only (`:25-28`).
- **The call site:** `apps/server/src/agents/gateway/tool-exec.ts` (274 lines).
  - It creates the runner at `:77`: `createPostBlocksRunner(logger, liveSendMessage)`.
  - It calls `runPostBlocksEffect(session, call, { roomJid: context.roomJid })` at `:217`.
  - `context` also has `groupId` and `topicId` (used at `:207-208`). The database is `deps.db`.
- **The reflection hook:** `apps/server/src/agents/gateway/group-ingest.ts` (366 lines). For the AI's own outgoing reflection it calls `void rekeyOnReflection(deps.db, session, message, logger)` at `:113-115`. `rekeyOnReflection` (`agents/gateway/question-answer.ts:24-46`) is the shape to copy: it reads `message.payload?.type`, `message.originId` and `message.id`, and logs only the AI id and the outcome.
- **The storage:** `recordCard(db, { originId, aiId, groupId?, topicId?, roomJid, data })` and `rekeyCard(db, originId, stanzaId)` in `apps/server/src/message-blocks/cards.ts`.

### Steps
1. **`post-blocks.ts`:**
   - `PostBlocksChat` gains `groupId?: string` and `topicId?: string`;
   - `createPostBlocksRunner` gains a third parameter, `record: (input: RecordCardInput) => Promise<void>`;
   - after a successful post with a non-empty id, call it with `{ originId: posted.id, aiId: session.aiId, roomJid, groupId, topicId, data: payload.data }`. This is **best-effort**: a failure logs `{ aiId, err }` at warn and never changes the tool result.
2. **`tool-exec.ts`:** pass `(input) => recordCard(deps.db, input).then(() => undefined)` (or the equivalent) as `record`, and pass `groupId` and `topicId` from `context` at `:217`.
3. **A new `apps/server/src/agents/gateway/card-rekey.ts`** with `rekeyCardOnReflection(db, session, message, logger)`. For a `blocks` payload with an `originId` different from `message.id`, call `rekeyCard`. It is best-effort and never throws, like `rekeyOnReflection`.
4. **`group-ingest.ts`:** call it right after `rekeyOnReflection` (`:115`), un-awaited.
5. **Test (1, message pipeline)** in `apps/server/src/agents/gateway/post-blocks.test.ts`: a successful post calls `record` once with the origin id, the room, the group and topic, and the card data; a failed `record` still returns the posted result.

### Allowed files
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/card-rekey.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `work/T-1791-record-cards.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- Every card an AI posts with `post_blocks` gets a `block_cards` row.
- Its reflection fills `stanza_id`.
- A storage failure never breaks the post.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/agents/gateway/post-blocks.ts`:** `PostBlocksChat` gains `groupId?: string` and `topicId?: string`; `createPostBlocksRunner` takes a third `record: (input: RecordCardInput) => Promise<void>` parameter. After a successful post with a non-empty id, `record` is called with `{ originId: posted.id, aiId: session.aiId, roomJid, groupId, topicId, data: payload.data }`. Recording is best-effort: a failure logs `{ aiId, err }` at warn (`AI card record failed`) and the tool result is unchanged. Nothing is recorded for an empty id (the kill switch dropped the send).
- **`apps/server/src/agents/gateway/tool-exec.ts`:** the runner gets `(input) => recordCard(deps.db, input).then(() => undefined)`, and the `post_blocks` call passes `groupId` and `topicId` from `context`.
- **`apps/server/src/agents/gateway/card-rekey.ts` (new):** `rekeyCardOnReflection(db, session, message, logger)`. For a `blocks` payload with an `originId` that differs from `message.id`, it calls `rekeyCard`; failures are swallowed and logged with `{ aiId, err }` at warn, and only a changed row logs `AI card re-keyed`. Same shape as `rekeyOnReflection` in `question-answer.ts`.
- **`apps/server/src/agents/gateway/group-ingest.ts`:** calls `rekeyCardOnReflection` un-awaited right after `rekeyOnReflection` on the AI's own outgoing reflection.
- **`apps/server/src/agents/gateway/post-blocks.test.ts`:** two new tests — a successful post calls `record` once with the origin id, AI id, room, group and topic and the card data; a failing `record` still returns the posted result and the message was sent. Existing tests pass a no-op `record`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/post-blocks.test.ts` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (repo root) → `GATE PASS`, summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- Changed files: `apps/server/src/agents/gateway/post-blocks.ts`, `post-blocks.test.ts`, `tool-exec.ts`, `card-rekey.ts`, `group-ingest.ts`, `work/T-1791-record-cards.md`.

### Notes for the lead

- The record call runs before the success log line; it adds one awaited database write to the tool call, but a slow or failing write can only log a warning, never change `content` or `postedToRoom`.
- `recordCard`'s optional `groupId`/`topicId` default to null in `cards.ts`, so a context without them still stores the row with the room.
- No open questions.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `a8f909130`.
- **Recording:** `post-blocks.ts` records each posted card best-effort (origin id, AI, room, group, topic, data); a failure only logs `{aiId, err}`. `tool-exec.ts` wires `recordCard` and passes the group and topic.
- **Re-keying:** `card-rekey.ts` re-keys on the reflection, also best-effort, and is called right after the question re-key in `group-ingest.ts`.
- **Known race, handled in B9:** the reflection can arrive before the row is written, and then the re-key finds nothing. So B9's route accepts the card's `originId`, which clients have on the message, as well as the stanza id, and `findCard` matches either.

