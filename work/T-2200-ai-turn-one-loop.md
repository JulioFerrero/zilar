---
id: T-2200
title: "AI turns T3: a group turn with no tools runs through the shared tool loop; runGroupTurn's second plain path goes"
status: merged
milestone: M5
branch: task/T-2200-ai-turn-one-loop
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2200: One loop for group turns (AI turn plan T3)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/agent-turns-plan.md` step T3. Julio said go on 2026-10-19. `runGroupTurn` has two code paths: the tool loop, and a hand-written "plain" path for a turn with no tools. That path makes the first model call, answers improvised tool calls with `invalid: unknown tool`, and makes one follow-up call. The shared loop already does all of this when it is given no tools.

### Facts (the lead read these on 2026-10-19, at `2dda3ebdb`)
1. `apps/server/src/agents/group-turn.ts:237-283`, inside `runGroupTurn`'s `try`:
   - when `tools` is non-empty and `executeTool` is set, it calls `runGroupToolTurn` (`:238-240`);
   - otherwise it runs the plain path (`:241-282`): `requestCompletion` → text reply, or improvised calls answered through `executeToolCalls` (no executor) → one follow-up `requestCompletion` → `sendGroupReply`.
2. `runGroupToolTurn` (`group-turn.ts:288-377`):
   - wraps the executor so only advertised tools (plus `task_status`) run (`:296-307`);
   - calls `runToolLoop`, and on a `null` text makes one last call that offers `tools` when `maxRounds <= 1` (`:338-371`).
3. `runToolLoop` (`apps/server/src/agents/tool-rounds.ts:23-179`):
   - round 1 offers `tools` (`:111-116`);
   - with no executor, an improvised call is answered `invalid: unknown tool`;
   - an empty first reply throws `ChatCompletionError` (`:121-125`), as the plain path does at `group-turn.ts:247-249`.
4. An empty `tools` list is the same as none: `requestCompletion` (`apps/server/src/agents/tool-loop.ts:123`) passes it on, and `apps/server/src/ai/model-client.ts:312` builds the toolkit from `input.tools ?? []`.
5. Two differences the lead accepts, so the plain path can go:
   - `checkRoundGate` (`budget.ts:259-292`) also runs for a plain turn. It is a read-only check (kill switch and spend limits).
   - A plain turn that has a progress card now finishes it `done` (`finishProgressQuietly`, `turn.ts:39`), like every tool turn.

### Steps
1. In `runGroupTurn`, delete the plain path (`group-turn.ts:241-282`) and always return `runGroupToolTurn(...)`. Pass `tools` only when `executeTool` is set; otherwise pass `[]` and no executor. Keep `wire`, `failTurn`, the typing `composing`/`paused` pair and the `catch`.
2. In `runGroupToolTurn`, make sure an empty `tools` list behaves as "no tools":
   - the last call's `...(maxRounds <= 1 ? { tools } : {})` must not differ from today's follow-up;
   - an improvised call never reaches any executor.
3. Delete the imports that become unused (`executeToolCalls`, `followUpMessages`, …), but only if nothing else in the file uses them.
4. Do not touch the DM path, `tool-rounds.ts`, `turn.ts` or the gateway files.
5. Report the line count of `group-turn.ts` before and after.

### Allowed files
- `apps/server/src/agents/group-turn.ts`
- `work/T-2200-ai-turn-one-loop.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/handoff.test.ts src/agents/reply.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and so do the four tests above, unchanged.
- A group turn with no tools still makes at most one follow-up model call, and a plain member can still never reach the action gateway (no executor is passed).
- `group-turn.ts` is at least 30 lines shorter.
- Live check by the lead in "ai test › General" after the deploy: an @mention of the AI answers, and a Stop mid-answer stops it.

---

## Report (written by the worker when done)

### What I did
- Deleted the hand-written plain path in `runGroupTurn` (`group-turn.ts`). The turn now always returns `runGroupToolTurn`.
- When `deps.executeTool` is undefined the turn is passed `{ ...deps, tools: [] }`, so no executor and no advertised tools reach the loop; an improvised call is answered `invalid: unknown tool` by `runToolLoop`, which already matches the old plain path.
- `runGroupToolTurn` needed no behaviour change: it already derives `tools = deps.tools ?? []`, builds no executor when `deps.executeTool` is undefined, and passes `tools` on the last call only when `maxRounds <= 1` (an empty list is the same as none, `model-client.ts:312`).
- Removed imports that became unused: `ChatCompletionError`, `executeToolCalls`, `followUpMessages`. `requestCompletion`, `TRANSIENT_FAILURE_REPLY`, `turnStopped` and `stoppedTurn` are still used by `runGroupToolTurn`.
- Reworded the `tools` doc comment on `GroupTurnDeps` so it no longer refers to the removed plain `completeChat` path: absent or empty means no tools are advertised and an improvised call is answered `invalid: unknown tool`.
- Did not touch the DM path, `tool-rounds.ts`, `turn.ts` or gateway files.

### Line count
- `apps/server/src/agents/group-turn.ts`: 377 lines before, 346 lines after (31 lines shorter).

### Commands and results
- `pnpm --filter @zilar/server exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/handoff.test.ts src/agents/reply.test.ts --maxWorkers=2 --reporter=dot`
  - 4 test files passed, 35 tests passed.
- `pnpm gate`: GATE PASS, summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.7s)
  PASS  tests @zilar/server  (14.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations / open questions
- None. The behaviour differences listed in the spec (`checkRoundGate` now also runs for a plain turn, and a progress card finishes `done`) are the two the lead accepted.

## Review (written by Claude)

Approved; the pre-review was clean with 4 nits. Net −30 in `group-turn.ts`.

**What changed:** `runGroupTurn`'s hand-written plain path is gone. Every group turn runs the shared tool loop, and with no executor it advertises no tools, so an improvised call is answered `invalid: unknown tool` and no executor is ever reached. The `tools` doc comment now says so.

**Accepted differences** (all benign):
- the read-only round gate also runs for a plain turn;
- a plain turn closes a progress card `done` on success and `failed` on an error (before, the card was left open);
- a caller with an executor but no tools would let `task_status` run. That can't happen in production, because the gateway always passes at least 3 tools with the executor.

The four guard tests pass unchanged, and the gate passes. The live check in "ai test › General" (an @mention, and a Stop mid-answer) follows the deploy.
