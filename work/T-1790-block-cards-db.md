---
id: T-1790
title: "Blocks Wave 2 B8a: migration 0071 (block_cards, block_responses), row types, message-blocks/cards.ts service (record, re-key, find, record/replace responses, save data) and the pure applyResponses; poll options gain votes?"
status: merged
milestone: M5
branch: task/T-1790-block-cards-db
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1790: Interactive cards, the storage

## Spec (written by Claude, do not edit)

### Why
Cards should be interactive for any request: a live checklist, a poll, and buttons, choice, form and rating answers. The design is `docs/plan/message-blocks.md` §3 and §8 (the Wave 2 decisions, 2026-10-17). This task is **B8a**: the storage, the service and the pure state merge. B8b (record at post time) and B9 (the route and the correction) build on it.

### Facts (read by the lead on 2026-10-17)
- **The latest migration** is `apps/server/drizzle/0070_topic-members-backfill-again.sql`. Migrations are hand-written SQL files that start with `SET lock_timeout = '5s';--> statement-breakpoint` (see `apps/server/drizzle/0066_ai_questions.sql:1-19`, the shape to copy). There is no journal edit.
- **Row types for agent tables** live in `apps/server/src/db/rows-agents.ts` (203 lines; `AiQuestionRow` and `AiQuestionInsert` at `:43-76`, the shape to copy) and are re-exported through `apps/server/src/db/rows.ts`. Check how `AiQuestionRow` is exported there and do the same.
- **The service shape to copy:** `apps/server/src/questions/service.ts`.
  - It uses `runSql(db, Effect.gen(… SqlClient …))` (imports at `:1-12`).
  - The insert runs inside `sql.withTransaction` (`:69-114`).
  - The re-key is `rekeyQuestionMessage` (`:156-175`).
  - Its tests use `createTestContext` / `testSql` from `apps/server/src/test-support` and the `seedAi` / `seedUser` seeds (`questions/service.test.ts:1-29`).
- **`apps/server/src/blocks/` is user blocking.** The card code goes in `apps/server/src/message-blocks/` (which holds `build.ts` and `guide.ts`).
- **The card data:** `BlocksData` / `BlocksDataSchema` (`packages/protocol/src/blocks.ts:80-100`).
  - Checklist items carry `done` and `by?` (`packages/protocol/src/blocks-progress.ts:6-26`).
  - The poll block (`packages/protocol/src/blocks-choices.ts:41-63`) has `options[{id,label}]`, `votes?` (the total) and `multiple?`.
  - Choice has `selected?` (an index, `:70-80`). Rating has `selected?` (`:111-…`).
  - Buttons (`:12-37`) and form (`:83-108`) have no drawn state.

### Steps
1. **`apps/server/drizzle/0071_block-cards.sql`:**
   - `block_cards`:
     - `origin_id text PRIMARY KEY`;
     - `stanza_id text UNIQUE` (nullable);
     - `ai_id text NOT NULL REFERENCES ais(id) ON DELETE CASCADE`;
     - `group_id text` and `topic_id text`;
     - `room_jid text NOT NULL`;
     - `data jsonb NOT NULL`;
     - `created_at` and `updated_at` as timestamptz, defaulting to now.
   - `block_responses`:
     - `card_id text NOT NULL REFERENCES block_cards(origin_id) ON DELETE CASCADE`;
     - `block_id text NOT NULL`;
     - `item_id text NOT NULL DEFAULT ''`;
     - `actor_id text NOT NULL` (a user id);
     - `value jsonb NOT NULL`;
     - `created_at` and `updated_at`;
     - `PRIMARY KEY (card_id, block_id, item_id, actor_id)`.
   - Plus an index on `block_cards(room_jid)`.
2. **Row types** `BlockCardRow` / `BlockCardInsert` / `BlockResponseRow` in `rows-agents.ts`, re-exported like the question rows.
3. **`apps/server/src/message-blocks/cards.ts`:**
   - `recordCard(db, { originId, aiId, groupId?, topicId?, roomJid, data })`;
   - `rekeyCard(db, originId, stanzaId): Promise<boolean>`, which sets `stanza_id` only when it is null;
   - `findCard(db, id)`, matching either `origin_id` or `stanza_id`;
   - `upsertResponse(db, { cardId, blockId, itemId, actorId, value })` (`ON CONFLICT … DO UPDATE SET value, updated_at`);
   - `replacePollVotes(db, { cardId, blockId, actorId, optionIds })`, which in one transaction deletes the actor's rows for that block and inserts one row per option id (`value {}`);
   - `listResponses(db, cardId)`;
   - `saveCardData(db, originId, data)`.
4. **The pure `applyResponses(data: BlocksData, rows, nameOf: (actorId) => string | undefined): BlocksData`,** in `apps/server/src/message-blocks/apply.ts`:
   - **checklist:** for each item, the latest row by `updated_at` with that `item_id` sets `done` from `value.done`. `by` is that actor's name when done, and is removed when not done.
   - **poll:** each option's `votes` is the number of rows with its `item_id`. The block's `votes` is the number of distinct actors.
   - **choice:** `selected` comes from the latest `value.selected`.
   - **rating:** `selected` comes from the latest `value.rating`.
   - Other kinds are unchanged.
   - The function never mutates its input, and the result must still pass `BlocksDataSchema`.
5. **The protocol:** the poll block's options gain `votes: Schema.optional(CountSchema)` in `packages/protocol/src/blocks-choices.ts`.
6. **Tests (2, message pipeline)** in a new `apps/server/src/message-blocks/cards.test.ts`:
   - recording the same checklist tick twice keeps one row, and `applyResponses` marks the item done by that person;
   - a poll where two people vote and one changes their vote gives the right per-option counts and a total of 2.

### Allowed files
- `apps/server/drizzle/0071_block-cards.sql`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/db/rows.ts`
- `apps/server/src/message-blocks/cards.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/message-blocks/cards.test.ts`
- `packages/protocol/src/blocks-choices.ts`
- `work/T-1790-block-cards-db.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/cards.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The migration creates both tables.
- The service records, re-keys, finds and stores responses.
- `applyResponses` gives the shared state.
- Both tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **Migration** `apps/server/drizzle/0071_block-cards.sql`: `block_cards` (`origin_id` PK, `stanza_id` UNIQUE nullable, `ai_id` FK to `ais` ON DELETE CASCADE, `group_id`, `topic_id`, `room_jid`, `data jsonb`, `created_at`/`updated_at` timestamptz default now()) and `block_responses` (`card_id` FK to `block_cards(origin_id)` ON DELETE CASCADE, `block_id`, `item_id` default `''`, `actor_id`, `value jsonb`, timestamps, PK `(card_id, block_id, item_id, actor_id)`), plus `block_cards_room_jid_idx` on `room_jid`. Starts with `SET lock_timeout = '5s';`, one statement per `--> statement-breakpoint`, matching `0066_ai_questions.sql`. No journal edit.
- **Row types** `BlockCardRow`, `BlockCardInsert`, `BlockResponseRow` added to `apps/server/src/db/rows-agents.ts`. No edit to `rows.ts` was needed: it re-exports the whole module with `export * from './rows-agents'` (line 387), which is how `AiQuestionRow` reaches `../db/rows` too.
- **Service** `apps/server/src/message-blocks/cards.ts`: `recordCard`, `rekeyCard` (stamps `stanza_id` only when null), `findCard` (matches `origin_id` or `stanza_id`), `upsertResponse` (`ON CONFLICT … DO UPDATE SET value, updated_at`), `replacePollVotes` (delete + insert in one `sql.withTransaction`), `listResponses`, `saveCardData`. Same `runSql(db, Effect.gen(… SqlClient …))` shape as `questions/service.ts`.
- **Pure merge** `apps/server/src/message-blocks/apply.ts`: `applyResponses`, per the spec — checklist uses the latest row per `item_id` (`by` set from `nameOf` when done, removed when not), poll sets each option's `votes` to its row count and the block's `votes` to the distinct actors, choice/rating take `selected` from the latest `value.selected`/`value.rating`, other kinds pass through. Input is never mutated (spread copies + `delete` on a copy for `by`).
- **Protocol** `packages/protocol/src/blocks-choices.ts`: the poll block's `options` struct gained `votes: Schema.optional(CountSchema)`. (Note: the block-level `votes` total at `:63` already existed; the spec's step 5 is about the option.)
- **Tests** `apps/server/src/message-blocks/cards.test.ts`: (1) a checklist tick recorded twice keeps one row and `applyResponses` marks the item done by that person, leaving the other item not-done and the input untouched; (2) a poll where two people vote and one changes their vote gives per-option counts `[0, 2]` and a total of 2. Both also re-decode the result with `decodeOrThrow(BlocksDataSchema)`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/cards.test.ts` → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm gate` (repo root) → `GATE PASS`, summary lines:
  - `gate: 7 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `PASS tests @zilar/protocol`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: …`, `size: every changed source file is within 400 lines`
  - `GATE PASS`

Changed files: `apps/server/drizzle/0071_block-cards.sql`, `apps/server/src/db/rows-agents.ts`, `apps/server/src/message-blocks/cards.ts`, `apps/server/src/message-blocks/apply.ts`, `apps/server/src/message-blocks/cards.test.ts`, `packages/protocol/src/blocks-choices.ts`, `work/T-1790-block-cards-db.md`.

### Notes for the lead

- `apps/server/src/db/rows.ts` is listed as allowed but left untouched on purpose: it already wildcard-re-exports `rows-agents.ts`, so the new rows are exported the same way as the question rows with no edit (same as the existing `AiQuestionRow`).
- `itemId` on `upsertResponse` is required (matches the spec signature); block-level answers (choice/rating) pass `''`, which is also the column default. B9's caller will decide.
- `rekeyCard` and `saveCardData` also bump `updated_at` on the changed row (the spec only requires the columns; this keeps them meaningful). `rekeyCard` is a plain `WHERE … AND stanza_id IS NULL`, so a second re-key is a no-op. `saveCardData` returns whether a row changed, like the other conditional updates.
- No open questions.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `bc148038f`.
- **Migration `0071`:** both tables as specified (`block_responses` cascades from `block_cards`, `block_cards` cascades from `ais`, and the PK covers card, block, item and actor), plus the `room_jid` index, with `lock_timeout` set.
- **`cards.ts`:** record, re-key (only when `stanza_id` is null), find by either id, upsert a response, replace a poll's votes in one transaction, list, and save.
- **`apply.ts`:** the checklist takes the latest row per item and drops `by` when an item is unticked; the poll gives per-option counts and a total of distinct voters; choice and rating take the latest row. The input is never mutated.
- The protocol poll option gains `votes?`.
- I ran `cards.test.ts`: 2 passed.
- **Next:** B8b (record at post time and re-key on reflection), then B9.
