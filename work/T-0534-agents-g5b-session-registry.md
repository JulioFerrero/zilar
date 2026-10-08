---
id: T-0534
title: "Agents G5b: move the session lifecycle (scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly, handleReplaced) out of createAgentGateway into agents/gateway/sessions.ts; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0534-agents-g5b-session-registry
model: auto
effort: low
depends_on: [T-0529]
estimate: 0.5 day
---

# T-0534: agents G5b, extract the session lifecycle

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G5", second half. G5a (T-0529) moved the live wrappers into `agents/gateway/live.ts`. **This is a pure extraction: no logic change and no Effect.** Follow the shape of `apps/server/src/agents/gateway/live.ts` and `apps/server/src/agents/gateway/listener.ts`: a factory taking a context object.

### Verified facts (do not re-derive; find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move)
- **The functions to move, verbatim** (around lines 527-770 after G5a):
  - `scheduleRetry(session)`, which uses `sessions`, `retryDelayMs`, `retryBaseMs`, `setTimeout`/`clearTimeout`, `logger`, `toRedactedError` and `secretsFor`, and calls itself;
  - `connectAi(record)`, which uses `deps` (`createCore`, `issueXmppToken`, the xmpp config), `sessions`, `superseded`, `logger` and `secretsFor`, and wires the core's events to **`handleIncoming`**, **`handleRoomIncoming`** and **`handleReplaced`**; it also calls `syncAiRooms` and `scheduleRetry`;
  - `disconnectAi(aiId)`, which calls `roomListener.dropRoomListenerIfUnused` and clears timers;
  - `syncAiRooms(session, aiName)`, which uses `listAiRooms`, `joinRoom`, `roomJidFor` and `leaveRoomQuietly`;
  - `leaveRoomQuietly(...)`;
  - `handleReplaced(session)`, which uses `superseded` and `logger`, and calls `disconnectAi`.
  
  `withToolGuide` sits between them and **is not** part of this task.
- **What stays in `gateway.ts`:**
  - the Maps `sessions` and `superseded` (pass them by reference);
  - `handleIncoming` and `handleRoomIncoming` (the turn code; pass them as callbacks, e.g. `(s, m) => handleIncoming(s, m)`);
  - `reconcile`, `start` and `stop`, which call `connectAi`, `disconnectAi` and `syncAiRooms` (keep the same call text by destructuring);
  - `roomListener` (pass `dropRoomListenerIfUnused` as a callback);
  - `nowMs`, `roomJidFor` and `secretsFor`.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): the lifecycle block ("connects every active AI on start…", "keeps the others when one AI fails to connect", "never keeps a login that finishes after shutdown"), the replaced-session cases, the reconnect and retry cases, the topics join cases, the kill switch block, "disconnects an AI disabled after start on the next reconcile" and "retries a failed join on reconcile".

### What to build
1. **Create `apps/server/src/agents/gateway/sessions.ts`** exporting `createSessionLifecycle(ctx)`.
   - `ctx` holds exactly what the moved code closes over, with the callbacks above.
   - It returns `{ scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly, handleReplaced }`.
2. **In `createAgentGateway`:**
   - create it once, after `roomListener` exists;
   - destructure the names, so every call site stays the same text;
   - remove the moved code and drop the imports that only it used.
   
   **Order matters:** the callbacks must be wrapped in arrows if the functions they call are declared later and are not hoisted function declarations. Check each one.
3. **Move the bodies verbatim:** no logic edits and no renames.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.
5. **Merge note:** keep your edits to the moved functions, the creation line and the imports.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G5", `apps/server/src/agents/gateway.ts` (the functions above and their callers), `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway/contracts.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/sessions.ts`, `work/T-0534-agents-g5b-session-registry.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The session lifecycle lives in `agents/gateway/sessions.ts`, moved verbatim.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
