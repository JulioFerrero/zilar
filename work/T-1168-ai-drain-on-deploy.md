---
id: T-1168
title: "AI-1: on shutdown the AI gateway drains — refuse new turns, wait up to 8 s for running DM and room turns to finish and send, and tell the asker 'I was restarted mid-reply, please ask again' for any turn still running, instead of silently dropping it"
status: merged
milestone: M5
branch: task/T-1168-ai-drain-on-deploy
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1168: AI replies survive a deploy

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md` AI-1 (P1, confirmed). `main` auto-deploys on every merge, several times a day.
- **What happens on stop:** `stopEffect` (`apps/server/src/agents/gateway/lifecycle.ts:233-249`) sets `started = false` and disconnects every AI session at once (`:244-247`). No drain, and nothing waits on a running turn.
- **What that does to a running turn:** it keeps going, then `liveSendMessage` returns `{ id: '' }` without sending (`apps/server/src/agents/gateway/live.ts:45-46`). `runDmTurn` reports "replied", and the draft ends `failed`. The asker gets no reply and no failure text, and the tokens are spent.
- **How busy is tracked:**
  - DM turns: `session.busy`, set and cleared in `pumpSessionEffect` (`apps/server/src/agents/gateway/dm-turn.ts:84-99`). The DM chat is the owner's;
  - room turns: `session.roomBusy` (the room JIDs), in `apps/server/src/agents/gateway/group-ingest.ts:170-190`;
  - both fields are typed at `apps/server/src/agents/gateway/contracts.ts:191,203`.
- **Shutdown order** (`apps/server/src/main.ts:125-140`): HTTP closes first, then the push component, then `gateway.stop()`, and the database last, so a draining turn still has its DB.
- **Time limits:** Docker kills the container 10 s after SIGTERM (no `stop_grace_period` in `deploy/coolify/docker-compose.app.yml:117`), and `FORCE_EXIT_MS = 15_000` (`main.ts:79`). So the drain must finish well inside 10 s.

### What to build
1. **In `stopEffect`,** after `started = false` and before the disconnect loop, run the drain:
   - poll every 200 ms until no session has `busy === true` and every `roomBusy` is empty, **at most 8 s** (`AI_DRAIN_MS = 8_000`, exported);
   - log the count of turns still running when the drain ends.
2. **Refuse new turns:** turns that would start during the drain must not start. Check how `started` gates new work (`lifecycle.ts:142,180,196`) and how incoming messages reach `pumpSessionEffect`. If `handleIncoming` (`apps/server/src/agents/gateway.ts:267`) doesn't check it, add the check there. Cite what you found.
3. **For each turn still running after 8 s,** before disconnecting, send through that still-connected session one message: `"I was restarted in the middle of my reply. Please ask again."`
   - for a busy DM, send it to the owner's chat;
   - for each room in `roomBusy`, send it to that room.

   Mark the turn so its later send is skipped rather than reported as replied, if that's simple. If it isn't, say so in the Report.
4. **Tests** (the message pipeline), at most 1, using `apps/server/src/agents/gateway.test-harness.ts` if it can hold a turn open: a `stop()` during a DM turn that finishes within the drain still delivers its reply. If the harness can't do it without a big change, write no test and explain in the Report.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (AI-1), `apps/server/src/agents/gateway/lifecycle.ts`, `apps/server/src/agents/gateway/dm-turn.ts:60-120`, `apps/server/src/agents/gateway/group-ingest.ts:160-198`, `apps/server/src/agents/gateway/live.ts:30-100`, `apps/server/src/agents/gateway.ts:240-318` and `apps/server/src/agents/gateway.test-harness.ts`.

### Allowed files
`apps/server/src/agents/gateway/lifecycle.ts`, `apps/server/src/agents/gateway/contracts.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test-harness.ts`, `apps/server/src/agents/gateway-drain.test.ts`, `work/T-1168-ai-drain-on-deploy.md`.

### Checks
```bash
pnpm gate
```
Plus the new test, if one is written: `pnpm --filter @zilar/server exec vitest run src/agents/gateway-drain.test.ts --reporter=dot`.

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on production:** ask the AI a question, then merge anything. The reply arrives, or the "restarted" text does.

---

## Report (written by the worker when done)

### What I did

On shutdown the gateway now drains turns in flight instead of dropping them.

1. **Constants** (`gateway/contracts.ts`): `AI_DRAIN_MS = 8_000`, `AI_DRAIN_POLL_MS = 200`, and `AI_RESTART_REPLY = 'I was restarted in the middle of my reply. Please ask again.'` Exported; `AI_DRAIN_MS` and `AI_RESTART_REPLY` are also re-exported from `agents/gateway.ts` beside the other gateway constants.
2. **Drain in `stopEffect`** (`gateway/lifecycle.ts`): after `started = false` and the unsubscribe pass, and before the disconnect loop, `drainEffect` polls `runningTurns()` every 200 ms until it is 0 or `AI_DRAIN_MS` has elapsed. `runningTurns()` counts one per `session.busy` DM plus one per entry of `session.roomBusy`. It always logs the remaining count (`logger.info({ turns }, 'AI drain finished')`). When the count is non-zero, each session with a leftover turn is marked `session.stopped = true` first, then it sends `AI_RESTART_REPLY` through the still-connected session: the owner's chat (owner JID derived via `loadAiOwnerId` + `jidFor(localpartFor(...), domain)`) for a busy DM, and each busy room JID with kind `'groupchat'`. Best-effort: a failed notice is swallowed.
3. **Refuse new turns** (`gateway.ts`, `handleIncoming`): added `if (!lifecycle.isStarted()) return;` right after the correction/retraction check.
4. **Test** (`gateway-drain.test.ts`): a `stop()` during a hanging DM turn; the turn is released 50 ms into the drain and its reply is asserted delivered, with exactly one disconnect and no restart notice.

### Citation for the "refuse new turns" check

`started` guards the *lifecycle event subscriptions* — `onAiLifecycle` (`lifecycle.ts:142`), `onGroupAi` (`:180`), `onTopicAi` (`:196`) — and `withActiveAi`/`reconcile`, so it does not gate a message that has already been delivered. Incoming messages reach `pumpSessionEffect` through the per-session `core.on('message', …)` listener installed in `sessions.ts:142-145`, which stays attached until `disconnectAi`. `handleIncoming` (`gateway.ts`) checked only `session.stopped || sessions.get(session.aiId) !== session`; during the drain a session is still in the map and not stopped, so without the added `isStarted()` check a message landing mid-drain would start a turn the drain never waits on. `started` is false from the first line of `stopEffect`.

### Files changed

- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/lifecycle.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway-drain.test.ts` (new)
- `work/T-1168-ai-drain-on-deploy.md`

No changes were needed in `live.ts`, `dm-turn.ts`, `group-ingest.ts` or `gateway.test-harness.ts`. Every file is well under 400 lines (`lifecycle.ts` 324, `contracts.ts` 310, `gateway.ts` 328, test 69).

### Commands run (real results)

- `pnpm install` → `Done in 15.9s` (only the pre-existing `@types/react-dom` peer warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-drain.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (repo root) →
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (7.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### How a turn is marked as skipped

Setting `session.stopped = true` for a session with a leftover turn was the simple route: `sessionIsLive` (`live.ts:30-32`) reads `!session.stopped`, so the turn's later `liveSendMessage` resolves `{ id: '' }` and its reply is never put on the wire; it also stops the pump's `while (… && !session.stopped)` loops and the failed draft `end`. The restart notice still goes out because it calls `session.core.sendMessage` directly, bypassing `sessionIsLive`.

### Honest caveats / deviations

- None from the spec. One inherent boundary race: a turn whose final `core.sendMessage` has already passed the `sessionIsLive` check at the exact instant the deadline hits could deliver its real reply and also receive the restart notice. Marking first shrinks the window but cannot remove it without a per-turn token shared with the send path (`dm-turn.ts`/`group-turn.ts`), which is outside this task's scope.
- The drain is driven by wall-clock `Date.now()` + `Effect.sleep`; the test exercises the within-deadline path, not the 8 s timeout path (the spec asks for at most one test).

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 2 follow-ups.**
- **`stopEffect`:**
  - drains: it polls `busy` and `roomBusy` every 200 ms, for at most `AI_DRAIN_MS = 8_000`, before disconnecting;
  - for turns still running at the deadline, it sends `AI_RESTART_REPLY` to the owner (DM) or the room through the still-connected session.
- **`handleIncoming`** refuses new turns once `started` is false.
- **Test:** a DM reply that finishes inside the drain is delivered, with 1 disconnect. 1 of 1 in the branch, run by the lead.
- **Follow-ups:**
  1. `wakeListenerAis` (`listener.ts:222-225`) can still start a listener turn mid-drain;
  2. a reply and the restart notice can both go out if the final send races the deadline;
  3. the test should also assert no restart notice.
- **Still to do:** the live check on the next deploy.
