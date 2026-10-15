---
id: T-1627
title: "Size split: agents/gateway/dm-turn.ts is at 396 lines — move one cohesive helper block (≥ 60 lines) into a new file, no behaviour change"
status: merged
milestone: M5
branch: task/T-1627-split-gateway-dm-turn
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1627: Split gateway/dm-turn.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/agents/gateway/dm-turn.ts` is at 396 lines, against a limit of 400. The next change to it would cross the limit, so it is split first.

### Facts (the lead read them on 2026-10-16)
- **The file** is one factory, `export function createDmTurn(ctx: DmTurnContext)` (`:73`).
- **Inside it** are `pumpSessionEffect` (`:95`) and `runSessionTurnEffect` (`:119` to the end). `runSessionTurnEffect` builds the prompt and context, resolves the AI's computer, and calls `runDmTurn` with tools, the executor and the turn limits (T-1611, about `:290-320`).
- **Tests:** `apps/server/src/agents/dm-turn.fake-provider.test.ts`, plus the `gateway-*.test.ts` files beside it in `apps/server/src/agents/`.

### Steps
1. **Read the whole file** and pick **one** cohesive block of at least 60 lines that can live as a plain function taking explicit arguments. Good candidates: building the turn's messages and system prompt, or building the `runDmTurn` input (executor, tools, limits). Don't move the pump.
2. **Move it** to a new file `apps/server/src/agents/gateway/dm-turn-input.ts`, or a name that fits what you move. It exports a function, and `dm-turn.ts` calls it. Keep the comments with the code.
3. **No behaviour change:** the same calls in the same order with the same arguments.
4. **Say in the Report** exactly what moved, and the new line counts.

### Allowed files
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `work/T-1627-split-gateway-dm-turn.md`

If the name you choose differs, use it and say so in the Report.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts src/agents/gateway-stop.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`dm-turn.ts` is under 340 lines.**
- **The tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did

Moved the gateway DM turn's desk resolution and `runDmTurn` input wiring out of
`apps/server/src/agents/gateway/dm-turn.ts` into a new
`apps/server/src/agents/gateway/dm-turn-input.ts`.

- **What moved** (was `dm-turn.ts` lines 286–364, 79 lines): creating the turn's
  live progress reporter, `resolveTurnDesk` + the `waiting` progress report,
  `deskEnabled`, `registerTurnAbort`, the whole `runDmTurn({...})` deps object
  (executor via `executeToolCall`, `buildTools`, `turnLimits`, round gate,
  progress callbacks, `onDelta`/`onUsage`, `beforeFinalSend`, send/typing,
  `logger`, `secrets`, `log`) and the `Effect.ensuring(clearTurnAbort(...))`
  cleanup. All comments moved with the code.
- **How it's wired**: `dm-turn.ts` now calls
  `runDmTurnInput({ ctx, ai, session, ownerJid, messages: dmMessages, target, chatKey: dmChatKey, drafts: turnDrafts, log: turnLog })`,
  which returns `Effect.Effect<DmTurnOutcome>`. `DmTurnContext` is now exported so
  the helper can take it as a type-only import — the same pattern
  `group-turn-body.ts` uses for `GroupTurnContext`.
- **No behaviour change**: the same calls run in the same order with the same
  arguments; only the scope moved. The abort is still registered immediately
  before `runDmTurn` and cleared right after it resolves, inside the same effect.
- **Removed now-unused imports from `dm-turn.ts`**: `runDmTurn`, `buildTools`,
  `TOOL_STAGE_THINKING`, `recordUsage`, `turnLimits`, `resolveTurnDesk`,
  `TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER`, `clearTurnAbort`, `registerTurnAbort`;
  `turnLogger`, `liveProgressReporter` and `executeToolCall` dropped from the
  factory destructuring.

**Line counts:** `apps/server/src/agents/gateway/dm-turn.ts` 396 → **317**
(acceptance: under 340). `apps/server/src/agents/gateway/dm-turn-input.ts` is new
at **131** lines.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts src/agents/gateway-stop.test.ts`
  → `Test Files 3 passed (3)`, `Tests 3 passed (3)`.
- `pnpm gate` (repo root) → **GATE PASS**. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.8s)`
  - `PASS  format  (0.8s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (4.0s)`
  - `PASS  effect  (1.0s)`
  - `PASS  tests @zilar/server  (17.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- **File name**: I used the exact path `dm-turn-input.ts` from the Allowed files
  list (rather than a different name) so the gate's scope check stays green.
- **Function name / scope**: the export is `runDmTurnInput`. To keep the call site
  compact and the move clearly cohesive, the helper covers the whole block from
  resolving the desk to running `runDmTurn` and clearing the abort — slightly more
  than "build the input" alone, but it's one contiguous block (the spec's
  candidate #2) and the comments travel with it. If you'd rather have a pure
  builder that returns `DmTurnDeps` and keep the `runDmTurn` call in `dm-turn.ts`,
  say so and I'll reshape it.
- The `runDmTurn` unit tests (`dm-turn.fake-provider`, `turn-stop-gate`,
  `reply.test`) call `runDmTurn` directly and don't exercise `createDmTurn`; the
  gateway wiring is covered by `gateway-desk.test.ts` / `gateway-stop.test.ts`,
  which pass.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, no nits, a pure move.
- **The split:** `dm-turn.ts` went from 396 to 317 lines, and the new `dm-turn-input.ts` is 129. `createDmTurn` now calls `runDmTurnInput({ ctx, ai, session, ownerJid, messages, target, chatKey, drafts, log })`.
- **The tests:** the lead ran `dm-turn.fake-provider`, `gateway-desk` and `gateway-stop`: 3 files passed.

