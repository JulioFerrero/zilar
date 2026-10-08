---
id: T-0540
title: "Agents G7: move the DM turn (pumpSession, runSessionTurn) out of createAgentGateway into agents/gateway/dm-turn.ts; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0540-agents-g7-extract-dm-turn
model: auto
effort: low
depends_on: [T-0534]
estimate: 0.5 day
---

# T-0540: agents G7, extract the DM turn

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G7". G1, G2, G3, G5a, G5b and G6 have merged; each created a factory in `apps/server/src/agents/gateway/` (`budget.ts`, `memory.ts`, `listener.ts`, `live.ts`, `sessions.ts`). **This is a pure extraction: no logic change and no Effect.** Follow the shape of those files.

### Verified facts (do not re-derive; find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move)
- **The functions to move, verbatim:**
  - `pumpSession(session)` (around line 1189 after G5b);
  - `runSessionTurn(session, batch)` (around 1204-1420).
- **What they call** (counted in the current file):
  - the live wrappers from `live.ts`: `liveSendMessage`, `liveSendTyping`, `liveMarkDisplayed`, `liveProgressReporter` and `sessionIsLive`;
  - `executeToolCall`, `withToolGuide` and `aiDeps` (still in `gateway.ts`);
  - `loadMemoryContext` and `startCompaction` (`memory.ts`);
  - `checkDailyLimit`, `checkDmRoundGate` and `sendBudgetWarnings` (`budget.ts`);
  - `disconnectAi` (`sessions.ts`) and `secretsFor`;
  - module imports: `runDmTurn`, `buildDmMessages`, `buildTools`, `loadHistory`, `loadActiveAi`, `loadOwnerName`, `ensureAiModel`, `listActions`, `mapFailureToReply`, `publishTurn`, `modelNameForAi`, `toRedactedError`, `jidFor`, `localpartFor`, `bareJid`, `isAiSender`, `randomUUID`;
  - `deps` (`db`, `cipher` and others) and `logger`.
  
  Check the exact list yourself when you move them.
- **Callers that stay in `gateway.ts`:** `handleIncoming` (around line 592) calls `pumpSession`. Find any other caller with grep.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): "replies to the owner DM…", "builds user and assistant turns…", "runs 3 messages during one slow turn as exactly 2 calls…", "sends one displayed marker per turn…", the streaming drafts block, the DM budget cases ("runs a normal turn under the limit", "sends one notice per DM per day…"), and "a throwing action gateway is logged but the turn still gets a fixed failure text".

### What to build
1. **Create `apps/server/src/agents/gateway/dm-turn.ts`** exporting `createDmTurn(ctx)`.
   - `ctx` holds exactly what the moved code closes over. Take the functions that live in `gateway.ts` or in other factories as callbacks.
   - It returns `{ pumpSession, runSessionTurn }`, or only `pumpSession` if nothing else calls `runSessionTurn`.
2. **In `createAgentGateway`:**
   - create it once, after every factory it needs exists;
   - destructure, so `handleIncoming` keeps the same call text;
   - remove the moved code and drop the imports that only it used.
3. **Move the bodies verbatim:** no logic edits and no renames.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.
5. **Merge note:** keep your edits to the moved functions, the creation line and the imports.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G7", `apps/server/src/agents/gateway.ts` (the two functions and `handleIncoming`), `apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/memory.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `work/T-0540-agents-g7-extract-dm-turn.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The DM turn lives in `agents/gateway/dm-turn.ts`, moved verbatim.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
