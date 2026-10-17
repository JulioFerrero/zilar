---
id: T-1822
title: "A poll remembers the viewer's own votes: GET /api/blocks/mine returns the viewer's poll picks for one card (same access as respond), and web and phone polls start from them, so a re-vote after a reload no longer drops earlier picks"
status: merged
milestone: M5
branch: task/T-1822-poll-my-votes
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1822: A poll remembers your votes

## Spec (written by Claude, do not edit)

### Why
A poll's own picks live only in component state: web `PollBlock.tsx:46` and phone `poll-block.tsx:30` start from `[]`, because the shared card data carries counts only. After a reload the check is gone. Worse, a poll answer **replaces the voter's whole set** (`replacePollVotes`, `apps/server/src/message-blocks/respond.ts:257-263`):
1. In a multiple-choice poll, a person votes A.
2. They reload.
3. They tap B.
4. The client sends `[B]`, and the A vote is silently deleted.

### Facts (read by the lead on 2026-10-17)
- **Contract:** `packages/api-contract/src/message-blocks.ts` (68 lines).
  - `MessageBlocksGroup` has one endpoint, `HttpApiEndpoint.post('respond', '/blocks/respond', …)` (`:57-68`), with `Session` and `SchemaErrors` middleware and the `/api` prefix.
  - `IdText` is at `:19-22`.
  - A GET with a query struct looks like `packages/api-contract/src/ai-memory.ts:34-37` (`HttpApiEndpoint.get('view', '/ai-memory', { query: AiMemoryQuery, success: … }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' })`).
- **Server:**
  - `apps/server/src/message-blocks/api.ts` (107 lines): `handlers.handle('respond', handler(logger, (request, user) => …))` at `:74-89`.
  - `apps/server/src/message-blocks/respond.ts` (280 lines):
    - `findCard` (`:21` import, used at `:244`);
    - `cardDataOf` (`:54-60`);
    - `requireCardAccess(db, card, userId)` (`:64-88`; every refusal is the same 404 `card_not_found`).
  - `listResponses(db, cardId)` (`apps/server/src/message-blocks/cards.ts:176-190`) returns rows with `blockId`, `itemId`, `actorId`.
  - The tests in `apps/server/src/message-blocks/respond.test.ts` include a stranger-404 case at `:83`.
- **Web:**
  - `apps/web/src/lib/api/blocks.ts`: `respondToBlock` via `callApi((client) => client['message-blocks'].respond({ payload }))`.
  - `PollBlock.tsx` (152 lines): `useBlockRespond()` gives `{ messageId, … }` or `null` (`BlockRespond.tsx:12-31`).
- **Phone:**
  - `apps/mobile/src/lib/blocks-api.ts`: `respondToBlock` via `runApi(blocksClient()['message-blocks'].respond({ payload }))`.
  - `poll-block.tsx` (121 lines): `useBlockRespond()` with `messageId` (`block-respond.tsx:13`).

### Steps
1. **Contract:** add `HttpApiEndpoint.get('mine', '/blocks/mine', { query: Schema.Struct({ messageId: IdText }), success: Schema.Struct({ picks: Schema.Record(Schema.String, Schema.Array(Schema.String)) }) })`, annotated with `onExcessProperty: 'error'` like `ai-memory.ts`. No rate limit middleware.
2. **Server `respond.ts`:** add `export async function myPicks(db, userId, messageId): Promise<{ picks: Record<string, string[]> }>`.
   - It uses `findCard`; a missing card throws `cardNotFound()`. Then it runs `requireCardAccess`, then `listResponses`.
   - It keeps only rows whose `actorId === userId`, whose `itemId` is set, and whose `blockId` names a `poll` block in `cardDataOf(card)`. It groups them as `{ [blockId]: itemId[] }`.
   - Wire `handlers.handle('mine', …)` in `api.ts` with the same `handler(logger, …)` form.
3. **One test in `respond.test.ts`** (permissions): a member who voted gets their picks and not another member's, and a stranger gets the same 404.
4. **Web:**
   - Add `myBlockPicks(messageId): Promise<Record<string, readonly string[]>>` to `apps/web/src/lib/api/blocks.ts`.
   - In `PollBlock`, when `respond !== null` and there's no `initialSelection`, fetch once on mount (`useEffect` keyed by `respond.messageId` and `block.id`). Set `mine` from `picks[block.id]` only if the viewer has not tapped yet. Ignore failures: the poll stays as today.
5. **Phone:** the same in `apps/mobile/src/lib/blocks-api.ts` and `poll-block.tsx`.
6. Keep every file at most 400 lines.

### Allowed files
- `packages/api-contract/src/message-blocks.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/web/src/lib/api/blocks.ts`
- `apps/web/src/components/message/blocks/PollBlock.tsx`
- `apps/mobile/src/lib/blocks-api.ts`
- `apps/mobile/src/components/chat/blocks/poll-block.tsx`
- `work/T-1822-poll-my-votes.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- After a reload, a poll shows the viewer's own check on both apps.
- A multiple-choice re-vote keeps the earlier picks.
- A stranger gets 404 from `/api/blocks/mine`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/message-blocks.ts`): added
  `GET /api/blocks/mine` with a strict `messageId` query (same `IdText` as
  respond) and `{ picks: Record<string, string[]> }` success. It has `Session`
  and `SchemaErrors` from the group and no rate-limit middleware, as the spec
  says. Exported `BlocksMyPicksQuery` / `BlocksMyPicksResult` so the three
  callers share the shape.
- **Server** (`apps/server/src/message-blocks/respond.ts`, `api.ts`): added
  `myPicks(db, userId, messageId)`. It runs `findCard` (missing → the same
  `card_not_found` 404), then `requireCardAccess` (not visible → the same
 404), then only keeps rows from `listResponses` whose `actorId` is the
  caller, whose `itemId` is set, and whose `blockId` is a `poll` block in the
  decoded card, grouped as `{ [blockId]: itemId[] }`. Wired it as the `mine`
  handler with the same `handler(logger, …)` form.
- **Web** (`apps/web/src/lib/api/blocks.ts`,
  `apps/web/src/components/message/blocks/PollBlock.tsx`): added
  `myBlockPicks(messageId)`. `PollBlock` fetches once per `respond.messageId` +
  `block.id` (skipped for fixtures with `initialSelection`), applies
  `picks[block.id]` only when the viewer has not tapped yet (a `tapped` ref
  wins a race with the fetch), and ignores failures so the poll behaves as
  before.
- **Phone** (`apps/mobile/src/lib/blocks-api.ts`,
  `apps/mobile/src/components/chat/blocks/poll-block.tsx`): the same
  `myBlockPicks` and the same guarded mount fetch. Added the
  `// effect-plain:` marker to the poll component (the same marker web's
  `PollBlock` already has) because the Effect ratchet flags the new Promise
  handling otherwise; this is within the allowed file and does not change
  behaviour.
- **Test** (`apps/server/src/message-blocks/respond.test.ts`): one permissions
  test. Two members vote on a multiple-choice poll (A+B and B); each
  `myPicks` call returns only their own set, and a stranger gets the same 404.
  `setup()` now also seeds that poll card and returns `ownerId`.

The re-vote fix needs no server change to `replacePollVotes`: the client now
starts from the fetched set, so tapping B sends `[A, B]` instead of `[B]`.
No schema or migration change.

### Files changed

- `packages/api-contract/src/message-blocks.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/web/src/lib/api/blocks.ts`
- `apps/web/src/components/message/blocks/PollBlock.tsx`
- `apps/mobile/src/lib/blocks-api.ts`
- `apps/mobile/src/components/chat/blocks/poll-block.tsx`
- `work/T-1822-poll-my-votes.md`

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/respond.test.ts`
  → 1 test file passed, 3 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`
  → 1 test file passed, 5 tests passed (188 `/api` routes swept; the new
  `/api/blocks/mine` answers 401 without a session).
- `pnpm gate` (final run):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  PASS  effect  (1.6s)
  SKIP  tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.9s)
  PASS  tests @zilar/server  (6.8s)
  PASS  tests @zilar/web  (4.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- The first gate run failed: format on
  `apps/mobile/src/lib/blocks-api.ts` and
  `apps/server/src/message-blocks/api.ts`, then the effect ratchet on
  `apps/mobile/src/components/chat/blocks/poll-block.tsx`. I formatted those
  two files with Prettier and added the `effect-plain` marker; the final run
  above is green.

### Notes for the lead

- UI acceptance ("a reload shows the check", "a re-vote keeps earlier picks")
  is not covered by an automated test, per the AGENTS rule for UI code; it
  needs the usual phone smoke / live check.
- The route has no rate limit by design (spec step 1); it is a read-only GET
  behind `Session` and scoped to cards the caller may see.
- `myPicks` ignores non-poll blocks and block-level rows (`itemId === ''`), so
  checklist ticks, choices, ratings, buttons and forms never leak into the
  response.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `fe7fa42f4`.
- **The contract:** `GET /api/blocks/mine?messageId=`.
- **`myPicks`:** the same `findCard` and `requireCardAccess` as an answer (so a stranger gets the same 404), then only the caller's own poll rows, grouped by block. The permissions test covers a member, another member and a stranger.
- **Web and phone polls** fetch once per card. A tap made before the answer lands wins, and a failure leaves the poll blank as before.
- **Known small window:** a multiple-choice tap before the fetch returns still sends only the new pick.
- **The lead checks it live** after the deploy.

