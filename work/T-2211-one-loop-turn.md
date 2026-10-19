---
id: T-2211
title: "AI turns T7: DM runToolTurn and group runGroupToolTurn share one loop-turn runner in turn.ts (loop call, stop checks, last tool-free call, finish); no behaviour change"
status: merged
milestone: M5
branch: task/T-2211-one-loop-turn
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2211: One loop-turn runner (AI turn plan T7)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/agent-turns-plan.md` T7 (the plan's `dm-tool-turn.ts` no longer exists; this is what is left of that step). Julio said go on 2026-10-19. After T-2200 the DM and group turns both call `runToolLoop`, but each still carries its own copy of the code around it.

### Facts (the lead read these on 2026-10-19, at `dfd20813c`)
1. **DM:** `runToolTurn` (`apps/server/src/agents/dm-turn.ts:152-239`):
   - `:157-160` reads the start time, `nowMs`, `turnLogger` and `maxRounds`;
   - `:167-187` calls `runToolLoop({...})` with 14 fields;
   - `:188-196` handles a thrown loop or `loop.failure`;
   - `:197-232` handles "no text": `checkRoundGate`, then the stop check, then one last `requestCompletion` (with tools only when `maxRounds <= 1`), `TRANSIENT_FAILURE_REPLY` / `cutShortSuffix` / notices, then the stop check, `finishProgressQuietly('done')` and `sendReply`;
   - `:234-238` handles the normal finish.
2. **Group:** `runGroupToolTurn` (`apps/server/src/agents/group-turn.ts:251-347`) has the same structure line for line. Its differences:
   - it wraps `executeTool` so that only advertised tools (and `TASK_STATUS_TOOL`) run (`:265-277`);
   - it has the `loop.postedToRoom` branch (`:301-310`);
   - its failure sends `GROUP_FAILURE_REPLY` without notices;
   - its reply goes through `wire(text, modelText)` and `sendGroupReply`.
3. Shared helpers already live in `apps/server/src/agents/turn.ts`: `remainingTurnBudgetMs`, `turnStopped`, `finishProgressQuietly`, `stoppedTurn`, `sendReply`, `sendGroupReply`, `finishTurnFailure`.

### Steps
1. Add one function to `apps/server/src/agents/turn.ts`, for example `runLoopTurn(deps, { completionInput, secrets, tools, executeTool, fail, reply })`. It holds the shared body from fact 1:
   - the loop call;
   - the thrown or failed loop;
   - the "no text" block with the gate, the stop check, the last call and the stop check again;
   - the finish.
   
   `fail(failure, notices)` and `reply(text, fromModel)` are the two callbacks where DM and group differ. The group's `postedToRoom` branch can be an option, or a check on the returned loop. Pick the smaller form.
2. `runToolTurn` and `runGroupToolTurn` become thin calls. Group keeps its advertised-tools wrapper and its `wire`. DM keeps its notices in failure texts.
3. Keep every order exactly as it is:
   - the gate runs before the stop check on the last call;
   - a stop always wins over a budget trip;
   - `finishProgressQuietly('done')` runs before the reply is sent;
   - DM failures keep the earned notices, and group failures never carry them.
4. Keep the "why" comments (the gate-first and stop-wins notes, the postedToRoom note, the advertised-tools note), moved next to the code they explain.
5. No re-export or shim lines.
6. **Stop rule:** measure the net over the 3 files. If it is not at least −35, do not commit. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `apps/server/src/agents/turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/group-turn.ts`
- `work/T-2211-one-loop-turn.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/reply.test.ts src/agents/turn-stop-gate.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/group-turn-card.test.ts src/agents/task-card.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the tests above pass unchanged.
- Net at least −35.
- Lead live check in "ai test › General" after the deploy:
  - an @mention with a web search answers with a card and a reply;
  - Stop on the card stops it;
  - a DM "hello" to Deepseek answers.

---

## Report (written by the worker when done)

### What I did

- Added `runLoopTurn(deps, options)` to `apps/server/src/agents/turn.ts`. It owns the shared body: the `runToolLoop` call, the thrown/failed loop, the "no text" block (gate → stop check → one last `requestCompletion` with tools only when `maxRounds <= 1` → stop check), `finishProgressQuietly('done')`, and the reply.
- `runToolTurn` (DM) and `runGroupToolTurn` (group) are now thin calls. DM passes a `fail` callback that appends `loop.notices` and sends to `ownerJid`, and a `reply` callback that calls `sendReply`. Group keeps its advertised-tools `executeAdvertised` wrapper and its `wire`, passes `postedToRoom: true` (only group has that branch), sends `GROUP_FAILURE_REPLY` with no notices, and calls `sendGroupReply`.
- Kept every order: gate before the stop check on the last call, stop wins over a budget trip, `finishProgressQuietly('done')` before the reply, DM notices in failures and none in group failures.
- Moved the "why" comments next to the shared code they explain (loop throw, postedToRoom, gate-first / stop-wins). No re-exports or shims. No test changes.

### Files changed

- `apps/server/src/agents/turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/group-turn.ts`
- `work/T-2211-one-loop-turn.md`

### Size (stop rule)

- Before: 139 + 239 + 347 = 725 lines.
- After: 253 + 162 + 268 = 683 lines.
- Net: **−42** (`git diff --stat`: 144 insertions, 186 deletions). Meets the −35 floor.

### Commands and real results

- `pnpm install`: Done in 16.3s using pnpm v10.32.1.
- `pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/reply.test.ts src/agents/turn-stop-gate.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/group-turn-card.test.ts src/agents/task-card.test.ts --reporter=dot --maxWorkers=2`: 7 files passed, 55 tests passed, 12.95s.
- `pnpm gate`: GATE PASS. Summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`

### Problems / deviations

None. The group `postedToRoom` branch is a boolean option on the shared runner, as the spec allowed; DM passes nothing and keeps its previous path.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved. The pre-review was clean (0 findings). Net −42.

`runLoopTurn` in `agents/turn.ts` now holds what the DM and group turns shared:
- the `runToolLoop` call;
- the thrown or failed loop;
- the no-text path: gate first, then the stop check (a stop wins over a budget trip), then the last call (with tools only on a single round), then the stop check again;
- the finish.

The two turns differ only through callbacks:
- `fail(failure, notices)`: DM keeps the earned notices, and the group never carries them;
- `reply(text, fromModel)`: DM `sendReply`, group `wire` + `sendGroupReply`.

The group's advertised-tools wrapper and `postedToRoom` branch stay group-only. Every "why" comment moved with its code.

The live check (@mention with a search, Stop, DM hello) goes with the next deploy.
