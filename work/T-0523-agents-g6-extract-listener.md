---
id: T-0523
title: "Agents G6: move the room listener (noteListenerMessage, fireRoomListener, wakeListenerAis, dropRoomListenerIfUnused, roomListeners) out of createAgentGateway into agents/gateway/listener.ts; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0523-agents-g6-extract-listener
model: auto
effort: low
depends_on: [T-0516]
estimate: 0.5 day
---

# T-0523: agents G6, extract the room listener

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G6". G1 and G2 have merged; G3 (T-0517, memory) is merging. Each one moves a region of `createAgentGateway` into `apps/server/src/agents/gateway/`. **This is a pure extraction: no logic change and no Effect.** Follow the shape of `apps/server/src/agents/gateway/budget.ts` (G2): a factory that takes a context object and returns the functions.

### Verified facts (do not re-derive; find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move as other tasks merge)
- **The state:** `const roomListeners = new Map<string, RoomListenerState>()` (around line 147). `RoomListenerState` and `LISTENER_*` live in `apps/server/src/agents/gateway/contracts.ts`.
- **The functions to move, verbatim:**
  - `noteListenerMessage(roomJid, room, message, body)` (around 1145), which uses `deps.listener`, `roomListeners`, `isAiSender`, `normBareJid`, `LISTENER_WINDOW_MAX`, `LISTENER_EVERY_N_DEFAULT`, `LISTENER_QUIET_MS_DEFAULT` and `setTimeout`;
  - `clearListenerTimer(state)` (around 1214);
  - `fireRoomListener(roomJid, state)` (around 1223), which uses `deps.listener`, `deps.db` (`groups` and `topics` selects), `loadRoster`, `scoreRoom`, `completeChat`, `baseUrl`, `logger`, `toRedactedError` and `secretsFor`;
  - `wakeListenerAis(roomJid, state, wakeIds)` (around 1288), which reads **`sessions`**, calls **`sessionIsLive(session)`**, pushes onto `session.roomPending` and calls **`pumpRoom(session, roomJid)`**;
  - `dropRoomListenerIfUnused(roomJid)` (around 1335), which reads **`sessions`** and deletes from **`roomListeners` and `roomRounds`**.
- **The call sites that stay in `gateway.ts`:**
  - `dropRoomListenerIfUnused(roomJid)` in `disconnectAi` (around 851) and in `leaveRoomQuietly` (around 938);
  - `noteListenerMessage(...)` in `handleRoomIncoming` (around 1407);
  - **in `stop()`** (around 2277-2280): `for (const state of roomListeners.values()) clearListenerTimer(state); roomListeners.clear();`.
- **`sessions`, `roomRounds`, `sessionIsLive` and `pumpRoom` stay in `gateway.ts`.** G5 and G8 move them later, so take them as context fields: the two Maps by reference, and the two functions as callbacks.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): "wakes the scored AI…", "records a message once for two AIs…", "fires at everyN without waiting for quiet", "drops a scoring result when a newer human message arrives", "clears the pending timer when the AI is disconnected", and the wake-line cases. Also `apps/server/src/agents/listener/*.test.ts`.

### What to build
1. **Create `apps/server/src/agents/gateway/listener.ts`** exporting `createRoomListener(ctx)`.
   - `ctx` holds exactly what the moved code closes over: `deps` (or just `db` and `listener`), `logger`, `baseUrl`, `secretsFor`, `toRedactedError` if it is not imported directly, `sessions`, `roomRounds`, `sessionIsLive` and `pumpRoom`.
   - `roomListeners` lives inside it, one per gateway.
   - It returns `{ noteListenerMessage, dropRoomListenerIfUnused, clearAll }`. `clearAll()` holds the body of the two `stop()` lines.
2. **In `createAgentGateway`:**
   - create it once, after `sessions`, `roomRounds` and the functions it needs exist (a function declaration is hoisted; pass `pumpRoom` as `(session, roomJid) => pumpRoom(session, roomJid)` if order matters);
   - replace the moved code with its methods.
   
   The call sites keep the same arguments, and `stop()` calls `clearAll()` at the same point.
3. **Move the bodies verbatim:** no logic edits and no renames. Drop imports that only the moved code used.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.
5. **Merge note:** other G tasks edit other regions of `gateway.ts`. Keep your edits to the moved functions, the creation line, the `stop()` lines and the imports.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G6", `apps/server/src/agents/gateway.ts` (the functions above and their call sites), `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/contracts.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/listener.ts`, `work/T-0523-agents-g6-extract-listener.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The room listener lives in `agents/gateway/listener.ts`, moved verbatim.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/agents/gateway/listener.ts` exporting `createRoomListener(ctx)`,
  following the `budget.ts` factory shape. `ctx` is `{ deps, logger, baseUrl, secretsFor,
  sessions, roomRounds, sessionIsLive, pumpRoom }`.
- Moved verbatim, no logic or name changes:
  `noteListenerMessage`, `clearListenerTimer`, `fireRoomListener`, `wakeListenerAis`,
  `dropRoomListenerIfUnused`, and the `roomListeners` map (constructed inside the factory).
- The factory returns `{ noteListenerMessage, dropRoomListenerIfUnused, clearAll }`.
  `clearAll()` holds the two `stop()` lines (`clearListenerTimer` per state then
  `roomListeners.clear()`); `clearListenerTimer` and `fireRoomListener` stay module-private.
- In `createAgentGateway` I removed the `roomListeners` declaration and the five moved
  functions, and create one `roomListener` right after `roomRounds`. `sessions` and
  `roomRounds` are passed by reference; `sessionIsLive` and `pumpRoom` are passed as
  callbacks (the latter wrapped as `(session, roomJid) => pumpRoom(session, roomJid)` per
  the spec). `secretsFor` and `baseUrl` come from the enclosing scope.
- Updated the call sites: `roomListener.dropRoomListenerIfUnused(...)` in `disconnectAi`
  and `leaveRoomQuietly`; `roomListener.noteListenerMessage(...)` in `handleRoomIncoming`;
  `stop()` now calls `roomListener.clearAll()` at the same point as before.
- Dropped only imports used by the moved code: the whole `./listener/score` import
  (`loadRoster`, `LISTENER_WINDOW_MAX`, `scoreRoom`, `ListenerWindowMessage`),
  `completeChat` from `./reply`, and `LISTENER_EVERY_N_DEFAULT`,
  `LISTENER_QUIET_MS_DEFAULT`, `RoomListenerState`, `RoomSubscription` from
  `./gateway/contracts`. The separate re-export block of the constants is untouched.

### Files changed
- `apps/server/src/agents/gateway/listener.ts` (new)
- `apps/server/src/agents/gateway.ts`
- `work/T-0523-agents-g6-extract-listener.md` (status + this Report)

### Commands run (real results)
- `pnpm install` → done in 14.1s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway.test.ts`
  → 1 test file passed, 168 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/listener`
  → 1 test file passed, 13 tests passed.
- `pnpm gate` → `PASS install (frozen) (1.9s)`, `PASS format (28.8s)`, `PASS lint (0.9s)`,
  `PASS typecheck (19.8s)`, `PASS tests @zilar/server (94.9s)`, `scope: every changed file
  is inside the Allowed files`, `GATE PASS`.

### Deviations / notes
- None from the spec. All agent tests are untouched and green.
- Security: pure extraction of debounce/scoring plumbing; no route, auth, secret or
  persistence logic changed. No secrets were read or logged.

## Review (written by Claude)

Approved (lead, 2026-10-08). G6 is a pure extraction: the room listener (noteListenerMessage, fireRoomListener, wakeListenerAis, dropRoomListenerIfUnused, roomListeners) moved verbatim into agents/gateway/listener.ts (createRoomListener), with sessions, roomRounds, sessionIsLive and pumpRoom injected, and stop() calls clearAll(). Agents tests unchanged. Pre-review clean, 0 nits.
