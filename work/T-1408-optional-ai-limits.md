---
id: T-1408
title: "P0 task 4: AI spending limits are optional (no default): limits nullable end to end (DB, contract, validation, wizard and AI settings on web and mobile); the budget check and warnings only run when the owner set a limit; usage shows spend without 'of $x' when there is none"
status: merged
milestone: M5
branch: task/T-1408-optional-ai-limits
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1408: Optional AI spending limits

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: **no default daily budget**. Spend is counted and shown per AI (T-1405, merged), and the owner *can* set a limit (`docs/design/agent-system.md` §7 decision 4). Today limits are required everywhere, and the wizard pre-fills $1/day and $10/month.

This is **Task 4** of `docs/audit/effect-ai-plan.md` (read §5.4).

### Facts (the lead checked them on main, 2026-10-14)
- **DB:** `ai_limits.per_day_usd` and `per_month_usd` are `numeric(12,2) NOT NULL` (`apps/server/drizzle/0005_clean_frightful_four.sql:3-4`). The latest migration is `0055_ai_usage.sql`.
- **Contract:** `AiLimits { perDayUsd: Number, perMonthUsd: Number }` at `packages/api-contract/src/ais.ts:91-94`.
- **Validation and defaults:**
  - `validateLimits` (`packages/chat-core/src/ai-limits.ts:17-44`) requires both values and caps the month at `MAX_MONTHLY_USD`;
  - the defaults are `DEFAULT_DAILY_USD = 1` and `DEFAULT_MONTHLY_USD = 10` (`packages/chat-core/src/ai-form.ts:10-11`), used by `apps/web/src/components/ais/NewAiDialog.tsx:108-109` and `apps/web/src/components/ais/aiForm.ts:8-9`.
  - Mobile builds the body via `apps/mobile/src/components/ais/form.ts:10` with `limits-fields.tsx` and `limits.ts`.
- **Server:**
  - provisioning inserts and updates `ai_limits` (`apps/server/src/ais/provisioning.ts:76-77,190`);
  - `getAiUsage` (`apps/server/src/ais/usage.ts`) computes `dailyLimitReached`, `dailyWarning` and `monthlyWarning` from the limits;
  - the budget gate is `apps/server/src/agents/gateway/budget.ts` (271 lines): the limit check at `:95` and `:196`, the warnings at `:125-170`.
- **UI:** the web usage block shows "Today $x of $y" (`apps/web/src/components/ais/AiUsageSection.tsx:52-62`); the AI panel limits are in `AiPanel.tsx:68` and `LimitsFields.tsx`.

### What to build
1. **Migration `apps/server/drizzle/0056_optional_ai_limits.sql`** (starts with `SET lock_timeout = '5s';--> statement-breakpoint`): `ALTER COLUMN … DROP NOT NULL` on both columns. Existing rows keep their values. Update `apps/server/src/db/rows.ts`.
2. **Contract:** `perDayUsd` and `perMonthUsd` become `Schema.NullOr(Schema.Number)`; `null` means no limit. Accept an absent `limits` on create as "no limits". Keep older clients working: a number still works.
3. **Validation** (`chat-core`): an empty field means no limit. When a value is set, keep the existing rules (greater than 0; day at most month when both are set; month at most `MAX_MONTHLY_USD`). Drop `DEFAULT_DAILY_USD` and `DEFAULT_MONTHLY_USD`, so new AIs start with both empty.
4. **Server:**
   - provisioning stores `NULL` for an unset limit;
   - `getAiUsage`: with no daily limit, `dailyLimitReached` and `dailyWarning` are false; with no monthly limit, `monthlyWarning` is false;
   - the budget gate then skips the turn only when a set limit is reached.
5. **Web and mobile (parity):**
   - the wizard and the AI settings show the two limit fields **empty**, with the placeholder "No limit" and a one-line hint "Optional. Leave empty for no limit.";
   - the usage block shows "Today $x" / "30 days $y" with no meter when there's no limit, and "of $limit" with a meter when there is;
   - fix the help text that mentions LiteLLM lag ("updates within a minute or two") to say spend updates after each reply;
   - **the mock backend** (`packages/mock-backend/src/domains/ais/`) has one AI with limits and one without.
6. **Out of scope:** dropping `llm_virtual_keys` and the env (a later task).

### Tests (money: required, few)
- Extend `apps/server/src/ais/usage.test.ts`: null limits → no flags; a set daily limit reached → `dailyLimitReached`; a set monthly limit at 80% → `monthlyWarning`.
- Extend the `validateLimits` test in `packages/chat-core` (find it): empty means null; day greater than month is still an error when both are set.
- **No UI tests.**

### Read first
`AGENTS.md`, `docs/audit/effect-ai-plan.md` §5.4, and the files above.

### Allowed files
`apps/server/drizzle/0056_optional_ai_limits.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/ais/*.ts`, `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/replies.ts`, `packages/api-contract/src/ais.ts`, `packages/chat-core/src/*.ts`, `packages/mock-backend/src/domains/ais/*.ts`, `apps/web/src/components/ais/*.tsx`, `apps/web/src/components/ais/*.ts`, `apps/web/src/lib/api/*.ts`, `apps/web/src/routes/AisPage.tsx`, `apps/mobile/src/components/ais/*.tsx`, `apps/mobile/src/components/ais/*.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/app/ais/[id].tsx`, `work/T-1408-optional-ai-limits.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/usage.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; files stay at most 400 lines.
- The lead sees empty "No limit" fields in the wizard at web `?mock=1` and on the emulator, and the usage block without a meter for the no-limit mock AI.

---

## Report (written by the worker when done)

### What I did
AI spending limits are optional end to end; `null` (or an absent `limits` on
create) means "no limit" and the budget check/warnings only fire for a set bound.

- **Migration** `apps/server/drizzle/0056_optional_ai_limits.sql`: `DROP NOT
  NULL` on `ai_limits.per_day_usd` and `per_month_usd` (existing rows keep their
  values). `apps/server/src/db/rows.ts` needed no change (it has no `ai_limits` row type).
- **Contract** `packages/api-contract/src/ais.ts`: `AiLimits` fields are
  `Schema.NullOr(Schema.Number)`; `AiLimitsPayload` accepts a `null`/positive
  bound (day ≤ month and the month cap only apply to set bounds); `CreateAiPayload.limits`
  is optional (absent = no limits).
- **chat-core**: `AiLimitsUsd` fields are `number | null`; `validateLimits` treats
  an empty field as no limit (invalid text still errors); `DEFAULT_DAILY_USD` /
  `DEFAULT_MONTHLY_USD` removed; `formatLimit(null)` renders "No limit".
- **Server**: `persona.AiLimits` nullable; `provisioning` stores `NULL` for an
  unset bound (`usd()` returns `string | null`); `queries.toPublicAi` maps a
  `NULL` column to `null`; `getAiUsage` answers `null` bounds with
  `dailyLimitReached`/`dailyWarning`/`monthlyWarning` false; `api.ts` create
  defaults an absent `limits` to both-null. In `gateway/budget.ts` I also removed
  the `deps.litellm === undefined` early-returns (audit plan §5.4: Task 4 reworks
  budgets so the check reads `ai_usage` directly), so the gate now skips a turn
  only when a set bound is reached and a usage-read failure still fails open.
- **Web**: wizard and panel limit fields start empty with placeholder "No limit"
  and the hint "Optional. Leave empty for no limit."; the usage block shows
  "Today $x" / "30 days $y" with no meter for an unset bound and "of $limit" with
  a meter for a set one; the lag help text now says "Spend updates after each
  reply."
- **Mobile**: same empty/placeholder/hint fields; list row and review step use a
  new `formatLimits` helper ("No limit" when neither bound is set).
- **Mock backend**: Dev-1 has `null` limits **and** real usage (so the no-limit
  usage block renders); QA-1 and Marketing AI keep limits. `readAiLimits` maps a
  missing/non-numeric bound to `null`.

### Files changed
Allowed: migration `0056`, `apps/server/src/db/rows.ts` (unchanged), `apps/server/src/ais/*`
(`api.ts`, `persona.ts`, `provisioning.ts`, `queries.ts`, `usage.ts`, `usage.test.ts`),
`apps/server/src/agents/gateway/budget.ts`, `packages/api-contract/src/ais.ts`,
`packages/chat-core/src/{ai-form,ai-limits,ai-limits.test}.ts`,
`packages/mock-backend/src/domains/ais/seed.ts`, the `apps/web/src/components/ais/*`
files, and the `apps/mobile/src/{components/ais/*,app/ais/*}` files.

### Commands run and real results
- `pnpm install` — done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage.test.ts`
  — **10 passed** (1 file).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/ai-limits.test.ts`
  — **5 passed** (1 file).
- `pnpm gate` (from the repo root):
  ```
  gate: 26 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.7s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.0s)
  PASS  tests @zilar/mobile  (1.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (5.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: 1 file(s) outside the Allowed files:
    apps/mobile/src/lib/ais-api.ts
  migration: every added migration continues from the base
  GATE PASS
  ```
  (The first gate run failed on format; I ran `prettier --write` on the five files
  it named, then re-ran to the pass above.)

### Deviations / needs a decision
- **`apps/mobile/src/lib/ais-api.ts` is outside the Allowed files, but I had to
  edit it.** The contract's `AiLimits` fields are now `number | null`, and this
  file declares mobile's own `AiLimits`/`PublicAi` and maps the wire shape onto
  them (`toPublicAi`). With a non-null local type it no longer typechecks, so
  the mobile package cannot build. The change is two words wide (`number` →
  `number | null`); everything else in the file is untouched. This is the one
  line the gate lists under scope. Same pattern as T-0095's report, where a
  required file outside the list was edited and flagged. If the lead prefers, the
  Allowed-files line for mobile just needs `apps/mobile/src/lib/ais-api.ts` added.
- **No `validateLimits` test existed** to extend (I searched all `*.test.ts`).
  I created `packages/chat-core/src/ai-limits.test.ts` with the spec's cases
  (empty → null bound; day > month still an error when both are set).
- **Removed the LiteLLM early-return in `budget.ts`** (audit plan §5.4). The
  task's bullet only said "the budget gate then skips the turn only when a set
  limit is reached", but the code comment said this stayed on the LiteLLM path
  "until Task 4 reworks budgets" — this is Task 4. Existing gateway tests pass.
- **Mobile has no usage block today** (mobile's `PublicAi` deliberately omits the
  `usage` field), so the spec's usage-block and help-text bullets were applied to
  web only. I did not add a new mobile usage surface; say the word if you want one.
- **Web list rows** (`apps/web/src/routes/AisPage.tsx`, not in Allowed files) use
  `formatLimit`, which now renders a `null` bound as "No limit", so a no-limit AI
  reads "No limit/day · No limit/month" there. I left the route untouched; it
  still compiles and passes.

### Open questions
- Accept `apps/mobile/src/lib/ais-api.ts` as a necessary in-scope edit (or add it
  to the Allowed list), and confirm the LiteLLM early-return removal.

**Lead fix (round 2).** Added `apps/mobile/src/lib/ais-api.ts` and `apps/web/src/routes/AisPage.tsx` to Allowed files; the web and mobile list rows now share a `formatLimits` helper ("No spending limit" / only the set bounds); added one comment on the unreachable `?? 0` in `budget.ts`. `pnpm gate` → GATE PASS, `scope: every changed file is inside the Allowed files`.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after the lead's small round (scope for the mobile ais-api.ts and AisPage.tsx; list wording). Checked:
- web ?mock=1 (headless): the list shows 'No spending limit', and the New AI dialog has empty 'No limit' fields with the hint;
- phone smoke PASS (/ais, /ais/new, /ais/ai-dev-1); the phone shows the same list text and the Edit screen's empty limit fields.
The deploy-window note (an old server reading NULL as $0) can't bite: production has no AIs yet.
