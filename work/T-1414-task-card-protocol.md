---
id: T-1414
title: "UX task C: one task card per AI turn, edited in place (protocol fields title/steps/state/summary/elapsed, corrections carry the payload, the server builds the step list from tool calls, no more retraction)"
status: merged
milestone: M5
branch: task/T-1414-task-card-protocol
model: auto
effort: default
depends_on: [T-1406]
estimate: 1 day
---

# T-1414: Task card protocol and server

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs work in the background without spamming the chat. There's one status line (T-1406, done) and **one task card per task, edited in place**, collapsed by default (`docs/design/agent-system.md` §4.3). The plan is `docs/audit/agent-ux-plan.md` §2.2 and Task C. This task is the protocol and server half; the card UI is the next task (Task D).

Today the server posts a progress message, corrects only its **text**, and then **retracts** it (`clearProgress`), which leaves a tombstone.

### Facts (the lead checked them on main, 2026-10-14)
- **`ProgressSchema`** is `packages/protocol/src/progress.ts:4-14` (`ai`, `task_id?`, `stage`, `detail?`, `percent?`). `PayloadSchema` structs are open, so unknown keys are ignored (plan §2.2), and the payload size cap is in `packages/protocol/src/payload.ts`.
- **Corrections can't carry a payload yet:**
  - `buildCorrection` is `packages/xmpp-core/src/stanza/build-outgoing.ts:144-158`;
  - its options are `id`, `to`, `kind`, `originalId`, `text` and `mentions`;
  - a normal send adds the payload as `<agent xmlns=AGENT_NAMESPACE>` at `:101-102`, plus the store hint at `:107-109`.
  
  `sendCorrection(chatJid, kind, originalId, text, opts?: SendCorrectionOptions)` is at `packages/xmpp-core/src/types.ts:273` (and `:364`), and is implemented at `packages/xmpp-core/src/core-effect/operations.ts:222-238`.
- **The reporter** is `liveProgressReporter` in `apps/server/src/agents/gateway/live.ts:68-145`:
  - it holds `progressId`;
  - `reportProgress(stage)` posts the first message with payload `{ ai, stage }`, then sends **text-only** corrections;
  - `clearProgress` retracts (`:121-140`).
  
  The DM wiring is `gateway/dm-turn.ts:304` and the group wiring is `gateway/group-turn-body.ts:299`.
- **`clearProgress` callers:**
  - the dep field `agents/dm-turn.ts:99` and `agents/group-turn.ts:85`;
  - the calls in `agents/dm-tool-turn.ts:269-361` and `agents/group-turn.ts:317-373`;
  - `clearProgressQuietly` at `dm-tool-turn.ts:368`, imported by `group-turn.ts:8`.
- **The stage per round** comes from `runLoopRound` (`agents/tool-exec.ts:92`, stage at `:133` via `stageForToolCall`, `agents/tool-guide.ts:66`); `actionOfCall` is at `tool-exec.ts:204`.
- **Cards never notify:** `apps/server/src/notify/ai-cards.ts` (T-1400) treats a message with the progress payload as live AI UI. A correction that carries the payload stays silent the same way; keep it so, and check it.
- **File sizes:** `dm-tool-turn.ts` is 398 lines (the limit is 400). The new code goes into a **new** `apps/server/src/agents/task-card.ts`, and the edits to `dm-tool-turn.ts` must be net negative (the `clearProgress` removals help).

### What to build
1. **Protocol** (`progress.ts`): add the optional fields from plan §2.2. Every new field is optional, and `stage` stays required and unchanged.
   - `title` (≤100 chars);
   - `steps`: an array of at most 20 `ProgressStep` entries, each `{ id ≤64, label 1-80, state: planned | doing | done | failed }`;
   - `started_at` (ISO), `elapsed_ms` (int ≥0) and `summary` (≤200);
   - `state`: working | done | failed | stopped;
   - `can_stop` (boolean).
2. **Corrections carry a payload:**
   - `buildCorrection` takes an optional `payload`, added exactly like a normal send (the same `<agent>` element and store hint);
   - `SendCorrectionOptions` gains `payload?`, passed through `operations.ts`.
3. **`apps/server/src/agents/task-card.ts`** (new): a small pure builder with this state:
   - **start(title)** sets `state: working` and `started_at`;
   - **step(label)** appends a step and marks the previous `done`, and the new one `doing`; at most 20 steps, after which it just updates the last label;
   - **fail(label?)** and **finish(state, summary)** close it out.
   
   The labels are the fixed stage texts (never model text or tool output). **The title** is the first stage text, or "Working on it" (a fixed string).
4. **The reporter** (`live.ts`):
   - it keeps one card message per turn (keyed on the turn, plus `task_id` when present);
   - every update is a correction carrying the **full payload** (and the stage text as the body, for old clients);
   - it throttles to at most one correction per second unless the state changes;
   - at the end of the turn it sends one last correction with `state: done` (or `failed`), `elapsed_ms` and `summary`. The summary is a fixed format: "Done in 2m 14s · 3 steps" or "Failed after 40s"; leave out money.
5. **Delete `clearProgress`/`clearProgressQuietly`** and every call and dep field listed above, plus the retraction branch in `live.ts`. The reply is a normal new message; the card stays above it in its final state.
6. **The mock backend**, if it builds progress payloads (`packages/mock-backend/src/domains/messages/builders.ts`, `progressCard`): accept the new optional fields (no UI change here).

### Tests (message pipeline: required, few)
- **`packages/protocol`:** an old payload (`{ai, stage}`) is still valid; a full new payload is valid; 21 steps are refused.
- **`packages/xmpp-core`** (the stanza test): a correction with a payload carries the `<agent>` element; one without is unchanged.
- **`apps/server/src/agents`:** update the tests that assert a retraction (search `clearProgress` and `sendRetraction` in `apps/server/src/agents/*.test.ts`) to assert the final correction with `state: done` and no retraction. One test for `task-card.ts`: the step transitions and the 20-step cap.

### Read first
`AGENTS.md`, `docs/audit/agent-ux-plan.md` §2.2 and Task C, and the files above.

### Allowed files
`packages/protocol/src/**`, `packages/xmpp-core/src/**`, `apps/server/src/agents/**`, `apps/server/src/notify/ai-cards.ts`, `packages/mock-backend/src/domains/messages/**`, `work/T-1414-task-card-protocol.md`.

### Checks
```bash
pnpm --filter @zilar/protocol exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run src/agents --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines; there's no retraction left in the agent progress path.
- Old clients keep working: they see the stage text, updated via the correction body.

---

## Report (written by the worker when done)

### What I did
- **Protocol** (`packages/protocol/src/progress.ts`): added `ProgressStepSchema`
  (`id` ≤64, `label` 1–80, `state: planned|doing|done|failed`) and the optional
  task-card fields on `ProgressSchema`: `title` (≤100), `steps` (≤20),
  `started_at` (ISO), `elapsed_ms` (int ≥0), `summary` (≤200),
  `state: working|done|failed|stopped`, `can_stop`. `stage` stays required and
  unchanged; every new field is optional, so the payload stays backward compatible.
- **Corrections carry a payload** (`packages/xmpp-core`): `buildCorrection` takes
  an optional `payload`, written exactly like a send (same `<agent>` element plus
  the store hint); `SendCorrectionOptions.payload` is passed through
  `core-effect/operations.ts`.
- **New pure builder** `apps/server/src/agents/task-card.ts`:
  `startTaskCard` / `addTaskCardStep` / `failTaskCard` / `finishTaskCard`, the
  20-step cap (after which the last label is renamed), the fixed elapsed/summary
  format (`Done in 2m 14s · 3 steps`, `Failed after 40s`) and `taskCardPayload`.
  Labels are the fixed stage texts only.
- **Reporter** (`apps/server/src/agents/gateway/live.ts`): one card message per
  turn, posted once and edited in place. Every update is a correction carrying the
  **full** payload, with the stage text as the body for old clients; corrections
  are throttled to at most one per second. The turn ends with one last correction
  carrying `state: done`/`failed`, `elapsed_ms` and `summary`.
- **Removed retraction**: deleted `clearProgress`/`clearProgressQuietly`, the
  `clearProgress` dep field on `DmTurnDeps`/`GroupTurnDeps`, every call, and the
  retraction branch in `live.ts`. A new `finishProgress(state)` dep closes the
  card; the reply is a normal new message and the card stays above it in its final
  state.
- `apps/server/src/notify/ai-cards.ts`: comments updated — a card correction now
  carries the payload, so it reads as live AI UI directly (`isLiveAiUiRow`), while
  `isLiveAiUiEdit` still catches an old server's payload-less edits. No behaviour
  change (a correction with the progress payload stays silent).
- **Mock backend**: `progressCard` accepts the new optional fields (no UI change).
- Extracted the shared `<agent>`+store-hint helper into
  `packages/xmpp-core/src/stanza/payload-element.ts` so `build-outgoing.ts` stays
  at 399 lines (it was exactly 400 before).

### Files changed
`packages/protocol/src/progress.ts`, `packages/protocol/src/payload.test.ts`,
`packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/core-effect/operations.ts`,
`packages/xmpp-core/src/stanza/build-outgoing.ts`,
`packages/xmpp-core/src/stanza/payload-element.ts` (new),
`packages/xmpp-core/src/stanza.test.ts`,
`apps/server/src/agents/task-card.ts` (new),
`apps/server/src/agents/task-card.test.ts` (new),
`apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/group-turn.ts`,
`apps/server/src/agents/dm-tool-turn.ts`,
`apps/server/src/agents/gateway/live.ts`,
`apps/server/src/agents/gateway/dm-turn.ts`,
`apps/server/src/agents/gateway/group-turn-body.ts`,
`apps/server/src/notify/ai-cards.ts`,
`packages/mock-backend/src/domains/messages/builders.ts`,
`work/T-1414-task-card-protocol.md`.

### Tests I ran (real results)
- `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts`
  → 1 file, **15 passed** (added: old `{ai, stage}` payload valid, full task-card
  payload valid, 21 steps refused).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`
  → 1 file, **90 passed** (added: correction with a payload carries the `<agent>`
  element and the store hint; a payload-less correction is unchanged).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/task-card.test.ts`
  → 1 file, **9 passed** (step transitions, 20-step cap, fail/finish, summary
  formats, payload).
- `pnpm --filter @zilar/server exec vitest run src/agents --maxWorkers=2 --reporter=dot`
  → 8 files, **38 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/notify/ai-cards.test.ts`
  → 1 file, **5 passed**.

### `pnpm gate` (from the repo root)
```
gate: 18 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (5.0s)
PASS  effect  (0.8s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/protocol  (1.1s)
PASS  tests @zilar/server  (7.4s)
PASS  tests @zilar/xmpp-core  (1.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```
(The first gate run failed only on Prettier for `task-card.test.ts`; I ran
`prettier --write` on that one file and the second run passed.)

### Deviations / notes
- The spec said to update the agent tests that assert a retraction. On this branch
  there are none: `grep -n "clearProgress\|sendRetraction" apps/server/src/agents/*.test.ts`
  returns nothing (the only `sendRetraction` in a test is the xmpp-core stanza
  test, and the client-core/chat-core/mobile retraction tests are not the agent
  progress path). So there was nothing to update; I added `task-card.test.ts` for
  the builder instead.
- `liveProgressReporter` takes an optional `taskId` and includes `task_id` in the
  payload when present. No caller passes it yet: the delegation id is only known
  mid-turn, after the card is already posted. The card is one per turn, which
  matches the per-turn reporter wiring.
- `finishProgress` replaces the deleted `clearProgress` dep. `sendRetraction` is no
  longer called anywhere in the agent progress path (the remaining `retract`
  references are inbound history handling and the test harness's interface stub).
- File sizes: `dm-tool-turn.ts` 387, `group-turn.ts` 388, `gateway/live.ts` 331,
  `task-card.ts` 160, `build-outgoing.ts` 399 — all ≤400.

### Security checklist
- Card labels and summaries are fixed server text (stage table / elapsed format),
  never model text or tool output. No secrets, no new routes or writes, no
  unscoped queries. Changes stay inside the Allowed files (confirmed by the gate's
  scope line).

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 3. Local tests pass: server agents and notify (9 files, 43), protocol (55), xmpp-core stanza (90). No clearProgress or retraction is left in the agent path, and card corrections carry the payload, so ai-cards keeps them silent. Clients don't apply the payload yet: that's Task D, launched right after this merge. Production has 0 AIs, so nothing is visible in the gap.
