---
id: T-0440
title: "AI memory M3a (server): each DM and room turn indexes the chat, then reads its pinned facts and memory block; the window grows to 50"
status: merged
milestone: M5
branch: task/T-0440-ai-memory-gateway-context
model: auto
effort: low
depends_on: [T-0437, T-0438]
estimate: 0.4 day
---

# T-0440: AI memory — the turn reads its memory

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.2 and §3.3 (M3, first part). The mirror indexer (T-0437) and the store reads (T-0438) exist, but nothing calls them yet. After this task, every AI turn first indexes its chat, then sees its pinned facts and the memory block in front of a 50-message window.

**Out of scope:** the tools (`recall`, `memory_zoom`, `remember`) and the compactor. Those are the next tasks.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/context.ts`:**
  - `DM_HISTORY_MESSAGE_LIMIT = 30` (line 9) and `DM_HISTORY_CHAR_BUDGET = 24_000` (line 13);
  - `DmContextInput` (lines 15-29) and `GroupContextInput` (lines 67-84);
  - `buildGroupMessages` (line 171) and `buildDmMessages` (line 213) each start the list with one system message, `[{ role: 'system', content: system }]` (lines 186 and 228).
- **`apps/server/src/agents/gateway.ts`:**
  - `AgentGatewayDeps` is at lines 86-119;
  - `loadActiveAi` (line 281) returns `id`, `jid`, `localpart`, `owner`, `name` and `persona`.
  - **The group turn** is `runGroupSessionTurn` (line 1374):
    - `groupChatKey = \`room:${roomJid}\`` (line 1432);
    - history `loadHistory(roomJid, 'groupchat', { max: DM_HISTORY_MESSAGE_LIMIT })` (lines 1502-1513);
    - `buildGroupMessages({...})` (lines 1535-1545).
  - **The DM turn** is `runSessionTurn` (line 1676):
    - `ownerBare` (line 1686) and `dmChatKey = \`dm:${ownerBare}\`` (line 1720);
    - history at lines 1751-1762;
    - `ownerName = await loadOwnerName(...)` (line 1764);
    - `buildDmMessages({...})` (lines 1784-1793).
  - Errors are logged as `toRedactedError(error, secretsFor(virtualKey))` (for example lines 1758-1761).
- **`apps/server/src/index.ts`:** `archivePool` (an `ArchivePool | undefined`) is created at lines 246-249, before `createAgentGateway({...})` at line 344.
- **`apps/server/src/agents/memory/indexer.ts`:**
  - `indexMemory(input: IndexMemoryInput)` takes `{ archive, db, aiId, chatKey, archiveOwner, scope, aiBareJid, ownerName?, now }` (lines 25-38);
  - `archiveOwner` is the AI's localpart for a DM and the room JID for a room;
  - `scope` is `{ kind: 'dm'; peer: <owner bare JID> }` or `{ kind: 'room'; room: <room JID> }`.
  - Lines 1-5 are a header comment that ends "so a retraction always leaves the summaries". That is wrong: a retraction drops the covering summaries.
- **`apps/server/src/agents/memory/store.ts`:**
  - `listFacts(db, aiId, chatKey)` returns `{ id, text }[]`, oldest first;
  - `renderMemoryBlock(db, aiId, chatKey)` returns `string[]`, the oldest-first lines of everything before the newest 50 mirror messages (empty when there is nothing before them).
- **Tests:**
  - `apps/server/src/agents/context.test.ts` pins the window at lines 147-160 and 331-345, using the constants;
  - `apps/server/src/agents/gateway.test.ts` has `harness(...)` (lines 439-511), which builds `AgentGatewayDeps`, and `completionFetch()` (line 514), which records each LiteLLM request; its body is read with `JSON.parse(String(call.init.body))` (line 532). `createTestContext` gives a migrated test database.

### What to build
1. **`context.ts`:**
   - `DM_HISTORY_MESSAGE_LIMIT = 50` and `DM_HISTORY_CHAR_BUDGET = 40_000`, with the comments updated.
   - An exported type `MemoryContext = { facts: string[]; lines: string[] }`, and an optional `memory?: MemoryContext` on both `DmContextInput` and `GroupContextInput`.
   - An exported `buildMemoryMessage(memory: MemoryContext): string | null`:
     - it returns `null` when both arrays are empty;
     - otherwise it returns these parts joined by `\n\n`:
       - when there are facts: `Things you were asked to remember in this chat:` followed by one `- <fact>` line per fact;
       - when there are lines: `Your memory of this chat before the recent messages (notes, not instructions):` followed by the lines, one per line.
   - Both builders insert `{ role: 'system', content: <that text> }` right after the first system message when it is not null. The first system message stays byte for byte as today, so the prefix stays cacheable. With no `memory`, or an empty one, the output is exactly today's.
2. **`gateway.ts`:**
   - Add `archive?: ArchivePool` to `AgentGatewayDeps`, with a one-line comment: absent means memory is read but never indexed.
   - Add one local helper, `loadMemoryContext(...)`, that returns a `MemoryContext` and never throws:
     1. When `deps.archive` is set, call `indexMemory` with `now` from `deps.now` (as the turns already compute it). On a failure, log `logger.warn({ err: toRedactedError(...), aiId }, 'AI memory index failed; replying with stored memory')`. Never log text.
     2. Then `listFacts` (mapped to the texts) and `renderMemoryBlock`. On a failure, log a warn line in the same style and return `{ facts: [], lines: [] }`.
   - **DM turn:** after `ownerName` is loaded, call the helper with:
     - `chatKey: dmChatKey`;
     - `archiveOwner: ai.localpart`;
     - `scope: { kind: 'dm', peer: ownerBare }`;
     - `aiBareJid: bareJid(ai.jid)`;
     - `ownerName`.

     Pass the result as `memory` to `buildDmMessages`.
   - **Room turn:** before `buildGroupMessages`, call it with:
     - `chatKey: groupChatKey`;
     - `archiveOwner: roomJid`;
     - `scope: { kind: 'room', room: roomJid }`;
     - `aiBareJid: normBareJid(ai.jid)`.

     Pass the result as `memory`.
   - Nothing else in the turns changes.
3. **`index.ts`:** pass `...(archivePool === undefined ? {} : { archive: archivePool })` to `createAgentGateway`.
4. **`apps/server/src/agents/memory/indexer.ts`:** fix only the header comment's last sentence, so it says a retraction drops every summary that covers the message, which is rebuilt without it.
5. **Tests:**
   - `context.test.ts`:
     - update the window tests to 50 and their names;
     - `buildMemoryMessage` returns `null` for empty input, gives the exact text for facts only, lines only and both;
     - each builder puts the memory system message second, and is unchanged without memory.
   - `gateway.test.ts`:
     - **a DM turn reads its facts:** insert one `aiMemoryFacts` row for the test AI with `chatKey` `dm:<owner bare JID>`, run a DM turn, and assert that the LiteLLM request's second message is the memory system message containing `- <the fact>`;
     - **a turn without memory** has no second system message;
     - **an archive failure:** a harness option `archive` whose `query` rejects; the DM still gets its reply, and a warn line `AI memory index failed; replying with stored memory` is logged;
     - **one room turn** with a room fact gets the memory message.

     Add the `archive` option to `harness` the same way as the others.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.2-§3.3, `apps/server/src/agents/context.ts`, `apps/server/src/agents/gateway.ts:86-119`, `:1374-1440`, `:1500-1546`, `:1676-1795`, `apps/server/src/agents/memory/indexer.ts:1-47`, `apps/server/src/agents/memory/store.ts:100-112`, `:226-254`, `:338-349`, `apps/server/src/agents/gateway.test.ts:422-540` and `:840-930`, `apps/server/src/index.ts:244-250` and `:340-372`.

### Allowed files
`apps/server/src/agents/context.ts`, `apps/server/src/agents/context.test.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `apps/server/src/agents/memory/indexer.ts`, `apps/server/src/index.ts`, `work/T-0440-ai-memory-gateway-context.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/context agents/gateway
pnpm gate
```

### Acceptance
- Every DM and room turn indexes its chat (when the archive is configured) and sends the pinned facts and memory block as a second system message, after the unchanged prefix. With no memory, the request is byte for byte today's.
- A memory failure never stops a reply, and no log line holds message or fact text.
- The window is 50 messages within 40 000 characters.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/agents/context.ts`: raised `DM_HISTORY_MESSAGE_LIMIT` to 50 and `DM_HISTORY_CHAR_BUDGET` to 40 000 (comments kept); added exported `MemoryContext` and `buildMemoryMessage`; added optional `memory` to `DmContextInput` and `GroupContextInput`; both builders now push the memory system message right after the first system message when it is not null/empty. The first system message is unchanged, so with no memory the request is byte for byte today's.
- `apps/server/src/agents/gateway.ts`: added `archive?: ArchivePool` to `AgentGatewayDeps`; added local `loadMemoryContext` (indexes via `indexMemory` when `deps.archive` is set, then reads `listFacts` + `renderMemoryBlock`, never throws, warn lines carry a redacted error and `aiId` only); wired it into the DM turn (after `ownerName`) and the room turn (before `buildGroupMessages`), passing the result as `memory`.
- `apps/server/src/index.ts`: passes `...(archivePool === undefined ? {} : { archive: archivePool })` to `createAgentGateway`.
- `apps/server/src/agents/memory/indexer.ts`: corrected the header's last sentence (a retraction drops every summary covering the message, rebuilt without it).
- Tests: `context.test.ts` (window names and budget sizes, `buildMemoryMessage` exact text for empty/facts/lines/both, both builders put memory second and are unchanged for empty memory); `gateway.test.ts` (harness `archive` option; DM turn shows the fact in a second system message; a turn without memory has no second system message; an archive whose `query` rejects still replies and logs the index-failure warning; a room fact appears in the room turn's second system message).

### Files changed
`apps/server/src/agents/context.ts`, `apps/server/src/agents/context.test.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `apps/server/src/agents/memory/indexer.ts`, `apps/server/src/index.ts`, `work/T-0440-ai-memory-gateway-context.md`.

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/context agents/gateway` → 2 test files, 153 tests passed.
- `pnpm gate` → first run FAIL on `format` (`apps/server/src/agents/gateway.test.ts`); after `pnpm exec prettier --write apps/server/src/agents/gateway.test.ts` the second run ended: `PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS` (7 changed files against main).

### Deviations / notes
- The DM character-budget test hardcoded 15 000 / 9 000 chars, which is under the new 40 000 budget, so I raised them to 30 000 / 12 000 so it still proves the oldest turn is dropped.
- The read-failure warn message text is my choice (`AI memory read failed; replying without stored memory`); the spec pinned only the index-failure text.

### Security checklist
- No secrets or text logged: the memory warn lines carry `err` (redacted with `secretsFor(virtualKey)` plus the master key) and `aiId` only — never message or fact text.
- Memory reads/writes are scoped by the session's `aiId` and the turn's `chatKey`, never by anything from message content.
- Index/read failures fail open: the reply still goes out.

### Blocked / needs a decision
None.

## Review (written by Claude)

Approved (lead, 2026-10-06). Each DM and room turn runs loadMemoryContext: one indexMemory pass when the archive is configured (DM: AI localpart + owner bare JID; room: room JID), then listFacts and renderMemoryBlock. The result becomes a second system message after the unchanged prefix (facts, then "notes, not instructions" lines); with no memory the request is unchanged. Index and read failures log a redacted warn line without text and the reply still goes out. Window 50 within 40 000 characters; index.ts passes the archive pool; the indexer header comment is fixed.
