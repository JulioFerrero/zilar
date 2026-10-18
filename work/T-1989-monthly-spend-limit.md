---
id: T-1989
title: "Money bug: an AI's monthly spending limit is only a warning — enforce it like the daily limit (skip the turn and each tool round, one fixed notice), with tests"
status: merged
milestone: M5
branch: task/T-1989-monthly-spend-limit
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-1989: Enforce the monthly spending limit

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1985) found that an owner's monthly limit on an AI never stops it.
- **What happens today:** only the daily limit skips a turn. Once 30-day spend passes the monthly limit, even the 80% heads-up stops, and the AI keeps spending.
- **The product rule:** owner limits apply per day and per month (`docs/PROJECT_PLAN.md:620`, "Owner hard limits").

This is money, so tests are required.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **`ais/usage.ts` (107 lines).**
  - `AiUsage` (`:11-20`) has `windowUsd`, `perMonthUsd` and `dailyLimitReached`, but no monthly flag.
  - `getAiUsage` sets `dailyLimitReached = perDayUsd !== null && todayUsd >= perDayUsd` (`:78`).
  - `monthlyWarning` comes from `monthlyWarns` (`:103-107`), which is true only while spend is under the cap.
- **`agents/gateway/budget.ts` (359 lines).** `createBudgetGate` checks only `dailyLimitReached`:
  - in the turn gate at `:166-191`, which sends one notice per AI per chat per UTC day through `dailyLimitNotices` and `dailyLimitReply`;
  - in the warnings at `:206`;
  - in the per-round gate `checkDmRoundGate` at `:284-287`.
  - When the usage read fails it fails closed with `dailyLimitReply` (`:146-163`, `:272-281`).
- **The notice texts** are in `agents/dm-turn.ts:24-37`: `dailyLimitReply`, `dailyWarningReply` and `monthlyWarningReply`.
- **Tests** exist in `ais/usage.test.ts` and `agents/gateway/budget.test.ts`.

### Steps
1. **Add the monthly flag.** In `ais/usage.ts`, add `monthlyLimitReached: boolean` to `AiUsage`, set to `perMonthUsd !== null && windowUsd >= perMonthUsd`. When it is true, set `monthlyWarning` to `false`.
2. **Add the monthly notice.** In `agents/dm-turn.ts`, add `monthlyLimitReply(perMonthUsd)` with this fixed text: `I've reached my spending limit for this period ($X.XX). My owner can raise it in My AIs.`
3. **Enforce it in `budget.ts`.** Every place that checks `dailyLimitReached` now treats the AI as limited when `dailyLimitReached || monthlyLimitReached`, in the turn gate, the warnings skip and `checkDmRoundGate`.
   - **The notice says which limit was hit:** the monthly one wins when both are reached.
   - **Keep the one-notice-per-AI-per-chat-per-UTC-day rule, shared by both limits.**
   - **The fail-closed paths keep the daily text.**
4. **Tests (money is crucial):**
   - In `ais/usage.test.ts`: a monthly cap with no daily cap, and spend at or above it, gives `monthlyLimitReached` true and no monthly warning.
   - In `agents/gateway/budget.test.ts`: the same AI is limited in the turn gate, with the monthly notice sent once, and `checkDmRoundGate` returns limited with the monthly reply.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/ais/usage.ts`
- `apps/server/src/ais/usage.test.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `apps/server/src/agents/gateway/budget.test.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/reply.ts`
- `work/T-1989-monthly-spend-limit.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/usage.test.ts src/agents/gateway/budget.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- An AI over its monthly limit gets no turn and no tool round, and sends one fixed notice per chat per day.
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did
- `ais/usage.ts`: added `monthlyLimitReached: boolean` to `AiUsage`, set to `perMonthUsd !== null && windowUsd >= perMonthUsd`; `monthlyWarning` is now false whenever the cap is reached (as well as when no cap is set).
- `agents/dm-turn.ts`: added `monthlyLimitReply(perMonthUsd)` with the fixed text `I've reached my spending limit for this period ($X.XX). My owner can raise it in My AIs.`; `agents/reply.ts` re-exports it.
- `agents/gateway/budget.ts`: a new `limitReachedReply(usage)` helper picks the monthly text when `monthlyLimitReached` is true (so monthly wins over daily when both are reached) and the daily text otherwise. The turn gate, the `sendBudgetWarnings` skip and `checkDmRoundGate` all treat the AI as limited when either flag is set. Both limits keep sharing `dailyLimitNotices`, so it is still one notice per AI per chat per UTC day. The fail-closed usage-read paths are unchanged and still send `dailyLimitReply`.
- Tests: updated the two `getAiUsage` equality assertions for the new field and added a monthly-cap test (no daily cap, spend at the cap and over it → `monthlyLimitReached` true, `monthlyWarning` false). In `budget.test.ts`, the `getAiUsage` mock now returns a controllable `AiUsage`; added a test where a monthly-limited AI is skipped by the turn gate, sends exactly one monthly notice across two turns, and gets the monthly reply from `checkDmRoundGate`; added a test that the monthly text wins when both limits are reached.

Files changed (all inside Allowed files):
- `apps/server/src/ais/usage.ts`
- `apps/server/src/ais/usage.test.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `apps/server/src/agents/gateway/budget.test.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/reply.ts`
- `work/T-1989-monthly-spend-limit.md`

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage.test.ts src/agents/gateway/budget.test.ts`: 2 test files passed, 17 tests passed.
- `pnpm gate` (first run): `FAIL format` on `apps/server/src/agents/gateway/budget.ts`; scope, migration, images and size checks passed. Fixed with `pnpm exec prettier --write apps/server/src/agents/gateway/budget.ts` (that file only).
- `pnpm gate` (second run): `GATE PASS`. Summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (7.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No deviations from the spec. The monthly window is the existing 30-day `windowUsd`, as the spec states.
- `checkDmRoundGate` does not send a notice itself (it only returns the reply); the once-per-day notice behaviour is enforced in the turn gate, unchanged from the daily-limit design.
- All changed files are at or under 400 lines (largest: `budget.test.ts`, 194 lines).

## Review (written by Claude)

Approved.
- **The monthly flag.** `monthlyLimitReached` is set when 30-day spend reaches the cap. The turn gate, the warning skip and the per-round gate all treat it like the daily flag.
- **Notices.** The monthly notice wins when both limits are reached, and the once-per-chat-per-day rule is shared by both. The monthly heads-up stops once the cap is reached.
- **Tests and pre-review.** The tests cover a monthly cap with no daily cap, at the usage, turn-gate and round-gate levels. The pre-review is clean.
