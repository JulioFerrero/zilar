---
id: T-0516
title: "Agents G2: move the budget gate (daily-limit check, 80% warnings, notice maps, utcDay, checkDmRoundGate) out of createAgentGateway into agents/gateway/budget.ts; zero behaviour change"
status: merged
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

### What I did
- Created `apps/server/src/agents/gateway/budget.ts` with `createBudgetGate(ctx)`:
  - `ctx` = `{ deps, logger, sessionIsLive, secretsFor }`.
  - Returns `{ utcDay, checkDailyLimit, sendBudgetWarnings, checkDmRoundGate }`.
  - The three notice maps (`dailyLimitNotices`, `dailyWarningNotices`, `monthlyWarningNotices`) live inside the gate, so there is one gate instance per gateway, as before.
- In `createAgentGateway`, the gate is created once where the maps were declared:
  `const budgetGate = createBudgetGate({ deps, logger, sessionIsLive, secretsFor });`
  (`sessionIsLive` and `secretsFor` are function declarations, so they are hoisted and the create site may precede them textually.)
- Replaced every call site with the gate method, same argument order and awaiting:
  - `await budgetGate.checkDailyLimit({...})` — 2 sites (group turn, DM turn)
  - `await budgetGate.sendBudgetWarnings({...})` — 2 sites
  - `checkRoundGate: () => budgetGate.checkDmRoundGate(session)` — 2 sites
  - `if ((await budgetGate.checkDmRoundGate(session)) !== null)` in `startCompaction` — 1 site
- Removed now-unused imports from `gateway.ts`: `getAiUsage`, `type AiUsage`, `dailyLimitReply`, `dailyWarningReply`, `monthlyWarningReply`. Added the `createBudgetGate` import.

### Injected callbacks (spec point 3)
The moved bodies call `secretsFor()` (a gateway-local helper over `deps.masterKeyForRedaction`) and `sessionIsLive` (a gateway-local function over the `sessions` map). To keep the bodies verbatim I injected both through `ctx`. There is no import cycle; injecting them avoids reimplementing gateway-local closures or exporting the `sessions` map. The notice senders are not closures: they already arrive per call as `input.sendNotice` / `input.sendWarning`, so those are unchanged.

### Files changed
- `apps/server/src/agents/gateway.ts` (budget logic moved out; single gate instance; call sites updated)
- `apps/server/src/agents/gateway/budget.ts` (new)
- `work/T-0516-agents-g2-extract-budget.md` (status + this Report)

### Commands run and real results
- `pnpm install`: done (packages already present, no changes).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway.test.ts`: 1 file passed, 168 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents`: 16 files passed, 1 skipped; 430 tests passed, 1 skipped (all `apps/server/src/agents/**/*.test.ts`, unchanged).
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.8s)
  PASS  format  (43.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (19.7s)
  PASS  tests @zilar/server  (84.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations / open questions
- None. Pure extraction: no logic edited, no function renamed, tests untouched. No blocked item.

## Review (written by Claude)

Approved (lead, 2026-10-08). G2 is a pure extraction: utcDay, checkDailyLimit, sendBudgetWarnings, checkDmRoundGate and the three notice maps moved verbatim into agents/gateway/budget.ts (createBudgetGate), with one gate per gateway. The agents tests are unchanged. Pre-review clean.
