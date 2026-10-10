---
id: T-0972
title: "Crucial tests for the AI reply pipeline: failure-to-reply mapping, secret redaction, and the tool-loop call cap (money), 4 tests in agents/reply.test.ts"
status: merged
milestone: M5
branch: task/T-0972-ai-reply-crucial-tests
model: auto
effort: default
depends_on: [T-0960]
estimate: 0.25 day
---

# T-0972: Crucial tests for the AI reply pipeline

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10) is tests only for crucial code: auth and keys, permissions and money, and the message pipeline. Since the test cut (T-0931), no test covers `apps/server/src/agents/` at all; T-0960 found no kept test that imports `agents/reply`. That code holds three crucial things:
- the caller's secrets must never reach the model or the logs: `redactError` (`apps/server/src/agents/tool-exec.ts:363`), built on `redactSecrets` (`apps/server/src/ai/litellm-client.ts:254`);
- the tool loop is capped at `TOOL_TURN_MAX_CALLS = 12` (`apps/server/src/agents/tool-loop.ts:370`), which bounds what one turn can spend;
- `mapFailureToReply` (`tool-exec.ts:45-54`) turns a 429 or `budget_exceeded` into the budget reply, and a 401 or 403 into the key-rejected reply.

### What to build
One new file, `apps/server/src/agents/reply.test.ts`, with **at most 4 tests**, importing from `./reply` (the barrel). No source changes.

1. `mapFailureToReply`: a 429 and a `budget_exceeded` detail give `BUDGET_EXCEEDED_REPLY`; a 401 and a 403 give `PROVIDER_KEY_REJECTED_REPLY`; anything else gives `TRANSIENT_FAILURE_REPLY`. Build the error the way `statusAndDetail` reads it (read `tool-exec.ts`).
2. `redactError`: an error whose message contains a secret comes back with the secret gone.
3. `runToolLoop` (`dm-tool-turn.ts:43`) with a fake `fetchImpl` that answers every round with a new tool call: it stops after at most `TOOL_TURN_MAX_CALLS` executions, counted with a fake `executeTool`. Use `nowMs` and `turnStartMs` so no real clock or timer is involved.
4. `runToolLoop` where the fake `executeTool` throws an error that contains a secret from `secrets`: no later request body the fake `fetchImpl` receives contains that secret.

If test 3 or 4 needs more than a small fake (for example a database), stop at tests 1 and 2 and say why in the Report. Keep the file under 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/dm-tool-turn.ts`, `apps/server/src/agents/tool-loop.ts`, and `apps/server/src/ai/litellm-client.ts:240-270`.

### Allowed files
`apps/server/src/agents/reply.test.ts`, `work/T-0972-ai-reply-crucial-tests.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/agents/reply.test.ts
pnpm gate
```

### Acceptance
- The Checks pass, and every test runs in under a second.
- The Report shows that each test fails when its rule is broken. Temporarily change the cap, the redaction or the mapping, run the test, paste the failure, then revert the change.

---

## Report (written by the worker when done)

### What I did
Added `apps/server/src/agents/reply.test.ts` (183 lines, no source changes) with 4 tests:

1. `mapFailureToReply` — a `ChatCompletionError(429, …)` and a `ChatCompletionError(400, 'budget_exceeded')` give `BUDGET_EXCEEDED_REPLY`, 401/403 give `PROVIDER_KEY_REJECTED_REPLY`, a plain `Error` gives `TRANSIENT_FAILURE_REPLY` (via `ChatCompletionError`/`Error`, which is exactly what `statusAndDetail` reads).
2. `redactError` — a message carrying a named secret comes back with the secret gone (and `[redacted]` in its place), the stack is clean too, and a credential-shaped `sk-…` token is masked even with no named secrets.
3. `runToolLoop` cap — a fake `fetchImpl` answers every round with a fresh `recall` call and a fake `executeTool` counts executions; the loop stops at exactly `TOOL_TURN_MAX_CALLS` (12) executions and 12 model calls. `nowMs`/`turnStartMs` are frozen so no real clock or timer is involved.
4. `runToolLoop` redaction — a fake `executeTool` throws an error containing a secret from `secrets`; neither a later request body the fake `fetchImpl` receives nor any field passed to the logger contains that secret.

The fake provider answers plain `200 application/json` (the loop parses that shape as well as SSE), so no stream plumbing or database is needed and every test is well under a second.

### Files changed
- `apps/server/src/agents/reply.test.ts` (new)
- `work/T-0972-ai-reply-crucial-tests.md` (Report + status)

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=verbose src/agents/reply.test.ts` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`. Per-test: 7ms, 3ms, 47ms, 7ms (all under a second).
- `pnpm gate` (from repo root):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (0.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.0s)
SKIP effect (no source files changed)
PASS  tests @zilar/server  (2.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```
  (The first gate run failed on `format` for `reply.test.ts`; I fixed it with `pnpm exec prettier --write apps/server/src/agents/reply.test.ts` and re-ran the gate, which passed.)

### Each test fails when its rule is broken (temporary changes, then reverted)
Source was reverted after every run; `git status` shows only the two Allowed files.

1. **Cap**: in `dm-tool-turn.ts` changed `executedCalls >= TOOL_TURN_MAX_CALLS` to `>= TOOL_TURN_MAX_CALLS + 1000` (cap enforcement disabled):
```
FAIL  src/agents/reply.test.ts > runToolLoop caps and redaction > stops after TOOL_TURN_MAX_CALLS tool executions even when every round asks for another call
AssertionError: expected 'I couldn\'t reply just now. Please tr…' to be null
- Expected: null
+ Received: "I couldn't reply just now. Please try again in a minute."
 ❯ src/agents/reply.test.ts:122:25
```
2. **Redaction**: in `tool-exec.ts` changed `redactError` to `new Error(error.message)` (no `redactSecrets`) — two tests fail:
```
FAIL  src/agents/reply.test.ts > redactError > removes a named secret from the message and the stack…
AssertionError: expected 'could not reach the gateway with prov…' not to contain 'provider-key-abcd1234'
 ❯ src/agents/reply.test.ts:77:34
FAIL  src/agents/reply.test.ts > runToolLoop caps and redaction > never puts a secret thrown by executeTool into a later request body or the log
AssertionError: expected 'tool blew up with sekret-value-1234' not to contain 'sekret-value-1234'
 ❯ src/agents/reply.test.ts:181:24
```
3. **Mapping**: in `tool-exec.ts` dropped `status === 429 ||` from the budget branch:
```
FAIL  src/agents/reply.test.ts > mapFailureToReply > maps 429 and budget_exceeded…
AssertionError: expected 'I couldn\'t reply just now. Please tr…' to be 'I\'ve reached my spending limit for t…'
 ❯ src/agents/reply.test.ts:54:77
```

### Deviations from the spec
- The spec says the file imports "from `./reply` (the barrel)". The barrel re-exports `mapFailureToReply`, the reply constants, `ChatCompletionError` and `runToolLoop`, but **not** `redactError`, so test 2 imports `redactError` from `./tool-exec` directly (the same import every other consumer in `agents/` uses). Adding it to the barrel would be a source change, which the spec forbids. This is the only deviation.

### Open questions / blocked
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 follow-up.**
- **The tests:** 4 crucial tests in `apps/server/src/agents/reply.test.ts`, 183 lines:
  - `mapFailureToReply`;
  - `redactError`;
  - the tool loop stops at `TOOL_TURN_MAX_CALLS`;
  - a secret thrown by a tool never reaches a later model request or the log.

  Each runs in under 50 ms.
- **Each test catches its broken rule:** the worker broke the cap, the redaction and the mapping in turn, every time the matching test failed, and the source was reverted after each run.
- **The deviation is accepted:** `redactError` is imported from `./tool-exec`, because the barrel does not re-export it.
- **Check:** the gate passed.
