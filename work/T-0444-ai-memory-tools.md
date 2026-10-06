---
id: T-0444
title: "AI memory M3b (server): recall, memory_zoom and remember tools in every DM and room turn, with a secret check"
status: todo
milestone: M5
branch: task/T-0444-ai-memory-tools
model: auto
effort: low
depends_on: [T-0440]
estimate: 0.5 day
---

# T-0444: AI memory — the memory tools

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.4 and §3.5 (M3, second part). Since T-0440 every turn reads its pinned facts and memory block. Now the AI gets three tools:
- `recall` searches the whole chat;
- `memory_zoom` opens a summary;
- `remember` pins a fact.

They are offered in **every** DM and room turn.

**Out of scope:** the compactor (next task) and the UI.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/tools.ts`:**
  - tool names at lines 3-5;
  - zod argument schemas at lines 20-38;
  - the `ParsedToolArguments` union at lines 43-51;
  - `parseToolArguments` (lines 75-122), which rejects names other than the three known ones (lines 78-84);
  - `ChatToolDefinition` (lines 128-135) and `PERSONA_TOOLS` (line 141);
  - `buildTools(actions)` (lines 224-232) returns the persona tools, plus `request_action` when there are actions;
  - `buildGroupTools(actions)` (lines 238-246) returns `[]` or only `request_action`.
- **`apps/server/src/agents/reply.ts`:**
  - the `ValidToolCall` union (lines 74-82);
  - `ToolExecution { content; notice? }` (lines 84-89);
  - `toCall(parsed, id)` (line 1072);
  - `executeOneToolCall` (lines 473-529) validates with `parseToolArguments` and runs `executeTool`;
  - `runGroupTurn` (line 1188) takes the tool loop when `tools` is non-empty and `executeTool` is set, and otherwise the plain path.
- **`apps/server/src/agents/gateway.ts`:**
  - `RequestActionContext { groupId, topicId, isStillAllowed }` (lines 669-673);
  - `executeToolCall(session, context?)` (line 680) returns `invalid: unknown tool` for every non-`request_action` call when `context` is set (lines 690-692). It is created once per turn, so a closure variable counts per turn.
  - **Room turn:**
    - `groupTools = allowedForAction && actionsList.length > 0 ? buildGroupTools(actionsList) : undefined` (lines 1617-1621);
    - the guide applies when `deps.toolsEnabled === true && groupTools !== undefined` (line 1656);
    - the `runGroupTurn` tool fields are set only when `groupTools` is defined (lines 1668-1684);
    - the chat key is `groupChatKey`.
  - **DM turn:**
    - `executeTool: executeToolCall(session)` and `...(deps.actions === undefined ? {} : { tools: buildTools(deps.actions.listActions()) })` (lines 1894-1895);
    - the guide applies when `dmActionsList.length > 0` (line 1875);
    - the chat key is `dmChatKey`.
- **`apps/server/src/agents/memory/store.ts`:**
  - `recallMemory(db, aiId, chatKey, query)` returns `string[]`;
  - `zoomMemory(db, aiId, chatKey, blockId)` returns `string[] | null` (null for a bad, out-of-range or below-floor id);
  - `addFact(db, aiId, chatKey, text)` returns `'saved' | 'duplicate' | 'invalid'` (one line, at most 280 characters).
- **No helper detects secret-looking text today.** `redactSecrets` (`apps/server/src/ai/litellm-client.ts:229`) only replaces known values.
- **Tests that pin the advertised tool lists:**
  - `apps/server/src/agents/gateway.test.ts` lines 1695, 2198, 3246 and 3294 (name lists), and lines 2740, 3459 and 3639 (`tools` undefined for room turns of plain members);
  - `apps/server/src/agents/tools.test.ts` (the `buildTools` and `buildGroupTools` results).

### What to build
1. **New `apps/server/src/agents/memory/secrets.ts`:** export `looksLikeSecret(text: string): boolean`. It is true when the text matches any of these (case-insensitive where it makes sense):
   - `sk-` followed by 16 or more `[A-Za-z0-9_-]`;
   - `gh[pousr]_` followed by 20 or more alphanumerics, or `github_pat_`;
   - `AKIA[0-9A-Z]{16}`;
   - `xox[abprs]-`;
   - a JWT, `eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}`;
   - `-----BEGIN`;
   - `(password|passwd|passcode|pwd|pin|otp|token|api[ _-]?key|secret)\s*[:=]\s*\S`;
   - a run of 32 or more `[A-Za-z0-9_-]` that contains both a letter and a digit.

   A plain sentence, a URL such as `https://example.com/docs/getting-started`, or a date is false. Add `memory/secrets.test.ts` with one true and one false case per rule.
2. **`tools.ts`:**
   - constants `RECALL_TOOL = 'recall'`, `MEMORY_ZOOM_TOOL = 'memory_zoom'` and `REMEMBER_TOOL = 'remember'`;
   - strict zod schemas:
     - `recall` `{ query: trimmed string, 1-100 characters }`;
     - `memory_zoom` `{ block: string matching ^\d{1,9}-\d{1,9}$ }`;
     - `remember` `{ text: trimmed string, 1-280 characters }`;
   - their `ParsedToolArguments` variants, and acceptance in `parseToolArguments`.
   - **`MEMORY_TOOLS: ChatToolDefinition[]`**, with these descriptions:
     - **recall:** "Search everything said in this chat, including messages older than what you can see. Use it before saying you don't remember. `query` is a few words; every word must appear. Returns the newest matches as `#seq date sender: text`."
     - **memory_zoom:** "Open one block of your memory of this chat, like `64-79`, into its two halves (shorter summaries or the messages themselves)."
     - **remember:** "Pin one short fact for this chat. Use it only when someone asks you to remember something, or for a lasting decision. One line, at most 280 characters. Never passwords, codes, keys or tokens."
   - `buildTools(actions)` returns `[...PERSONA_TOOLS, ...MEMORY_TOOLS]`, plus `request_action` when there are actions.
   - `buildGroupTools(actions)` returns `[...MEMORY_TOOLS]`, plus `request_action` when there are actions.
   - Update the comments that say a group only gets `request_action`.
3. **`reply.ts`:** add the three variants to `ValidToolCall` (`query`, `block` and `text`) and to `toCall`. Update the `GroupTurnDeps.tools` comment (it now carries the memory tools).
4. **`gateway.ts`:**
   - `RequestActionContext` gains `allowActions: boolean`.
   - `executeToolCall(session, chatKey: string, context?)` (new required `chatKey` argument). Inside the returned function:
     - **in a room** (`context` set): a call other than `request_action` or the three memory tools is `invalid: unknown tool`, as today, and `request_action` with `!context.allowActions` is also `invalid: unknown tool`.
     - **`recall`:** `recallMemory(deps.db, aiId, chatKey, call.query)`. The content is `no matches` when empty, else the lines joined by `\n`.
     - **`memory_zoom`:** `zoomMemory(...)`. `null` gives `invalid: unknown block`, `[]` gives `empty`, and otherwise the lines are joined by `\n`.
     - **`remember`:**
       - after 5 saved facts in this turn (a counter in the closure), the result is `refused: at most 5 per turn`;
       - `looksLikeSecret(call.text)` gives `refused: looks like a secret`;
       - otherwise `addFact`: `saved` gives `ok` (and counts), `duplicate` gives `already remembered`, and `invalid` gives `invalid: one line, at most 280 characters`.
     - Each memory call logs `logger.info({ aiId, tool: call.tool, ok }, 'AI memory tool')`, **never** the query, block or text.
   - **The room turn** always builds `groupTools = buildGroupTools(allowedForAction ? actionsList : [])` and always passes the tool fields. The context is `{ groupId, topicId, isStillAllowed, allowActions: allowedForAction && actionsList.length > 0 }`, and the executor is `executeToolCall(session, groupChatKey, context)`. The guide condition becomes `deps.toolsEnabled === true && allowedForAction && actionsList.length > 0`, so the guide still appears only when `request_action` is offered.
   - **The DM turn** uses `executeTool: executeToolCall(session, dmChatKey)` and always `tools: buildTools(deps.actions?.listActions() ?? [])`. The guide condition is unchanged.
   - Update the comments around both.
5. **Tests:**
   - **`tools.test.ts`:**
     - the new list results;
     - `parseToolArguments` accepts valid memory calls and rejects an empty query, a query over 100 characters, a block such as `a-b`, a 281-character text and extra keys.
   - **`gateway.test.ts`:**
     - **update only the tool-list expectations** at the lines listed above: the names now include `memory_zoom`, `recall` and `remember`, and a plain member's room turn now advertises exactly those three;
     - **new:** a DM turn where the model calls `remember` ("The launch is on Friday.") stores the fact in `aiMemoryFacts` under `dm:<owner bare JID>`, and the follow-up request carries the tool result `ok`;
     - **new:** `remember` with `password: hunter22` stores nothing and returns `refused: looks like a secret`;
     - **new:** a sixth `remember` in one turn is refused;
     - **new:** `recall` returns seeded `aiMemoryMessages` lines of this chat only (seed another chat key too);
     - **new:** in a room, a plain member's turn where the model improvises `request_action` gets `invalid: unknown tool`, and the action gateway is never called;
     - **new:** no log line contains the fact text.
   - If `reply.test.ts`, `rounds.test.ts` or `integration.test.ts` break only on tool-list expectations, update those expectations the same way. Any other break: stop and report BLOCKED.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.4-§3.5, `apps/server/src/agents/tools.ts`, `apps/server/src/agents/reply.ts:66-95`, `:470-530`, `:1060-1100` and `:1130-1200`, `apps/server/src/agents/gateway.ts:660-735`, `:1606-1690` and `:1866-1900`, `apps/server/src/agents/memory/store.ts:256-412`, `apps/server/src/agents/gateway.test.ts:1680-1700`, `:2190-2200`, `:2730-2745`, `:3230-3300`, `:3440-3465` and `:3625-3645`.

### Allowed files
`apps/server/src/agents/memory/secrets.ts`, `apps/server/src/agents/memory/secrets.test.ts`, `apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools.test.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0444-ai-memory-tools.md`.

Tool-list expectation updates only: `apps/server/src/agents/reply.test.ts`, `apps/server/src/agents/rounds.test.ts`, `apps/server/src/agents/integration.test.ts`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/secrets agents/tools agents/gateway agents/reply agents/rounds
pnpm gate
```

### Acceptance
- Every DM and room turn offers `recall`, `memory_zoom` and `remember`, scoped to the turn's own AI and chat. The ids never come from the arguments.
- `remember` refuses secret-like text, duplicates, malformed text and a sixth call in one turn.
- A plain room member still never reaches the action gateway.
- No log line holds a query, block id or fact text.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
