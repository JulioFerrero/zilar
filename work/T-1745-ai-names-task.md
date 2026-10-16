---
id: T-1745
title: "The AI names its task: an optional task_title (2-4 words) on any tool call sets the work card title, as the boards draw it (\"Check the prices\"); stripped before the tool runs, never logged"
status: merged
milestone: M5
branch: task/T-1745-ai-names-task
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1745: The AI names its task

## Spec (written by Claude, do not edit)

### Why
The approved boards title the work card with the job: "Check the prices" (`docs/design/mockups/routines/PhoneRoutineAsk.dc.html`) and "Fix the checkout button" (`docs/design/mockups/ai-work/Phone.dc.html`). The app shows the first step instead ("Looking up saved tools"). On 2026-10-16 Julio chose "The AI names it": the AI gives a 2-4 word title on its first action, and the fixed stage labels stay the fallback.

### Facts (the lead read them on 2026-10-16)
- **The card title is the first stage:** `startTaskCard(stage, …)` (`apps/server/src/agents/task-card.ts:23-47`), and the title is the stage or "Working on it". `addTaskCardStep` (`:53-`) skips a first step equal to the title (T-1727).
- **Stages are fixed labels:** `stageForToolCall(name, action)` (`apps/server/src/agents/tool-guide.ts`). The first call of each round reports its stage through `input.reportProgress(stage)` (`apps/server/src/agents/tool-exec.ts:135-145`). `actionOfCall` (`:237-257`) shows how a call's `argsJson` is read safely.
- **The card state:** `reportProgress` is built in `apps/server/src/agents/gateway/live.ts:87-125`. It starts or steps the card, logs `status` with the fixed stage (T-1426: log labels are never model text), and sends the payload. Its type is in `apps/server/src/agents/dm-turn.ts:105`; it's passed from `apps/server/src/agents/gateway/group-turn-body.ts:312` and `apps/server/src/agents/gateway/dm-turn-input.ts:131`.
- **Arguments:** every tool call's `argsJson` is parsed in `apps/server/src/agents/tools/parse.ts:84` (`JSON.parse`), then decoded strictly per tool, so an unknown key would be refused.
- **The tool definitions** are in `apps/server/src/agents/tools/definitions.ts` (307 lines).

### Steps
1. **The parameter.** In `definitions.ts`, add an optional `task_title` string property (maxLength 40) to every tool definition the model gets, through one helper. Its description: "Only on your first tool call of a task: 2-4 plain words naming the whole job, e.g. \"Check the prices\"."
2. **Strip it.** In `parse.ts`, right after `JSON.parse` (`:84`), remove a top-level `task_title` key from the object before the strict decode, so no tool ever sees it.
3. **Read it.**
   - In `tool-exec.ts`, read `task_title` from the round's first call's `argsJson`, the way `actionOfCall` does;
   - sanitise it: trim, collapse whitespace, drop control characters, ≤ 40 characters, and ignore it if empty;
   - pass it as a second argument: `reportProgress(stage, title?)`. Update the type at `dm-turn.ts:105` and the two callers.
4. **Use it.**
   - In `live.ts`, when a title is given and the card hasn't been named yet, set the card's title to it, through a pure `nameTaskCard(card, title)` in `task-card.ts`. The current stage stays as the first step: don't skip it when the title differs.
   - Never put the title in the session log or any logger line.
   - A later title in the same turn is ignored.
5. **The guide.** In `tool-guide.ts`, add one sentence: "On your first tool call, set task_title to 2-4 words naming the whole job."
6. **Tests** (message pipeline, at most two): `nameTaskCard` names once and keeps the stage as a step; `parse.ts` strips `task_title` and the strict decode still passes.
7. Keep each file under 400 lines.

### Allowed files
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/parse.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/task-card.ts`
- `apps/server/src/agents/task-card.test.ts`
- `apps/server/src/agents/tools/parse.test.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `work/T-1745-ai-names-task.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/task-card.test.ts src/agents/tools --reporter=dot
pnpm gate
```

### Acceptance
- **When the model sends `task_title`** on its first call, the card's title is that text, and the fixed stages appear as steps.
- **Without it,** the card behaves as before.
- **The title never reaches a tool, the session log or the logs.**
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
The AI can now name its own work card with an optional `task_title` (2–4 words)
on the first tool call of a task; the fixed stage labels stay the fallback.

- **The parameter** (`tools/definitions.ts`): one helper, `withTaskTitle` /
  `withTaskTitles`, adds the optional `task_title` string property (maxLength 40)
  to every tool definition the model gets — `buildTools` and `buildGroupTools`
  map their full output (persona, memory, `request_action`, `delegate`,
  `task_status`, `ask_people`, desk) through it. Description: "Only on your first
  tool call of a task: 2-4 plain words naming the whole job, e.g. \"Check the
  prices\"."
- **Strip it** (`tools/parse.ts`): `withoutTaskTitle` drops the top-level key
  right after `JSON.parse`, before the strict decode, so no tool ever sees it;
  the exported `stripTaskTitle` does the same on the raw JSON string.
- **Read it** (`tool-exec.ts`): a new `taskTitleOfCall` reads `task_title` from
  the round's first non-quiet call's `argsJson` (the way `actionOfCall` reads
  `request_action`), then `sanitizeTaskTitle` trims, collapses whitespace, drops
  control characters, caps at 40 chars and returns `undefined` when blank. It is
  passed as `reportProgress(stage, title?)`. The `runLoopRound` type was widened.
- **Keep it out of the log** (`tool-exec.ts`): the session `tool_call` row now
  logs `stripTaskTitle(call.argsJson)` (and its byte count), so the title never
  reaches the session log; no logger line ever carries it.
- **Use it** (`task-card.ts`, `gateway/live.ts`): new pure `nameTaskCard(card,
  title)` sets the title once (a `named` flag on `TaskCard` ignores later
  titles) and promotes the opening stage to the first step, because the title no
  longer repeats it. `live.ts` calls it on each reported stage when a title was
  sent.
- **The guide** (`tool-guide.ts`): one line added — "On your first tool call, set
  task_title to 2-4 words naming the whole job."
- **Tests**: `task-card.test.ts` adds one case for `nameTaskCard` (names once,
  stage kept as a step, second title ignored) and updates the `startTaskCard`
  shape for the new `named` field; new `tools/parse.test.ts` (one case) proves
  `task_title` is stripped and the strict decode still passes.

Files changed: `tools/definitions.ts`, `tools/parse.ts`, `tools/parse.test.ts`
(new), `tool-exec.ts`, `tool-guide.ts`, `gateway/live.ts`, `task-card.ts`,
`task-card.test.ts`, `dm-turn.ts`, `work/T-1745-ai-names-task.md`.

### Checks run
- `pnpm install` — Done in 20.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/task-card.test.ts src/agents/tools/parse.test.ts` — 2 files, 14 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools` — 2 files, 4 tests passed.
- `pnpm gate` (from the repo root) — summary lines:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (18.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Acceptance: with `task_title` on the first call the card title is that text and
the fixed stages appear as steps (`nameTaskCard` test); without it the card is
unchanged (`startTaskCard` / `addTaskCardStep` tests unchanged); the title never
reaches a tool (`parse.ts` strip), the session log (`stripTaskTitle` on the
`tool_call` row) or any logger; the gate passes.

### Notes for the lead
- The spec said to "update the type at `dm-turn.ts:105` and the two callers".
  I widened `DmTurnDeps.reportProgress` and `runLoopRound`'s `reportProgress`.
  `gateway/dm-turn-input.ts` and `gateway/group-turn-body.ts` only forward the
  function reference, and TypeScript accepts the wider `(stage, title?)`
  signature in place of `(stage)`, so neither needed a textual change; I left
  them untouched. `group-turn-deps.ts` and `tool-rounds.ts` (not in Allowed
  files) also needed no change for the same reason — the title flows through the
  shared function object.
- Behaviour is unchanged for turns that send no `task_title`: `nameTaskCard` is
  only called when a title is present, and progress is only reported on
  multi-round turns as before.

## Review (written by Claude)

- **Accepted at `dd1e6917f`.** The pre-review is clean (4 cosmetic nits) and the packet is current. The lead ran `task-card.test.ts` and `tools/parse.test.ts`: 14 passed.
- **The flow, as read by the lead:**
  - the first call's `task_title` is sanitised in `tool-exec.ts`;
  - `reportProgress(stage, title)` opens the card, and `nameTaskCard` sets the title once and keeps the opening stage as step 1;
  - later rounds append steps as before.
  - `parse.ts` strips `task_title` before every strict decode, and `tool-exec.ts` strips it before the session-log `tool_call` row, so no tool or log sees it.
- **Nits left:**
  - the stale module comment in `task-card.ts:4-5`;
  - the 40-character cap is declared twice;
  - unparsable args keep their raw text in the log row, as before this task;
  - a later stage equal to the new title can repeat as a step.

