---
id: T-2209
title: "Web search W1: a DeepSeek AI's web.search and web.fetch use DeepSeek's Search and Fetch APIs with the AI's own key; each successful request adds $0.00075 to its usage"
status: merged
milestone: M5
branch: task/T-2209-deepseek-search
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2209: DeepSeek Search and Fetch for DeepSeek AIs (web search plan W1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: an AI on DeepSeek uses its own DeepSeek key for web search and fetch, with no scraping. Plan: `docs/audit/web-search-plan.md` W1. Today `web.search` scrapes DuckDuckGo's HTML, which returns nothing when DuckDuckGo shows a bot check.

### DeepSeek's API (from their docs, 2026-10)
Both calls use `Authorization: Bearer <key>` and `Content-Type: application/json`.

**Search:** `POST https://api.deepseek.com/v1/tools/search`
- Body: `{ "query": string (1-128 chars), "count": 1-50 }`.
- 200 response: `{ "results": [{ "title", "url", "snippet", "summary", "date" (string|null), "site_name" (string|null), ... }] }`. An empty array means no matches.

**Fetch:** `POST https://api.deepseek.com/v1/tools/fetch`
- Body: `{ "url": string }`. The URL must be http(s), have a host, carry no username or password, and be at most 8192 chars.
- 200 response: `{ "title": string, "content": string (Markdown) }`.

**Errors:** an OpenAI-style body with these statuses:

| Status | Meaning |
| --- | --- |
| 400 | invalid request |
| 401 | bad key |
| 402 | balance empty |
| 403 | fetch refused by DeepSeek's policy |
| 404 | fetch found no readable content |
| 408 / 429 / 5xx | retry later |

**Billing:** only a 200 with results is billed (search with non-empty `results`, fetch with non-empty `content`), at $0.75 per 1,000 requests, so $0.00075 each.

### Facts (the lead read these on 2026-10-19)
1. **The adapters.** `web.fetch` and `web.search` are built in `apps/server/src/startup/components.ts:222-301`. Their `execute` is wrapped by `withWebRateLimit` (`apps/server/src/web-tools/shared.ts:91-102`), which receives the `ActionContext` (`apps/server/src/actions/registry.ts:24-30`). Its `aiId` comes from the gateway, never from the model.
2. **Startup order.** The adapters are created at `components.ts:495-498` with `buildWebToolsAdapters({ searchProviderName, logger })`. The key cipher is made later, at `components.ts:558-561` (`gatewayCipher`).
3. **The AI's key.** `loadModelTarget(db, cipher, aiId)` (`apps/server/src/agents/gateway/model-target.ts`) returns the AI's `{ provider, apiKey, model, apiUrl? }`, owner-scoped and active only. `provider === 'deepseek'` is a direct DeepSeek key.
4. **Usage.** `recordUsage` / `writeUsage` (`apps/server/src/ais/usage-store.ts:78-125`) upserts one `ai_usage` row per (AI, day) and adds `cost_usd`.
5. **Search output.** `formatSearchResults` (`apps/server/src/web-tools/search.ts:218-224`) writes the model text, and its header names DuckDuckGo. `WebSearchResult` is `{ title, url, snippet }` (`search.ts:10-14`).

### Steps
1. **New file `apps/server/src/web-tools/deepseek.ts`** with `deepseekSearch(key, query, { fetchImpl?, signal? })` (count `MAX_SEARCH_RESULTS`) and `deepseekFetch(key, url, { fetchImpl?, signal? })`.
   - Timeouts: 15 s for search, 30 s for fetch.
   - Each returns either `{ ok: true, ... }` or `{ ok: false, summary }`. The summary is a fixed line per status, for example "DeepSeek key rejected", "DeepSeek balance is empty", "page refused by DeepSeek", "no readable content", "search busy, try later", "search failed".
   - The key and the response body never go into a summary, model text or log line. Log only the status code, at warn.
   - For search, use `summary` (written for models) as the result text. Add the `date` and `site_name` when present.
2. **`apps/server/src/web-tools/shared.ts`:** add `deepseekKeyFor?: (aiId: string) => Promise<string | null>` and `recordToolCost?: (aiId: string, costUsd: number) => void` to `BuildWebToolsAdaptersDeps` and `WebToolsState`. Pass the `ActionContext` through `withWebRateLimit` to `fn`, so the adapters can read `aiId`.
3. **`components.ts`:**
   - Make the cipher before the web adapters.
   - `deepseekKeyFor` = `loadModelTarget(...)`, returning `apiKey` only when `provider === 'deepseek'`, else null. It returns null when there is no cipher.
   - **`web.search`:** with a key, call DeepSeek. An empty result list answers the existing "unavailable" text. On success, call `recordToolCost(aiId, 0.00075)`. Without a key, keep the current provider unchanged.
   - **`web.fetch`:** with a key, first apply the URL checks: an http or https scheme, a host, and no username or password. Then call DeepSeek Fetch. Truncate `content` to `maxChars` as today, and record the cost on non-empty content. Without a key, keep the current path unchanged.
   - Change the `web.search` description to "Search the web; never put private or sensitive text in the query."
4. **`apps/server/src/ais/usage-store.ts`:** add `recordToolCost(deps, aiId, costUsd, now)`. It adds the cost with zero tokens and reuses the same upsert, with no second copy of the SQL. Like `recordUsage`, it is best effort and never throws.
5. **`search.ts`:** `formatSearchResults` takes the source name for its header ("DeepSeek" or "DuckDuckGo HTML, unreliable"), and `WebSearchResult` gets optional `date` and `site`.
6. **Tests:** a new `apps/server/src/web-tools/deepseek.test.ts` with an injected `fetchImpl`, exactly these 3 cases (keys and money):
   - a 401 answer: the summary is fixed, and neither the key nor the body appears in the summary or the model text;
   - a 200 with results records the cost once; a 200 with `results: []` records nothing;
   - an AI whose `deepseekKeyFor` is null never calls `api.deepseek.com`.

### Allowed files
- `apps/server/src/web-tools/deepseek.ts` (new)
- `apps/server/src/web-tools/deepseek.test.ts` (new)
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/web-tools/search.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/ais/usage-store.ts`
- `work/T-2209-deepseek-search.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/web-tools/deepseek.test.ts src/ais/usage-store.test.ts src/web-tools/adapters.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and so do the 3 new tests.
- The key is never logged or echoed.
- The cost lands in `ai_usage.cost_usd` only for a billed request.
- Lead live check after the deploy, in "ai test › General":
  - ask Deepseek for today's headlines: the card shows a search, and the answer cites real URLs;
  - ask it to read one URL: the answer uses that page;
  - the AI's usage cost for today rises by a fraction of a cent.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/web-tools/deepseek.ts` with `deepseekSearch` and `deepseekFetch`. Both call `api.deepseek.com/v1/tools/*` with `Bearer <key>`, 15 s / 30 s timeouts, Effect `Schema` validation of the response, and fixed summary lines per status (401 "DeepSeek key rejected", 402 "DeepSeek balance is empty", 403 "page refused by DeepSeek", 404 "no readable content", 408/429/5xx "… busy, try later"). The key, request body and response body never enter a summary, model text or log line; logs carry only `{ status }` at warn. Search results use DeepSeek's `summary` as the result text, with `snippet` as fallback, plus `date` and `site_name` when present.
- `web.search`: when the AI has a direct DeepSeek key, it calls DeepSeek and records $0.00075 only for a non-empty result list. An empty list keeps the existing "unavailable" text. Without a key the DuckDuckGo HTML provider is unchanged. Description is now "Search the web; never put private or sensitive text in the query."
- `web.fetch`: with a DeepSeek key it checks the URL first (http/https, a host, no username/password), calls DeepSeek Fetch, truncates to `maxChars` and records $0.00075 only when the content is non-empty. Without a key the guarded path is unchanged.
- `shared.ts`: `BuildWebToolsAdaptersDeps` / `WebToolsState` gained `deepseekKeyFor`, `recordToolCost` and `deepseekFetch`; `withWebRateLimit` now passes the `ActionContext` to the wrapped function.
- `components.ts`: the key cipher is created before the web adapters; `deepseekKeyFor` returns the AI's decrypted key only when `loadModelTarget(...)` reports `provider === 'deepseek'`, and null when there is no cipher; `recordToolCost` writes through the usage store with `{ db, logger }`.
- `usage-store.ts`: added `recordToolCost(deps, aiId, costUsd, now)`. It is best effort, tracked with the other pending writes, and shares the single `INSERT … ON CONFLICT` through a new private `addUsage`.
- `search.ts`: `formatSearchResults` takes the source label; `WebSearchResult` got optional `date` and `site`.
- `deepseek.test.ts`: the 3 requested cases (401 leaks nothing; one cost for results and none for an empty list; no API call when `deepseekKeyFor` is null).

### Files changed

- `apps/server/src/web-tools/deepseek.ts` (new)
- `apps/server/src/web-tools/deepseek.test.ts` (new)
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/web-tools/search.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/ais/usage-store.ts`
- `work/T-2209-deepseek-search.md`

### Commands and results

- `pnpm install`: done, 1155 packages, 13.2 s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/deepseek.test.ts`: 1 file passed, 3 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage-store.test.ts src/web-tools/adapters.test.ts`: 2 files passed, 9 tests passed.
- `pnpm gate` (final run):
  - `PASS install (frozen) (1.0s)`
  - `PASS format (1.2s)`
  - `PASS lint (0.6s)`
  - `PASS typecheck (2.7s)`
  - `PASS effect (0.5s)`
  - `PASS build @zilar/server (0.6s)`
  - `PASS tests @zilar/server (14.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `WARN size: apps/server/src/startup/components.ts: 787 lines (main 701); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`

During the first gate runs I fixed Prettier formatting (deepseek files) and made the new module count as Effect by writing its HTTP layer with `Effect.tryPromise`/`timeoutOrElse`; the final run is the one above.

### Deviations from the spec

1. `withWebRateLimit` passes the `ActionContext` as the **second** callback argument (`fn(args, ctx)`) instead of the first. `price-adapter.ts` and `wikipedia-adapter.ts` call it with `(args)` and are outside this task's Allowed files; using `(args, ctx)` keeps them working, and the context still reaches `web.search`/`web.fetch`.
2. Added `deepseekFetch?: FetchLike` to the adapter deps/state. The spec's tests need an injected `fetchImpl`, and the adapters had no seam to pass one to the provider.
3. `DeepSeekOptions` also accepts `logger?` (the spec listed `fetchImpl`/`signal`), because only the provider knows the HTTP status that AGENTS requires be logged at warn.
4. Queries longer than DeepSeek's 128-character limit are sliced to 128 inside `deepseekSearch`; the local `web.search` schema still allows 200 characters.

### Blocked / needs a decision

None.

### Open questions

None.


## Review (written by Claude)

Approved. The pre-review was clean: 3 nits, all optional (a DB-error fallback, a surrogate cut at 128 chars, test depth).

**Keys and money, read by the lead:**
- The key comes from `loadModelTarget`, owner-scoped and active, and is used only when `provider === 'deepseek'`. It travels only in the Authorization header.
- Failures map to fixed summaries per status. Logs carry only the status code.
- The cost ($0.00075) is added only for search with results and fetch with content, through the same `ai_usage` upsert, now shared by `addUsage` (one SQL).
- Fetch keeps the URL checks: http(s), a host, no credentials.
- Other AIs keep today's path until W2.
- The `web.search` description no longer says "unreliable".

The live check (headlines search, reading one URL, the usage cost rising) follows the deploy.
