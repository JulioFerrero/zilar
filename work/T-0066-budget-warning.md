---
id: T-0066
title: AI budget warning at 80% (daily and 30-day window) — one fixed notice per chat, sent with the turn that crossed it
status: review
milestone: M2
branch: task/T-0066-budget-warning
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0058, T-0061]
estimate: 1 day
---

# T-0066: Budget warning at 80%

## Spec (written by Claude, do not edit)

### Goal

`docs/PROJECT_PLAN.md` §8.4: "A warning in the room at 80%, and the AI stops at 100%." T-0058 built the stop for the daily limit (a fixed notice at 100%), and LiteLLM stops the AI at the monthly cap. There is no warning before either. An owner finds out only when the AI goes silent. Add a single, honest heads-up when an AI's spend crosses 80% of its daily limit or of its 30-day limit.

It runs after T-0061 because both tasks edit `apps/server/src/agents/gateway.ts`.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0058-ai-costs.md` (the whole design: baselines, soft limit, fail-open, notice-once-per-chat-per-UTC-day)
- `apps/server/src/agents/gateway.ts` (`checkDailyLimit`, `dailyLimitNotices`, its two call sites for DM and group turns), `reply.ts` (`dailyLimitReply`, `BUDGET_EXCEEDED_REPLY`, the fixed replies)
- `apps/server/src/ais/usage.ts` (`getAiUsage`, `AiUsage`)

### Allowed files
- `apps/server/src/ais/usage.ts`, `usage.test.ts`
- `apps/server/src/agents/gateway.ts`, `reply.ts`, `gateway.test.ts`, `reply.test.ts`
- `work/T-0066-budget-warning.md`

**Not allowed:** schema or migrations (keep the "already warned" state in memory, like T-0058's notices), web, mobile, `packages/**`, `docs/**`. No new dependencies.

### What to build

1. **`usage.ts`:** extend `AiUsage` with `dailyWarning: boolean` (`perDayUsd > 0 && todayUsd >= 0.8 * perDayUsd && !dailyLimitReached`) and `monthlyWarning: boolean` (`perMonthUsd > 0 && windowUsd >= 0.8 * perMonthUsd && windowUsd < perMonthUsd`). Keep the existing fields and their behavior unchanged. Compare with cents-safe arithmetic (no float surprises at exactly 80%: 1.60 of 2.00 must warn).
2. **`reply.ts`:** two fixed notices, as functions of the formatted numbers:
   - `dailyWarningReply(todayUsd, perDayUsd)`: `Heads up: I've used $1.62 of my $2.00 daily limit. I'll pause for the day when it runs out.`
   - `monthlyWarningReply(windowUsd, perMonthUsd)`: `Heads up: I've used $16.30 of my $20.00 limit for this period. You can raise it in My AIs.`
3. **Gateway:** the check that already runs before every turn (`checkDailyLimit`) also decides the warning, but **does not skip the turn**: the model call goes ahead, and the warning is sent **after the AI's reply** for that turn (so the owner reads the answer first, then the heads-up).
   - At most one warning per kind, per AI, per chat, per UTC day (in memory, like the daily notices: a restart may repeat it once). Daily and monthly warnings are independent.
   - If the limit is already reached (100%), no warning: the existing notice path applies.
   - A failed warning send only logs (ids only, never the key, never spend amounts beyond what the notice text already says) and never fails the turn.
   - In groups the warning goes to the group, in DMs to the DM, with the same routing the existing notices use. A group warning is sent only when the turn was triggered by a human message the AI actually answered (never for a skipped or rate-limited turn).
   - Usage `null` (LiteLLM down) → no warning, fail open, as today.

### Tests (Vitest, no network; LiteLLM faked as in the existing tests)
- `usage.ts`: exactly 80% warns; 79.99% doesn't; over 100% has no warning and `dailyLimitReached` true; a zero limit never warns; the monthly flags likewise.
- Gateway: crossing 80% → the reply first, then one warning; a second turn the same day → no second warning; the next UTC day (injected clock) → a warning again; daily and monthly both crossed → two different warnings, once each; 100% → the existing notice and no warning; usage null → no warning; a failing warning send doesn't break the turn or the next one; groups and DMs.
- The order of the two messages is asserted (reply, then warning).

### Live check (the lead does it)
Not needed from you. Say in the Report that the live proof is still open.

### Acceptance criteria
- [ ] One warning per kind per chat per UTC day, after the reply.
- [ ] No behavior change at or above 100%, or when usage is unavailable.
- [ ] Nothing new is logged that includes amounts, keys or message text.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- A UI for warnings, per-room budgets, email or push alerts.
- Changing how the 100% stop or LiteLLM's cap works.

---

## Report (written by the worker when done)

### What I did
- `usage.ts`: added `dailyWarning` and `monthlyWarning` to `AiUsage` with cents-safe integer comparison (`todayCents * 5 >= perDayCents * 4`, `windowCents * 5 >= perMonthCents * 4 && windowCents < perMonthCents`). Exactly 80% warns, just-below doesn't, over-100% has no warning, zero caps never warn. Existing fields unchanged.
- `reply.ts`: added `dailyWarningReply(todayUsd, perDayUsd)` and `monthlyWarningReply(windowUsd, perMonthUsd)` with the exact spec texts.
- `gateway.ts`: `checkDailyLimit` now returns `{ limited, usage }` from its single pre-turn read; after the reply (`runDmTurn`/`runGroupTurn`) `sendBudgetWarnings` sends daily then monthly warnings to the same chat (DM or plain group message), at most one per kind per AI per chat per UTC day in memory. At 100% or usage-null nothing extra is sent; a failed warning send only logs ids and never fails the turn. Group warnings only happen when the turn ran (early returns for skipped/rate-limited turns send nothing).
- Tests: extended `usage.test.ts` (exact-80% daily/monthly, just-below, over-cap, zero caps), `reply.test.ts` (exact strings), `gateway.test.ts` (DM: reply-then-warning order, once-per-day, next-UTC-day re-warn, both-warnings-once, 100% notice-only, null-usage silent, failing-warning-send recovery; groups: reply-then-warning in room, once-per-day, no warning for non-mention skipped turns).
- Live proof is still open (per spec, the lead does it).

### Files changed
- `apps/server/src/ais/usage.ts`
- `apps/server/src/ais/usage.test.ts` (updated 4 old `toEqual` for the 2 new fields + 5 new tests)
- `apps/server/src/agents/reply.ts`
- `apps/server/src/agents/reply.test.ts` (2 new tests)
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway.test.ts` (6 new DM tests + 1 new group test)

### Commands run and real results
- `pnpm install`: ok.
- `pnpm format:check`: my files pass after prettier; 1 remaining warn in `packages/xmpp-core/src/integration-edits.test.ts` (outside Allowed files, untouched, pre-existing).
- `pnpm lint` (oxlint): pass, no warnings.
- `pnpm --filter @galena/server exec tsc --noEmit`: pass (exit 0). Repo-wide `pnpm typecheck` fails in `packages/xmpp-core` (`integration-edits.test.ts` node types + `apps/server/src/xmpp/admin-client.ts` node types via that package's tsconfig) — pre-existing, outside Allowed files, untouched by me.
- `pnpm exec turbo test --force --filter=@galena/server`: 38 files passed / 5 skipped files, 508 tests passed / 7 skipped (was 492 passed before my 16 new tests).
- `pnpm build`: pass (2 tasks).
- `grep any/ts-ignore` on changed source: no `any`, no `@ts-ignore` (only the word "anywhere" in a comment).

### Problems, deviations from the spec, open questions
- Pre-existing repo failures outside my scope (see above): `format:check` and repo-wide `typecheck` both fail only on `packages/xmpp-core/src/integration-edits.test.ts`, which I did not touch (not in Allowed files). All server-scoped checks pass.
- Warning decision uses the pre-turn usage read (no second LiteLLM call), as the spec directs ("the check that already runs before every turn also decides the warning").
- Warning order when both cross: daily first, then monthly. DM outer-catch failure texts (e.g. missing virtual key) do not trigger warnings since the warning send lives inside the `try` after `runDmTurn`; group outer-catch failure texts likewise skip warnings. Normal `runDmTurn`/`runGroupTurn` failure replies (which are sent messages) are followed by warnings when the flags say so.
- No new dependencies. No amounts, keys, or message text in new log lines (only `{ aiId }`); test asserts the log contains no `$0.80`/`$1.00`, keys, or message text.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
