---
id: T-0972
title: "Crucial tests for the AI reply pipeline: failure-to-reply mapping, secret redaction, and the tool-loop call cap (money), 4 tests in agents/reply.test.ts"
status: todo
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

## Review (written by Claude)
