---
id: T-0516
title: "Agents G2: move the budget gate (daily-limit check, 80% warnings, notice maps, utcDay, checkDmRoundGate) out of createAgentGateway into agents/gateway/budget.ts; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0516-agents-g2-extract-budget
model: auto
effort: low
depends_on: [T-0512]
estimate: 0.5 day
---

# T-0516: agents G2, extract the budget gate

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G2". T-0512 (G1, merged) moved the contracts and DB lookups into `agents/gateway/`. G2 moves the budget logic. **It is a pure extraction: no logic change and no Effect.** G3 (memory) runs in parallel in another region of the same file.

### Verified facts (do not re-derive; G1 moved the lines, so find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`)
- **The state:** three in-memory maps, `dailyLimitNotices`, `dailyWarningNotices` and `monthlyWarningNotices` (`new Map<string, string>()`, "once per UTC day", lost on restart).
- **`function utcDay()`** returns `(deps.now ?? (() => new Date()))().toISOString().slice(0, 10)`.
- **`async function checkDailyLimit(input)`:** the soft pre-turn check (T-0058). A null usage fails open; a reached limit sends the fixed notice once per AI per chat per UTC day and skips the turn; it returns the fetched usage.
- **`async function sendBudgetWarnings(input)`:** the 80% heads-ups after the reply.
- **`async function checkDmRoundGate(session)`:**
  - returns `{ limited: true, reply: 'The AI was stopped.' }` when `!sessionIsLive(session)`;
  - returns null without `deps.litellm`;
  - calls `getAiUsage(...)`; a throw gives null; otherwise `dailyLimitReply(usage.perDayUsd)` when the daily limit is reached.
- **What they close over:** `deps` (`db`, `litellm`, `now`), `logger`, `sessionIsLive`, and the send helpers they use for notices. Read each body to list them exactly.
- **The pinning tests** (in `apps/server/src/agents/gateway.test.ts`; find them by name): "runs a normal turn under the limit", "fails open when the spend lookup fails", "sends one notice per DM per day…", "sends the reply first, then one daily warning…", "warns again on the next UTC day", "sends both warnings once each…", "enforces the daily limit in rooms…", "warns in the room after the reply…".

### What to build
1. **Create `apps/server/src/agents/gateway/budget.ts`** exporting `createBudgetGate(ctx)`. `ctx` is exactly what the moved functions close over (deps, logger, `sessionIsLive`, the notice-sending callbacks). It returns `{ utcDay, checkDailyLimit, sendBudgetWarnings, checkDmRoundGate }`, and **the three maps live inside the gate**, one gate per gateway, as today.
2. **In `createAgentGateway`,** create the gate once, where the maps were declared, and replace the moved functions with the gate's methods. **Every call site keeps the same argument order and awaiting.**
3. **Move the bodies verbatim:** no logic edits and no renames of the moved functions. If a callback must be injected to avoid an import cycle, inject it; say so in the Report.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §1.9, §2 and §3 "G2", `apps/server/src/agents/gateway.ts` (the four functions, the maps and every call site), `apps/server/src/agents/gateway/contracts.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/budget.ts`, `work/T-0516-agents-g2-extract-budget.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The budget logic and its notice state live in `agents/gateway/budget.ts`, moved verbatim, with `gateway.ts` using one gate instance.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
