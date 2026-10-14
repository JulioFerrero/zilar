---
id: T-1405
title: "P0 task 3: count every AI model call in a new ai_usage table (tokens and cost per AI per UTC day, prices from the models.dev catalog); the AI's spend summary reads it instead of LiteLLM"
status: merged
milestone: M5
branch: task/T-1405-ai-usage-cost
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1405: AI usage and cost

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: model calls run in our server through Effect AI (T-1399, merged and live). Spend is counted per AI, with **no default budget** (`docs/design/agent-system.md` §7). LiteLLM is gone, so today nothing records spend, and the AI's usage block can't show anything.

This is **Task 3** of `docs/audit/effect-ai-plan.md` (read §5.3 and §6 Task 3). Budget enforcement is the next task; here it only has to keep compiling.

### Facts (the lead checked them on main, 2026-10-14)
- **Usage per call already exists:**
  - `apps/server/src/ai/model-client.ts:199-204` builds `ChatUsage` (`inputTokens`, uncached; `outputTokens`; `cacheReadTokens`; `cacheWriteTokens`);
  - `:292` calls `input.onUsage?.(result.usage)` once per model call;
  - `onUsage` is threaded through `tool-loop.ts:81,100`, `dm-turn.ts:59,124`, `dm-tool-turn.ts:63,229` and `group-turn.ts:55,194,265`;
  - **no gateway path passes it yet:** `agents/gateway/dm-turn.ts:274` (`runDmTurn`), `agents/gateway/group-turn-body.ts:263` (`runGroupTurn`), and memory compaction in `agents/gateway/memory.ts`.
- **Prices:** `apps/server/src/ai/catalog.ts` (`getAiCatalog` `:210`, `mapCatalog` `:108`) maps models.dev `cost.input` to `inputPricePerMTok` (`:95`), plus output. models.dev also has `cost.cache_read` and `cost.cache_write` per model, which the catalog doesn't keep yet.
- **The spend summary** `getAiUsage` (`apps/server/src/ais/usage.ts:63`) reads LiteLLM key spend and the `ai_daily_spend` baselines. Since T-1401 it answers `null` without LiteLLM (`:14`). It's read by the AIs API (`apps/server/src/ais/api.ts:175`) and the gateway budget check (`apps/server/src/agents/gateway/budget.ts:60`).
- **The contract shape** `AiUsage { todayUsd, windowUsd }` is at `packages/api-contract/src/ais.ts:98-103`; keep it.
- **Migrations:** the latest is `apps/server/drizzle/0054_push_failure_reason.sql`. Migrations are hand-written SQL that starts with `SET lock_timeout = '5s';--> statement-breakpoint`, and `apps/server/src/db/rows.ts` gets the row type.

### What to build
1. **Migration `apps/server/drizzle/0055_ai_usage.sql`:** create the `ai_usage` table as in plan §5.3:
   - `ai_id` references `ais(id)` `ON DELETE CASCADE`; `day date`;
   - the token columns `input_tokens`, `output_tokens`, `cached_tokens` and `cache_write_tokens`, all `bigint`;
   - `cost_usd numeric(12,6)`; `updated_at`;
   - primary key `(ai_id, day)`.

   Add the row type to `apps/server/src/db/rows.ts`. Don't drop `llm_virtual_keys` or `ai_daily_spend` here.
2. **`apps/server/src/ai/cost.ts`** (new):
   - `costOf(provider, model, usage)` in USD: input uncached × input price, output × output price, cache read × cache-read price (fallback: the input price), cache write × cache-write price (fallback: the input price);
   - prices come from the catalog. Extend `mapCatalog` to keep `cacheReadPricePerMTok` and `cacheWritePricePerMTok` internally, without changing the public catalog response unless that's trivial;
   - an unknown model costs 0 and logs one warning (ids only).
3. **`apps/server/src/ais/usage-store.ts`** (new):
   - `recordUsage(db, aiId, provider, model, usage, now)` does one `INSERT … ON CONFLICT (ai_id, day) DO UPDATE SET col = ai_usage.col + EXCLUDED.col` for all counters and cost. It's atomic per call; the day is the UTC day.
   - **A failure logs and never fails the turn.**
4. **Wire `onUsage`** in the three gateway paths: the DM turn, the group turn and memory compaction. It records against the AI that made the call, with the target's provider and model.
5. **`getAiUsage`** (`ais/usage.ts`) reads `ai_usage`:
   - `todayUsd` = today's `cost_usd`;
   - `windowUsd` = the sum of the last 30 days;
   - the limit fields keep working from `ai_limits` as today.

   Remove the LiteLLM and baseline logic from this function, and the `litellm` dependency from `AiUsageDeps` and its callers (`ais/api.ts:175`, `agents/gateway/budget.ts:60`). Keep `budget.ts`'s behaviour otherwise unchanged; the next task reworks it.
6. **Out of scope:** dropping tables, the env clean-up, budget rules, and the UI.

### Tests (money: required, few)
- **`apps/server/src/ais/usage-store.test.ts`:** two calls on the same day add up into one row (tokens and cost); a call on the next UTC day makes a new row; a deleted AI's rows go with it.
- **`apps/server/src/ai/cost.test.ts`:** a known price, the cache-read fallback to the input price, and an unknown model costs 0.
- Update `apps/server/src/ais/usage.test.ts` to the new source; remove the LiteLLM baseline cases.

### Read first
`AGENTS.md`, `docs/audit/effect-ai-plan.md` §5.3-5.4, and the files above.

### Allowed files
`apps/server/drizzle/0055_ai_usage.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/ai/cost.ts`, `apps/server/src/ai/cost.test.ts`, `apps/server/src/ai/catalog.ts`, `apps/server/src/ais/usage.ts`, `apps/server/src/ais/usage.test.ts`, `apps/server/src/ais/usage-store.ts`, `apps/server/src/ais/usage-store.test.ts`, `apps/server/src/ais/api.ts`, `apps/server/src/agents/gateway/*.ts`, `work/T-1405-ai-usage-cost.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/usage-store.test.ts src/ai/cost.test.ts src/ais/usage.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; files stay at most 400 lines.
- **Live after the deploy:** after Julio DMs an AI, `SELECT ai_id, day, input_tokens, output_tokens, cost_usd FROM ai_usage` shows the row (the lead reads it over SSH), and the AI's usage block shows today's spend.

---

## Report (written by the worker when done)

### What I did
1. **Migration `drizzle/0055_ai_usage.sql`** (new): creates `ai_usage` exactly as plan §5.3 — `ai_id` FK to `ais(id)` `ON DELETE CASCADE`, `day date`, the four `bigint` token columns, `cost_usd numeric(12,6)`, `updated_at`, primary key `(ai_id, day)`. Starts with `SET lock_timeout = '5s';--> statement-breakpoint`. Did not touch `llm_virtual_keys` or `ai_daily_spend`. Added `AiUsageRow` to `src/db/rows.ts`.
2. **`src/ai/cost.ts`** (new): `costOf(provider, model, usage, logger?)` = uncached input × input price + output × output price + cache read × cache-read price + cache write × cache-write price, cache prices falling back to the input price. Prices come from a server-internal table (`ModelPrices`, `setModelPrices`, `modelPricesFor`, `priceKey`). An unknown model costs 0 and warns once per provider/model per process (provider and model ids only).
3. **`src/ai/catalog.ts`**: the models.dev `cost` schema now keeps `cache_read`/`cache_write`; an internal `mapCatalogDocument` returns the public providers **and** the price table, and `getAiCatalog` fills `cost.ts` through `setModelPrices`. `mapCatalog` stays pure and its public response is byte-for-byte unchanged (so `catalog.test.ts`, which is outside my Allowed files, still passes). Added `ensureModelPrices(provider, model)`: a shared, never-rejecting, best-effort catalog warm-up used by the usage store.
4. **`src/ais/usage-store.ts`** (new): `recordUsage(deps, aiId, provider, model, usage, now)` does one `INSERT … ON CONFLICT (ai_id, day) DO UPDATE SET col = ai_usage.col + EXCLUDED.col` for all four counters and the cost, on the UTC day of `now`. A failure logs (`{ err, aiId }`, ids only) and resolves — it never fails the turn.
5. **`src/ais/usage.ts`**: `getAiUsage` now reads `ai_usage` — `todayUsd` = today's `cost_usd`, `windowUsd` = the sum over the last 30 UTC days (today included, the 31st day back excluded). The limit fields, the 80% cents-safe warnings and `dailyLimitReached` are unchanged. Removed the LiteLLM and baseline logic; `AiUsageDeps` is now `{ db, now? }` (the `logger` field went with LiteLLM, as did `AiUsageLogger`).
6. **Callers**: `ais/api.ts` always reads usage (dropped the "no LiteLLM ⇒ null" shortcut, so the usage block works in production); `gateway/budget.ts` no longer passes a LiteLLM client to `getAiUsage`.
7. **Wired `onUsage`** in the three gateway paths that had none: the DM turn (then `runDmTurn` → `runToolTurn`), the group turn (`runGroupTurn`) and memory compaction (`completeChat` in `gateway/memory.ts`). Each call records against `session.aiId` with the target's provider and model; the callback is fire-and-forget and `recordUsage` swallows its own errors.
8. **Tests**: new `src/ai/cost.test.ts` (known price; cache-read/write fall back to input price; unknown model costs 0 and warns once) and `src/ais/usage-store.test.ts` (two calls same UTC day add into one row with tokens and cost; the next UTC day starts a new row; deleting the AI cascades its rows away; a failed write logs and resolves). Rewrote `src/ais/usage.test.ts` against `ai_usage`, dropping every LiteLLM/baseline case and keeping the limit and 80% warning cases.

### Files changed
`apps/server/drizzle/0055_ai_usage.sql` (new), `apps/server/src/db/rows.ts`, `apps/server/src/ai/cost.ts` (new), `apps/server/src/ai/cost.test.ts` (new), `apps/server/src/ai/catalog.ts`, `apps/server/src/ais/usage.ts`, `apps/server/src/ais/usage.test.ts`, `apps/server/src/ais/usage-store.ts` (new), `apps/server/src/ais/usage-store.test.ts` (new), `apps/server/src/ais/api.ts`, `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/group-turn-body.ts`, `apps/server/src/agents/gateway/memory.ts`, `work/T-1405-ai-usage-cost.md`. All inside the task's Allowed files.

### Commands I ran
- `pnpm install` (worktree setup): done, no errors (one pre-existing mobile peer-dependency warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/cost.test.ts src/ais/usage-store.test.ts src/ais/usage.test.ts`: **3 files, 15 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/catalog.test.ts src/agents/gateway-group.test.ts src/agents/gateway-drain.test.ts src/agents/dm-turn.fake-provider.test.ts`: **4 files, 24 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/provisioning.test.ts src/agents/reply.test.ts`: **2 files, 10 tests passed**.
- `pnpm gate` (repo root), after fixing the one typecheck error it surfaced:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (0.8s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (8.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First run failed typecheck on `usage-store.test.ts` — a `readonly` array return type; fixed by dropping the explicit annotation.)

### Deviations and notes
- **Budget enforcement stays off on purpose.** `getAiUsage` no longer needs a LiteLLM client, so the `litellm` argument is gone from `budget.ts`. I kept the existing `if (deps.litellm === undefined) fail open` guards, so production (no LiteLLM configured) behaves exactly as today and limits are not newly enforced from `ai_usage` — the spec says budget enforcement is the next task ("here it only has to keep compiling"). Task 4 should drop those guards and read `ai_usage` directly. I left a comment saying so at `checkDailyLimitEffect`.
- **Cache prices stay internal.** The public `AiCatalogModel` contract is unchanged (adding fields there would have broken `catalog.test.ts`, which is outside my Allowed files), so the price table lives in `cost.ts` and is filled by `getAiCatalog`.
- **Cold-start prices.** A price is only known once something has fetched the catalog. `recordUsage` first calls `ensureModelPrices` (a shared, best-effort, never-rejecting `getAiCatalog`), so the first DM after a restart is still priced instead of recorded as 0. Tests seed the price table with `setModelPrices`, so they never touch the network. If the catalog fetch fails, an unknown model records cost 0 with one warning (as specified).
- **Window boundary.** "The last 30 days" is implemented as `day > today - INTERVAL '30 days'` (today included, the 31st day back excluded); a test pins that boundary.
- **`AiUsageDeps` lost `logger`.** After the LiteLLM read went, the injected logger was unused, so I removed it (and the `AiUsageLogger` export) rather than leave dead parameters.
- `recordUsage`'s cost is bound as a `toFixed(6)` string, matching the `numeric(12,6)` column and the codebase's habit of passing numerics as strings.

### Open questions
- None blocking. The only judgement call is the kept budget guard above; if the lead expected budget to start reading `ai_usage` in this task, that is a small, isolated change (drop the two `deps.litellm === undefined` guards in `budget.ts`).

### Round 1 (fix round for PREREVIEW)

- **Finding 1 (should-fix) — fixed.** `ensureModelPrices` (`src/ai/catalog.ts`) kept the resolved shared promise forever, so a failed or stale warm-up left every later call for that model unpriced (cost 0, warn-once) until restart or an unrelated catalog hit. It now releases `pricesRequest` when the request settles (`request.finally`), so the next call retries; concurrent callers still share the single in-flight request. Commit: `T-1405: fix finding 1 - retry catalog price warm-up after it settles`.
- **Test added.** `catalog.test.ts` is outside this task's Allowed files, so the regression test lives on the sole production caller path in `src/ais/usage-store.test.ts`: `ensureModelPrices` retries the catalog fetch after a failed warm-up instead of caching the failure (two failing fetches ⇒ two attempts). I checked it fails against the old code (`fetches` was 1, expected 2) and passes with the fix.
- **Finding 2 (nit) — not touched.** `AiUsageRow`'s `bigint` columns typed as `number` in `src/db/rows.ts` is a nit in a file (and line) this round does not otherwise change, so per the round rules it is left as is. It stays harmless: nothing reads those columns yet; the next reader should fix the type.
- **Commands:** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage-store.test.ts src/ai/cost.test.ts src/ais/usage.test.ts` → 3 files, **16 passed** (was 15; +1 new). Then `pnpm gate` from the repo root → `GATE PASS` (install/format/lint/typecheck/effect/tests all pass, scope clean, migration chain OK).

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 1 auto round (the shared price request is released on settle), nit 2. Lead checks: migration 0055 starts with SET lock_timeout, cascades on AI delete, primary key (ai_id, day); the 3 test files pass locally (16 tests); onUsage is wired in the DM, group and memory paths. T-1396 (paused) must take the next free migration number now. Live: after Julio's first AI DM, read ai_usage over SSH.
