---
id: T-0529
title: "Agents G5a: move the live-session wrappers (sessionIsLive, liveSendMessage, liveProgressReporter, liveSendTyping, liveMarkDisplayed) and postToChat with its three lookups out of createAgentGateway into agents/gateway/live.ts; zero behaviour change"
status: todo
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

## Review (written by Claude)
