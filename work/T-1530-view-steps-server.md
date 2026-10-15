---
id: T-1530
title: "View steps, server (docs/audit/view-steps-plan.md §2–§3): GET /api/agents/tasks/:taskId/steps groups a turn's tool calls under the task card's steps (durations, ok, error, approved), owner only; a request_action tool row records its approval id"
status: merged
milestone: M5
branch: task/T-1530-view-steps-server
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1530: View steps, server

## Spec (written by Claude, do not edit)

### Why
Julio approved the View steps design on 2026-10-15 (`docs/design/mockups/view-steps/`). The audit `docs/audit/view-steps-plan.md` (T-1522) gives the facts. The lead decided its open questions in T-1522's Review:
- the reader is **owner only**, errors included;
- it follows the card's 20-step cap;
- after the 30-day retention it shows steps without actions;
- a short `tool + args` command text is fine.

This task is the server half. The web and phone panels come next.

### Facts (the lead read them on main, 2026-10-15)
- **How the card's steps match the status rows** (`apps/server/src/agents/task-card.ts`):
  - the **first** reported stage only opens the card: `startTaskCard` sets the title and `steps: []` (`:38-47`). `apps/server/src/agents/gateway/live.ts:110-113` calls `startTaskCard` when `card === null`, otherwise `addTaskCardStep`;
  - each **later** stage adds a step with id `step-<n>`, 1-based (`:53-65`, `stepId` at `:33-34`);
  - from the 21st step on (`TASK_CARD_MAX_STEPS = 20`, `:27`) the last step is renamed instead.
  - Every reported stage logs one `status` row first (`live.ts:109`). So, by `seq` order, status row 1 is the title, status row k+1 is step k, and rows past the 21st rename step 20.
- **Close markers:**
  - the card's close is logged as a `status` row with stage `card_done`, `card_failed` or `card_stopped` (`live.ts:165`);
  - the Stop path also logs a plain `{ stage: 'stopped' }` (`apps/server/src/agents/turn-stop.ts:25-26`). Neither is a step.
- **Tool rows:** each executed call logs `tool_call` (`tool`, `args` redacted and truncated to 2 KiB, `args_bytes`) then `tool_result` (`tool`, `output`, `output_bytes`, `ok`, `exit_code?`, plus the `duration_ms` column), after the round runs (`apps/server/src/agents/tool-exec.ts:168-192`). The outcome comes from `ToolCallOutcome` (`apps/server/src/agents/tool-calls.ts:30-37`, built at `:125-133`) and `ToolExecution` (`apps/server/src/agents/tool-loop.ts:68-80`).
- **Approvals:** `request_action` returns `{ status: 'pending_approval', approvalId }` (`apps/server/src/actions/gateway.ts:23`), but the runner (`apps/server/src/agents/gateway/request-action.ts:68-79`) drops the id. The `approvals` table holds the decision (`status`).
- **The events route:**
  - `GET /api/agents/tasks/:taskId/events` (`packages/api-contract/src/agent-tasks.ts:47-59`), handled at `apps/server/src/agents/log/api.ts:47-69`;
  - owner check: `loadTaskOwnerId` with the same 404 for unknown and not-yours (`apps/server/src/agents/log/read.ts`);
  - rows carry `kind`, `data`, `at` and `duration_ms`.
- **Rows never shown:** `model_call`, `answer` and `error` (audit §1.7).

### Steps
1. **The approval id on the log:**
   - `ToolExecution` and `ToolCallOutcome` gain `approvalId?: string`;
   - the request-action runner returns it on `pending_approval`;
   - `tool-calls.ts` passes it into the outcome;
   - `tool-exec.ts` adds `approval_id` to the `tool_result` data when present.
2. **Contract (`packages/api-contract/src/agent-tasks.ts`):** add `GET /agents/tasks/:taskId/steps` returning
   ```
   TaskSteps = {
     steps: Array<{
       id: string;          // step-<n>
       label: string;
       state: 'done' | 'failed' | 'stopped' | 'doing';
       durationMs: number;
       approved: boolean;
       actions: Array<{ command: string; ok: boolean; durationMs: number; error?: string }>;
     }>;
   }
   ```
3. **New `apps/server/src/agents/log/steps.ts`:** `taskSteps(db, taskId)` reads all rows of the task in `seq` order (one query, capped at 2000 rows), then:
   - **Statuses:** take the `status` rows whose stage doesn't start with `card_` and isn't `stopped`. Row 1 is the title; row k+1 opens step `step-k` (k ≤ 20; later rows rename step 20, as the card does).
   - **One status row only:** the result is one step, `step-1`, labelled with that stage.
   - **Actions:** each `tool_call` plus its following `tool_result` belongs to the step open at that moment; actions before step 1 go to step 1.
     - `command` is `"<tool> <args>"`, cut to 120 characters;
     - `ok` and `durationMs` come from the result;
     - `error` is the result `output` when `ok` is false.
   - **Durations:** a step's duration is the next step's status `at` minus its own `at`. The last step ends at the close marker's `at`, or the last row's `at`.
   - **States:** every step but the last is `done`. The last takes the close marker (`card_done` → `done`, `card_failed` → `failed`, `card_stopped` → `stopped`), or `doing` when there is none.
   - **`approved`:** true when any of the step's results carries an `approval_id` whose `approvals.status` is `approved` (one batched read).
   - Skip `model_call`, `answer` and `error` rows.
4. **`apps/server/src/agents/log/api.ts`:** handle `steps` with the same owner check and 404 as `events`. Add the route to the signed-out 401 sweep if there is a list of routes for it.
5. **One test, `apps/server/src/agents/log/steps.test.ts`** (permissions and the message pipeline), seeding rows directly:
   - title, two steps and a `card_done`, with one ok action and one failed action, gives 2 steps, the right grouping, the error text and `done`;
   - another user gets 404.

### Not in scope
- web and phone panels (next tasks);
- read access for group members.

### Allowed files
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tool-calls.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/gateway/request-action.ts`
- `packages/api-contract/src/agent-tasks.ts`
- `apps/server/src/agents/log/steps.ts` (new)
- `apps/server/src/agents/log/steps.test.ts` (new)
- `apps/server/src/agents/log/api.ts`
- the file listing routes for the signed-out 401 sweep, if one exists (name it in the Report)
- `work/T-1530-view-steps-server.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/log/steps.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `GET /api/agents/tasks/<taskId>/steps` returns the card's steps with their actions, durations, states and `approved` to the AI's owner, and 404 to anyone else.
- It answers 401 signed out.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

**1. The approval id on the log**
- `apps/server/src/agents/tool-loop.ts`: `ToolExecution` gains `approvalId?: string`.
- `apps/server/src/agents/tool-calls.ts`: `ToolCallOutcome` gains `approvalId?: string`; the executed branch copies `execution.approvalId` into the outcome.
- `apps/server/src/agents/gateway/request-action.ts`: the `pending_approval` branch returns `approvalId: outcome.approvalId`.
- `apps/server/src/agents/tool-exec.ts`: the `tool_result` row carries `approval_id` when the outcome has one.

**2. Contract** — `packages/api-contract/src/agent-tasks.ts`: added `TaskStepAction`, `TaskStep` (`id`, `label`, `state`, `durationMs`, `approved`, `actions`) and `TaskSteps`, plus `GET /agents/tasks/:taskId/steps` on the existing `agentTasks` group (same `Session` middleware and `/api` prefix).

**3. New reader** — `apps/server/src/agents/log/steps.ts` (245 lines): `taskSteps(db, taskId)` reads every row of a task in `seq` order in one query capped at 2000 rows, then:
- filters `status` rows: drops `card_*` and the stop path's `stopped`; row 1 is the title, row k+1 opens `step-k`, stages past 20 rename the last step (imports `TASK_CARD_MAX_STEPS`);
- a title-only card still yields one `step-1`; a task with no status rows yields no steps;
- groups each `tool_call` with its following `tool_result` under the step open at that time (step 1 before any); command is `<tool> <args>` trimmed and cut to 120 chars, `ok`/`durationMs` from the result, `error` from the result `output` when `ok` is false;
- durations run from a step's own `at` to the next step's `at`, and the last to the close marker or the last row (`Math.max(0, …)`);
- every step but the last is `done`; the last takes `card_done`→`done`, `card_failed`→`failed`, `card_stopped`→`stopped`, else `doing`;
- `approved` is one batched read of `approvals` for the step's collected `approval_id`s;
- drops `model_call`, `answer` and `error` rows.

**4. Handler** — `apps/server/src/agents/log/api.ts`: added the `steps` handler with the same owner check and 404 as `events`.

**5. Test** — `apps/server/src/agents/log/steps.test.ts` (179 lines): seeds rows directly (title, `Running tests` + ok action, `Deploying` + failed action, `card_done`) and asserts 2 steps, grouping, durations `[3000, 6000]`, the error text, `done`, and `approved: true` on the step whose action raised an approved approval; plus stranger/unknown 404 and signed-out 401.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/log/steps.test.ts` → `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` (from the repo root) summary:
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (3.3s)
PASS  format  (1.8s)
PASS  lint  (0.9s)
PASS  typecheck  (3.9s)
PASS  effect  (0.9s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/server  (29.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **401 sweep:** there is no hand-written route list to edit. `apps/server/src/authz-sweep.test.ts` enumerates `app.routes` itself, so the new `steps` endpoint is swept automatically; the route answers 401 signed out (covered by the test I added and by the sweep in `pnpm gate`). No extra file was touched.
- **`approved` wording:** `approvals.status` has no literal `approved` (`pending | approved_once | approved_always | denied | consumed`). I read "status is `approved`" as the granted family: `approved_once`, `approved_always` and `consumed` (the last is an approved decision that later ran). `pending`/`denied` are not approved. Say the word if you want only `approved_once`/`approved_always`.
- **No status rows but tool rows:** the spec only defines the one-status-row special case, so with zero status rows the result is `steps: []` and orphan tool rows are dropped (the plan's "no card, no panel" branch). Flag if you wanted a synthetic step instead.
- **`stopped` is not a close marker** here, per the spec's explicit list (`card_done`/`card_failed`/`card_stopped`). The stop path logs both rows, so `card_stopped` closes the step; a log with only `stopped` and no card is not a step and does not close one.
- **Command text** is the stored (already redacted/truncated) `tool + args`; `error` is the stored result `output`, both owner-only as decided.

### Round (fix round 1)

- **Finding 1 (must-fix) fixed** — `apps/server/src/agents/log/steps.ts`: the last step's source row is now the final stage when the status list overflowed the 20-step cap (`const source = index === count ? lastIndex : index;`). A title + 21 stages now labels `step-20` with stage 21's text, matching the card. When there is no overflow `count === lastIndex`, so the expression is unchanged from before.
- **Finding 4 (nit that the must-fix needs)** — added a cap/rename test in `apps/server/src/agents/log/steps.test.ts`: seeds a title, 21 stages and `card_done`, and asserts 20 steps, `step-1 … step-20` and `step-20` labelled `stage 21`.
- **Findings 2 and 3 (nits)** — left as they are: neither is on a line this round changes and the prereview asks for no fix.
- **Tests:** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/log/steps.test.ts` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- **Gate:** `pnpm gate` (from the repo root) summary:
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/server  (16.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
- Findings fixed: 1 (must-fix) plus the cap test finding 4 asks for. No disagreements.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** the autopilot ran one round. The must-fix (past the 20-step cap, step-20 must carry the last stage's label, as the card does) is fixed, with a cap test.
- **Two nits, left as they are:**
  - in the overflow case, one stage-to-stage span is not counted in any step's duration;
  - calls and results pair in order rather than by tool name. An orphan needs a crash between two adjacent appends.
- **Read the contract:** `TaskSteps { steps: TaskStep[] }`, where a step is `{ id, label, state: done|failed|stopped|doing, durationMs, approved, actions: { command, ok, durationMs, error? }[] }`. It matches what T-1535 (the web panel) was written against.
- **Owner only:** the same `loadTaskOwnerId` check and 404 as `events`. The approvals read only touches ids found on this task's own rows.
- **The approval id** now rides the `tool_result` data as `approval_id`. Older rows simply show no shield.
- **After the deploy,** the lead checks that the route answers 401 signed out.

