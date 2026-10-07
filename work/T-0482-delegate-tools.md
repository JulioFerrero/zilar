---
id: T-0482
title: "Listener S5b (server): delegate + task_status tools in group turns, wired to the delegation service; worker turn injected as a handoff; result stored on finish"
status: merged
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

### What I did
- **`tools.ts`**: added `DELEGATE_TOOL` / `TASK_STATUS_TOOL`, the strict `DelegateArgsSchema` (`to`, `objective`, optional `context_summary` ≤1200, `acceptance` ≤10 items, `return_format` ≤200) and `TaskStatusArgsSchema`; taught `parseToolArguments` both names; added `buildDelegateTool(targets)` (lists `id — name`, says the target uses its own model/budget and replies in the room, use `task_status` for the stored result) and `TASK_STATUS_TOOL_DEF`; `buildGroupTools(actions, delegateTargets?)` appends both tools only when `delegateTargets` is non-empty (byte-identical output otherwise).
- **`reply.ts`**: added both tools to `ValidToolCall`; `toCall` maps `to → toAiId`, `context_summary → contextSummary`, `return_format → returnFormat`.
- **`gateway.ts`**:
  - `RoomPendingMessage` gained `delegationId`.
  - `RequestActionContext` gained `roomJid`, `triggerId` and `delegateTargetIds`.
  - The group turn's one delegation read now also carries this AI's `canDelegate` and each target's `aiId`; when `canDelegate` and there is at least one accepting session, `buildGroupTools` gets the targets (`{id: aiId, name: nick}`).
  - `executeToolCall` (group context): `delegate` / `task_status` are allowed only with a non-empty `delegateTargetIds` (otherwise `invalid: unknown tool`); `delegate` checks the target, the round's hop budget (`refused: no hops left for this message`), calls `createDelegation` (`replyTo` = turn trigger id), queues `delegation:<id>` on the **worker's** `roomPending` (`handoff: true`, `fromJid` = boss JID, `fromNick` = boss room nick, body `Task from <boss nick>: <objective>` plus `\nContext: …` / `\nReturn: …`), calls `pumpRoom`, spends one hop and answers `{"task_id":"…","status":"working"}`; `task_status` answers `{"task_id","status","result"}` or `invalid: unknown task`.
  - After `runGroupTurn`, when the trigger has a `delegationId`, `finishDelegation` stores `completed`/`failed` with the worker's posted text. Dropped turns (daily limit, rate limit, round cap) and the outer turn-error path finish the row `failed` with no summary, so a row never stays `working`.
- **Tests**: `tools.test.ts` parse accept/reject for both tools and `buildGroupTools` with/without targets (48 tests in the file). `gateway.test.ts` new `delegation tools (T-0482)` describe with the six cases from the spec (happy path, no `canDelegate` + improvised call, unknown target, hops spent, third-AI `task_status`, worker over daily limit).

### Files changed
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools.test.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0482-delegate-tools.md`.
`apps/server/src/agents/reply.test.ts` was allowed but did not need changes (no snapshot of the tool list there; the mapping is covered through the gateway tests).

### Commands and results
- `pnpm install` — done (warnings only: pre-existing `@types/react-dom` peer).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools` — 48 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/reply` — 45 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/delegation` — 183 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/reply agents/gateway agents/delegation` (the task Checks command) — 4 files, 276 passed.
- `pnpm gate` (first run) — FAIL format on 5 changed files; ran `pnpm exec prettier --write` on them, then one lint error (`no-unsafe-optional-chaining` in my new test) which I fixed with a non-null assertion.
- `pnpm gate` (final) —
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (5.6s)
  PASS  format  (42.2s)
  PASS  lint  (1.3s)
  PASS  typecheck  (20.1s)
  PASS  tests @zilar/server  (62.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The spec named only `delegateTargetIds` for `RequestActionContext`; I also added `roomJid` and `triggerId`, because `delegate` needs the room (to queue the worker and read the boss's nick) and the trigger id (`replyTo`). No other constructor of the context exists.
- Beyond the three named pre-model drops, the outer `catch` in `runGroupSessionTurn` also finishes a delegated row `failed`, so a failure in `ensureAiModel` / key / memory setup cannot leave a row `working`. `finishDelegation` is a single conditional update, so a later call after a finish is a no-op.
- `finishDelegation` after `runGroupTurn` passes `resultSummary` in both outcomes (per the spec wording); the dropped-turn paths pass no summary.
- If one boss turn issues several `delegate` calls that all land in one worker batch, only the trigger's `delegationId` is finished (the spec ties one `delegationId` to one trigger). The hop cap still refuses beyond `ROUND_MAX_HOPS`. Flagging in case the lead wants each queued delegation finished.

### Blocked / needs a decision
None.

### Round (pre-review fixes, T-0482)
Findings fixed:
- **Finding 1 (must-fix)** — coalesced worker batches orphaned every non-trigger delegation row. `pumpRoom` now peels the queue so a delegated task is always its own turn: if the head run has no delegation it coalesces mentions as before, but the batch stops before the first delegation item, and a delegation is taken alone. Each delegated turn then finishes its own row. (Previously the whole queue was drained into one batch and only the last eligible item's `delegationId` was finished.) Updated the hops test to assert both rows end `completed`, the assertion the finding named.
- **Finding 2 (should-fix)** — added `reads a task_status for an involved AI`: a boss that may delegate calls `task_status` for its own `completed` row and the tool result carries `{task_id, status, result}`.

Nits not touched (all three, per "do not touch nits"): the missing `context === undefined` guard in the `TASK_STATUS_TOOL` branch, the lenient hop-budget check when the round is missing, and `task_status` being tied to a non-empty `delegateTargetIds`.

Tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway -t 'delegation tools'` — 7 passed.

Gate result:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (18.2s)
PASS  lint  (1.3s)
PASS  typecheck  (8.9s)
PASS  tests @zilar/server  (51.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Round (post-review fixes, T-0482)
Findings fixed:
- **Finding 1 (should-fix)** — `task_status` was executable in DM turns. The `TASK_STATUS_TOOL` branch in `executeToolCall` now returns `invalid: unknown tool` when `context === undefined`, mirroring the sibling `delegate` branch, so a DM model that improvises the tool with valid args can no longer read real delegation data. Test added: `answers task_status in a DM with invalid: unknown tool` — it seeds a real `completed` row for the AI, sends a DM turn, and asserts the tool is not offered and the tool result is `invalid: unknown tool`. I confirmed it fails without the guard (reverted it, ran the test: 1 failed) and passes with it.

Nits not touched (per "do not touch nits"): finding 2, `task_status` being tied to a non-empty `delegateTargetIds`.

Tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway -t 'answers task_status in a DM'` — 1 passed.

Gate result:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (39.9s)
PASS  lint  (2.2s)
PASS  typecheck  (1.3s)
PASS  tests @zilar/server  (99.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Round (post-review fixes 2, T-0482)
Findings fixed:
- **Finding 1 (should-fix)** — the empty-`delegateTargetIds` gate applied to both delegation tools, so `task_status` was refused whenever there were no targets. In `gateway.ts` the gate now names `DELEGATE_TOOL` only; `task_status` always falls through to `getDelegationForAi`, which scopes the read to the two involved AIs. One extra fix was required outside that line: the group tool loop in `reply.ts` only runs advertised tools, so even with the gateway gate fixed an improvised `task_status` was answered `invalid: unknown tool` before `executeToolCall` ran. `runGroupToolTurn` now treats `task_status` as a known group tool that may run even when it was not advertised (read-only, scoped by `getDelegationForAi`). The advertised tool list is unchanged, so `buildGroupTools` output, spec §3 and the "boss without canDelegate is not offered the tool" test are untouched.
- Tests added in `gateway.test.ts`: `reads a completed task_status for the boss after the worker left the room`, `lets an accepting worker read its own task without canDelegate`, `answers task_status from an uninvolved AI with invalid: unknown task when there are no targets`.
- I confirmed both halves are load-bearing: with `gateway.ts` reverted (reply fix present), all 3 new tests fail; with `reply.ts` reverted (gateway fix present), all 3 new tests fail with `invalid: unknown tool`.

Disagreements: none. The finding named `gateway.ts:818` only; the `reply.ts` advertised-tool guard was an additional, necessary part of the same behaviour.

Tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway -t 'delegation tools'` — 11 passed.

Gate result:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (4.5s)
PASS  format  (106.0s)
PASS  lint  (1.8s)
PASS  typecheck  (63.0s)
PASS  tests @zilar/server  (220.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

Approved (lead, 2026-10-07).
- **delegate:** offered only to an AI with canDelegate and same-room targets that accept tasks. It creates the row, counts a hop, and queues a "Task from" handoff turn on the worker. The worker turn finishes the row: completed with the reply, or failed when it is dropped.
- **task_status:** reads only for the two AIs involved, with targets or without (fix round 3).
This was the last feature task before the no-features rule. Pre-review clean after the rounds; the nits are cosmetic.
