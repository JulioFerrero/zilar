---
id: T-1167
title: "AI-3/4/5: honest AI failure replies — a 429 is 'my provider is busy' (one retry first), budget only when the detail says budget, an unknown model / too-long context get their own words; replies cut by max_tokens say so and the cap goes to 4096"
status: merged
milestone: M5
branch: task/T-1167-ai-error-replies
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1167: Honest AI failure replies

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md` AI-3, AI-4 and AI-5 (all P1, confirmed).
- **AI-3:** `mapFailureToReply` (`apps/server/src/agents/tool-exec.ts:46-55`) treats every 429 as the budget. Providers and LiteLLM send 429 for rate limits, so the owner reads "I've reached my spending limit… raise it in My AIs" (`apps/server/src/agents/tool-loop.ts:22-23`) and raises a limit that was never the problem. `requestCompletion` (`tool-loop.ts:318-342`) makes one attempt only.
- **AI-4:** every other status maps to `TRANSIENT_FAILURE_REPLY` ("try again in a minute", `tool-loop.ts:26`). That includes a 400 or 404 for an unknown model, a context that's too long, and a content filter, so a typo in the model name gives an AI that says "try again" forever. `errorDetail` (`tool-loop.ts:141-163`) keeps `error.message`. LiteLLM's hard cap may be a 400 whose message reads "Budget has been exceeded", which `/budget_exceeded/` misses.
- **AI-5:**
  - the cap is a fixed `REPLY_MAX_TOKENS = 1024` (`tool-loop.ts:17`, sent at `:221`);
  - the stream parser ignores `finish_reason` (`apps/server/src/agents/stream.ts:28-31`, choices at `:92`);
  - so a reply cut by the cap arrives mid-sentence, as if complete.
- **File sizes:** `tool-loop.ts` is 387 lines and `tool-exec.ts` 376. The reply texts are re-exported by the barrel `apps/server/src/agents/reply.ts:15-29` and used by `apps/server/src/agents/dm-tool-turn.ts:10,126,147`.

### What to build
1. **Move the reply texts** (`tool-loop.ts:16-26`: `BUDGET_EXCEEDED_REPLY`, `PROVIDER_KEY_REJECTED_REPLY`, `TRANSIENT_FAILURE_REPLY`) into a new `apps/server/src/agents/replies.ts`, and add:
   - `RATE_LIMITED_REPLY = "My provider is busy right now. Please try again in a minute."`;
   - `MODEL_NOT_FOUND_REPLY = "My model name isn't recognised by the provider. The owner can change it in My AIs."`;
   - `CONTEXT_TOO_LONG_REPLY = "This conversation is too long for my model. Start a new topic or ask me something shorter."`;
   - `CUT_SHORT_SUFFIX = "\n\n(cut short; ask me to continue)"`.

   Keep the old names exported from `tool-loop.ts` (re-export), so `reply.ts` and `dm-tool-turn.ts` don't change.
2. **`mapFailureToReply` (`tool-exec.ts`),** in this order:
   1. `/budget/i` in the detail → budget;
   2. 401 or 403 → key;
   3. 429 → rate limited;
   4. 400 or 404 with `/model/i` in the detail → model not found;
   5. `/context|too long|maximum context|token limit/i` → context too long;
   6. anything else → transient.
3. **One retry in `requestCompletion`:** one retry after 2 s for 429, 5xx or status 0 (unreachable or timeout), **only when `onDelta` has not fired yet** (nothing was streamed). Keep the total within the existing timeout logic.
4. **AI-5:**
   - `stream.ts` keeps the last non-null `choices[].finish_reason`, and `ChatCompletionResult` gets `finishReason?: string`;
   - raise `REPLY_MAX_TOKENS` to 4096;
   - where the DM and group turns send the final content (`dm-tool-turn.ts:147` and the matching group site; find it, and cite it in the Report), append `CUT_SHORT_SUFFIX` when `finishReason === 'length'`.
   - If that site is outside the Allowed files, say so and stop at the result field.
5. **Tests** (money: budget messages), in `apps/server/src/agents/reply.test.ts`:
   - extend the existing `mapFailureToReply` table (`:52-68`) with a 429 rate limit, a 400 "Budget has been exceeded", a 404 "model not found" and a 400 "maximum context length";
   - one retry test: a 429, then a 200, gives the content, with exactly 2 fetches.

   Two tests at most.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (AI-3, AI-4, AI-5), `apps/server/src/agents/tool-exec.ts:30-60`, `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/stream.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.test.ts:1-70` and `apps/server/src/agents/dm-tool-turn.ts:100-160`.

### Allowed files
`apps/server/src/agents/replies.ts`, `apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/stream.ts`, `apps/server/src/agents/dm-tool-turn.ts`, `apps/server/src/agents/group-turn.ts`, `apps/server/src/agents/reply.test.ts`, `work/T-1167-ai-error-replies.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/reply.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did

**AI-3 / AI-4 — honest failure replies.**
- New `apps/server/src/agents/replies.ts` holds the fixed texts: the three old ones
  (`BUDGET_EXCEEDED_REPLY`, `PROVIDER_KEY_REJECTED_REPLY`, `TRANSIENT_FAILURE_REPLY`) plus
  `RATE_LIMITED_REPLY`, `MODEL_NOT_FOUND_REPLY`, `CONTEXT_TOO_LONG_REPLY`, `CUT_SHORT_SUFFIX`
  and a small `cutShortSuffix(finishReason)` helper.
- `tool-loop.ts` re-exports the texts with `export * from './replies'`, so the `reply.ts`
  barrel and `dm-tool-turn.ts` keep importing the old names unchanged (`reply.ts` was not
  touched).
- `tool-exec.ts` `mapFailureToReply` now decides in the spec's order: `/budget/i` → budget;
  401/403 → key; 429 → rate limited; 400/404 with `/model/i` → model not found;
  `/context|too long|maximum context|token limit/i` → context too long; else transient.
  It imports the texts straight from `./replies`.
- `requestCompletion` retries once (2 s) for 429, 5xx and an unreachable gateway, and only
  while nothing was streamed. The retry sits **inside** `timeoutOrElse`, so the whole call
  still fits in the existing `timeoutMs` (see "Deviations").

**AI-5 — cut-short replies.**
- `stream.ts` now keeps the last non-null `choices[].finish_reason` and returns it as
  `ChatStreamResult.finishReason`.
- `ChatCompletionResult` gained `finishReason?: string`; `REPLY_MAX_TOKENS` went 1024 → 4096.
- `CUT_SHORT_SUFFIX` is appended when `finishReason === 'length'` at these sites:
  - `apps/server/src/agents/dm-tool-turn.ts` — `runToolLoop`, both content returns
    (the shared loop used by **both** the DM and the group tool turn): current line 136
    (text answer) and line 151 (tool-free last call).
  - `apps/server/src/agents/dm-tool-turn.ts:326` — `runToolTurn` closing call (DM).
  - `apps/server/src/agents/group-turn.ts:329` — `runGroupToolTurn` closing call. **This is
    the matching group site the spec asked me to find.**

**Tests** (`apps/server/src/agents/reply.test.ts`, two tests at most as asked):
- extended the `mapFailureToReply` table with 429 rate limit, 400 "Budget has been exceeded",
  404 "model not found" and 400 "maximum context length" (the old 429 → budget expectation
  was replaced by 429 → rate limited);
- added one retry test: a 429 followed by a 200 returns the content with exactly 2 fetches.

### Files changed
- `apps/server/src/agents/replies.ts` (new, 22 lines)
- `apps/server/src/agents/tool-exec.ts` (392)
- `apps/server/src/agents/tool-loop.ts` (397)
- `apps/server/src/agents/stream.ts` (191)
- `apps/server/src/agents/dm-tool-turn.ts` (389)
- `apps/server/src/agents/group-turn.ts` (373)
- `apps/server/src/agents/reply.test.ts` (221)
- `work/T-1167-ai-error-replies.md`

Every touched file is ≤ 400 lines (largest: `tool-loop.ts` 397).

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts`
  → `Test Files 1 passed (1)`, `Tests 5 passed (5)` (ran twice, same result).
- `pnpm gate` (final run, from the repo root):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (5.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed on `format` (two files) and the second on `typecheck` (the retry
  test's `requestCompletion` call was missing `messages`); both were fixed and the gate above
  is the green run.

### Deviations from the spec / things to know
- **Retry vs timeout.** The spec lists "status 0 (unreachable **or timeout**)" as retryable,
  but also says "keep the total within the existing timeout logic". Those pull opposite ways,
  so I put `Effect.retry` *inside* `Effect.timeoutOrElse`: the whole call (pause included) stays
  within `timeoutMs`, and a fetch that rejects (unreachable) is retried, while a real hang that
  exhausts `timeoutMs` is not (there is no budget left to retry into). Say the word if you'd
  rather each attempt get its own `timeoutMs` (total ≈ 2×90 s + 2 s).
- **Non-streaming JSON.** `finishReason` is only produced by `stream.ts`. The fallback path
  where a provider ignores `stream: true` and answers plain JSON leaves it undefined, so those
  replies don't get the cut-short suffix. I left it out to keep `tool-loop.ts` within 400 lines;
  LiteLLM always streams on this path today.
- **Sites not covered.** The group *plain* path (`group-turn.ts` when no tools are advertised)
  and the DM plain path (`dm-turn.ts completeChat`, not an Allowed file) do not append the
  suffix, so the two plain paths stay consistent with each other.
- **Small clean-ups in touched files** so `tool-loop.ts` fits in 400 lines: the streamed branch
  now `return streamed;` (`ChatStreamResult` and `ChatCompletionResult` have the same shape),
  and `type Effect as EffectType` was dropped in favour of the direct `Effect.fn.Return` /
  `Effect.Effect` used elsewhere in the package.

### Open questions
- None blocking. The retry/total-timeout choice above is the one judgement call worth a look.

### Round 1 (pre-review fixes)

- **Finding 1 (should-fix) — fixed.** `requestCompletion` now retries *inside* a
  per-attempt timeout: each attempt runs under whatever budget is left before the
  call's `deadline`, `CompletionTimeout` joined the `CompletionFailure` union and
  `isRetryableFailure`, and the retry only fires while `elapsed + 2 s < timeoutMs`.
  The total (pause included) therefore stays within `timeoutMs`, and a timeout is
  retryable whenever the budget leaves room for it. Files changed:
  `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/reply.test.ts`.
  Three comments in `tool-loop.ts` were trimmed so the file stays at exactly 400
  lines.
- **Test added.** `reply.test.ts` gains one test: a hung request that spends the
  whole budget is not retried (exactly one fetch) and fails with
  `the request timed out`.
- **Note on finding 1.** By construction, a request that times out *after* using
  the whole budget still has nothing left to retry with, so the finding's 90 s
  stall stays a single attempt. The two spec halves (retry a timeout AND keep the
  total within `timeoutMs`) cannot both hold for that case; this implements the
  finding's remaining-budget recipe, which was the suggested resolution.
- **Nits 2–4 not touched** (outside the changed lines / spec-dictated behaviour).
- **Commands and results.**
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts`
  → 1 file passed, 6 tests passed.
  `pnpm gate` → `PASS install/format/lint/typecheck/effect/tests @zilar/server`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 1 auto round, with 1 nit and 1 follow-up.**
- **The reply texts** moved to `replies.ts` (re-exported), and three replies were added: rate limited, model not found, and context too long.
- **`mapFailureToReply` order:** `/budget/i` (which catches LiteLLM's 400 "Budget has been exceeded"), then 401/403 key, 429 rate limited, 400/404 with `model`, context, and transient last.
- **One retry** after 2 s for 429, 5xx or status 0, only before any delta.
- **`finish_reason`** is kept, the cap is 4096, and `length` appends the cut-short suffix in the tool loop and group turns.
- **Tests:** 6 of 6 in the branch, run by the lead.
- **Sizes:** `tool-loop.ts` is at exactly 400 lines.
- **Follow-up:** the DM plain (no-tools) path needs the suffix in `gateway/dm-turn.ts`.
