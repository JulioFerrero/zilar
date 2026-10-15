---
id: T-1580
title: "Split apps/server/src/agents/gateway/tool-exec.ts (376 lines): the delegate and task_status branches move to gateway/delegate-run.ts as createDelegateRunner (the request-action.ts pattern); executeToolCall calls it; no behaviour or wording change"
status: merged
milestone: M5
branch: task/T-1580-split-tool-exec
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1580: Split tool-exec.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/agents/gateway/tool-exec.ts` is 376 lines after T-1576 and is the AI tool executor (the message pipeline). The next tool change would cross 400. T-1409 split `request_action` out the same way (`apps/server/src/agents/gateway/request-action.ts:1-3`). **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main after T-1576, 2026-10-15)
- **`createToolExec(ctx)`** (`:62`) destructures `deps`, `logger`, `sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom`, `secretsFor` and more (`:62-72`).
- **`executeToolCall(session, chatKey, context?, desk?)`** (`:86`) builds `execute` with the per-tool branches:
  - **`DELEGATE_TOOL` (`:184-295`):** it checks the context and targets, finds the target session, spends a hop on the room round, creates the delegation, queues the synthetic handoff trigger, pumps the room, logs, and returns the JSON `{ task_id, status }`;
  - **`TASK_STATUS_TOOL` (`:296-314`).**
- **The model:** `createRequestActionRunner(actions, logger)` in `request-action.ts` returns the runner functions that `tool-exec.ts` calls.

### Steps
1. **New `apps/server/src/agents/gateway/delegate-run.ts`:** `export function createDelegateRunner({ deps, logger, sessions, roomRounds, pumpRoom })` (only what the moved code uses) returns `runDelegate(session, context, call)` and `runTaskStatus(session, context, call)`.
   - Both return the same `Effect` / `ToolExecution` values the branches return today.
   - The branch bodies move **unchanged**: the wording, log lines, guard order and the `invalid: unknown tool` answers when `context` is undefined.
   - It must not import `./tool-exec`.
2. **`tool-exec.ts`:** the two branches become `if (call.tool === DELEGATE_TOOL) return yield* runDelegate(session, context, call);` (and the same for task status). Remove the imports only the moved code used.
3. **No behaviour change.** The gateway and delegation tests must pass in the gate.

### Tests
None new.

### Allowed files
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/delegate-run.ts` (new)
- `work/T-1580-split-tool-exec.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files (`tool-exec.ts` under 280);
  - the export list of `tool-exec.ts` before and after (identical);
  - the gate summary, including the gateway and delegation tests that ran.

---

## Report (written by the worker when done)

### What I did
Split the `DELEGATE_TOOL` and `TASK_STATUS_TOOL` branches out of
`apps/server/src/agents/gateway/tool-exec.ts` into the new
`apps/server/src/agents/gateway/delegate-run.ts`, following the
`request-action.ts` pattern (barrel/importers unchanged; `tool-exec.ts` keeps
the same single export).

- New `delegate-run.ts`: `export function createDelegateRunner(ctx)` with
  `ctx = { deps, logger, sessions, roomRounds, pumpRoom, secretsFor }` (the
  spec listed `{ deps, logger, sessions, roomRounds, pumpRoom }`; the moved
  `delegate` body also reads `secretsFor` for `toRedactedError`, so the extra
  field is required by the code that moved). It returns `runDelegate(session,
  context, call)` and `runTaskStatus(session, context, call)`, both
  `Effect.fnUntraced` generators returning `Effect.fn.Return<ToolExecution>`.
  It does **not** import `./tool-exec`.
- `tool-exec.ts`: builds the runner once in `createToolExec`
  (`const { runDelegate, runTaskStatus } = createDelegateRunner({...})`); the
  two branches are now `if (call.tool === DELEGATE_TOOL) return yield*
  runDelegate(session, context, call);` and the `TASK_STATUS_TOOL` one-liner.
  Removed the now-unused imports (`createDelegation`, `getDelegationForAi`,
  `ROUND_MAX_HOPS`, `errorName`, `toRedactedError`); added the
  `createDelegateRunner` import.
- Bodies moved with wording, log lines and guard order unchanged. The only
  textual edits inside the moved code: indentation (outer scope shifted) and
  `getDelegationForAi(deps.db, call.taskId, aiId)` → `session.aiId` in
  `runTaskStatus`, because the `aiId` local stayed behind in `executeToolCall`
  (same value, so no behaviour change).

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/`
  → 4 files passed, 28 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`
  → 1 file passed, 13 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/handoff.test.ts`
  → 1 file passed, 4 tests passed.
- `pnpm gate` from the repo root → `GATE PASS`. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/server  (11.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  `tests @zilar/server` runs `vitest --changed main`, i.e. the server tests
  affected by the two changed sources; the gateway tests above are the ones
  in that set I also ran directly. No test in the repo references delegation
  (`grep -rl delegat --include=*.test.ts apps/server/src` finds none), so the
  `delegate`/`task_status` paths are only covered through the group-turn
  tests (`gateway-group.test.ts`).

### Acceptance data
- `wc -l`: `tool-exec.ts` before 376 → after **256**; new `delegate-run.ts`
  **183**. Both under 400 (tool-exec under the requested 280).
- Export list of `tool-exec.ts` before and after (identical):
  ```
  BEFORE: 62:export function createToolExec(ctx: ToolExecContext) {
  AFTER:  59:export function createToolExec(ctx: ToolExecContext) {
  ```
  `delegate-run.ts` adds `36:export function createDelegateRunner(ctx:
  DelegateRunnerContext) {`.
- No `effect-plain` marker needed (the new file imports and uses `Effect`;
  the gate's `effect` step passed).

### Notes for the lead
- `secretsFor` was added to `createDelegateRunner`'s context beyond the spec's
  parenthetical list; it is used by the moved `toRedactedError` call and the
  spec says "only what the moved code uses".
- No behaviour or wording change; test count and files are unchanged.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `tool-exec.ts` 256 and `delegate-run.ts` 183 lines (was 376).
  - **Exports:** the `^export` lines of `tool-exec.ts` are identical to main's.
  - **No cycle:** `delegate-run.ts` mentions `tool-exec` only in a comment.
  - **The moved delegate body:** `diff -w` against main's `:190-295` shows only the closing brace.
- **Tests:** the gateway and delegation tests passed in the worker's gate.
