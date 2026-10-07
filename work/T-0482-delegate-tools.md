---
id: T-0482
title: "Listener S5b (server): delegate + task_status tools in group turns, wired to the delegation service; worker turn injected as a handoff; result stored on finish"
status: todo
milestone: M5
branch: task/T-0482-delegate-tools
model: auto
effort: low
depends_on: [T-0480, T-0481]
estimate: 0.6 day
---

# T-0482: the delegate and task_status tools

## Spec (written by Claude, do not edit)

### Why
This is plan task S5, from `docs/audit/listener-delegation-plan.md` §4.1 to §4.3, with Julio's §8 decisions. A boss AI whose owner turned on "Can delegate" gets a `delegate` tool in group turns. It hands a task to an AI in the same room whose owner turned on "Accepts tasks". The worker runs it as a normal turn **with its own model, key and limits**.

`delegate` returns at once with `{task_id, status: "working"}`. This is the plan's deliberate deviation from §9.5: there is no blocking wait. The worker's reply goes to the boss as `@boss`. `task_status(task_id)` reads the stored result.

### Verified facts (do not re-derive)
Lines are on main after T-0481.
- **The delegation service (T-0480, `apps/server/src/agents/delegation/service.ts`):**
  - `checkDelegation(db, { fromAiId, toAiId, groupId, topicId })` gives ok or a reason;
  - `createDelegation(db, { fromAiId, toAiId, groupId, topicId?, objective, contextSummary?, acceptance?, constraints?, artifacts?, budget?, returnFormat?, replyTo? })` returns `{ ok: true, delegation: { id, toAiId, objective, status } }` or `{ ok: false, reason }`;
  - `getDelegationForAi(db, id, aiId)` returns the row for the two AIs involved, otherwise null;
  - `finishDelegation(db, { id, aiId, status, resultSummary?, artifacts? })` returns a boolean.
  
  It caps text and lists itself.
- **The tool plumbing:**
  - names and zod arg schemas are in `apps/server/src/agents/tools.ts` (`RecallArgsSchema` etc. at lines 26-70);
  - `parseToolArguments(toolName, argsJson)` (`tools.ts:106`) rejects unknown names, then parses per tool;
  - `MEMORY_TOOLS` (`tools.ts:235`);
  - `buildGroupTools(actions)` (`tools.ts:353`).
  
  In `apps/server/src/agents/reply.ts`:
  - `ValidToolCall` is at line 78;
  - `toCall(parsed, id)` (around line 1074) lifts the parsed args;
  - `DmTurnOutcome = { kind: 'replied'; text } | { kind: 'failed'; text }` is at line 388, and `runGroupTurn` returns it.
- **The gateway (`apps/server/src/agents/gateway.ts`):**
  - `executeToolCall(session, chatKey, context?)` is at line 768. In a group (`context` set) it allows only the memory tools and `request_action` (lines 786-797). `RequestActionContext` (line 754) is `{ groupId, topicId, isStillAllowed, allowActions }`.
  - The group turn builds `handoffTargets` (other live sessions in this room whose AI has `acceptsDelegation`, one DB read, lines 2095-2120). It also builds `groupTools = buildGroupTools(...)` (line 2150) and calls `runGroupTurn` (line 2187) with `executeTool: executeToolCall(session, groupChatKey, {...})` (line 2199).
  - **Handoff (T-0481):**
    - `RoomPendingMessage.handoff?: true` (line 219);
    - `handleRoomIncoming` counts a hop in `roomRounds` (`round.hops`, `round.handoffIds`, `ROUND_MAX_HOPS = 2` at line 191; lines 1819-1845);
    - `runGroupSessionTurn` lets an AI-sender item through only with `handoff === true` and when the sender is a live session in the room;
    - `sessionForAiJid(bare)` is at line 1757;
    - `pumpRoom(session, roomJid)` runs the queue.
- **The tests:** `apps/server/src/agents/tools.test.ts`, `apps/server/src/agents/reply.test.ts`, and `apps/server/src/agents/gateway.test.ts` (the handoff describe near the end has the fixtures for 2–3 AI sessions in one room).

### What to build
1. **Tools (`tools.ts`).**
   - Add `DELEGATE_TOOL = 'delegate'` and `TASK_STATUS_TOOL = 'task_status'`.
   - Arg schemas:
     - `delegate`: `{ to: string (1..64), objective: string (1..1000), context_summary?: string (≤1200), acceptance?: string[] (≤10), return_format?: string (≤200) }`, strict;
     - `task_status`: `{ task_id: string (1..64) }`, strict.
   - Teach `parseToolArguments` both names.
   - Add `buildDelegateTool(targets: { id: string; name: string }[])`. Its description lists the targets as `id — name` and says: the target works on it with its own model and budget and replies in the room; use task_status later for the stored result. Add a fixed `TASK_STATUS_TOOL_DEF`.
   - `buildGroupTools` gets an optional second parameter `delegateTargets?: { id; name }[]`. When it is non-empty, append `delegate` and `task_status`. **Otherwise the output is unchanged.**
2. **Calls (`reply.ts`).** Add both to `ValidToolCall` and `toCall`. Map `to` to `toAiId`, `context_summary` to `contextSummary` and `return_format` to `returnFormat`.
3. **The gateway: offering the tools.**
   - In the group turn, when this AI's `canDelegate` is true (read it with the existing `acceptsDelegation` query, or the `loadActiveAi` row if it already has it) and `handoffTargets` is non-empty, pass `delegateTargets` to `buildGroupTools`.
   - Each target carries the AI id and its room nick, so the `handoffTargets` entries must also keep `aiId`.
   - Add `delegateTargetIds: Set<string>` to `RequestActionContext`.
4. **The gateway: running `delegate`** (in `executeToolCall` with a group `context`):
   - **Allow the tool** only when `delegateTargetIds` is non-empty; otherwise answer `invalid: unknown tool`.
   - **Target:** the target must be in `delegateTargetIds`, or answer `invalid: unknown AI`.
   - **Budget:** if the room's round has `hops >= ROUND_MAX_HOPS`, answer `refused: no hops left for this message`.
   - **Create the row:** call `createDelegation` with `fromAiId: session.aiId`, `groupId` and `topicId` from the context, and `replyTo`: the trigger id (pass it through the context). On `{ok:false}`, answer `refused: <reason>`.
   - **Count the hop:** on success, `round.hops += 1`.
   - **Start the worker:** queue onto the **worker's** session `roomPending` an item with:
     - `id`: `delegation:<id>`;
     - `body`: `Task from <boss nick>: <objective>`, plus `\nContext: <context_summary>` when given and `\nReturn: <return_format>` when given;
     - `fromJid`: the boss's `aiJid`, `fromResolved: true`, `fromNick`: the boss's room nick;
     - `timestamp`: now;
     - `handoff: true` and a new `delegationId`.
     
     Then call `pumpRoom`.
   - **Answer:** `{"task_id":"<id>","status":"working"}`.
   - **Log:** ids only (`fromAiId`, `toAiId`, `delegationId`, `groupId`).
5. **The gateway: running `task_status`.** `getDelegationForAi(db, task_id, session.aiId)`; null answers `invalid: unknown task`. Otherwise answer compact JSON: `{task_id, status, result}` with `result` = `resultSummary` or null.
6. **The gateway: finishing.** In `runGroupSessionTurn`, when the trigger has a `delegationId`, after `runGroupTurn` returns call `finishDelegation(db, { id, aiId: session.aiId, status, resultSummary: outcome.text })`, with `status` = `completed` for `replied` and `failed` for `failed`.
   - If the turn is dropped before the model call (daily limit, rate limit or round cap), call `finishDelegation` with `failed` and no summary, so the task never stays `working` forever.
   - Wrap errors and log ids only.
   - No wake line for delegation turns: they are not pure listener wakes.
7. **Tests.**
   - **`tools.test.ts`:**
     - the parse accepts and rejects for both tools;
     - `buildGroupTools` without targets is unchanged, and with targets it adds both.
   - **`gateway.test.ts`:**
     - a boss with `canDelegate` and a worker that accepts: the boss's model calls `delegate`; a row is created; the worker gets a turn whose trigger body starts with "Task from"; the worker's reply mentions the boss; the row ends `completed` with the reply text;
     - a boss without `canDelegate` is not offered the tool, and a forced call answers `invalid: unknown tool`;
     - an unknown target answers `invalid: unknown AI`;
     - hops spent answers `refused: no hops left for this message`;
     - `task_status` from a third AI answers `invalid: unknown task`;
     - a worker over its daily limit leaves the row `failed`.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §4 and §8, `apps/server/src/agents/delegation/service.ts`, `apps/server/src/agents/tools.ts:1-140` and `:230-370`, `apps/server/src/agents/reply.ts:60-100`, `:380-390` and `:1060-1110`, `apps/server/src/agents/gateway.ts:185-225`, `:750-900`, `:1750-1860`, `:1880-1960` and `:2090-2230`, the T-0481 handoff tests at the end of `apps/server/src/agents/gateway.test.ts`.

### Allowed files
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools.test.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.test.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0482-delegate-tools.md`.

If any other test breaks (for example a tool-list snapshot), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/reply agents/gateway agents/delegation
pnpm gate
```

### Acceptance
- An AI allowed to delegate can hand a task to an accepting AI in the same room.
- The worker runs it on its own model and limits, replies to the boss, and the row stores the result.
- `task_status` reads it, for the two AIs involved only.
- Hops and turn budgets still hold.
- Without targets, the tool list is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
