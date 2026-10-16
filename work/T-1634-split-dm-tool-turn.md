---
id: T-1634
title: "Size split: agents/dm-tool-turn.ts is at 395 lines — move runToolLoop (the shared multi-round loop) into agents/tool-rounds.ts, re-exported from dm-tool-turn.ts, no behaviour change"
status: merged
milestone: M5
branch: task/T-1634-split-dm-tool-turn
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1634: Split dm-tool-turn.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/agents/dm-tool-turn.ts` is at 395 lines, against a limit of 400. The AI-computer work (scheduled jobs, smart wake) will touch the tool loop next.

### Facts (the lead read them on 2026-10-16, main after T-1631)
- **The file** has two exports:
  - `runToolLoop` (`:55`, its header comment at about `:20-54`), the multi-round loop shared by DM and group turns;
  - `runToolTurn` (`:236` to the end; header comment about `:226-235`), the DM wrapper.
- **The importers:**
  - `apps/server/src/agents/dm-turn.ts:7`: `import { runToolTurn } from './dm-tool-turn';`
  - `apps/server/src/agents/group-turn.ts:8`: `import { runToolLoop } from './dm-tool-turn';`
  - `apps/server/src/agents/reply.ts` also imports from `./dm-tool-turn`; check what it imports.
- **Tests:** `apps/server/src/agents/dm-turn.fake-provider.test.ts`, `gateway-desk.test.ts` and `gateway-group.test.ts`.

### Steps
1. **Move `runToolLoop`** (with its header comment, and any helpers or constants **only** it uses) into a new file `apps/server/src/agents/tool-rounds.ts`.
   - **Correction from the lead:** `apps/server/src/agents/tool-loop.ts` already exists (204 lines, the model call `requestCompletion`). **Don't touch it,** and don't name the new file `tool-loop.ts`.
2. **In `dm-tool-turn.ts`,** import it for `runToolTurn` and add `export { runToolLoop } from './tool-rounds';`, so no importer changes. Then update `group-turn.ts:8` to import from `./tool-rounds` directly. That is the only importer edit.
3. **No behaviour change:** the same code, order and logging.
4. **Say in the Report** what moved and the new line counts.

### Allowed files
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/tool-rounds.ts`
- `apps/server/src/agents/group-turn.ts`
- `work/T-1634-split-dm-tool-turn.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts src/agents/gateway-group.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`dm-tool-turn.ts` is under 250 lines.**
- **The tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did

Used the corrected destination `apps/server/src/agents/tool-rounds.ts` (the lead's note); `apps/server/src/agents/tool-loop.ts` was not touched (still 204 lines).

- **Moved `runToolLoop`** — its `T-0106` header comment and body, byte for byte — out of `dm-tool-turn.ts` into the new `tool-rounds.ts`, together with only the imports it needs: `FetchLike`, `ModelTarget`, `ChatUsage` (types), `cutShortSuffix`, `runLoopRound`, `CHAT_TURN_CAPS`, `ChatCompletionError`, `TRANSIENT_FAILURE_REPLY`, `requestCompletion`, `ExecuteToolCall`, `ModelRequestMessage`, `TurnCaps`, `remainingTurnBudgetMs`, `ChatToolDefinition`, `TurnLog`. No helper or constant moved: the loop only uses shared ones.
- **`dm-tool-turn.ts`** now imports `runToolLoop` from `./tool-rounds` for `runToolTurn` and re-exports it (`export { runToolLoop } from './tool-rounds';`), so `dm-turn.ts` and `reply.ts` need no change. Removed the imports that only `runToolLoop` used (`CHAT_TURN_CAPS`, `ChatCompletionError`, `ExecuteToolCall`, `TurnCaps`, `runLoopRound`).
- **`group-turn.ts:8`** now imports `runToolLoop` from `./tool-rounds` (the only importer edit).
- **No behaviour change:** same code, order and logging. `tool-rounds.ts` imports `runLoopRound` from `./tool-exec` and `remainingTurnBudgetMs` from `./turn-budget`; no import cycles (neither imports `tool-rounds`).

Line counts: `dm-tool-turn.ts` 395 → 189; `tool-rounds.ts` new = 213; `tool-loop.ts` unchanged = 204.

Deviation from the letter of the spec: none — I used the exact re-export the spec asks for. Prettier collapsed the now-shorter import lines in `dm-tool-turn.ts` to one line each (its config); that is the only formatting difference.

### Checks run

- `pnpm install` — Done in 34s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts src/agents/gateway-group.test.ts` — Test Files 3 passed (3); Tests 15 passed (15).
- `pnpm gate` — first run FAILed only on `format` (`dm-tool-turn.ts`); after `prettier --write` on the file, the re-run passed. Final summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.3s)
PASS  lint  (1.7s)
PASS  typecheck  (5.3s)
PASS  effect  (1.1s)
PASS  tests @zilar/server  (11.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Scope is exactly the four Allowed files (three source + the task file); the gate agrees.
- Acceptance met: `dm-tool-turn.ts` is 189 lines (< 250) and the tests pass unchanged.
- I first explored the original spec's destination (`tool-loop.ts`) but did not modify it; it was restored to nothing changed because I never wrote to it (verified with `git status`).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The lead's spec named an existing file** (`tool-loop.ts`). The lead corrected it mid-task to `tool-rounds.ts`, and `tool-loop.ts` has no diff against main.
- **The split:** `dm-tool-turn.ts` went from 395 to 189 lines, and the new `tool-rounds.ts` is 213. `group-turn.ts` imports from `./tool-rounds`, and `dm-tool-turn.ts` re-exports it for `reply.ts`.
- **The tests:** the lead ran `dm-turn.fake-provider`, `gateway-desk` and `gateway-group`: 15 passed.
