---
id: T-1824
title: "DM interactive cards, server: record a DM card under its origin id, let only the AI's owner answer it (same 404 for anyone else), and correct it in the DM as a chat correction (plan docs/plan/dm-interactive-cards.md tasks 1-3)"
status: merged
milestone: M5
branch: task/T-1824-dm-cards-server
model: auto
effort: default
depends_on: [T-1809]
estimate: 40 min
---

# T-1824: DM cards, server side

## Spec (written by Claude, do not edit)

### Why
Plan `docs/plan/dm-interactive-cards.md` (T-1809), Option A, tasks 1–3. A DM card is never reflected, so it keeps the origin id the gateway sent it with; DM clients will send that id (T-1825). The DM refusal for interactive kinds (T-1803) **stays in place** in this task; T-1826 lifts it.

### Facts (read by the lead on 2026-10-17, main `f380f4762`)
- **`apps/server/src/agents/gateway/post-blocks.ts`** (169 lines):
  - `recordPosted(session, chat, originId, data)` at `:70-88` writes `roomJid`, plus `groupId`/`topicId` only when set.
  - `:149-153`: `if (kind !== 'chat') { recordPosted(...) }`, under the comment "T-1800: a DM card is read-only for now".
- **`apps/server/src/agents/gateway/post-blocks.test.ts`** (233 lines): the case `'posts a read-only chat card in the owner DM and records nothing'` at `:157-180` ends with `expect(records).toHaveLength(0)`.
- **`apps/server/src/message-blocks/respond.ts`** (310 lines):
  - `requireCardAccess(db, card, userId)` at `:64-88` has a topic branch, then a group branch, then `throw cardNotFound()`.
  - It already runs SQL through `runSql` and `SqlClient` (imports `:10-17`).
  - The AI's owner is `ais.owner`; the same query exists as the exported `loadAiOwnerId(db, aiId)` in `apps/server/src/agents/gateway/db.ts:184`.
- **`apps/server/src/message-blocks/respond.test.ts`** (181 lines): fixtures `setup()` from `:58`, and `correctInRoom` mocked with `vi.fn`.
- **`apps/server/src/agents/gateway/live.ts`** (391 lines):
  - `correctInRoomEffect` (`:339-363`) returns `false` when `!session.rooms.has(input.roomJid)`, then calls `session.core.sendCorrection(input.roomJid, 'groupchat', …)`.
  - `postToChatEffect` resolves the owner's JID as `jidFor(localpartFor(ownerId), deps.xmpp.domain)` after `yield* loadOwnerId(input.aiId)` (`:294-301`).

### Steps
1. **`post-blocks.ts`:** always call `recordPosted` after a successful send (drop the `kind !== 'chat'` condition) and update the comment.
   - In `post-blocks.test.ts`, the DM case becomes "records the DM card under the sent id with no group or topic": `records` has one entry with `roomJid` equal to the DM JID and no `groupId` or `topicId`.
2. **`respond.ts` `requireCardAccess`:** before the final 404, when `card.groupId === null && card.topicId === null`, load the AI's owner and allow only `userId === ownerId`.
   - Import `loadAiOwnerId` from `../agents/gateway/db` if that import passes the gate; otherwise add a small private query.
   - Everything else stays the same 404.
   - **Add one test in `respond.test.ts`:** a DM card (no group, no topic) is answered by the AI's owner, while another user and a group member get 404.
3. **`live.ts` `correctInRoomEffect`:** when the session doesn't hold `input.roomJid`, load the owner. Correct with kind `'chat'` only if the owner's JID (built as in `postToChatEffect`) equals `input.roomJid` compared lowercase; otherwise return `false` as today. Rooms keep `'groupchat'`.
   - **`live.ts` must stay at most 400 lines.** Shorten the comment rather than grow the file past it.
4. **No other files.**

### Allowed files
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/server/src/agents/gateway/live.ts`
- `work/T-1824-dm-cards-server.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A DM card is recorded under its sent id.
- Only the AI's owner can answer it.
- Its correction goes to the owner as a `chat` correction; a room correction is unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `post-blocks.ts`: `recordPosted` now runs for every successful card send, so a DM card is stored under the id the gateway sent it with (no `groupId`/`topicId`). Updated the comment.
- `post-blocks.test.ts`: the DM case now expects exactly one record with `roomJid` = DM JID and no `groupId`/`topicId`; updated the file header comment.
- `respond.ts` `requireCardAccess`: before the final 404, a card with no group and no topic loads the AI's owner via `loadAiOwnerId` and allows only that user; everyone else (including group members) still gets `card_not_found` 404.
- `respond.test.ts`: added a DM card test — the AI owner answers it and gets a correct call with the DM JID, while a group member and an outsider both get 404 and only the owner's response is stored.
- `live.ts` `correctInRoomEffect`: when the session does not hold the room, it loads the owner, builds their JID the same way as `postToChatEffect`, and compares it to `roomJid` lowercased. A match sends a `chat` correction; no match returns `false` as before. Room corrections stay `groupchat`. Shortened the comment to keep the file at 397 lines (limit 400).

### Checks run
- `cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts src/message-blocks/respond.test.ts --reporter=dot --maxWorkers=2`: 10 passed (10).
- `pnpm gate` from the repo root: GATE PASS. Summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen) (1.7s)`
  - `PASS format (0.9s)`
  - `PASS lint (1.3s)`
  - `PASS typecheck (4.2s)`
  - `PASS effect (0.9s)`
  - `PASS tests @zilar/server (18.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead
- Only the files under Allowed files changed.
- The `kind === 'chat'` refusal for interactive cards (T-1803) is untouched; T-1826 still lifts it.
- I did not add a `live.ts` test: the spec only asked for the `respond.test.ts` test, and `correctInRoomEffect` has no existing unit test file. The `chat` correction path is covered by inspection only.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `87f4c42ff`.
- **`post-blocks.ts`** records every posted card, DM ones included; the DM test expects one record with no group or topic.
- **`requireCardAccess`:** a card with no group and no topic admits only `loadAiOwnerId(card.aiId) === userId`; anyone else gets the same 404. The test covers the owner, another user and a group member.
- **`correctInRoomEffect`** corrects as `chat` only when the target equals the owner's JID (compared lowercase); rooms keep `groupchat`. `live.ts` is 397 lines.
- **The pre-review nit** (the stale T-1803 comment in `post-blocks.ts:42-43`) is fixed by the task that lifts the DM refusal.
- **The `chat` correction** is checked live once the DM refusal is lifted.
