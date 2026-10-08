---
id: T-0556
title: "Agents G4: move the tool executor (executeToolCall, runRequestAction, withToolGuide) out of createAgentGateway into agents/gateway/tool-exec.ts verbatim; cross-seam reads as ctx callbacks; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0556-agents-g4-extract-tool-exec
model: auto
effort: low
depends_on: [T-0549]
estimate: 0.5 day
---

# T-0556: agents G4, extract the tool executor

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G4". G1-G3 and G5-G8 have merged; G4 waited because it crosses seams. **The models to copy are `agents/gateway/dm-turn.ts` (G7), `agents/gateway/group-turn.ts` (G8a) and `agents/gateway/group-ingest.ts` (G8b).** This is a pure extraction: no logic change and no Effect.

**One deviation from the plan:** use one file, `gateway/tool-exec.ts`, instead of `tool-exec.ts` plus `tool-host.ts`. The plan's `ToolHost` reads (`sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom`) become fields of the factory's `ctx`, as the other factories did.

### Verified facts (do not re-derive; find each function by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move after merges)
- **The functions to move verbatim** (after G8b):
  - `executeToolCall(` (around line 265; about 244 lines);
  - `async function runRequestAction(` (around 509);
  - `function withToolGuide(` (around 565).
- **Callers that stay:**
  - `createDmTurn({ … executeToolCall, withToolGuide … })` (around 194) and `createGroupTurn({ … executeToolCall … })` (around 236) receive them as ctx fields;
  - find any other caller with grep.
  
  **The factories are created before these function declarations today, which works through function hoisting.** After the move, `createToolExec` must be created **before** `createDmTurn` and `createGroupTurn`, or those two must take lazy arrows. Pick whichever keeps the call text unchanged, and explain it in the Report.
- **What the functions close over:** `sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom` (from `createGroupIngest`), `deps`, `logger`, `aiDeps`, `secretsFor`, `nowMs` and the action gateway. **Check this list against the code.** Values from factories created later go in as lazy arrows (`(…) => pumpRoom(…)`), as G8b did.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name):
  - "updates the persona by chat…", "saves a remembered fact…" and "refuses a sixth remember in one turn after five saved";
  - "routes a tier-2 request_action through the action gateway with session-derived ids", "cannot be tricked by an aiId or groupId smuggled inside args" and "maps every RequestOutcome…";
  - "a stopped AI answers 'the AI was stopped'…";
  - the delegation tool cases.

### What to build
1. **Create `apps/server/src/agents/gateway/tool-exec.ts`** exporting `createToolExec(ctx)`. It returns `{ executeToolCall, runRequestAction, withToolGuide }`, or only what callers still use.
2. **In `createAgentGateway`:**
   - create it once, in an order that is safe as explained above;
   - destructure;
   - remove the moved functions and drop the imports that only they used.
3. **Move the bodies verbatim:** no logic edits and no renames, except replacing a direct factory member reference with the injected callback (as G8b did with `noteListenerMessage`). Put a whitespace-insensitive diff of the old block against the new one in the Report.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` and `apps/server/src/actions/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G4", `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/tool-exec.ts`, `work/T-0556-agents-g4-extract-tool-exec.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents src/actions
pnpm gate
```

### Acceptance
- The tool executor lives in `agents/gateway/tool-exec.ts`, moved verbatim, with the diff in the Report.
- The agents and actions tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
