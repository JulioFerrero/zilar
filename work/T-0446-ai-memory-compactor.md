---
id: T-0446
title: "AI memory M3c (server): after each reply the server summarises up to 4 pending memory blocks with the AI's own model"
status: merged
milestone: M5
branch: task/T-0446-ai-memory-compactor
model: auto
effort: low
depends_on: [T-0444]
estimate: 0.4 day
---

# T-0446: AI memory — the compactor

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.7 (M3, last part). The mirror fills and the AI reads its memory block, but no summary node is ever built, so old messages show as raw lines cut to the 48-line budget.

After this task, every turn, once its reply is sent, builds up to 4 pending summary nodes in the background, using the AI's own model and key. The owner pays, and the daily limit holds.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/memory/store.ts`:**
  - `pendingNodes(db, aiId, chatKey, limit)` (line 437) returns the buildable blocks, smallest first, only below the 50-message window and above the floor;
  - `compactionInput(db, aiId, chatKey, block)` (line 452) returns the raw rows of a 16-block or, for a larger block, the two child summaries, which **lack their `#lo-hi` id** (lines 465-471);
  - `putNode(db, aiId, chatKey, block, summary)` (line 482) cuts with `summary.slice(0, MEMORY_LINE_MAX)` (line 496), which can leave a lone high surrogate;
  - `buildCompactionPrompt(blockId, inputLines)` (line 503).
- **`apps/server/src/agents/memory/tree.ts`:** `formatBlockId(block)` (line 152) and `MEMORY_LINE_MAX = 280`.
- **`apps/server/src/agents/memory/secrets.ts`:** `looksLikeSecret(text)` (T-0444).
- **`apps/server/src/agents/reply.ts`:** `completeChat(input: CompleteChatInput): Promise<string>` (line 292). Its input is `{ baseUrl, virtualKey, model, messages, fetchImpl?, timeoutMs?, secrets? }` (lines 128-140).
- **`apps/server/src/agents/gateway.ts`** (line numbers after T-0444):
  - `logger` (line 458), `baseUrl` (line 463) and `secretsFor(virtualKey?)` (line 495);
  - `checkDmRoundGate(session)` returns `{ limited: true, … }` when the AI is stopped or its daily limit is reached, and otherwise null;
  - `modelNameForAi(aiId)` is imported at line 18;
  - **the room turn** ends with `await sendBudgetWarnings({ … chatKey: groupChatKey … })` at lines 1754-1759, inside the `try` where `virtualKey` is set;
  - **the DM turn** ends with `await sendBudgetWarnings({ … chatKey: dmChatKey … })` at lines 1988-1993.
- **`apps/server/src/agents/gateway.test.ts`:**
  - `completionFetch()` answers every call with the text `AI says hi` and records each call in `calls`;
  - `harness(...)` builds the deps.

  No existing test seeds 66 or more `aiMemoryMessages` rows, so no existing test reaches a pending block.

### What to build
1. **`store.ts`:**
   - `compactionInput` prefixes each child summary with its id, `#${lo}-${hi - 1} ${summary}`, the same form as `renderMemoryBlock`;
   - `putNode` cuts to `MEMORY_LINE_MAX` and then drops a trailing lone high surrogate (`\uD800-\uDBFF`).

   Update `store.test.ts` for both.
2. **New `apps/server/src/agents/memory/compactor.ts`:** export `compactMemory(input)`, where `input` is `{ db, aiId, chatKey, complete: (prompt: string) => Promise<string>, limit?: number /* default 4 */ }`. It returns `{ built: number; withheld: number }`. For each block from `pendingNodes(db, aiId, chatKey, limit)`, in order:
   1. `lines = compactionInput(...)`;
   2. when `lines` is empty, the summary is `(nothing kept)`;
   3. otherwise `raw = await complete(buildCompactionPrompt(formatBlockId(block), lines))`, and the summary is the first non-empty line of `raw`, trimmed. An empty result becomes `(nothing kept)`;
   4. when `looksLikeSecret(summary)`, the summary becomes `(summary withheld)` and counts as `withheld`;
   5. `putNode(...)` and count it as `built`.

   A `complete` that throws stops the loop and is rethrown. It never logs.
3. **`gateway.ts`:**
   - add an in-memory `Set<string>` of running compactions, keyed `${aiId}:${chatKey}`;
   - add a local `startCompaction(session, chatKey, virtualKey)`:
     - it returns at once when the key is running;
     - otherwise it adds the key and runs **without being awaited** (`void (async () => { … })()`):
       1. `if ((await checkDmRoundGate(session)) !== null) return;`
       2. `compactMemory({ db: deps.db, aiId, chatKey, complete: (prompt) => completeChat({ baseUrl, virtualKey, model: modelNameForAi(aiId), messages: [{ role: 'user', content: prompt }], ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }), secrets: secretsFor() }) })`;
       3. when `built > 0`, log `logger.info({ aiId, chatKey, built, withheld, ms }, 'AI memory compacted')`;
       4. on an error, log `logger.warn({ err: toRedactedError(error, secretsFor(virtualKey)), aiId }, 'AI memory compaction failed')`;
       5. `finally`, delete the key.
   - **Call it** right after each `sendBudgetWarnings(...)`: room with `groupChatKey`, DM with `dmChatKey`, passing `virtualKey`.
   - **Never** log a summary, prompt or message text.
4. **New `apps/server/src/agents/memory/compactor.test.ts`** (test database, fake `complete` that records prompts):
   - with 66 seeded mirror rows (seq 0-65), one pass builds the node `0-15`. The prompt contains the 16 `#seq …` lines, and the stored summary is the fake's first line;
   - with 112 rows, the first pass builds `0-15` and `16-31`; then `0-31` is built from the two child summaries, and its prompt contains `#0-15 ` and `#16-31 `. Each pass makes at most 4 calls;
   - a secret-like reply is stored as `(summary withheld)` and counted;
   - an all-deleted block is stored as `(nothing kept)` without calling `complete`;
   - a throwing `complete` builds nothing for that block and rethrows.
5. **`gateway.test.ts`:**
   - a DM turn with 66 seeded mirror rows for `dm:<owner bare JID>`:
     - after the reply, a second LiteLLM call is made (wait for it with `vi.waitFor`) whose user message starts with `Compress chat memory #0-15`;
     - an `aiMemoryNodes` row `0-15` exists with the summary `AI says hi`;
     - the reply itself was sent before that call;
   - with the daily limit reached (use the existing limit-test setup), the same seeding makes no compaction call;
   - no log line contains a mirror text.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.7, `apps/server/src/agents/memory/store.ts:430-512`, `apps/server/src/agents/memory/tree.ts:120-170`, `apps/server/src/agents/memory/secrets.ts`, `apps/server/src/agents/reply.ts:128-140` and `:285-298`, `apps/server/src/agents/gateway.ts:455-500`, `:850-880`, `:1745-1762` and `:1980-1996`, `apps/server/src/agents/gateway.test.ts:422-540` and the daily-limit tests near line 1331.

### Allowed files
`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/store.test.ts`, `apps/server/src/agents/memory/compactor.ts`, `apps/server/src/agents/memory/compactor.test.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0446-ai-memory-compactor.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/compactor memory/store agents/gateway
pnpm gate
```

### Acceptance
- After a reply, up to 4 pending blocks are summarised in the background with the AI's own model and key. The run never delays or fails the reply, and never runs twice at once for one chat or past the daily limit.
- Summaries are one line, at most 280 characters; secret-like ones are withheld.
- No log line holds text.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **`store.ts`**
  - `compactionInput`: a child summary is now prefixed with its id (`#${lo}-${hi - 1} ${summary}`), matching `renderMemoryBlock` and `zoomMemory`.
  - `putNode`: cuts to `MEMORY_LINE_MAX` then drops a trailing lone high surrogate (`\uD800-\uDBFF`), so a cut never leaves half an astral character.
- **`memory/compactor.ts` (new)**: `compactMemory({ db, aiId, chatKey, complete, limit? })` returns `{ built, withheld }`. For each `pendingNodes` block in order: empty input → `(nothing kept)` with no model call; otherwise the first non-empty trimmed line of `complete(buildCompactionPrompt(...))` (empty → `(nothing kept)`); a `looksLikeSecret` summary becomes `(summary withheld)` and counts as `withheld`; then `putNode` and `built += 1`. A throwing `complete` stops the loop and is rethrown. It never logs.
- **`gateway.ts`**: added a module-local `Set<string>` of running compactions keyed `${aiId}:${chatKey}` and a local `startCompaction(session, chatKey, virtualKey)` that returns at once if the key is already running, then runs un-awaited: `checkDmRoundGate` re-check → `compactMemory` with `completeChat` on the AI's own `baseUrl`/`virtualKey`/`modelNameForAi(aiId)` and `secrets: secretsFor()` → `logger.info({ aiId, chatKey, built, withheld, ms }, 'AI memory compacted')` when `built > 0`; on error `logger.warn({ err: toRedactedError(error, secretsFor(virtualKey)), aiId }, 'AI memory compaction failed')`; `finally` deletes the key. Called right after each `sendBudgetWarnings` (room `groupChatKey`, DM `dmChatKey`). No summary/prompt/message text is logged.
- **`store.test.ts`**: updated the `compactionInput` expectation to `['#0-15 L', '#16-31 R']`; added a `putNode` test for the 280-cut and the trailing-surrogate drop (`'a'.repeat(279) + emoji + 'tail'` → `'a'.repeat(279)`, no trailing high surrogate).
- **`memory/compactor.test.ts` (new)**: 66 rows → one pass builds `0-15`, the prompt holds all 16 `#seq …` lines, the stored summary is the fake's first line; 112 rows → multi-level build with ≤ 4 calls per pass and a child-summary prompt; secret-like reply → `(summary withheld)` + `withheld` 1; all-deleted block → `(nothing kept)` with `complete` never called; throwing `complete` → rethrows and builds no node.
- **`gateway.test.ts`**: added `aiMemoryNodes` import and a `memory compaction (T-0446)` block: a DM turn with 66 seeded mirror rows makes a second LiteLLM call whose user message starts with `Compress chat memory #0-15`, stores node `0-15` with summary `AI says hi`, the reply is in `core.sent` before the compaction call is issued, and no log line/field contains the reply text or any `mirror-<n>` text; a second test jumps spend past the cap during the reply call so the compactor's own gate sees the limit and makes no compaction call (one model call total, no nodes).

### Files changed (all Allowed)

`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/store.test.ts`, `apps/server/src/agents/memory/compactor.ts` (new), `apps/server/src/agents/memory/compactor.test.ts` (new), `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0446-ai-memory-compactor.md`.

### Commands and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory/store.test.ts src/agents/memory/compactor.test.ts` → 2 files passed, 29 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway.test.ts` → 1 file passed, 132 tests passed.
- Checks command `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/compactor memory/store agents/gateway` → 3 files passed, 161 tests passed.
- `pnpm gate` → `PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- First `pnpm gate` failed on `format` only for `compactor.test.ts`; fixed with `pnpm exec prettier --write apps/server/src/agents/memory/compactor.test.ts` (no behaviour change), then gate passed.

### Deviations / notes

- The spec's example says "with 112 rows, the first pass builds 0-15 and 16-31". With `MEMORY_WINDOW = 50` a 112-row chat has `end = 62`, so three size-16 blocks are pending (`0-15`, `16-31`, `32-47`) and the first pass (limit 4) builds all three; the second pass builds `0-31` from the two child summaries. The test asserts the observed build counts (`built === calls`, each pass ≤ 4) plus the required nodes rather than exactly two, and still pins the child-summary prompt (`#0-15 `, `#16-31 `).
- `completeChat` is called with `secrets: secretsFor()` exactly as written; `requestCompletion` already adds `virtualKey` to the redaction list, and the gateway catch redacts with `secretsFor(virtualKey)`.
- The daily-limit test crosses the cap inside the reply call so the compactor's own `checkDmRoundGate` guard is the thing being exercised; it still uses the existing 0.5-baseline / limit-test pattern.

### Open questions

None.

## Review (written by Claude)

Approved (lead, 2026-10-07). compactMemory builds up to 4 pending nodes, smallest first. A 16-block is built from its raw rows and a larger block from its #lo-hi child summaries. It keeps the first non-empty line, stores "(nothing kept)" for an all-deleted block without a model call, and withholds a secret-like summary. The gateway fires startCompaction after the budget warnings in DM and room turns. It is not awaited, runs once per (AI, chat), and is skipped when the AI is stopped or over its daily limit. It uses the AI's model and virtual key, and the logs carry counts only. store.ts: child ids in the compaction input and a surrogate-safe putNode cut.
