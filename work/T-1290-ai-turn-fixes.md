---
id: T-1290
title: "AI turn fixes: the 120 s turn cap bounds each model call (AI-14); group mentions from different people aren't merged into one turn (AI-9); a failed room turn tells the asker plainly and DMs the owner the real reason once a day per room (AI-10)"
status: merged
milestone: M5
branch: task/T-1290-ai-turn-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1290: AI turn fixes

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-14** (P2, `:116`): `TOOL_TURN_WALL_CLOCK_MS` (120 s) is checked only before each round (`apps/server/src/agents/dm-tool-turn.ts`). Each model call has its own 90 s timeout (`apps/server/src/agents/tool-loop.ts`), and the closing call adds another, so a slow provider holds the turn (and every later owner message) for about 5 minutes.
- **AI-9** (P2, `:197`): group mentions merge into one turn whose trigger is the last item (`apps/server/src/agents/gateway/group-turn.ts`), and the reply tags only that sender (`apps/server/src/agents/group-turn.ts`). The audit's fix is in `apps/server/src/agents/gateway/group-ingest.ts`: don't merge items from different senders.
- **AI-10** (P2, `:203`): a failed room turn sends `@asker <mapFailureToReply>` (`gateway/group-turn.ts`). That text asks the asker to fix the **owner's** key or budget, and the owner never hears of it.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-14:** each `requestCompletion` in a tool turn (rounds and the closing call) gets `timeoutMs: max(5 000, remaining)`, where remaining is the turn's wall-clock budget.
2. **AI-9:** in `group-ingest.ts`, merge queued mentions only when they come from the same sender. A different sender starts a new turn that runs after the current one, keeping order.
3. **AI-10:**
   - **in rooms**, the asker gets "I can't answer right now. My owner has been told.";
   - **the owner** gets a DM from the AI with the real reason (the existing `mapFailureToReply` text), at most once per day per room. Use the `dailyLimitNotices` pattern in `apps/server/src/agents/gateway/budget.ts` (cite it);
   - DM turns keep today's text.
4. **Tests,** up to 3, in `apps/server/src/agents/gateway-group.test.ts` (the nearest; cite another if better):
   - two senders' mentions make two turns;
   - a room failure sends the generic line plus one owner DM, and a second failure the same day sends no second DM;
   - for AI-14, a test only if a fake clock makes it simple.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:39-53`, `:116`, `:197-210`), and the files above.

### Allowed files
`apps/server/src/agents/**/*.ts`, `work/T-1290-ai-turn-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

### Recheck of each finding on `main`

All three were still present in this worktree:

- **AI-14**: `apps/server/src/agents/dm-tool-turn.ts:89` checked `TOOL_TURN_WALL_CLOCK_MS` only before each round; the round call and the closing call used the 90 s default. Fixed here.
- **AI-9**: `apps/server/src/agents/gateway/group-ingest.ts:229-230` took the whole queue (up to the next delegation) as one turn. Fixed here.
- **AI-10**: `apps/server/src/agents/gateway/group-turn.ts:573` sent `@<asker> <mapFailureToReply>` into the room and never told the owner. Fixed here.

### What I built

1. **AI-14**: new `apps/server/src/agents/turn-budget.ts` exports `remainingTurnBudgetMs(startedAt, nowMs)` = `max(5000, TOOL_TURN_WALL_CLOCK_MS - elapsed)` (with `TOOL_TURN_MIN_CALL_MS = 5000`). Every `requestCompletion` in the shared tool loop (`runToolLoop`) and both closing calls (`runToolTurn`, `runGroupToolTurn`) now pass `timeoutMs: remainingTurnBudgetMs(...)`, so one slow provider no longer gets a fresh 90 s per call on top of the 120 s turn cap.
2. **AI-9**: `pumpRoomEffect` in `apps/server/src/agents/gateway/group-ingest.ts` now extends the batch only across items from the same sender (normalised bare JID). A delegation is still its own turn; a different sender's mention starts the next turn, in order.
3. **AI-10**: rooms now hear the fixed `GROUP_FAILURE_REPLY` ("I can't answer right now. My owner has been told."), and the owner gets a DM with the real `mapFailureToReply` reason at most once per AI per room per UTC day. The day key lives in `createBudgetGate` (`apps/server/src/agents/gateway/budget.ts`), next to `dailyLimitNotices`, using the same in-memory map plus `utcDay()` pattern the spec points at. Both failure paths are covered: the model-failure paths in `agents/group-turn.ts` (through a new optional `onFailure` dep the gateway wires in) and the outer `catchDefect` in `gateway/group-turn.ts`. DM turns keep today's text.

### Tests (added to `apps/server/src/agents/gateway-group.test.ts`)

- **AI-9**: two senders' mentions queued during a held turn produce three turns tagged `@Owner`, `@Second`, `@Third` (this fails under the old whole-queue merge).
- **AI-10**: a 401 room failure sends the fixed line to the room and exactly one owner DM (`PROVIDER_KEY_REJECTED_REPLY`); a second failure the same day sends no second DM.
- **AI-14**: `remainingTurnBudgetMs` returns the remaining budget and floors at 5000 ms (fake clock).

### Files changed

- `apps/server/src/agents/turn-budget.ts` (new, 16 lines)
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/replies.ts`
- `apps/server/src/agents/reply.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `work/T-1290-ai-turn-fixes.md`

### Commands and results

- `pnpm install` — done (1181 packages).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` — 1 file, 13 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/gateway-drain.test.ts` — 2 files, 7 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` — 4 files, 23 passed.
- `pnpm gate` — GATE PASS (summary lines):
  - `PASS  install (frozen)  (4.7s)`
  - `PASS  format  (3.3s)`
  - `PASS  lint  (2.3s)`
  - `PASS  typecheck  (8.0s)`
  - `PASS  effect  (3.1s)`
  - `PASS  tests @zilar/server  (10.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Problems / deviations

- The AI-14 helper went into a new `agents/turn-budget.ts` rather than `tool-loop.ts`: `tool-loop.ts` was already exactly 400 lines, so adding there breached the 400-line acceptance.
- `apps/server/src/agents/gateway/group-turn.ts` was already 566 lines on `main` (over the 400-line guideline); it is now 599. I kept its growth small (the day-key state lives in `budget.ts`, per the spec) and all other edited files are at most 400 lines, but this file cannot reach 400 without a refactor outside this task's scope.
- I ran the full `src/agents` suite once at the end (with `--maxWorkers=2`) because the task's Checks list it; otherwise I only ran the test files I touched plus `pnpm gate`.

### Open questions / blocked

None.

### Round 2 (fix round, `PREREVIEW.md`)

Findings: must-fix=0, should-fix=1, nit=3.

- **Finding 1 (should-fix, file length): fixed.** Split
  `apps/server/src/agents/gateway/group-turn.ts` (599 lines) into a thin factory
  plus a new `apps/server/src/agents/gateway/group-turn-body.ts` (348 lines)
  holding the turn body. A pure move: wording and behaviour unchanged. The
  factory is now 326 lines. `RoomGateState` is now exported from
  `gateway/db.ts` for the body's input type. Every file touched this round is at
  most 400 lines, which supersedes the earlier "cannot reach 400" deviation.
- **Nits (2, 3, 4): left as they are.** They are not in lines this round
  changes; the round's instructions are to fix must-fix and should-fix only.
- No new test: finding 1 is a pure move with no behaviour change. The existing
  AI-9/AI-10/AI-14 tests in `gateway-group.test.ts` cover the moved code.

Tests run this round:
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`
→ 1 file, 13 passed.

`pnpm gate` → GATE PASS:

- `PASS  install (frozen)  (1.9s)`
- `PASS  format  (2.1s)`
- `PASS  lint  (1.1s)`
- `PASS  typecheck  (3.3s)`
- `PASS  effect  (1.7s)`
- `PASS  tests @zilar/server  (8.2s)`
- `scope: every changed file is inside the Allowed files`
- `migration: every added migration continues from the base`

Status stays `review`.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits).**
- **Lead's checks after the rebase:**
  - server `src/agents` vitest: 4 files, 23 tests pass, including the AI-9 per-sender turns and the AI-10 single owner DM per day;
  - server tsc: 0 errors;
  - largest files: `group-turn.ts` 399 lines, `dm-tool-turn.ts` 392.
- **Live check after deploy:** a room failure shows "I can't answer right now. My owner has been told."
