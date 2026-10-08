---
id: T-0540
title: "Agents G7: move the DM turn (pumpSession, runSessionTurn) out of createAgentGateway into agents/gateway/dm-turn.ts; zero behaviour change"
status: merged
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

### What I did

Pure extraction (plan §3, G7). Moved `pumpSession` and `runSessionTurn` verbatim out of `createAgentGateway` into the new `apps/server/src/agents/gateway/dm-turn.ts`, exporting `createDmTurn(ctx)`.

- `createDmTurn` returns `{ pumpSession }`. `runSessionTurn` is only called by `pumpSession` (checked with grep), so it is not returned.
- `ctx` carries exactly what the moved code closes over: `deps`, `logger`, `turnLogger`, `baseUrl`, `sessionIsLive`, the four `live*` wrappers, `budgetGate`, `loadMemoryContext`, `startCompaction`, `disconnectAi`, `secretsFor`, `aiDeps`, `executeToolCall`, `withToolGuide`, `draftHub`. Callback types use indexed access (`ReturnType<typeof createBudgetGate>`, `MemoryRunner[...]`, `ReturnType<typeof createLiveSession>[...]`) so no signatures are duplicated.
- In `createAgentGateway` the factory is created once, after the live session, session lifecycle, budget gate and memory runner exist; `const { pumpSession } = createDmTurn({...})` keeps `handleIncoming`'s `void pumpSession(session)` call text unchanged.
- Removed the moved block (comment + both functions) and the imports that only it used: `randomUUID` (node:crypto), `jidFor`/`localpartFor` (`../xmpp/provisioning`), `bareJid`, `buildDmMessages`, `runDmTurn`, `buildTools`, `loadOwnerName`, and the `PendingMessage` type. Kept `eq`, `inArray`, `ensureAiModel`, `llmVirtualKeys`, `DM_HISTORY_MESSAGE_LIMIT`, `mapFailureToReply`, `loadActiveAi`, `isAiSender`, `modelNameForAi` etc. because the group turn / `start` still use them.
- No logic edits, no renames. Verified with a diff: the extracted block is byte-for-byte identical to the original.

### Files changed

- `apps/server/src/agents/gateway/dm-turn.ts` (new): `createDmTurn` + `DmTurnContext`.
- `apps/server/src/agents/gateway.ts`: removed the two functions and their now-unused imports; added the factory import and creation.
- `work/T-0540-agents-g7-extract-dm-turn.md`: status + this report.

### Commands run and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` → 16 passed, 1 skipped (17 files); 430 passed, 1 skipped (431 tests).
- `diff` of the extracted block (from `git show HEAD:...gateway.ts`) against the block in `dm-turn.ts` → `IDENTICAL`.
- `pnpm gate` (repo root):

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (17.4s)
PASS  lint  (0.9s)
PASS  typecheck  (8.7s)
PASS  tests @zilar/server  (44.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Tests

No test file was touched. `apps/server/src/agents/gateway.test.ts` and the rest of `src/agents` pass unchanged.

### Deviations / notes

- The spec suggested returning `{ pumpSession, runSessionTurn }` "or only `pumpSession` if nothing else calls `runSessionTurn`". Nothing else calls it, so only `pumpSession` is returned.
- `draftHub` is passed as a whole value (kept the `draftHub.publishTurn(...)` call text verbatim) rather than as a `publishTurn` callback; `randomUUID` moved with the code.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-08). G7: pumpSession and runSessionTurn moved into agents/gateway/dm-turn.ts (createDmTurn). Lead diff (whitespace-insensitive) of the old block against the new file: identical except the factory return. Agents tests unchanged (430 passed). Pre-review clean.
