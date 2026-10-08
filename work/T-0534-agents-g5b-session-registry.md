---
id: T-0534
title: "Agents G5b: move the session lifecycle (scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly, handleReplaced) out of createAgentGateway into agents/gateway/sessions.ts; zero behaviour change"
status: merged
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

### What I did

Pure extraction, no logic change and no Effect, following the shape of
`agents/gateway/live.ts` and `listener.ts`.

- Created `apps/server/src/agents/gateway/sessions.ts`, exporting
  `createSessionLifecycle(ctx)`. It holds the moved `scheduleRetry`,
  `connectAi`, `disconnectAi`, `syncAiRooms`, `leaveRoomQuietly` and
  `handleReplaced`, verbatim, and returns all six.
- In `createAgentGateway` I create the lifecycle once (right after
  `roomListener`/the `let` declarations) and destructure
  `{ connectAi, disconnectAi, syncAiRooms }`, so every external call site in
  `reconcile`, `start` and `stop` keeps the same text.
- Moved `withToolGuide` nowhere: it stays in `gateway.ts` as the spec says.
- Dropped the imports that only the moved code used: `type XmppCore` and
  `issueXmppToken`, `XMPP_TOKEN_TTL_SECONDS` and `retryDelayMs` (contracts
  import), `listAiRooms` (db import) and `GATEWAY_RESOURCE` (the value import;
  it is still re-exported from `gateway.ts` by the separate re-export block).

The context object carries exactly what the moved code closes over:
`sessions`, `superseded`, `deps` (`Pick<AgentGatewayDeps, 'db' | 'xmpp'>`),
`createCore`, `retryBaseMs`, `logger`, `secretsFor`, `roomJidFor`, `nowMs`,
plus the callbacks `isStarted`, `handleIncoming` and
`dropRoomListenerIfUnused`.

### Files changed

- `apps/server/src/agents/gateway/sessions.ts` (new)
- `apps/server/src/agents/gateway.ts`
- `work/T-0534-agents-g5b-session-registry.md` (status + this report)

### Commands and real results

- `pnpm install` — succeeded (reused packages, 0 added).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` —
  `Test Files 16 passed | 1 skipped (17)`, `Tests 430 passed | 1 skipped (431)`,
  285s.
- `pnpm gate` (repo root) — ended with `GATE PASS`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (4.3s)
  PASS  format  (60.3s)
  PASS  lint  (1.9s)
  PASS  typecheck  (27.4s)
  PASS  tests @zilar/server  (121.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec

1. **`started` is read through a callback.** `connectAi` reads the gateway's
   `started` flag in two places; the flag stays in `gateway.ts` (it is set by
   `start`/`stop`). I pass `isStarted: () => started` and read `isStarted()`
   there. This is the only source change inside a moved body; the checks run
   at the same points and the same values, so behaviour is identical.
2. **`handleRoomIncoming` is not in the context.** The spec's description says
   `connectAi` wires events to `handleIncoming`, `handleRoomIncoming` and
   `handleReplaced`, but the code only wires `core.on('message')` →
   `handleIncoming`, `core.on('replaced')` → `handleReplaced` and
   `core.on('status')`. `handleIncoming` dispatches `groupchat` stanzas to
   `handleRoomIncoming`, which stays in `gateway.ts`. I passed only the
   callbacks the moved code actually calls, to avoid an unused context field
   (`handleIncoming` only).
3. **I destructure only the three functions the gateway still calls.**
   `scheduleRetry`, `leaveRoomQuietly` and `handleReplaced` are now called only
   from inside `sessions.ts`; the factory still returns all six as the spec
   asks, but destructuring the unused ones in `gateway.ts` would trip the
   unused-variable lint rule.

### Security / behaviour

Pure move: no route, log line, error text or timing changed. No secrets,
logging, permission or query changes. I did not touch any file outside the
Allowed files.

## Review (written by Claude)

Approved (lead, 2026-10-08). G5b is a pure extraction: scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly and handleReplaced moved verbatim into agents/gateway/sessions.ts (createSessionLifecycle). The only deltas are isStarted() over the live flag and the injected dropRoomListenerIfUnused. Agents tests unchanged. Pre-review clean, 0 nits.
