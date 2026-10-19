---
id: T-2218
title: "Stop cancels an in-flight DeepSeek web.search/web.fetch: the turn's abort signal travels from executeToolCall through the action gateway (ActionContext.signal) to the DeepSeek calls"
status: merged
milestone: M5
branch: task/T-2218-stop-cancels-web-tool
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2218: Stop cancels an in-flight web tool

## Spec (written by Claude, do not edit)

### Why
The lead's live check on 2026-10-19 (10:00 UTC, "ai test › General"): Stop on a multi-page `web.fetch` task took about 20 s to land. The card sat at "Stopping…" until the in-flight DeepSeek fetch returned (timeout 30 s). The turn only notices the stop between tool calls, because the action gateway never passes the turn's abort signal to the adapters.

### Facts (the lead read these on 2026-10-19)
1. **The turn's abort signal:** `prepareTurn` (`apps/server/src/agents/gateway/turn-wiring.ts`) returns `signal`. The DM and group inputs pass `executeToolCall(session, chatKey, context, deskOptions, { unattended, dmJid? })`. The signal only reaches the desk options.
2. `executeToolCall` (`apps/server/src/agents/gateway/tool-exec.ts:213-219`) takes `options?: { unattended?: boolean; dmJid?: string }`. For `request_action` it calls `runRequestActionEffect(session, call, chat, unattended)` (`:67-131`), which calls `actions.request({...})`.
3. `RequestParams` (`apps/server/src/actions/gateway.ts:198-208`) has no signal. `executeAction` builds the `ActionContext` (`:354-360`).
4. `ActionContext` (`apps/server/src/actions/registry.ts:24-30`) has `aiId`, `groupId`, `topicId`, `requestId` and `logger`.
5. `withWebRateLimit` (`apps/server/src/web-tools/shared.ts`) passes the ctx to `web.fetch` and `web.search` (`apps/server/src/startup/components.ts`). These call `deepseekFetch` / `deepseekSearch` (`apps/server/src/web-tools/deepseek.ts`), which already accept `options.signal` and combine it with the timeout.

### Steps
1. Add `signal?: AbortSignal` to `executeToolCall`'s `options`, to `RequestParams`, and to `ActionContext`. Thread it through `runRequestActionEffect` → `actions.request` → `executeAction` → `ctx`. It is never part of the audit row or the args hash.
2. The DM and group inputs pass `signal` (from `prepareTurn`) in the `executeToolCall` options.
3. `web.fetch` and `web.search` pass `ctx.signal` to `deepseekFetch` / `deepseekSearch`. An aborted call returns the existing failure summary; the loop then sees the stop and ends the turn `stopped`, as it does today. The guarded-fetch path (non-DeepSeek AIs) stays as it is: plan W3 removes it.
4. **Tests:** one case in `apps/server/src/web-tools/deepseek.test.ts`. A fetch whose signal aborts mid-request resolves at once with a failure summary, and no cost is recorded.

### Allowed files
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/registry.ts`
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/web-tools/deepseek.test.ts`
- `work/T-2218-stop-cancels-web-tool.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/web-tools/deepseek.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Lead live check after the deploy: Stop on a multi-page `web.fetch` task in "ai test › General" ends the card in a few seconds, not about 20.

---

## Report (written by the worker when done)

### What I did
- Added `signal?: AbortSignal` to `ActionContext` (`actions/registry.ts`) and to `RequestParams` (`actions/gateway.ts`), and copied `params.signal` into the `ActionContext` built in `executeAction`. The signal is never put in the audit row, the stored args or the args hash.
- Added `signal?: AbortSignal` to `executeToolCall`'s options in `tool-exec.ts` and threaded it through `runRequestActionEffect` / `runRequestAction` into `actions.request`.
- The DM and group turn inputs now pass the `signal` they already receive from `prepareTurn` in the `executeToolCall` options; the `executeToolCall` option types in `dm-turn.ts` and `group-turn.ts` were widened to match.
- `web.fetch` and `web.search` in `startup/components.ts` now pass `ctx.signal` to `deepseekFetch` / `deepseekSearch` when present. The guarded-fetch path for non-DeepSeek AIs is unchanged.
- Added one test in `apps/server/src/web-tools/deepseek.test.ts`: a DeepSeek fetch that hangs until aborted resolves with the existing `fetch failed` summary as soon as the turn's signal aborts, with no `modelText` and no tool cost recorded.

### Files changed
- `apps/server/src/actions/registry.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/web-tools/deepseek.test.ts`
- `work/T-2218-stop-cancels-web-tool.md`

### Commands and results
- `pnpm install`: done, no failures.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/deepseek.test.ts`: 1 file, 4 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts`: 2 files, 31 tests passed.
- `pnpm gate` (repo root): exit 0, `GATE PASS`. Summary:
  - `gate: 10 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (0.7s)`
  - `PASS  effect  (0.4s)`
  - `PASS  build @zilar/server  (0.5s)`
  - `PASS  tests @zilar/server  (10.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines` (four soft-limit WARNs, all pre-existing or +1/+5 lines)
  - `comments: no task IDs in added comments`
  - `GATE PASS`

### Problems / deviations
- None. The guarded-fetch path was left untouched as the spec asked.
- `prepareArgs` (the tier-2 pre-approval path) does not receive the signal; it runs before approval and is not the in-flight adapter call the Stop targets.

### Open questions
- None.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). +18 source lines, +30 test lines.

The turn's abort signal now travels:
1. from `executeToolCall` options;
2. through `runRequestActionEffect` → `actions.request` (`RequestParams.signal`) → `executeAction` (`ActionContext.signal`);
3. to `deepseekFetch` and `deepseekSearch`.

It is never audited or part of the args hash. One new test: an aborted fetch resolves at once with a failure summary, and no cost is recorded.

The live check (Stop on a multi-page fetch task lands in seconds) follows the deploy.
