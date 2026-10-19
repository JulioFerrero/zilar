---
id: T-2212
title: "A closed AI task card's message body is its summary ('Stopped after 12s'), not the last step's text, so chat-list previews stop showing 'Reading the page' after a stop; plus one stale devtools comment"
status: merged
milestone: M5
branch: task/T-2212-card-close-body
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2212: Closed card body is its summary

## Spec (written by Claude, do not edit)

### Why
The lead's live check on 2026-10-19: after a Stop in "ai test › General", the chat-list preview of the topic kept reading "Deepseek: Reading the page" (web; the phone shows the same body text). The card itself shows "stopped" correctly.

### Facts (the lead read these on 2026-10-19)
1. `apps/server/src/agents/gateway/live.ts:177`: the closing correction sends `finished.stage` as the message body. `stage` is the last step's fixed text (`web.fetch` is 'Reading the page', `apps/server/src/agents/tool-guide.ts:59`).
2. `finishTaskCard` (`apps/server/src/agents/task-card.ts:73-86`) sets `summary` from `taskCardSummary` (`:105-118`): 'Done in 40s · 3 steps', 'Stopped after 12s' or 'Failed after 12s'.
3. Chat lists and notifications that do not read the payload show the body text.
4. `packages/devtools/src/lead/merge.ts:92-93`: a comment still names `batch merge`, which T-2201 removed.

### Steps
1. `live.ts:177`: send `finished.summary` as the body instead of `finished.stage`. The payload is unchanged.
2. If a test asserts the old closing body, update its expected text. That is the only test change allowed.
3. `merge.ts:92-93`: drop "and `batch merge`" from the comment, so it reads that a `--hold` merge sets it false.
4. Run the tests below and `pnpm gate`.

### Allowed files
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `apps/server/src/agents/turn-stop-gate.test.ts`
- `packages/devtools/src/lead/merge.ts`
- `work/T-2212-card-close-body.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/group-turn-card.test.ts src/agents/turn-stop-gate.test.ts src/agents/task-card.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Lead live check after the deploy: stop a web-search turn in "ai test › General"; the topic's chat-list preview reads "Deepseek: Stopped after …".

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/agents/gateway/live.ts`: the closing correction now sends the card's summary text as the message body instead of the last step's `stage`. Extracted `taskCardSummary(...)` into a local `summary` so the same value feeds `finishTaskCard` and the correction; the payload is unchanged.
- `packages/devtools/src/lead/merge.ts`: the `push` option comment now reads that a `--hold` merge sets it false; "and `batch merge`" is gone.
- No test asserted the old closing body, so no test file was changed.

### Deviation from the spec
- The spec said to send `finished.summary`. That field is typed `string | null`, so `finished.summary` fails typecheck. I compute the summary once as a `string` and pass that to both `finishTaskCard` and `sendCorrection`; the sent text and payload are otherwise exactly as specced.

### Files changed
- `apps/server/src/agents/gateway/live.ts`
- `packages/devtools/src/lead/merge.ts`
- `work/T-2212-card-close-body.md`

### Commands and results
- `pnpm install`: done, 1155 packages, one peer-dependency warning about `@types/react-dom` in `apps/mobile` (pre-existing, outside scope).
- `pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/group-turn-card.test.ts src/agents/turn-stop-gate.test.ts src/agents/task-card.test.ts --reporter=dot`: 4 test files passed, 26 tests passed.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`, `PASS tests @zilar/devtools`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: ...`, `size: ...`, `comments: no task IDs in added comments`; ends with `GATE PASS`.

### Blocked / needs a decision
- None.


## Review (written by Claude)

Approved. The pre-review was clean (0 findings).

The closing correction of an AI task card now sends the card summary as the body ("Stopped after 12s", "Failed after 12s", "Done in 40s · 3 steps") instead of the last step's text. The payload is unchanged. Chat-list previews and other body readers stop showing "Reading the page" after a stop. The stale `batch merge` comment in `lead/merge.ts` is fixed too.

The live check (stop a turn, read the topic preview) follows the deploy.
