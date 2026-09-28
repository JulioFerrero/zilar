---
id: T-0058
title: AI costs — show each AI's spend (today, and the 30-day window vs its cap) and enforce the per-day limit before a turn
status: planned
milestone: M2
branch: task/T-0058-ai-costs
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0054]
estimate: 1 day
---

# T-0058: AI costs

## Spec (written by Claude, do not edit)

### Goal

M2 lists "**costs**". Each AI has two limits:
- **per month:** enforced by LiteLLM as the virtual key's `max_budget` over a 30-day window;
- **per day:** `ai_limits.per_day_usd`, which is stored but **never enforced**. That's a real gap: an owner who sets "$2/day" expects it to hold.

The owner also can't see what an AI has spent. This task:
1. shows the spend;
2. enforces the daily limit as a **soft** limit: checked before each turn, with the lag of LiteLLM's spend tracking.

### Approach (decided by the lead; follow it)

The source of truth is LiteLLM's cumulative spend on the AI's virtual key (`getKeyInfo(key).spend`, which the admin client already has). It counts within the key's 30-day budget window and drops back when the window resets.
- **Today's spend** = the current key spend − the key spend at the start of today (UTC). Store that baseline per AI per UTC day, the first time the AI's spend is read on that day.
- If the current spend is **lower** than the baseline, the window has reset. Treat the baseline as 0 for that day and store the new value.
- If there's no baseline for today yet (the first read of the day), today's spend is 0 by definition. Record the baseline and continue.
- LiteLLM writes spend in batches, so the numbers can lag a turn or two. That makes the daily limit soft. Document this in a code comment and in the panel's help text.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/ai/litellm-client.ts` (`getKeyInfo`, redaction), `apps/server/src/ais/service.ts` (`PublicAi`, `listAis`, `getOwnedAi`, `findAiForGateway`, the key row), `routes.ts`
- `apps/server/src/agents/gateway.ts` and `reply.ts` **after T-0054**: `runSessionTurn` for DMs, the group turn, failure texts (`BUDGET_EXCEEDED_REPLY` for the monthly cap), and how the virtual key is loaded
- `apps/server/src/db/schema.ts` and `drizzle/` (generate with `db:generate`)
- `apps/web/src/components/ais/AiPanel.tsx`, `AisPage.tsx`, `LimitsFields.tsx`, `apps/web/src/lib/api.ts` (`PublicAi`)
- `docs/design/ui-style.md` §4 (the well recipe for meters)

### Allowed files
- `apps/server/src/db/schema.ts` and one new generated migration (plus `meta/`)
- `apps/server/src/ais/**` (a new `usage.ts` with its test is welcome)
- `apps/server/src/agents/gateway.ts`, `reply.ts`, plus their tests
- `apps/web/src/lib/api.ts` (the `PublicAi` schema), `apps/web/src/components/ais/AiPanel.tsx`, `AisPage.tsx`, plus their tests
- `work/T-0058-ai-costs.md` and `work/screenshots/T-0058/**`

**Not allowed:** `apps/mobile/**`, `packages/**`, `docs/**`, and group or web chat files.

### Allowed dependencies
None.

### What to build

**1. Data:** a new table `ai_daily_spend`:
- `ai_id` (FK ais, on delete cascade);
- `day` (date, UTC);
- `baseline_usd` (numeric, as the existing money columns);
- `updated_at`.

Primary key `(ai_id, day)`. Insert the baseline with `ON CONFLICT DO NOTHING`, so two concurrent first reads can't fight.

**2. `usage.ts`: `getAiUsage(deps, aiId)`** returns:
- `todayUsd`;
- `windowUsd` (the key's current spend);
- `perDayUsd`, `perMonthUsd`;
- `dailyLimitReached` (`todayUsd >= perDayUsd`).

It implements the baseline rules above, and it's pure except for the DB and one `getKeyInfo` call.
- A LiteLLM failure returns `null` usage. The API shows it as "unavailable", and the turn check **fails open**: the turn goes ahead. The monthly cap is still enforced by LiteLLM, so failing closed would only break the AI when LiteLLM hiccups. Explain this in a comment.
- Never log the key; ids only.

**3. API.** `GET /api/ais` and `GET /api/ais/:id` add `usage: { todayUsd, windowUsd } | null`. Owner only, as today. Read the list's usages in parallel, with a small timeout per AI: 2 s, and on timeout `null`.

**4. Enforcement in the gateway,** before any model call, for **DM and group turns**:
- if `dailyLimitReached`, skip the model call and send **one** fixed notice per AI per chat per UTC day: `I've reached today's spending limit ($X.XX). I'll be back after 00:00 UTC.` (the formatted per-day limit). Keep that "already notified" state in memory. After a restart it may notify once more, which is acceptable.
- Further messages that day get no reply and no notice. The owner's DM messages still get the read marker (T-0050), so the owner sees the AI got them.
- Add the notice text as an exported constant next to the other fixed replies.

**5. Web.**
- The AI panel gets a **Usage** block above the limits:
  - `Today $0.03 of $2.00` and `30-day window $0.41 of $20.00`;
  - each has a thin meter: a **well** track with a `#ededed` fill, turning `--danger` at or above 100%;
  - "Usage unavailable" when `usage` is null;
  - a one-line help text: "Spend updates within a minute or two; the daily limit may let a last reply through."
- The AIs page row shows today's spend in mono under the model name.

### Tests (Vitest, no network; LiteLLM faked as in the existing tests)
- `usage.ts`:
  - first read of the day → baseline recorded, today 0;
  - a later read → the delta;
  - a window reset (spend dropped) → the baseline reset;
  - two concurrent first reads → one row, the same answer;
  - a LiteLLM failure → null;
  - UTC day boundaries with an injected clock.
- The gateway:
  - limit reached → no model call, one notice per chat per day, no second notice;
  - under the limit → a normal turn;
  - usage null → a normal turn (fails open);
  - groups follow the same rule.
- Routes: `usage` in the list and the detail, with a timeout → null, and owner-only.
- Web: the usage block renders the numbers and meters, the danger state at 100%, and the unavailable state.

### Visual check
Mock mode or a component render: the AI panel with the usage block (normal, over the limit, unavailable) at 1440×900. Save to `work/screenshots/T-0058/`. **Stop any dev server you start.**

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server --filter=@galena/web
pnpm build
```

### Out of scope
- Per-message cost display, provider price tables, invoices.
- Mobile.
- Changing how LiteLLM enforces the monthly cap.

## Report (written by the worker when done)

## Review (written by Claude)
