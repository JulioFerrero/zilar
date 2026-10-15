---
id: T-1611
title: "An AI with its computer on gets at least 6 tool rounds per reply: live (TOOLS_ENABLED=false) caps every turn at 1 round, so 'create hello.txt and list the folders' asked for a second tool call and the reply failed with 'I couldn't reply just now'"
status: merged
milestone: M5
branch: task/T-1611-desk-turns-multi-round
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1611: Computer turns get several tool rounds

## Spec (written by Claude, do not edit)

### Why
On 2026-10-15 (~22:44 UTC) Julio switched one AI to the Zilar computer on live and asked "create a hello.txt file, and list the directories". The AI answered "I couldn't reply just now. Please try again in a minute." twice.

What the lead verified:
- **The computer itself works.** The jail `desk-0c520a6c-…-default` started at 22:42, and an earlier question ran a command in it.
- **Live allows one tool round per reply.** Live has `TOOLS_ENABLED=false`, so `AGENT_TOOL_MAX_ROUNDS` defaults to 1 (`apps/server/src/config/load.ts:112-117`). The server logged `AI tool turn finished` with `rounds: 1` for both failed turns.
- **The second step had nowhere to go.** With one round, the turn ends with one follow-up model call that still carries tools, and only that call's text is used (`apps/server/src/agents/dm-tool-turn.ts:340-356`; the comment at `:240-246` calls this the legacy single-round tail). The model asked for a second tool call (the listing after the write), so the text was null, and the reply became `TRANSIENT_FAILURE_REPLY` (`:355`). The workspace is still empty.
- **A computer job needs several steps by nature,** and Julio's rule is that AI computers work with no variables to set. So a turn that offers the desk tools must not be held to the single-round default.

### Facts (the lead read them on 2026-10-16, main `692148b9d`)
- **The default:** `apps/server/src/config/load.ts:112-117`: `AGENT_TOOL_MAX_ROUNDS` is 6 when `TOOLS_ENABLED` is on, else 1, unless set.
- **The DM turn:** `apps/server/src/agents/gateway/dm-turn.ts` (395 lines). `:295`: `const deskEnabled = turnDesk.client !== undefined;`. `:316`: `...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),`.
- **The group turn:** `apps/server/src/agents/gateway/group-turn-body.ts` (374 lines). `:214`: `const deskEnabled = turnDesk.client !== undefined;`. `:296`: the same `maxRounds` spread.
- **The caps that still bound every turn:** `apps/server/src/agents/tool-loop.ts:173-174`, `TOOL_TURN_WALL_CLOCK_MS = 120_000` and `TOOL_TURN_MAX_CALLS = 12`. With more than 1 round, the last model call is made without tools, so the AI must answer in text (`apps/server/src/agents/dm-tool-turn.ts:122-129`).

### Steps
1. **New file `apps/server/src/agents/gateway/turn-rounds.ts`:**
   - export `DESK_MIN_TOOL_ROUNDS = 6`;
   - export `turnMaxRounds(configured: number | undefined, deskEnabled: boolean): number | undefined`:
     - when `deskEnabled`, it returns `Math.max(configured ?? 1, DESK_MIN_TOOL_ROUNDS)`;
     - otherwise it returns `configured` unchanged;
   - add a short comment: a computer job needs several steps, the single-round default would end a desk turn after one, and the wall clock and call caps still bound the turn.
2. **In `dm-turn.ts:316` and `group-turn-body.ts:296`,** compute `const maxRounds = turnMaxRounds(deps.toolMaxRounds, deskEnabled);` and spread `...(maxRounds === undefined ? {} : { maxRounds })` in place of the current spread. Add the import.
   - **Both files must stay within 400 lines.** `dm-turn.ts` is at 395: if the extra lines would cross 400, inline the call in the spread instead of adding a `const`.
3. **Change nothing else:** no config default, no compose file, no prompt.

### Tests
One small file, `apps/server/src/agents/gateway/turn-rounds.test.ts`:
- `(1, true)` gives 6;
- `(10, true)` gives 10;
- `(1, false)` gives 1;
- `(undefined, false)` gives `undefined`.

### Allowed files
- `apps/server/src/agents/gateway/turn-rounds.ts`
- `apps/server/src/agents/gateway/turn-rounds.test.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `work/T-1611-desk-turns-multi-round.md`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/turn-budget.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/group-turn.ts`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/turn-rounds.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A desk turn on a server with `TOOLS_ENABLED=false` runs up to 6 rounds,** and the last call is tool-free.
- **Turns without the computer behave exactly as before.**
- **`dm-turn.ts` and `group-turn-body.ts` stay within 400 lines.**

### Revision 1 (Julio, 2026-10-16: "not just 6 rounds, put something realistic")
A computer job needs computer-sized limits. Every turn today also stops at **12 tool calls** and **2 minutes** (`apps/server/src/agents/tool-loop.ts:173-174`), so more rounds alone is not enough.

**The new limits:**

| Per reply | Chat AIs (unchanged) | **With the computer on** |
|---|---|---|
| Tool rounds | the configured value | **at least 40** |
| Tool calls | 12 | **80** |
| Wall clock | 120 s | **15 min** |
| Longest wait on one model answer | what is left of the wall clock | **at most 5 min** |

**What the lead read** (main `692148b9d`):
- the DM loop checks the wall clock at `apps/server/src/agents/dm-tool-turn.ts:106` and the call cap at `:199`;
- each model call's timeout comes from `remainingTurnBudgetMs` (`:132`, the tail at `:349`, and `apps/server/src/agents/group-turn.ts:371`);
- `apps/server/src/agents/tool-exec.ts:151` cuts a round's calls to `TOOL_TURN_MAX_CALLS - executedCalls`;
- `apps/server/src/agents/turn-budget.ts:10-16` is `remainingTurnBudgetMs(startedAt, nowMs, floorMs)`;
- `maxRounds` reaches the loop through `DmTurnDeps` (`apps/server/src/agents/dm-turn.ts:84`), then `runToolTurn` (`apps/server/src/agents/dm-tool-turn.ts:250,265`), and through the group deps (`apps/server/src/agents/group-turn.ts:84,290,322`).


## Report (written by the worker when done)

### What I did (Revision 1)
- **`apps/server/src/agents/tool-loop.ts`:** added `TurnCaps`, `CHAT_TURN_CAPS` (the
  T-0106 120 s / 12-call caps), `COMPUTER_TURN_MAX_ROUNDS = 40`, `COMPUTER_TURN_CAPS`
  (80 calls / 15 min) and `MODEL_CALL_MAX_MS = 300_000`; updated the T-0106 comment so
  "fixed, not config" now names chat turns and points at the computer caps.
- **`apps/server/src/agents/turn-budget.ts`:** `remainingTurnBudgetMs` now takes
  `wallClockMs = TOOL_TURN_WALL_CLOCK_MS` and returns
  `Math.min(MODEL_CALL_MAX_MS, Math.max(floorMs, wallClockMs - elapsed))`. Two-argument
  callers are unchanged.
- **Threaded the caps:** `runToolLoop` takes an optional `caps` (default `CHAT_TURN_CAPS`)
  and uses `caps.wallClockMs` for the loop check and each model call and `caps.maxCalls`
  for the loop stop, passing `maxCalls` into `runLoopRound`; `runLoopRound` keeps the
  per-round call cap from `input.maxCalls`; `DmTurnDeps` and `GroupTurnDeps` gained
  `caps?: TurnCaps`, forwarded to `runToolLoop`, with the closing call in each tail using
  the turn's wall clock.
- **`apps/server/src/agents/gateway/turn-rounds.ts`:** replaced `turnMaxRounds`/
  `DESK_MIN_TOOL_ROUNDS` with `turnLimits(configured, deskEnabled)` returning
  `{ maxRounds: max(configured ?? 1, 40), caps: COMPUTER_TURN_CAPS }` for a desk turn and
  `configured === undefined ? {} : { maxRounds: configured }` otherwise.
- **`gateway/dm-turn.ts` and `gateway/group-turn-body.ts`:** the const + spread became the
  single `...turnLimits(deps.toolMaxRounds, deskEnabled)`.
- **Tests:** rewrote `turn-rounds.test.ts` for `turnLimits` (1/true → `{40, caps}`,
  60/true → 60, 1/false → `{maxRounds: 1}`, undefined/false → `{}`) plus the model-call cap
  case.

Files changed (all inside Allowed files): `tool-loop.ts`, `turn-budget.ts`, `tool-exec.ts`,
`dm-tool-turn.ts`, `dm-turn.ts`, `group-turn.ts`, `gateway/turn-rounds.ts`,
`gateway/turn-rounds.test.ts`, `gateway/dm-turn.ts`, `gateway/group-turn-body.ts`,
`work/T-1611-desk-turns-multi-round.md`.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/turn-rounds.test.ts src/agents/gateway-group.test.ts`
  → `Test Files 2 passed (2)`, `Tests 18 passed (18)`.
- `pnpm gate` (from repo root) → `gate: 11 changed file(s) against main`; PASS install
  (frozen), format, lint, typecheck, effect, tests @zilar/server; `scope: every changed file
  is inside the Allowed files`; `size: every changed source file is within 400 lines`;
  `GATE PASS`.

Final line counts of changed source files:
`tool-loop.ts` 204, `turn-budget.ts` 20, `tool-exec.ts` 254, `dm-tool-turn.ts` 395,
`dm-turn.ts` 170, `group-turn.ts` 399, `gateway/turn-rounds.ts` 19,
`gateway/dm-turn.ts` 396, `gateway/group-turn-body.ts` 375 — all within 400.

### Notes for the lead
- Chat turns are unchanged: with no `caps`, the loop uses `CHAT_TURN_CAPS`
  (120 s / 12 calls), and `remainingTurnBudgetMs` with two arguments returns the old value
  (120 s is under `MODEL_CALL_MAX_MS`).
- A per-round call cap is now also the loop's own stop (`caps.maxCalls`).
- I did not run the live server end to end; only the unit/integration tests above and the gate.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean on the revision-1 head (`f4ad160ef`; the packet matches HEAD).
- **What the lead read:**
  - **`tool-loop.ts`:** `TurnCaps`, `CHAT_TURN_CAPS` (12 calls, 120 s), and `COMPUTER_TURN_MAX_ROUNDS = 40` with `COMPUTER_TURN_CAPS` (80 calls, 15 min). `MODEL_CALL_MAX_MS` is 300 s.
  - **`turn-budget.ts`:** `remainingTurnBudgetMs` takes the turn's wall clock and caps one model call at 300 s. Chat turns don't change.
  - **The loop:** `runToolLoop`, `runLoopRound`, the DM tail and the group tail all use the turn's caps.
  - **`turnLimits`:** with the computer on, a turn gets `max(configured, 40)` rounds plus the computer caps; otherwise exactly the configured value.
  - **Sizes:** `group-turn.ts` 399, `dm-tool-turn.ts` 395, gateway `dm-turn.ts` 396.
- **Live context:** on 2026-10-16 the lead set `TOOLS_ENABLED`, `ROUTINES_ENABLED` and `WEB_TOOLS_ENABLED` to true on `zilar-chat` (Julio's choice). Chat turns now get 6 rounds; computer turns get 40.
- **Follow-up:** `group-turn.ts` is at 399 lines. Split it before its next change.


