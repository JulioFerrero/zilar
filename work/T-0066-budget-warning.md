---
id: T-0066
title: AI budget warning at 80% (daily and 30-day window) — one fixed notice per chat, sent with the turn that crossed it
status: planned
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
