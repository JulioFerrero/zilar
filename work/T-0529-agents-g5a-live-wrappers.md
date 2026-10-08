---
id: T-0529
title: "Agents G5a: move the live-session wrappers (sessionIsLive, liveSendMessage, liveProgressReporter, liveSendTyping, liveMarkDisplayed) and postToChat with its three lookups out of createAgentGateway into agents/gateway/live.ts; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0529-agents-g5a-live-wrappers
model: auto
effort: low
depends_on: [T-0523]
estimate: 0.5 day
---

# T-0529: agents G5a, extract the live-session wrappers

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G5". The lead splits G5 in two:
- **G5a (this task):** the live-session wrappers and `postToChat`;
- **G5b (later):** connect, disconnect, room sync and retries.

G1, G2, G3 and G6 have merged; G6 (T-0523) created `agents/gateway/listener.ts`. **This is a pure extraction: no logic change and no Effect.** Follow the shape of `apps/server/src/agents/gateway/budget.ts` and `apps/server/src/agents/gateway/listener.ts`: a factory that takes a context object and returns the functions.

### Verified facts (do not re-derive; find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move)
- **The functions to move, verbatim:**
  - `sessionIsLive(session)`: `!session.stopped && sessions.get(session.aiId) === session`;
  - `liveSendMessage(session, to, kind, text, opts?)`: resolves `{ id: '' }` when the session is not live, else `session.core.sendMessage(...)`;
  - `liveProgressReporter(session, to, kind, aiJid)`: `{ reportProgress, clearProgress }`, which uses `logger`, `toRedactedError` and `secretsFor()`;
  - `liveSendTyping(session, to, kind, state)` and `liveMarkDisplayed(session, chatJid, kind, messageId)`;
  - **`postToChat(input)`**, with its private helpers `sendOptions(input)`, `loadOwnerId(aiId)`, `loadRoomJid(groupId)` and `loadTopicRoomJid(topicId)`. Those four have no other caller in the file; check with grep. They use `deps.db` (the `ais`, `groups` and `topics` selects), `deps.xmpp.domain`, `jidFor` and `localpartFor`.
- **What they close over:** `sessions` (the Map stays in `gateway.ts`; pass it by reference), `deps`, `logger` and `secretsFor`.
- **Callers that stay in `gateway.ts`:**
  - `sessionIsLive` is passed **before its declaration line** to `createRoomListener({...})` (around line 138) and `createBudgetGate({...})` (around line 182). A function declaration is hoisted today, so **create the new factory right after `sessions` and `superseded` are declared, before those two.**
  - `postToChat` is in the returned gateway object (around line 1987).
  - `liveSendMessage`, `liveSendTyping`, `liveMarkDisplayed` and `liveProgressReporter` are used by the turn code (`runSessionTurn`, `runGroupSessionTurn` and others).
  
  Every call keeps the same arguments.
- `withToolGuide` sits between these functions but is **not** part of this task; leave it where it is.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): the `postToChat` cases, "a stopped AI answers 'the AI was stopped'…", "a reply in flight when the stop arrives is dropped", "posts one progress message and corrects it on the next round", the kill switch block, and the read-marker cases.

### What to build
1. **Create `apps/server/src/agents/gateway/live.ts`** exporting `createLiveSession(ctx)`.
   - `ctx` holds `sessions`, `deps` (or just `db` and `xmppDomain`), `logger` and `secretsFor`.
   - It returns `{ sessionIsLive, liveSendMessage, liveProgressReporter, liveSendTyping, liveMarkDisplayed, postToChat }`.
2. **In `createAgentGateway`:**
   - create it once, at the point described above;
   - destructure the six names, so every call site stays the same text;
   - remove the moved code and drop the imports that only it used.
   
   `secretsFor` is a function declaration (hoisted), so passing it early is fine; check that it does not read anything declared later at call time.
3. **Move the bodies verbatim:** no logic edits and no renames.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.
5. **Merge note:** other G tasks may edit other regions of `gateway.ts`. Keep your edits to the moved functions, the creation line and the imports.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G5", `apps/server/src/agents/gateway.ts` (the functions above and their call sites), `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/contracts.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/live.ts`, `work/T-0529-agents-g5a-live-wrappers.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The live wrappers and `postToChat` live in `agents/gateway/live.ts`, moved verbatim.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Moved the live-session wrappers (`sessionIsLive`, `liveSendMessage`,
`liveProgressReporter`, `liveSendTyping`, `liveMarkDisplayed`) and `postToChat`
with its four private helpers (`loadOwnerId`, `loadRoomJid`,
`loadTopicRoomJid`, `sendOptions`) out of `createAgentGateway` into the new
`apps/server/src/agents/gateway/live.ts`, exported as the factory
`createLiveSession(ctx)`. Bodies moved verbatim; no logic changes and no
Effect.

In `gateway.ts`:
- created the factory once, just after `sessions`/`superseded` and before
  `createRoomListener` and `createBudgetGate`, and destructured the six names
  so every call site is unchanged text;
- the `sessions` Map stays in `gateway.ts` and is passed by reference;
- `withToolGuide` stayed where it was;
- dropped the imports that only the moved code used: `SendMessageOptions` and
  `ChatKind` (from `@zilar/xmpp-core`) and `Payload` (from
  `@zilar/protocol`). `jidFor`/`localpartFor`, `ais`, `groups`, `topics` and
  `eq` are still used by code that stays, so they remain.

### Deviation from the spec
The spec's "what they close over" list (`sessions`, `deps`, `logger`,
`secretsFor`) omits `roomJidFor`, but `loadRoomJid` and `loadTopicRoomJid`
call it. It also has a caller that stays in `gateway.ts` (the leave-room path),
so it was not moved; I passed it into the context as `roomJidFor` to keep one
definition. Everything else matches the spec. No behaviour change.

### Files changed
- `apps/server/src/agents/gateway/live.ts` (new)
- `apps/server/src/agents/gateway.ts`
- `work/T-0529-agents-g5a-live-wrappers.md`

### Commands and results
- `pnpm install`: exit 0 (peer-dependency warnings only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents`:
  exit 0; Test Files 16 passed | 1 skipped (17); Tests 430 passed | 1 skipped
  (431).
- `pnpm gate`: `gate: 3 changed file(s) against main`; PASS install (frozen),
  PASS format, PASS lint, PASS typecheck, PASS tests @zilar/server;
  `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). G5a is a pure extraction: sessionIsLive, the live send/typing/displayed/progress wrappers and postToChat with its three lookups moved verbatim into agents/gateway/live.ts (createLiveSession), created before the listener and budget factories that take sessionIsLive. Agents tests unchanged. Pre-review clean, 0 nits.
