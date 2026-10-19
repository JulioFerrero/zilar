---
id: T-2207
title: "AI turns T5/T6: DM and group turn inputs share one wiring helper (routine send, progress card, desk, abort, usage, typing, gate); no behaviour change"
status: merged
milestone: M5
branch: task/T-2207-ai-turn-wiring
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2207: One turn wiring for DM and group (AI turn plan T5 and T6)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/agent-turns-plan.md` steps T5 and T6. Julio said go on 2026-10-19. Both inputs build the same per-turn wiring before calling the turn:
- `apps/server/src/agents/gateway/dm-turn-input.ts:32-148` builds it for `runDmTurn`;
- `apps/server/src/agents/gateway/group-turn-body.ts:286-399` builds it for `runGroupTurn`.

The plan's measured lesson (T4: −3, not −80) applies: share only what is really the same, and stop if the net does not go down.

### Facts (the lead read these on 2026-10-19, at `24764738e`)
Each item is the same in both files:
1. **The routine send.**
   - DM `:60-70`, group `:304-313`: `createRoutineSend({ db, session, routineId, isLive, now, logger })` when the turn is a scheduled routine, else `null`.
   - The group's `isLive` (`!candidate.stopped && sessions.get(candidate.aiId) === candidate`) is what `sessionIsLive` does for the DM.
2. **The progress reporter.** `liveProgressReporter(session, <chat jid>, <kind>, ai.jid, log)` when `routineSend === null`, else `null`. DM `:71-72` (`ownerJid`, `'chat'`); group `:314-317` (`roomJid`, `'groupchat'`).
3. **The desk.** DM `:73-77`, group `:289-292` and `:318-322`: `resolveTurnDesk` and the `TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER` report.
   - The group resolves the desk only when the turn may use tools, which is the `? … : { waiting: false }` at `:289-291`. Keep that.
4. **The abort.**
   - `registerTurnAbort(session, <jid>)` (DM `:79`, group `:325`);
   - `Effect.ensuring(clearTurnAbort(...))` (DM `:146`, group `:399`);
   - the desk options `{ ownerUserId: ai.owner, client: turnDesk.client, signal }` passed to `executeToolCall`.
5. **The turn deps passed to the runner,** written out in both:
   - `onUsage` → `recordUsage(...)` (DM `:112-121`, group `:368-378`, the same 10 lines);
   - `sendTyping` with `TOOL_STAGE_THINKING` (DM `:132-140`, group `:387-395`);
   - `checkRoundGate: () => budgetGate.checkDmRoundGate(session)`, `...turnLimits(deps.toolMaxRounds, deskEnabled)`, the `reportProgress`/`finishProgress` spread, `turnLogger`, `logger`, `secrets: secretsFor()`, `log`, and the `fetchImpl` spread.

### Steps
1. Add `apps/server/src/agents/gateway/turn-wiring.ts` with one Effect function, e.g. `prepareTurn({ ctx, session, ai, target, chatJid, kind, log, routineId, useDesk })`. It returns:
   - `routineSend`;
   - the abort `signal`, and an `ensureCleared` step (or a wrapper that runs the turn and always clears the abort);
   - `deskOptions` for `executeToolCall`;
   - `deskEnabled`;
   - `common`, the shared runner deps from fact 5 (with `reportProgress`/`finishProgress` when there is a progress card).
2. `dm-turn-input.ts` and `group-turn-body.ts` call it and spread `common` into `runDmTurn` / `runGroupTurn`. Each keeps its own extras:
   - DM: `onDelta`, `beforeFinalSend` with the drafts, its `sendMessage`;
   - group: `rememberRoomSentId` in `sendMessage`, `onFailure`, `handoffTargets`, the tool filter, settlement and delegation.
3. Keep every order that matters:
   - the desk resolves before the abort registers;
   - the waiting report comes before the turn;
   - the abort is cleared on every exit;
   - `rememberRoomSentId` runs after every group send.
4. No re-export or shim files. `dm-turn-input.ts` stays as the DM entry.
5. **Stop rule:** measure the net over every changed file, the new one included. If it is not at least −30, do not commit. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `apps/server/src/agents/gateway/turn-wiring.ts` (new)
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `work/T-2207-ai-turn-wiring.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-desk.test.ts src/agents/gateway-group.test.ts src/agents/group-turn-card.test.ts src/agents/gateway/routine-send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and so do the tests above, unchanged.
- Net at least −29. The lead lowered this on 2026-10-19 so the restored `onUsage` comment in `turn-wiring.ts` stays; it is required.
- Lead live check in "ai test › General" after the deploy:
  - an @mention answers;
  - a Stop on the progress card stops the turn;
  - a DM to the AI ("hello") answers in the DM.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/agents/gateway/turn-wiring.ts` with `prepareTurn`. It builds the routine send, the progress reporter, the desk (only when `useDesk`), the waiting report, the abort and the shared runner deps, in that order. It returns `routineSend`, `signal`, `ensureCleared`, `deskEnabled`, `deskOptions` and `common`.
- `dm-turn-input.ts` and `group-turn-body.ts` now call `prepareTurn`, spread `common` into `runDmTurn` / `runGroupTurn`, and keep their own extras: DM drafts and `sendMessage`; group `rememberRoomSentId`, `onFailure`, handoff targets, tool filter, settlement and delegation.
- Kept the orders that matter: desk before abort registration, waiting report before the turn, abort cleared through `Effect.ensuring` on every exit, `rememberRoomSentId` after every group send.
- Preserved one asymmetry the shared `chatJid` could not express: the DM registers its abort under `session.aiJid` while its progress card goes to `ownerJid`. `prepareTurn` takes an optional `abortJid` for that; the group defaults to `roomJid`.

### Files changed
- `apps/server/src/agents/gateway/turn-wiring.ts` (new, 98 lines)
- `apps/server/src/agents/gateway/dm-turn-input.ts` (148 → 82 lines)
- `apps/server/src/agents/gateway/group-turn-body.ts` (449 → 388 lines)
- `work/T-2207-ai-turn-wiring.md`

### Net size
597 lines before → 568 after, **net −29** (new file included), measured with `wc -l` after Prettier. The lead lowered the acceptance bar to −29 on 2026-10-19 so the required `onUsage` comment stays.

### Commands and results
- `pnpm install`: done, 1155 packages, 13.8s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/dm-turn.fake-provider.test.ts`: 1 file, 1 test passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts`: first run 1 failed / 9 passed (the test stops the DM by `aiJid`, and the first helper version registered the abort under `ownerJid`); after adding `abortJid`: 1 file, 10 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-desk.test.ts`: 1 file, 1 test passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`: 1 file, 21 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/group-turn-card.test.ts`: 1 file, 3 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/routine-send.test.ts`: 1 file, 9 tests passed.
- `pnpm gate`:
  - `PASS install (frozen) (1.2s)`
  - `PASS format (1.3s)`
  - `PASS lint (0.9s)`
  - `PASS typecheck (3.0s)`
  - `PASS effect (0.6s)`
  - `PASS build @zilar/server (0.6s)`
  - `PASS tests @zilar/server (15.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`

### Deviations
- None from the spec. The new helper's return type is inferred rather than named, which kept the new file small enough to meet the net target.

### Open questions
- None.

### Round 1 (fix round)
- **Findings fixed:** finding 1 (should-fix) — net was −29 against the required −30. Dropped the `onUsage` comment in `turn-wiring.ts` as the finding suggested; the code below it is self-explanatory. Net became 597 → 567, **−30**. No behaviour changed, so no test was added.
- **Tests added:** none; the finding is a size acceptance miss, not a behaviour fix. The six Checks files still pass: 6 files, 45 tests.
- **Gate:** `GATE PASS` — install, format, lint, typecheck, effect, build @zilar/server, tests @zilar/server all PASS; scope, migration, images, size, comments checks pass.

### Round 2 (lead decision)
- The lead settled finding 1 in the spec (`16e494606`): acceptance is now net at least −29 and the `onUsage` comment is required. Restored the comment exactly; net is 597 → 568, **−29**, which meets the updated bar.
- No tests added; no behaviour changed.
- **Gate:** `GATE PASS` — install, format, lint, typecheck, effect, build @zilar/server, tests @zilar/server all PASS; scope, migration, images, size, comments checks pass.

## Review (written by Claude)

Approved; the pre-review was clean after 1 auto round. Net −29: the lead lowered the bar from −30 to keep the usage "why" comment.

The DM and group turn inputs now share `prepareTurn` (`agents/gateway/turn-wiring.ts`). It covers:
- the routine send and the progress card;
- the desk and the "waiting for your computer" report;
- the abort registration, with `ensureCleared` on every exit;
- the common runner deps: usage, typing, round gate, limits, logger, secrets and log.

Each input keeps its own extras: DM drafts; group sent-id memory, `onFailure`, handoff, settlement and delegation.

The order is unchanged: the desk resolves before the abort registers, and the waiting report comes before the turn. The group still skips the desk for plain members (`useDesk: allowDesk`).

The live check in "ai test › General" follows the deploy.
