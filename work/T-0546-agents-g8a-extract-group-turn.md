---
id: T-0546
title: "Agents G8a: move the group/topic turn body (runGroupSessionTurn) out of createAgentGateway into agents/gateway/group-turn.ts verbatim; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0546-agents-g8a-extract-group-turn
model: auto
effort: low
depends_on: [T-0540]
estimate: 0.5 day
---

# T-0546: agents G8a, extract the group turn

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G8". **The lead's split for G8:**
- **G8a** (this task) moves the whole `runGroupSessionTurn` function verbatim. It is about 420 lines, but a verbatim move is mechanical, and splitting the function body would be a logic change.
- **G8b** (later) moves the ingest side: `sessionForAiJid`, `handleRoomIncoming` and `pumpRoom`.

**The model to copy is G7 (T-0540):** `apps/server/src/agents/gateway/dm-turn.ts` moved `pumpSession` and `runSessionTurn` the same way. This is a **pure extraction: no logic change and no Effect.**

### Verified facts (do not re-derive; find each function by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move after merges)
- **The function to move verbatim:** `async function runGroupSessionTurn(` (around line 783 after G7; it runs to just before `async function start()`, around 1205).
- **The likely caller that stays in `gateway.ts`:** `pumpRoom` (around 757). Find every caller with grep.
- **Already-extracted factories it may call:**
  - `budgetGate` (`budget.ts`), the memory runner (`memory.ts`), the live wrappers (`live.ts`), the session lifecycle (`sessions.ts`), `roomListener` (`listener.ts`) and `dm-turn.ts`;
  - plus `gateway.ts` closures such as `executeToolCall`, `runRequestAction`, `withToolGuide`, `aiDeps`, `secretsFor`, `roomJidFor` and `nowMs`.
  
  Take the closures as callbacks in `ctx`, exactly as G7 did. Use indexed-access types such as `ReturnType<typeof createBudgetGate>[...]` so no signature is copied by hand.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`): the groups block, request_action in groups, AI handoff, delegation tools and topic naming (see plan §3 G8 for the blocks).

### What to build
1. **Create `apps/server/src/agents/gateway/group-turn.ts`** exporting `createGroupTurn(ctx)`. It returns `{ runGroupSessionTurn }`, and `ctx` holds exactly what the function closes over.
2. **In `createAgentGateway`:**
   - create it once, after every factory and closure it needs exists;
   - destructure, so the callers keep the same call text;
   - remove the moved function and drop the imports that only it used.
3. **Move the body verbatim:** no logic edits and no renames. In the Report, show a diff of the old block against the new one; only indentation and the factory wrapper may differ.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G8", `apps/server/src/agents/gateway/dm-turn.ts` (the model), `apps/server/src/agents/gateway.ts` (`runGroupSessionTurn` and `pumpRoom`).

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/group-turn.ts`, `work/T-0546-agents-g8a-extract-group-turn.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The group turn lives in `agents/gateway/group-turn.ts`, moved verbatim, with the diff in the Report.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
