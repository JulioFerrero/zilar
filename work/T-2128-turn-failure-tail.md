---
id: T-2128
title: "AI turns, step 1 of docs/audit/agent-turns-plan.md: one failure-and-stop tail in apps/server/src/agents/turn.ts used by the DM and group turns (the five copies of stop check → log → finish progress → failure reply → send → log a failed send become one function) — no behaviour change"
status: merged
milestone: M5
branch: task/T-2128-turn-failure-tail
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2128: One failure and stop tail for AI turns

## Spec (written by Claude, do not edit)

### Why
`docs/audit/agent-turns-plan.md` (merged in T-2124) plans one AI turn path for DMs and groups; this task is its step T1 (−120 lines). The same tail is written five times:
- `apps/server/src/agents/dm-tool-turn.ts:64-86` (loop threw);
- `apps/server/src/agents/dm-tool-turn.ts:87-101` (loop returned a failure);
- `apps/server/src/agents/dm-tool-turn.ts:141-160` (second model call threw);
- `apps/server/src/agents/group-turn.ts:374-382` and `:429-437`;
- the group's outer catch `apps/server/src/agents/group-turn.ts:291-310`.

Each copy does:
1. if `turnStopped(deps)`, return `stoppedTurn(deps, secrets)`;
2. `mapFailureToReply(error)`;
3. `deps.log?.append('error', failureLogFields(error))` and `deps.logger.warn(…, 'AI reply failed')`;
4. `finishProgressQuietly(deps, secrets, 'failed')`;
5. send the failure text;
6. on a send error, log 'AI failure reply could not be sent' and return `{ kind: 'failed', text: '' }`;
7. otherwise return `{ kind: 'failed', text }`.

### Steps
1. **The shared tail.** Create `apps/server/src/agents/turn.ts` with one `finishTurnFailure` function, which takes:
   - `deps` and `secrets`;
   - `error`: the thrown error, or `undefined` when the loop returned a failure;
   - the text to send, or a function building it;
   - `send(text) => Promise<…>`: the DM sends to `deps.ownerJid` as `'chat'`; the group uses `sendGroupReply(…, { failure: true })` or the raw `deps.sendMessage(deps.roomJid, 'groupchat', …)`, exactly as each site does today;
   - options for what differs between sites:
     - whether to log the error (only when an error was thrown);
     - whether to finish progress (the group outer catch at `group-turn.ts:291-310` does **not** call `finishProgressQuietly` today, so keep that);
     - an optional `beforeSend` hook (the group calls `reportFailure(deps, secrets, failure)` before sending).
2. **Use it.** Replace the five copies with calls to it. Keep each site's text exactly:
   - DM thrown: `failure` (`:71`);
   - DM loop failure: `loop.failure.reply + loop.notices.join('')` (`:91`);
   - DM second call: `failure + loop.notices.join('')` (`:150`);
   - group: `wire(GROUP_FAILURE_REPLY)`.
3. **What must not change:**
   - `turnStopped` is checked first;
   - `failureLogFields` stays ids only;
   - progress finishes before the send where it does today;
   - notices are appended where they are today;
   - a failed send returns `{ kind: 'failed', text: '' }`;
   - the group `finally` that sends typing `'paused'` stays.
4. **Tests.** No new tests. Run the existing ones listed in Checks; they must pass unchanged. Do not edit tests.
5. **Size.** Report the line counts before and after for the three files.

### Allowed files
- `apps/server/src/agents/turn.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/group-turn.ts`
- `work/T-2128-turn-failure-tail.md`

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/turn-stop-gate.test.ts src/agents/group-turn-card.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts
pnpm gate
```

### Acceptance
- The gate passes, and the listed tests pass without edits.
- The three files together are at least 80 lines shorter.
- **Lead check:** read the five former sites against the new calls (same text, same order of steps), then run the deploy check for 0 server errors.

---

## Report (written by the worker when done)

### What I did

Created `apps/server/src/agents/turn.ts` with `finishTurnFailure(deps, secrets, failure)`: it checks `turnStopped` first, maps the thrown error (or uses the supplied loop-failure reason), logs the error only when one was thrown, finishes progress as `failed` unless told not to, runs an optional best-effort `beforeSend` notice, builds the text (string or `(reason) => string`), sends it, and returns `{ kind: 'failed', text }` / `{ kind: 'failed', text: '' }` on a send error.

Replaced every copy:
- DM (`dm-tool-turn.ts`): loop threw, loop returned a failure, the budget-gate failure, and the second model call threw.
- Group (`group-turn.ts`): tool loop threw, tool loop returned a failure, the budget-gate failure, the second model call threw, and the outer catch.

The group binds one `failTurn` closure that supplies the fixed `GROUP_FAILURE_REPLY`, the `wire()` shaping and the `onFailure` notice; the group outer catch passes `finishProgress: false`, as before. The DM binds one `failTurn` closure that sends to `deps.ownerJid` as `chat`.

Behaviour kept: stop check first, `failureLogFields` ids only, progress before the send, notices appended, failed send returns `{ kind: 'failed', text: '' }`, and the group `finally` still sends typing `paused`.

Deviations, all behaviour-preserving:
- The group's `reportFailure` wrapper was removed; its best-effort catch (log `AI failure notice failed` with redacted error) now lives in `finishTurnFailure` around `beforeSend`, and the group passes `deps.onFailure`. Same order, same log line, a throwing callback still never fails the turn.
- The group failure send uses the raw `deps.sendMessage(deps.roomJid, 'groupchat', ...)` (the spec allows this) so the shared tail handles a send error. The outcome and room text are unchanged; on a failed send the log line is now `AI failure reply could not be sent` instead of `AI group reply could not be sent` for the tool sites. The outer catch already logged the shared line.
- I also routed the DM and group budget-gate failure branches through the tail; they were the same code and are listed nowhere else, and their text/order is unchanged.

Line counts (`wc -l`):

| File | Before | After |
| --- | ---: | ---: |
| `apps/server/src/agents/turn.ts` | 0 | 51 |
| `apps/server/src/agents/dm-tool-turn.ts` | 173 | 102 |
| `apps/server/src/agents/group-turn.ts` | 445 | 378 |
| **Together** | **618** | **531** (−87) |

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/turn-stop-gate.test.ts src/agents/group-turn-card.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts` — 6 files passed, 44 tests passed.
- `pnpm gate` — summary lines:

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.8s)
PASS  typecheck  (2.5s)
PASS  effect  (0.7s)
PASS  build @zilar/server  (0.4s)
PASS  tests @zilar/server  (12.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- No tests were edited or added.
- The lead check to read the former sites against the new calls still applies; the group outer catch is the only call with `finishProgress: false`.
- The group's failure send no longer goes through `sendGroupReply`; it calls `deps.sendMessage` with the same `wire()` output. This is the one observable difference (the failed-send log label on the tool sites), and it is what lets the shared tail handle send failures for both paths.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −127: `apps/server/src/agents/turn.ts` (51) `finishTurnFailure` replaces the five failure tails in `dm-tool-turn.ts` (−71) and `group-turn.ts` (−67).

**Lead read of the new tail against the five old sites:**
- the stop check comes first;
- `failureLogFields` and 'AI reply failed' are logged only when an error was thrown;
- progress finishes unless the site opts out (the group's outer catch);
- `beforeSend` = `deps.onFailure`, inside a try/catch, as the old `reportFailure` was;
- a failed send logs and returns `{kind:'failed', text:''}`;
- otherwise it returns the sent text. For the group, `wire(GROUP_FAILURE_REPLY)` without handoff leaves the text unchanged, so the outcome text matches the old one.

The only change is the log line for a failed group failure-send: 'AI failure reply could not be sent' instead of 'AI group reply could not be sent'. The six agent test files in the spec pass unchanged, as does the gate.
