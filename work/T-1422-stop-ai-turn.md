---
id: T-1422
title: "UX task E: Stop a running AI turn from its task card (owner only): POST /api/ais/:id/turns/stop {chatJid}; the turn aborts, posts no reply, the card ends 'stopped'; Stop button on web and mobile cards"
status: merged
milestone: M5
branch: task/T-1422-stop-ai-turn
model: auto
effort: default
depends_on: [T-1414, T-1419]
estimate: 1 day
---

# T-1422: Stop a running AI turn

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs work in the background, and the owner must be able to **stop a task** from its card (`docs/design/agent-system.md` §4.3). The plan is `docs/audit/agent-ux-plan.md` Task E; the lead's decision was "Stop ends the task".

T-1414 made one card per turn with `state` and `can_stop` in the payload (`packages/protocol/src/progress.ts`), and T-1419 drew the card on web and mobile. **Nothing sets `can_stop` yet, and there is no stop route.**

### Facts (the lead checked them on main, 2026-10-14)
- **The contract:** `packages/api-contract/src/ais.ts` (244 lines). The AI endpoints are at `:205-230`. **`POST /ais/:id/stop` already exists: it is the AI kill switch** (`:222`, it disconnects the whole AI; keep it). Resume is at `:226`.
- **The routes:** `apps/server/src/ais/api.ts` (375 lines: put the new handler in a **new file**, e.g. `apps/server/src/ais/stop-turn.ts`, and add only the wiring lines to `api.ts`). The kill switch is around `:265-300`.
- **The gateway session:** `AiSession` is in `apps/server/src/agents/gateway/contracts.ts:203-230`. It has `busy`, `stopped`, `rooms`, `roomBusy` and `roomPending`; this file is 337 lines.
- **The card reporter:** `apps/server/src/agents/gateway/live.ts` (the task card from T-1414: one card per turn, optional `taskId` at `:85`). The builder is `apps/server/src/agents/task-card.ts` (`finish(state, summary)`; `state` can be `stopped`).
- **The loop:** `apps/server/src/agents/tool-loop.ts` (134 lines). The model call is `apps/server/src/ai/model-client.ts`: Effect, with a deadline at `:313-314`, run by `Effect.runPromise` at the end.
- **Wiring hooks:** `apps/server/src/main.ts` (560 lines, over the limit: **add at most 4 lines**). It wires `onApprovalDecided` (comment at `:369`), and `running.gateway` holds the agent gateway.
- **The clients:** web `apps/web/src/components/ProgressCard.tsx` (185 lines), mobile `apps/mobile/src/components/chat/progress-card.tsx` (167 lines). The API clients are `apps/web/src/lib/api/ais.ts` and `apps/mobile/src/lib/ais-api.ts`.

### What to build
1. **The route:** `POST /api/ais/:id/turns/stop` with body `{ chatJid }`. It is **owner only**: the session user must own the AI, and anyone else gets 404, the same rule as the other AI routes. It answers `{ stopped: boolean }`, false when no turn is running in that chat. The route calls a gateway hook `stopTurn(aiId, chatJid)`.
2. **The gateway** (a new `apps/server/src/agents/gateway/stop.ts`):
   - each running turn (DM or room) registers an `AbortController` on the session, keyed by chat;
   - `stopTurn` aborts it;
   - **the abort reaches the model call** (pass the `signal` through `tool-loop` to `model-client`, and interrupt the Effect) **and the tool loop** (no more rounds; a running desk tool call gets the signal too);
   - after an abort the turn posts **no reply**, and the card gets one last correction: `state: 'stopped'`, with the summary "Stopped after 1m 12s". The usage spent so far is still recorded in `ai_usage`.
   - Messages that arrive later start a new turn as usual.
3. **`can_stop: true`** on every card while `state` is working.
4. **Clients:** a Stop button on the card (a square icon plus the label "Stop", not an emoji).
   - Show it only while `state` is working, `can_stop` is true, **and the viewer owns that AI**: the viewer's own AI list (`GET /api/ais`) contains the card's `ai` JID.
   - Tapping it calls the route and shows "Stopping…" until the card's next edit arrives.
   - It's the same on web and mobile, and the collapsed card keeps its one-line layout (the button sits at the right).

### Tests (message pipeline and permissions: required)
- **`apps/server/src/agents/`:** with a fake model that waits, stopping mid-turn means the reply is never posted, the last card correction has `state: 'stopped'`, and `stopped: true` comes back. Stopping when nothing runs gives `stopped: false`.
- **The route:** another user gets 404; the owner gets 200.

### Read first
`AGENTS.md`, `docs/audit/agent-ux-plan.md` Task E, and the files above.

### Allowed files
`packages/api-contract/src/ais.ts`, `apps/server/src/ais/**`, `apps/server/src/agents/**`, `apps/server/src/ai/model-client.ts`, `apps/server/src/main.ts`, `apps/server/src/app.ts`, `packages/mock-backend/src/domains/ais/**`, `apps/web/src/components/ProgressCard.tsx`, `apps/web/src/lib/api/ais.ts`, `apps/mobile/src/components/chat/progress-card.tsx`, `apps/mobile/src/lib/ais-api.ts`, `work/T-1422-stop-ai-turn.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents src/ais --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines; `main.ts` grows by at most 4 lines.
- **Web `?mock=1`:** the working card shows Stop for the owner, and the mock route answers.

---

## Report (written by the worker when done)

### What I did

**1. The route (`POST /api/ais/:id/turns/stop`, owner only).**
`packages/api-contract/src/ais.ts` declares `StopTurnPayload` (`{ chatJid }`, trimmed,
1–512 chars), `StopTurnResult` (`{ stopped: boolean }`) and the `stopTurn` endpoint
after `resume`. It keeps only the group's `Session` middleware (like the kill switch
`/stop`, it needs no cipher). `apps/server/src/ais/stop-turn.ts` (new) does the
owner-scoped read with `getOwnedAi` (a stranger gets the same 404 as an unknown id)
and calls the gateway hook through a lazy `getGateway`. `apps/server/src/ais/api.ts`
adds only the wired handler. `app.ts` gains `getGateway` and `main.ts` passes
`() => running.gateway` (3 added lines) with `stopTurn` added to the `RunningServer`
`Pick`.

**2. The gateway (`apps/server/src/agents/gateway/stop.ts`, new).**
`AiSession` gains `turnAborts: Map<string, AbortController>`, keyed by the client
chat id the owner sees (the AI's own JID in a DM, the room JID in a group/topic).
`registerTurnAbort` / `clearTurnAbort` wrap a turn; `createStopTurn` returns the
`stopTurn(aiId, chatJid)` hook the gateway exposes. The DM turn
(`gateway/dm-turn.ts`) registers under `session.aiJid`, the group turn
(`gateway/group-turn-body.ts`) under `roomJid`, and both clear in `Effect.ensuring`.

**3. The abort reaches the model and the tools.**
`ai/model-client.ts` takes an optional `signal` and races the call against it with
`Effect.raceFirst` + `Effect.callback` (an abort fails the call at once; the retry
condition checks the signal so an aborted call never retries). `agents/tool-loop.ts`
threads `signal` to every model call, and `runToolLoop` drops the loop before another
round. The desk tools get the signal too (`gateway/desk-exec.ts` forwards it to
`hands.execute`, and an aborted call answers "the tool call was stopped").
**A correction:** `Effect.race` (not `raceFirst`) silently waits on a pending
`Effect.callback` instead of propagating a failing sibling — that broke every failing
model call; `raceFirst` is what makes the abort and the failure both surface.

**4. The turn ends quietly and the card says `stopped`.**
`DmTurnDeps`/`GroupTurnDeps` take `signal`, `finishProgress` accepts `stopped`, and
both turns return without sending when the signal fired, closing the card with
`finishProgressQuietly(…, 'stopped')`. The stop helpers (and
`finishProgressQuietly`, moved out of `dm-tool-turn.ts`) live in the new
`apps/server/src/agents/turn-stop.ts` so neither turn file crosses the 400-line cap.
`task-card.ts` sets `can_stop: true` on every working card. Usage already spent is
untouched (aborting a call means that call reports no usage; completed calls already
recorded). Later messages start a new turn as usual.

**5. Clients.** Web `ProgressCard.tsx` and mobile `progress-card.tsx` now render a
`Square` icon + "Stop" button at the right of the collapsed line, only while the card
is working, `can_stop` is `true`, and the viewer owns the card's AI (the AI's JID is in
the viewer's `GET /api/ais` list). Tapping it calls the route, shows "Stopping…" until
the card's next edit (tracked by comparing the `progress`/`data` object identity), and
resets on a failure. The expand control and the Stop button are siblings, so no nested
buttons. `apps/web/src/lib/api/ais.ts` and `apps/mobile/src/lib/ais-api.ts` add
`stopAiTurn`. The mock backend (`packages/mock-backend/src/domains/ais/routes.ts`)
answers the route with `{ stopped: true }`.

### Files changed

- `packages/api-contract/src/ais.ts`
- `apps/server/src/ais/stop-turn.ts` (new), `apps/server/src/ais/api.ts`, `apps/server/src/ais/stop-turn.test.ts` (new)
- `apps/server/src/agents/gateway/stop.ts` (new), `gateway.ts`, `gateway/contracts.ts`,
  `gateway/sessions.ts`, `gateway/dm-turn.ts`, `gateway/group-turn-body.ts`,
  `gateway/tool-exec.ts`, `gateway/desk-exec.ts`, `gateway/live.ts`
- `apps/server/src/agents/handoff.ts` (new), `turn-stop.ts` (new), `dm-turn.ts`,
  `dm-tool-turn.ts`, `group-turn.ts`, `task-card.ts`, `tool-loop.ts`,
  `gateway.test-harness.ts`
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/app.ts`, `apps/server/src/main.ts`
- `packages/mock-backend/src/domains/ais/routes.ts`
- `apps/web/src/components/ProgressCard.tsx`, `apps/web/src/lib/api/ais.ts`
- `apps/mobile/src/components/chat/progress-card.tsx`, `apps/mobile/src/lib/ais-api.ts`
- `work/T-1422-stop-ai-turn.md`

### Tests

Added `apps/server/src/agents/gateway-stop.test.ts` (message pipeline: a fake model
that answers one tool round then hangs; `stopTurn` mid-turn aborts it, posts no reply,
leaves exactly one `state: 'stopped'` correction, and an idle/unknown chat or AI
answers `false`) and `apps/server/src/ais/stop-turn.test.ts` (owner 200 with the
gateway's answer, a stranger 404 and the gateway is never reached, plus
`stopped: false`). `gateway.test-harness.ts` now records a correction's `opts` so the
card payload is assertable.

Commands run:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts`
  — `Test Files 1 passed (1) / Tests 1 passed (1)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/stop-turn.test.ts`
  — `Test Files 1 passed (1) / Tests 2 passed (2)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`
  — `Tests 13 passed (13)`.
- `pnpm --filter @zilar/server exec vitest run src/agents src/ais --reporter=dot --maxWorkers=2`
  — `Test Files 13 passed (13) / Tests 58 passed (58)`.
- `pnpm gate` (from the repo root) — `GATE PASS`:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (14.5s)
  PASS  tests @zilar/web  (4.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Problems / deviations

- **The `?mock=1` Stop button needs one out-of-scope line.** The seeded working card
  (`dev-28` in `packages/mock-backend/src/domains/messages/threads/dev-team.ts`, and
  `dai-2` in `dev-ai.ts`) does not set `can_stop`, and that file is not in this task's
  Allowed files (`packages/mock-backend/src/domains/ais/**` only). With the client
  implemented exactly as the spec says (show Stop only when `can_stop === true`), the
  mock card shows no Stop; the mock route itself answers `{ stopped: true }`. To make
  the manual `?mock=1` check pass, add `canStop: true` to that card (one line, or widen
  the Allowed files). I left the tree strictly in scope so the gate stays clean.
- **No rate limit on the new write.** The security checklist says every write has a
  rate limit or a cap; the existing AI kill switch (`/stop`, `/resume`) has none either,
  and adding one needs a new middleware tag in `packages/api-contract/src/middleware.ts`
  (not in the Allowed files), so I followed the existing AI-route shape. The route is
  owner-only, idempotent and covered by the 401 sweep.
- **`signal` passed through `completionInput`.** The DM/group turn types gained an
  optional `signal` forwarded to every model call; scope creep is limited to the two
  turn modules and the shared loop.

### Open questions

- Is the one-line mock seed change (`canStop: true` on the working card) acceptable
  outside the Allowed files, or should the Allowed files be widened for it?

### Round (fix round)

PREREVIEW.md: must-fix=0, should-fix=2, nit=1, follow-up=2.

- **Finding 1 (should-fix) — a stopped card kept its step `doing`.** Fixed in
  `task-card.ts`: `finishTaskCard` now resolves the open step for `stopped` too
  (only a clean finish is `done`; `failed` and `stopped` end `failed`). The
  `gateway/live.ts` special-case for `failed` was redundant once the builder
  handles every terminal state, so it now just calls `finishTaskCard`.
  Tests: a new `finishTaskCard` stopped case in `task-card.test.ts`, and
  `gateway-stop.test.ts` now runs two tool rounds before the stop so the
  stopped correction really carries a step, asserting it is no longer `doing`.
- **Finding 2 (should-fix) — the budget-gate branch posted a failure after a
  stop.** Added the missing `turnStopped` check right after the gate is awaited
  in `group-turn.ts` (the branch the finding names). The DM tool tail
  (`dm-tool-turn.ts`) has the identical branch and hole, so it got the same
  check. New `turn-stop-gate.test.ts` covers both: a stop during the gate await
  means no room/DM reply, no failure notice, and a card that finishes `stopped`.
- Nit 3 (the "Stopping…" button) and follow-ups 4 (mock seed `canStop`) and 5
  (rate limit) are untouched: the nit is not in a line this round changes, and
  the follow-ups need files outside the Allowed files.

Tests run (single, `--reporter=dot`):

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/task-card.test.ts src/agents/gateway-stop.test.ts`
  — `Test Files 2 passed (2) / Tests 11 passed (11)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/turn-stop-gate.test.ts`
  — `Test Files 1 passed (1) / Tests 2 passed (2)`.

`pnpm gate` (from the repo root) — `GATE PASS`:

```
PASS  install (frozen)  (0.9s)
PASS  format  (1.7s)
PASS  lint  (0.6s)
PASS  typecheck  (2.6s)
PASS  effect  (0.8s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (1.3s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (14.9s)
PASS  tests @zilar/web  (2.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

### Round 2 (fix round)

PREREVIEW.md (fresh review after round 1): must-fix=0, should-fix=1, nit=2,
follow-up=2.

- **Finding 1 (should-fix) — `group-turn.ts` was 403 lines, over the acceptance
  cap "every file is at most 400 lines".** Moved the T-0481 handoff-mention
  helpers (`HANDOFF_BOUNDARY` and `findHandoffIndex`, moved unchanged) out of
  `group-turn.ts` into the new `apps/server/src/agents/handoff.ts`. `group-turn.ts`
  is now **383 lines**, `handoff.ts` 22. Pure move, no behaviour change, so no
  test change was needed: the tests that cover group replies and handoff
  mentions (`reply.test.ts`, `gateway-group.test.ts`) still pass unchanged.
  `main.ts` was already inside its cap (net +3, cap +4).
- Nits 2 (the "Stopping…" button stuck when the route answers `{ stopped: false }`)
  and 3 (an abort in the gap before the final send) are untouched: neither sits in
  a line this round changes. Follow-ups F1 (the `?mock=1` seed `canStop`) and F2
  (the rate limit) still need files outside the Allowed files.
- `status` stays `review`.

Tests run (single, `--reporter=dot`):

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/gateway-group.test.ts`
  — `Test Files 2 passed (2) / Tests 20 passed (20)`.
- Effect ratchet alone on the two changed files
  (`pnpm --filter @zilar/devtools exec tsx src/effect-map/ratchet-cli.ts --base main apps/server/src/agents/handoff.ts apps/server/src/agents/group-turn.ts`)
  — `effect: ok (2 files checked)`; `handoff.ts` is pure, so no `effect-plain` marker.

`pnpm gate` (from the repo root) — `GATE PASS` (run again after this Report edit:
`GATE PASS`):

```
gate: 33 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.7s)
PASS  lint  (0.7s)
PASS  typecheck  (2.8s)
PASS  effect  (0.9s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (1.4s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (14.7s)
PASS  tests @zilar/web  (3.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

### Disagreements

None. (The DM budget-gate branch in `dm-tool-turn.ts` was not named by a
finding, but it is the same should-fix bug; it was fixed in the same commit.)

### Merge (rebase onto main)

Rebased onto `main` (T-1426 session log + T-1423 desks), keeping both sides in
every conflict — our abort `signal` and stop handling next to main's turn
`taskId`/session-log `append` calls — and getting the three over-cap files back
under 400 lines by moving the two turn senders (`sendReply`, `sendGroupReply`)
into the new `turn-send.ts` and the DM turn-defect handler into the new
`gateway/turn-defect.ts`; `turn-stop.ts` now also appends the `status: stopped`
session-log event so a stopped turn ends on a step too.
- Runner typecheck fix: the stop route put `apps/server/src/app.ts` (typechecked
  by `@zilar/runner`, which cannot resolve `@xmpp/client`) on a path into
  `gateway/contracts.ts` and the XMPP core, so the `TurnStopper` type moved to
  the import-free `agents/gateway/stop-types.ts`; `pnpm --filter @zilar/runner
  exec tsc --noEmit` now reports 0 errors.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 2 auto rounds, nit 3, follow-up 2.
- Local tests: agents and ais (14 files, 61).
- app.ts +6 and main.ts +1 (both were already over 400; accepted before T-1427 enforces).
- Follow-ups go into later tasks: F1, the mock card sets can_stop (with the View steps UI); F2, a rate limit on the stop routes (stop-turn and the kill switch).
