---
id: T-1636
title: "Size split: ai/model-client.ts is at 397 lines — move the error mapping (ChatCompletionError and the AiError → status/detail helpers) into ai/model-errors.ts, re-exported from model-client.ts, no behaviour change"
status: merged
milestone: M5
branch: task/T-1636-split-model-client
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1636: Split ai/model-client.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/ai/model-client.ts` is at 397 lines, against a limit of 400. Every AI model call goes through it, so the next provider change would cross the limit.

### Facts (the lead read them on 2026-10-16)
- **The error block:**
  - `export class ChatCompletionError` (`:26-43`, with its comment);
  - `statusOf` (`:112`), `providerBodyMessage` (`:146`), `detailOf` (`:176`);
  - `export function chatErrorFromAiError(error, secrets)` (`:201-212`, which uses `redactSecrets`).
- **The rest stays:** the types, `callOnce` (`:239`), `isRetryable` (`:296`), `withAbort`, `modelTransport` and `export function chat` (`:344`).
- **The importers:**
  - `apps/server/src/agents/tool-loop.ts` imports `ChatCompletionError` (and `chat`, …) from `../ai/model-client`;
  - `apps/server/src/ai/model-client.test.ts:10` and `apps/server/src/ai/model-client.openai-compatible.test.ts:10` import `ChatCompletionError`, `chat` and `chatErrorFromAiError` from `./model-client`.
- **The folder `apps/server/src/ai/`** has no `model-errors.ts` yet.

### Steps
1. **Move `ChatCompletionError`, `statusOf`, `providerBodyMessage`, `detailOf` and `chatErrorFromAiError`** (with their comments, and imports only they need) into a new file `apps/server/src/ai/model-errors.ts`.
2. **In `model-client.ts`,** import what it uses and add `export { ChatCompletionError, chatErrorFromAiError } from './model-errors';`, so no importer changes.
3. **No behaviour change:** the same messages, statuses and redaction.
4. **Say in the Report** what moved and the new line counts.

### Allowed files
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/ai/model-errors.ts`
- `work/T-1636-split-model-client.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ai/model-client.test.ts src/ai/model-client.openai-compatible.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`model-client.ts` is under 320 lines.**
- **Both model-client tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did

Moved the error-map block out of `apps/server/src/ai/model-client.ts` into a new
`apps/server/src/ai/model-errors.ts`, verbatim (same comments, same logic):

- `ChatCompletionError` class (with its comment);
- `statusOf`;
- `providerBodyMessage`;
- `detailOf`;
- `chatErrorFromAiError`.

The only imports the moved code needs are `AiError` from `effect/ai` and
`redactSecrets` from `./http`; both went to `model-errors.ts`.

In `model-client.ts`:

- `redactSecrets` was dropped from the `./http` import (it is only used by the
  moved code); `type FetchLike` stays.
- Added `import { ChatCompletionError, chatErrorFromAiError } from './model-errors'`
  for its own internal uses (`withAbort`, `chat`), and
  `export { ChatCompletionError, chatErrorFromAiError } from './model-errors'`
  so no importer changes.
- `AiError` stays imported (still used by `callOnce` and the stream types).

No behaviour change: same statuses, same detail strings, same `redactSecrets`
redaction, same class shape.

Line counts: `model-client.ts` 397 → 282 lines; new `model-errors.ts` 126 lines.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/model-client.test.ts src/ai/model-client.openai-compatible.test.ts`
  → 2 test files passed, 15 tests passed.
- `pnpm gate` (from repo root):
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`,
    `PASS  effect`, `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- Acceptance met: `model-client.ts` is 282 lines (limit 320); both model-client
  tests pass unchanged.
- The three changed files are the two source files and this task file.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, a verbatim move.
- **The split:** `model-client.ts` went from 397 to 282 lines, and the new `model-errors.ts` is 126. `ChatCompletionError` and `chatErrorFromAiError` are re-exported.
- **The tests:** the lead ran both model-client tests: 15 passed.
