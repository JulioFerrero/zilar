---
id: T-0480
title: "Listener S5a (server): delegation service — permission check, create (with caps), read for task_status, finish; pure DB module, not wired yet"
status: merged
milestone: M5
branch: task/T-0480-delegation-service
model: auto
effort: low
depends_on: [T-0470]
estimate: 0.35 day
---

# T-0480: the delegation service

## Spec (written by Claude, do not edit)

### Why
This is the data half of plan task S5, from `docs/audit/listener-delegation-plan.md` §4.1, §4.3, §4.4 and §8. It covers the decision "any AI in the group may receive a task if its owner allowed it". A boss AI with `canDelegate` hands a task to a worker AI with `acceptsDelegation` in the same room. The task is stored in `ai_delegations`.

This task builds **only the DB module and its tests**. The `delegate` and `task_status` tools and the gateway wiring are a later task. Nothing calls this module yet.

### Verified facts (do not re-derive)
- **`ai_delegations`** (`apps/server/src/db/schema.ts:612-651`) has these columns:
  - `id` (text PK), `fromAiId` and `toAiId` (FK `ais`, cascade), `groupId` (FK, cascade), `topicId` (nullable FK);
  - `objective` (text, not null), `contextSummary`;
  - `acceptance`, `constraints` and `artifacts` (jsonb `string[]`, default `[]`);
  - `budgetCurrency`, `budgetMax` (numeric 12,2), `returnFormat`, `replyTo`;
  - `status` (`'working'|'completed'|'failed'|'canceled'`, default `working`), `resultSummary`, `createdAt`, `updatedAt`.
  
  A check enforces `from_ai_id <> to_ai_id`.
- **The `ais` columns** `canDelegate` and `acceptsDelegation` (booleans, default false) come from T-0470. `ais.status` is `'active'|'disabled'|'stopped'` (`schema.ts:576`).
- **Room AI membership:** the General topic room uses `groupAis` (groupId, aiId) and other topics use `topicAis` (topicId, aiId). That is the same rule as `loadRoster` in `apps/server/src/agents/listener/score.ts:47-63` (`topicId` given → `topicAis`, otherwise → `groupAis`). `topics.isGeneral` is in `schema.ts` (around line 414).
- **Ids:** the code uses `randomUUID()` from `node:crypto`, as in `apps/server/src/agents/memory/store.ts:390`.
- **The DB test pattern:** `createTestContext`, `TEST_XMPP_DOMAIN` and `TestContext` come from `apps/server/src/test-support`. Seed helpers (`seedOwner`, `seedAi`, `seedGroup`, `seedTopic`) are written inline in `apps/server/src/agents/listener/score.test.ts:26-90`; copy that style.

### What to build
**New file `apps/server/src/agents/delegation/service.ts`:**

1. **Caps, as exported consts:**
   - `objective` ≤ 1000 chars;
   - `contextSummary` ≤ 1200 chars (about 300 tokens);
   - `acceptance`, `constraints` and `artifacts`: each ≤ 10 items of ≤ 300 chars;
   - `returnFormat` ≤ 200 chars;
   - `resultSummary` ≤ 8000 chars (about 2k tokens).
   
   **Over-long text is cut, not rejected; extra items are dropped.** An empty `objective` after a trim is rejected.
2. **`checkDelegation(db, { fromAiId, toAiId, groupId, topicId })`** returns `{ ok: true } | { ok: false; reason: 'same_ai' | 'cannot_delegate' | 'not_accepting' | 'not_in_room' | 'inactive' }`. The rules:
   - the two ids are different;
   - the source AI has `canDelegate`;
   - the target has `acceptsDelegation`;
   - both are `active`;
   - both are in the room. If `topicId` is a non-General topic, both must be in `topicAis` for it; otherwise both must be in `groupAis` for the `groupId`. Look `isGeneral` up from `topics` when a `topicId` is given.
   
   Unknown ids give `inactive`.
3. **`createDelegation(db, input)`** runs `checkDelegation`, then inserts a row with `status: 'working'` and the capped fields. It returns `{ ok: true; delegation: { id, toAiId, objective, status } } | { ok: false; reason }`. The input is the handoff shape: `{ fromAiId, toAiId, groupId, topicId?, objective, contextSummary?, acceptance?, constraints?, artifacts?, budget?: { currency, max }, returnFormat?, replyTo? }`. `budget.max` must be ≥ 0, or it is dropped.
4. **`getDelegationForAi(db, id, aiId)`** returns `{ id, fromAiId, toAiId, status, objective, resultSummary, artifacts, updatedAt }` **only when** `aiId` is the `fromAiId` or the `toAiId`, and `null` otherwise (no leak across AIs).
5. **`finishDelegation(db, { id, aiId, status: 'completed'|'failed', resultSummary?, artifacts? })`** succeeds only when `aiId` is the `toAiId` and the row is still `working`. It updates `status`, the capped `resultSummary`, the `artifacts` (when given) and `updatedAt`, then returns `true`, and `false` otherwise. **One conditional `UPDATE … WHERE id AND to_ai_id AND status='working'`**, so a race cannot finish a row twice.
6. **`cancelDelegation(db, { id, aiId })`:** only the `fromAiId`, only while `working`, by the same single conditional update. It returns a boolean.

**Tests,** in the new file `apps/server/src/agents/delegation/service.test.ts`:
- each `checkDelegation` reason, plus success for the General topic (`groupAis`) and a non-General topic (`topicAis`);
- an AI in the group but not in the topic gives `not_in_room`;
- `create` caps long text and drops extra items;
- an empty objective is rejected;
- `get` returns null for a third AI;
- `finish`: only by the target, only once, so a second call returns false;
- `cancel`: only by the source.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §4 and §8, `apps/server/src/db/schema.ts:600-652` (and `groupAis`, `topicAis`, `topics`), `apps/server/src/agents/listener/score.ts:1-63`, `apps/server/src/agents/listener/score.test.ts:1-110`, `apps/server/src/agents/memory/store.ts` (the DB style).

### Allowed files
`apps/server/src/agents/delegation/service.ts`, `apps/server/src/agents/delegation/service.test.ts`, `work/T-0480-delegation-service.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/delegation
pnpm gate
```

### Acceptance
- The service enforces the permission and room rules, caps the inputs, and stops other AIs from reading a delegation.
- A delegation finishes once, by its target, and cancels only by its source.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Built the delegation DB module and its tests, nothing wired to the gateway.

- `apps/server/src/agents/delegation/service.ts` — new module:
  - exported caps `OBJECTIVE_MAX` (1000), `CONTEXT_SUMMARY_MAX` (1200), `DELEGATION_LIST_MAX` (10), `DELEGATION_ITEM_MAX` (300), `RETURN_FORMAT_MAX` (200), `RESULT_SUMMARY_MAX` (8000);
  - `checkDelegation` (same AI, source `canDelegate`, target `acceptsDelegation`, both `active`, room membership via `groupAis` for the group / General topic and `topicAis` for a non-General topic; unknown ids read as `inactive`);
  - `createDelegation` (runs the check, trims objectives, caps text and lists, drops extra list items, drops a negative budget, stores `working`);
  - `getDelegationForAi` (only `fromAiId` or `toAiId`; a third AI gets `null`);
  - `finishDelegation` and `cancelDelegation` (one conditional `UPDATE … WHERE … status='working'`, so a race cannot finish or cancel twice).
- `apps/server/src/agents/delegation/service.test.ts` — new tests covering every `checkDelegation` reason, group (`groupAis`) and non-General topic (`topicAis`) success, the "in group but not in topic" case, caps, empty objective, budget drop, third-AI read, single finish and source-only cancel.

### Files changed
- `apps/server/src/agents/delegation/service.ts` (new)
- `apps/server/src/agents/delegation/service.test.ts` (new)
- `work/T-0480-delegation-service.md` (status + this report)

No other file was touched.

### Commands and real results
- `pnpm install` — done (only the existing `apps/mobile` `@types/react-dom` peer warning; no change needed).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/delegation` — 1 test file passed, **18 tests passed**.
- `pnpm gate` — **GATE PASS**. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first two gate runs failed (format on my two files; then typecheck: `.returning({ id })` is not accepted on the `ServerDatabase` union, and two destructured test rows needed an `undefined` guard). Both fixed inside the Allowed files.

### Deviations / notes
- The spec does not name a reason for an empty objective. I added `'empty_objective'` to the `createDelegation` failure union (`DelegationCheckReason | 'empty_objective'`); `checkDelegation`'s own union is unchanged.
- `finishDelegation` always writes the capped `resultSummary` (null when omitted) and writes `artifacts` only when given. `cancelDelegation` takes `{ id, aiId }` and returns a boolean as specified.
- Check order is: `same_ai` → unknown id → `cannot_delegate` → `not_accepting` → `inactive` → `not_in_room`. `createDelegation` runs the permission check first, then rejects an empty objective, then inserts.

### Round 2 (fix round)
Findings fixed:
- **Finding 1 (should-fix):** `bothInRoom` now selects `topics.groupId` alongside `isGeneral` and returns `false` when the topic does not belong to the passed `groupId`, so a mismatched `{ groupId: A, topicId: T of group B }` is rejected as `not_in_room` for both General and non-General topics. No other logic changed.

Tests added:
- `rejects a non-General topic that belongs to another group` — both AIs are in the topic's `topicAis`, but the topic belongs to another group, so the check returns `not_in_room`.
- `rejects a General topic that belongs to another group` — both AIs are in the passed group's `groupAis`, but the General topic belongs to another group, so it returns `not_in_room`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/delegation` — 1 file passed, **20 tests passed** (was 18).

Finding 2 (nit, budget `currency`/extreme `max`) was left as is: it is a nit and the line is outside the finding-1 change, so it stays untouched per the fix-round instructions.

Gate:
- `pnpm gate` — **GATE PASS**. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

Approved (lead, 2026-10-07). agents/delegation/service.ts provides:
- checkDelegation (same_ai, cannot_delegate, not_accepting, inactive, not_in_room; General through group_ais, other topics through topic_ais);
- createDelegation with capped fields;
- getDelegationForAi, limited to the two AIs involved;
- finishDelegation and cancelDelegation, each a single conditional UPDATE.
Pre-review clean after one auto round. Not wired yet (S5b).
