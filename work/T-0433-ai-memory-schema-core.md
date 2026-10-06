---
id: T-0433
title: "AI memory M1 (server): the memory tables (one migration) and the pure tree core (cover, pending, block ids) ported from OptMem"
status: merged
milestone: M5
branch: task/T-0433-ai-memory-schema-core
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0433: AI memory — schema and tree core

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-06 that Zilar AIs get automatic, always-on long-term memory. The plan is `docs/audit/ai-memory-plan.md`, and this task is M1 (§4). It is **the only schema task**: it adds the tables and the pure algorithm, with no gateway wiring. The algorithm is a fresh TypeScript implementation of the behaviour of OptMem's `cover()` and `pending()`, described below. OptMem has no license file, so write it from this description and copy no code.

### Verified facts (do not re-derive)
- **Schema:**
  - Drizzle schema in `apps/server/src/db/schema.ts`. The `ais` table is at line 516, with `id: text('id').primaryKey()`.
  - The pattern for new tables is `mediaItems` (line 1231) and `mediaIndexState` (line 1276), which use `pgTable`, `primaryKey({ columns })`, `bigint(..., { mode: 'number' })` and `timestamp(..., { withTimezone: true }).notNull().defaultNow()`.
  - Generate the migration with `pnpm --filter @zilar/server db:generate`. The current head is `apps/server/drizzle/0041_blue_magneto.sql`, so yours is `0042_*`.
- **OptMem's `_cover(T, alpha)`** (memo.py:82-102):
  - start with one root of size = the next power of two ≥ T;
  - split a block `[lo,hi)` when `size > 1` and (`hi > T` or `size > alpha*(T-lo)`);
  - blocks with `lo >= T` are dropped.
- **`cover(T, budget)`** (memo.py:105-131):
  - if T ≤ budget, return every single item;
  - otherwise bisect alpha in [0,1] for 60 steps, taking the smallest cover that fits the budget;
  - then, while lines are under budget, split the **last** block of size > 1 (the newest).
- **`pending(T)`** (memo.py:437-449): for each size 2, 4, 8, … ≤ T, the blocks `k*size` from the first missing one up to `floor(T/size)`, smallest size first.

### What to build
1. **Schema (`schema.ts`):** four tables, exactly as in plan §3.1.
   - **`aiMemoryMessages` (`ai_memory_messages`):**
     - columns: `aiId` (text, FK `ais.id`, on delete cascade), `chatKey` (text), `seq` (integer), `messageId` (text), `at` (timestamptz), `sender` (text), `text` (text), `deleted` (bool, default false), `createdAt`;
     - PK (`aiId`, `chatKey`, `seq`); unique (`aiId`, `chatKey`, `messageId`).
   - **`aiMemoryNodes` (`ai_memory_nodes`):** `aiId` (FK cascade), `chatKey`, `lo` (int), `hi` (int), `summary` (text), `createdAt`. PK (`aiId`, `chatKey`, `lo`, `hi`).
   - **`aiMemoryFacts` (`ai_memory_facts`):** `id` (text PK), `aiId` (FK cascade), `chatKey`, `text`, `createdAt`. Index (`aiId`, `chatKey`, `createdAt`).
   - **`aiMemoryState` (`ai_memory_state`):** `aiId` (FK cascade), `chatKey`, `indexedThroughMicros` (bigint number, not null, default 0), `floorSeq` (int, not null, default 0), `updatedAt`. PK (`aiId`, `chatKey`).
   - Add a comment on each table naming the plan and its role, in the style of the comments around `mediaItems`.
2. **Migration:** generated, never hand-edited. Check the SQL only creates these 4 tables and their indexes and FKs.
3. **New `apps/server/src/agents/memory/tree.ts`**, pure functions with no I/O:
   - `type Block = { lo: number; hi: number }`, where `hi` is exclusive;
   - `MEMORY_MIN_BLOCK = 16`, `MEMORY_WAKE_LINES = 48`, `MEMORY_LINE_MAX = 280`;
   - `cover(total: number, budget: number, minBlock = MEMORY_MIN_BLOCK): Block[]` is OptMem's `cover`, with one change: a block may only be size 1 or a power of two ≥ `minBlock`. A split that would make blocks smaller than `minBlock` (and bigger than 1) splits straight into single items, and only when the budget allows. If the singles don't fit, keep the `minBlock`-sized block whole. The result is sorted, contiguous and covers `[0,total)` exactly. Never more than `budget` blocks, unless even the coarsest valid tiling cannot fit; document that case.
   - `pending(total: number, built: (b: Block) => boolean, minBlock = MEMORY_MIN_BLOCK): Block[]`: buildable blocks, smallest size first, sizes `minBlock`, 2·`minBlock`, …; a block of size > `minBlock` is listed only when both halves are built.
   - `parseBlockId(id: string): Block | null` reads `"16-31"`: inclusive on both ends, an aligned power of two ≥ 2, else `null`. `formatBlockId(b)` is its inverse.
4. **New `apps/server/src/agents/memory/tree.test.ts`:**
   - every item verbatim when `total ≤ budget`;
   - never over the budget, for total in [1..2000] × budget in [8, 48, 96];
   - contiguous and exact coverage;
   - only sizes 1 or ≥ `minBlock`, and every block aligned (`lo % size === 0`);
   - the last block is the finest: block size never grows toward the end;
   - `pending` lists smallest first and never lists a parent before both halves are built;
   - `parseBlockId` rejects `"4-5"` with min 16, `"5-6"`, `"3-10"` and junk, and round-trips with `formatBlockId`.

No other file. No gateway, route or indexer changes: those are M2-M4.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md`, `apps/server/src/db/schema.ts:510-560` and `:1225-1290`.

### Allowed files
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0042_*.sql` (generated), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0042_snapshot.json`, `apps/server/src/agents/memory/tree.ts`, `apps/server/src/agents/memory/tree.test.ts`, `work/T-0433-ai-memory-schema-core.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/tree
pnpm gate
```

### Acceptance
- One generated migration adds the four tables (no other schema change).
- `tree.ts` ports `cover` and `pending` with the 16-block minimum, with property-style tests.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **Schema (`apps/server/src/db/schema.ts`):** appended four tables after `mediaIndexState`, each with a comment naming the plan and its role:
  - `aiMemoryMessages` (`ai_memory_messages`): `aiId` FK `ais.id` cascade, `chatKey`, `seq` int, `messageId`, `at` timestamptz, `sender`, `text`, `deleted` bool default false, `createdAt`; PK (`aiId`,`chatKey`,`seq`); unique index (`aiId`,`chatKey`,`messageId`).
  - `aiMemoryNodes` (`ai_memory_nodes`): `aiId` FK cascade, `chatKey`, `lo`, `hi`, `summary`, `createdAt`; PK (`aiId`,`chatKey`,`lo`,`hi`).
  - `aiMemoryFacts` (`ai_memory_facts`): `id` text PK, `aiId` FK cascade, `chatKey`, `text`, `createdAt`; index (`aiId`,`chatKey`,`createdAt`).
  - `aiMemoryState` (`ai_memory_state`): `aiId` FK cascade, `chatKey`, `indexedThroughMicros` bigint(number) not null default 0, `floorSeq` int not null default 0, `updatedAt`; PK (`aiId`,`chatKey`).
- **Migration:** generated, not hand-edited: `apps/server/drizzle/0042_lethal_tattoo.sql` plus `drizzle/meta/0042_snapshot.json` and the `_journal.json` entry. The SQL creates exactly the four tables, their four FKs (all `ON DELETE cascade`) and two indexes (`ai_memory_facts_chat_created_idx`, unique `ai_memory_messages_unique_idx`). No other table is touched.
- **Tree core (`apps/server/src/agents/memory/tree.ts`):** pure, no I/O. `cover(total, budget, minBlock = 16)` reproduces OptMem's `_cover`/`cover` with the min-block rule (blocks are size 1 or a power of two ≥ 16; a split that would fall below 16 shatters into singles only when the budget allows); blocks are dropped when `lo >= total`, so the result covers `[0,total)` exactly. It bisects `alpha` 60 steps for the finest tiling that fits, then spends leftover lines splitting the newest block. `pending(total, built, minBlock)` lists buildable blocks smallest size first, a parent only once both halves are built. `parseBlockId`/`formatBlockId` are inverses over aligned power-of-two ids. Exports the three constants.
- **Tests (`apps/server/src/agents/memory/tree.test.ts`):** 13 tests: verbatim when `total ≤ budget`; never over budget (with the documented exception below) for `total` 1..2000 × budget {8,48,96}; exact contiguous coverage; sizes 1 or ≥ 16 with `lo % size === 0`; non-increasing size toward the end; leftover spent on the newest block; `pending` ordering and halves rule; `parseBlockId` rejects `"4-5"` (with min 16 and default), `"5-6"`, `"3-10"`, junk, non-powers and unaligned ids, and round-trips with `formatBlockId`.

### Files changed

`apps/server/src/db/schema.ts`, `apps/server/drizzle/0042_lethal_tattoo.sql`, `apps/server/drizzle/meta/0042_snapshot.json`, `apps/server/drizzle/meta/_journal.json`, `apps/server/src/agents/memory/tree.ts`, `apps/server/src/agents/memory/tree.test.ts`, `work/T-0433-ai-memory-schema-core.md` — all inside the Allowed files.

### Commands run (real results)

- `pnpm install` → done, no lockfile change.
- `pnpm --filter @zilar/server db:generate` → wrote `drizzle/0042_lethal_tattoo.sql`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/tree` → **1 file, 13 tests passed** (4.15s).
- `pnpm gate` (from repo root) →
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.9s)
  PASS  lint  (0.5s)
  PASS  typecheck  (5.6s)
  PASS  tests @zilar/server  (217.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec

- **Coarsest-doesn't-fit exception is real and tested.** With `minBlock` 16, a 15-item tail forces the coarsest valid tiling to carry 15 singles, so a budget of 8 can be below even the coarsest tiling. `cover` returns that coarsest tiling as-is (documented in a code comment) rather than dropping memory; the over-budget test asserts exact equality with an independent coarsest-count oracle in that case.
- **`parseBlockId` takes an optional `minBlock` (default 16).** The spec's signature showed no parameter but the test asked to reject `"4-5"` "with min 16"; the optional param satisfies both (default 16 rejects it, `parseBlockId(id, 2)` accepts it).
- **Internal performance only:** the private `coverForAlpha` accepts a block-count limit so the bisection can reject over-budget candidates early; the public results are unchanged and the 1..2000 sweep runs in a few seconds.

### Security checklist

Schema + pure functions only: no routes, no I/O, no logs, no secrets. All new FKs are scoped to one `aiId` with `ON DELETE cascade`, so deleting an AI removes its memory. No open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). Migration 0042 only adds ai_memory_messages, ai_memory_nodes, ai_memory_facts and ai_memory_state, with FK cascade to ais and the unique (ai, chat, message) index. tree.ts is a fresh implementation of the OptMem cover/pending behaviour with a 16 minimum block: a split below the minimum shatters into singles, the coarsest tiling is returned over budget by design (with a 48 budget it stays under about 21 lines), and leftover lines split the newest block. pending is smallest first and lists a parent only once both halves exist. Block ids are validated. The pre-review was clean. Callers pass total = T-50 so the window is never summarised.
