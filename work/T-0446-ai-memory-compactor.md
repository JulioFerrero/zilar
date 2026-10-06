---
id: T-0446
title: "AI memory M3c (server): after each reply the server summarises up to 4 pending memory blocks with the AI's own model"
status: todo
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

## Review (written by Claude)
