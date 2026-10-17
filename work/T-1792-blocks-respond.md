---
id: T-1792
title: "Blocks Wave 2 B9: POST /api/blocks/respond — a room member answers an AI card (checklist tick, poll vote, choice, rating, button, form); the server records it, merges the state into the card and corrects the card as the AI; plus a gateway correctInRoom and a re-key retry"
status: merged
milestone: M5
branch: task/T-1792-blocks-respond
model: auto
effort: default
depends_on: [T-1790, T-1791]
estimate: 45 min
---

# T-1792: The card respond route

## Spec (written by Claude, do not edit)

### Why
This is Wave 2, B9 (`docs/plan/message-blocks.md` §3 and §8). A tap on an interactive card must reach the server. The server records it in `block_responses`, merges every answer into the card and corrects the card as the AI, so everyone in the room sees the new state. The route never wakes the AI: for the decision kinds, the client also sends the normal `@AI` reply (§8.4).

### Facts (read by the lead on 2026-10-17)
- **The storage (T-1790)**, in `apps/server/src/message-blocks/cards.ts`:
  - `findCard(db, id)` matches `origin_id` or `stanza_id`;
  - `upsertResponse`, `replacePollVotes`, `listResponses` and `saveCardData`.
  - `applyResponses(data, rows, nameOf)` is in `apps/server/src/message-blocks/apply.ts`.
  - A card row has `originId`, `stanzaId`, `aiId`, `groupId`, `topicId`, `roomJid` and `data`.
- **Recording (T-1791):** `post_blocks` records each card under its origin id. `apps/server/src/agents/gateway/card-rekey.ts` re-keys it with the stanza id on the room reflection.
  - **Race:** the reflection can arrive before the row is written, and then `rekeyCard` updates 0 rows.
  - Clients only know the stanza id: `UiMessage` has just `id` (`packages/chat-core/src/types.ts:68-70`).
- **The blocks:** `packages/protocol/src/blocks-choices.ts` holds buttons (`actions[].id`, `:12-37`), poll (`options[].id`, `multiple?`, `:41-63`), choice (`options` as strings, `selected?` an index, `:70-80`), form (`fields[].id/kind`, `:83-108`) and rating (`max`, `:111-…`). The checklist is in `packages/protocol/src/blocks-progress.ts:6-26` (`items[].id`). `BlocksDataSchema` is in `packages/protocol/src/blocks.ts:80`.
- **Topic access:** `apps/server/src/topics/access.ts` has `requireVisibleTopic` (`:117`), `isTopicMember` (`:106`), `toMissingTopic` (`:28`) and `getGroupMembership` (`:43`).
- **The route pattern to copy:**
  - `apps/server/src/topics/api.ts` (373 lines): the `handler(logger, …)` wrapper and `HttpError`, plus a per-user limiter mounted with `rateLimitLayer(TopicsPreviewRateLimit, previewLimiter, …)` (`:366-368`), then `mountApi(TopicsApi, apiLayer)`;
  - the contract `TopicsGroup` (`packages/api-contract/src/topics.ts`) and the limiter class `TopicsPreviewRateLimit` (`packages/api-contract/src/middleware.ts:182-185`);
  - both are composed in `packages/api-contract/src/api.ts:41-73`, and the server mounts it in `apps/server/src/app/routes-messaging.ts:102-110`, passing `getGateway: getTurnWatcher`.
- **Posting as the AI:** `apps/server/src/agents/gateway/live.ts` (349 lines). `postToChatEffect` (`:283-323`) checks `sessions.get(aiId)`, `sessionIsLive` and `session.rooms.has(roomJid)`, then sends.
  - The XMPP core has `session.core.sendCorrection(to, kind, originalId, text, { payload })`, used by `agents/gateway/routine-send.ts:146-151`.
  - The gateway type is in `apps/server/src/agents/gateway/contracts.ts:265-277`, and `apps/server/src/agents/gateway.ts` (395 lines) returns the live functions at `:390`.

### Steps
1. **The contract:**
   - a new `packages/api-contract/src/message-blocks.ts` with `MessageBlocksGroup`: `POST /blocks/respond`, payload `{ messageId: string, blockId: string, itemId?: string, value: { done?: boolean, optionIds?: string[], selected?: number, rating?: number, actionId?: string, fields?: Record<string, string> } }`, success `{ data: BlocksData }`, with the middleware `BlocksRespondRateLimit` (new in `middleware.ts`);
   - add it to `ZilarApi` in `api.ts`, and export it from `index.ts` like the others.
2. **The gateway:** `correctInRoom({ aiId, roomJid, originalId, text, payload }): Promise<boolean>` in `live.ts`. Use the same live and room checks as `postToChatEffect`, then `sendCorrection(roomJid, 'groupchat', originalId, text, { payload })`. Add it to the contract type and to `gateway.ts`'s returned object. Keep `gateway.ts` at most 400 lines.
3. **A new `apps/server/src/message-blocks/respond.ts`,** with `respondToCard(deps, userId, input)`:
   1. `findCard`, or 404 `card_not_found`.
   2. **Access:**
      - a card with a `topicId` needs `requireVisibleTopic`, and also `isTopicMember` unless the topic is General;
      - a card with only a `groupId` needs a group membership;
      - otherwise, 404.
      - Every refusal answers the same 404 `card_not_found`.
   3. **Validate:** find the block by `blockId` in `card.data.blocks`. Its kind must be checklist, poll, choice, rating, buttons or form, and the value must fit the kind:
      - **checklist:** `itemId` is an existing item, plus `done`;
      - **poll:** `optionIds` are all existing options, at most 1 unless `multiple`, and may be empty to unvote;
      - **choice:** `selected` is a valid index;
      - **rating:** `rating` is between 1 and `max`;
      - **buttons:** `actionId` exists;
      - **form:** `fields` keys exist and each value is at most 120 characters.
      - Anything else is 400 `invalid_response`.
   4. **Record:**
      - checklist: `upsertResponse(itemId, { done })`;
      - poll: `replacePollVotes`;
      - the others: `upsertResponse('', value)`.
   5. **Merge:** `listResponses`, then load the actors' display names (one query on the users table), then `applyResponses`. Decode the result with `BlocksDataSchema`; if it fails, keep the old data and log.
   6. `saveCardData`.
   7. **Correct** the card as the AI, best-effort: `correctInRoom({ aiId, roomJid, originalId: card.originId, text: data.fallback, payload: { v: 0, type: 'blocks', data } })`. A `false` result or an error is logged with `{ cardId, ok }` and never fails the request.
   8. Return `{ data }`.
4. **A new `apps/server/src/message-blocks/api.ts`:** the handler, plus a per-user limiter of 120 a minute, mounted like the topics API in `routes-messaging.ts` (pass `db` and `getGateway`).
5. **The race:** in `card-rekey.ts`, when `rekeyCard` returns `false`, retry up to 3 times (after 300 ms, 1 s and 3 s), so a reflection that beats the insert still re-keys. Keep it best-effort and un-awaited by ingest.
6. **Tests (2, permissions and message pipeline)** in a new `apps/server/src/message-blocks/respond.test.ts`, using the `createTestContext` / seeds pattern from `questions/service.test.ts`:
   - a user who isn't in the card's topic gets 404 and nothing is recorded;
   - a topic member's checklist tick returns the item with `done: true` and their name, saves it, and calls `correctInRoom` once.

### Allowed files
- `packages/api-contract/src/message-blocks.ts`
- `packages/api-contract/src/api.ts`
- `packages/api-contract/src/middleware.ts`
- `packages/api-contract/src/index.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway/card-rekey.ts`
- `apps/server/src/app/routes-messaging.ts`
- `work/T-1792-blocks-respond.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A room member can answer an interactive card. The answer is stored, merged and corrected into the card for everyone.
- Non-members get 404.
- The route never wakes the AI.
- Both tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

Implemented the card respond route end to end (Wave 2 B9):

- **Contract** (`packages/api-contract/src/message-blocks.ts`): `MessageBlocksGroup` with `POST /blocks/respond` (`messageId`, `blockId`, `itemId?`, `value`), the `BlocksRespondValue` struct (done / optionIds / selected / rating / actionId / fields), and `BlocksRespondRateLimit` in `middleware.ts` (120 a minute on the server). Added the group to `ZilarApi` and exported the module from `index.ts`.
- **Gateway** (`agents/gateway/live.ts`, `contracts.ts`, `gateway.ts`): `correctInRoom({ aiId, roomJid, originalId, text, payload })` with the same live-session and `session.rooms.has(roomJid)` guards as `postToChatEffect`, then `sendCorrection(roomJid, 'groupchat', …)`. Returned from `createLiveSession` and from `gateway.ts`; `gateway.ts` is 397 lines.
- **Service** (`apps/server/src/message-blocks/respond.ts`): `respondToCard(deps, userId, input)` — `findCard`; access via `requireVisibleTopic` + `isTopicMember` for a topic card (General exempt), group membership for a group-only card, and the same 404 `card_not_found` for a missing card and every refusal; per-kind validation (checklist item + `done`, poll options + `multiple` + empty-unvote, choice index, rating 1..`max`, button action id, form field ids and 120-char values) with 400 `invalid_response`; records with `upsertResponse` / `replacePollVotes`; merges with `listResponses` + one display-name query on `"user"` + `applyResponses`; re-decodes with `BlocksDataSchema` and keeps the stored data on failure; `saveCardData`; then a best-effort `correctInRoom` (a false result or an error is logged with `{ cardId, ok }` and never fails the request).
- **Route** (`apps/server/src/message-blocks/api.ts`): handler plus a per-user limiter of 120 a minute, mounted from `routes-messaging.ts` with `base` (db/logger/…) and the gateway's `correctInRoom` (narrowed with `cardCorrectorOf`, so a gateway double without the hook reads as "no gateway"). The route never touches the turn queue, so it never wakes the AI.
- **Race** (`agents/gateway/card-rekey.ts`): when `rekeyCard` returns `false`, retry after 300 ms, 1 s and 3 s (four attempts), still best-effort and un-awaited by ingest. Written with `Effect.tryPromise` / `Effect.sleep` because of the effect ratchet (a bare `new Promise` failed the `effect` gate check).
- **Tests** (`respond.test.ts`, 2 tests with `createTestContext` + seeds): (1) a stranger gets 404 `card_not_found`, nothing is recorded, the stored card is unchanged and `correctInRoom` is not called; (2) a General-topic member's checklist tick returns `done: true` with their name, one row is stored, the merged data is saved and `correctInRoom` is called once with the origin id, the room, the fallback text and the `{ v: 0, type: 'blocks', data }` payload.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/respond.test.ts` → 1 file passed, 2 tests passed (4.16s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` → 1 file passed, 5 tests passed; the sweep lists `POST /api/blocks/respond -> 401`.
- `pnpm gate` (repo root), final run:

```text
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/server  (19.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation in the contract's success type.** `@zilar/api-contract` depends on `effect` only (its `iso-datetime.ts` comment says so) and `package.json` is outside my Allowed files, so `BlocksRespondResult` declares `data: Schema.Unknown` instead of `BlocksData`. The server fills it with a decoded `BlocksData` and clients decode it with `BlocksDataSchema` (documented in the file). If you want it typed in the contract, a follow-up can add `@zilar/protocol` as a workspace dependency of the contract package.
- The two tests call `respondToCard` directly rather than over HTTP, matching the spec's test list; the mounted route itself is covered by the authz sweep's `401` (shown above). No end-to-end POST test was added.
- `correctInRoom` treats a miss (`false`) as final, but the gateway also has a `session.rooms.has` guard; the retry loop in `card-rekey.ts` only retries the "row not written yet" case, not database errors (an error is logged once and stops).
- Poll duplicate `optionIds` are de-duplicated before the `multiple` check and the insert, so a repeated id cannot hit the `(card, block, item, actor)` primary key.
- `respond.ts` logs only the card id and the error name; no response text, message body or secret is logged.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `87cd30fe0`.
- **Access:** every refusal answers the same 404 `card_not_found`:
  - a topic card needs the topic visible, plus membership outside General;
  - a group card needs group membership.
- **Validation:** each kind's value is checked (checklist item and `done`, poll options and `multiple`, choice index, rating 1..max, button action, form fields ≤120).
- **Recording and merge:** the answer is recorded, `applyResponses` merges it with the actors' names, the result is decoded with `BlocksDataSchema` (the stored data stays if the decode fails), then saved.
- **Correction:** `correctInRoom` is best-effort and uses the same live and room guards as `postToChat`.
- **Re-key:** it retries at 300 ms, 1 s and 3 s, un-awaited by ingest.
- **Tests:** 2 (non-member 404, a member's tick with the name and one correction), and the authz sweep covers 401.
- **Follow-ups for the client tasks:**
  - the contract types `data` as `Unknown`, so B10/B11 must decode it with `BlocksDataSchema`;
  - the form cap is duplicated (contract and server).

