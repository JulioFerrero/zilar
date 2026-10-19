---
id: T-2219
title: "Web search keys W2a (server): Brave, Exa, Firecrawl, Jina and Tavily as connections; an AI's web.search/web.fetch route to its DeepSeek key or the owner's first web search key"
status: merged
milestone: M5
branch: task/T-2219-web-search-keys-server
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2219: Web search keys (server)

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/web-search-plan.md` W2, approved by Julio on 2026-10-19. The boards and rules are in `docs/design/mockups/web-search/README.md`:
- An AI uses its model provider's own search and read when the provider has them (DeepSeek today).
- Otherwise it uses the owner's first working web search key that has the capability.

This task is the server half. The web and phone screens follow in separate tasks.

### Facts (read by the lead on 2026-10-19)
1. **Provider ids.** `PROVIDER_IDS` is in `packages/api-contract/src/connections.ts:10-19`. `connectionBaseUrl` (`apps/server/src/connections/api.ts:88-106`) gives every id in that list no base URL.
2. **Which providers can run an AI.** `isLlmProvider` (`apps/server/src/connections/providers.ts:16-21`) decides this. `apps/server/src/ais/provisioning.ts:28` refuses the others for an AI. `github` is the existing non-LLM example.
3. **Key test.** `ENDPOINTS: Record<ProviderId, Endpoint>` (`apps/server/src/connections/probe.ts:27-64`) is GET only (`testKeyEffect`, `:115-148`). `outcomeFor` (`:83-96`) treats 401/403 as a rejected key.
4. **DeepSeek web calls.** `apps/server/src/web-tools/deepseek.ts` holds `deepseekSearch`/`deepseekFetch`. Its shared `postJson` already handles timeout plus abort signal, and the failure texts are `searchFailure`/`fetchFailure`. The tests are in `apps/server/src/web-tools/deepseek.test.ts`.
5. **Adapters.** `webFetchAdapter` and `webSearchAdapter` are in `apps/server/src/startup/components.ts:225-374` (the file is 789 lines). The state hooks `deepseekKeyFor`, `deepseekFetch` and `recordToolCost` are in `apps/server/src/web-tools/shared.ts:32-66`. The wiring is at `components.ts:574-590`.
6. **Model key.** `loadModelTarget` (`apps/server/src/agents/gateway/model-target.ts`) joins `provider_connections pc ON pc.owner = ais.owner`, active only. Its DB test setup is in `apps/server/src/agents/gateway/model-target.test.ts:17-44`.
7. **Provider APIs** (from their docs). The invalid-key codes were checked by the lead with a fake key on 2026-10-19.

   | Provider | Search | Read | Key header | Invalid key |
   |---|---|---|---|---|
   | Brave | GET `https://api.search.brave.com/res/v1/web/search?q=…&count=8` → `web.results[] {title,url,description}` (the description may hold `<strong>` tags) | none | `x-subscription-token`, plus `accept: application/json` | **422** `SUBSCRIPTION_TOKEN_INVALID` |
   | Exa | POST `https://api.exa.ai/search` `{query, numResults: 8, contents: {highlights: true}}` → `results[] {title,url,highlights[]}` | POST `https://api.exa.ai/contents` `{urls:[url], text:true}` → `results[0] {title,text}`, `statuses[0].status` | `x-api-key` | 401 |
   | Firecrawl | POST `https://api.firecrawl.dev/v2/search` `{query, limit: 8}` → `data.web[] {url,title,description}` | POST `https://api.firecrawl.dev/v2/scrape` `{url, formats:["markdown"]}` → `data.markdown`, `data.metadata.title` (a string or an array) | `authorization: Bearer` | 401 |
   | Jina | GET `https://s.jina.ai/?q=…` (docs only, not checked without a key: `data[]` of `{title,url,description,content}`) | GET `https://r.jina.ai/<url>` → `{code, data: {title, url, content}}` (checked keyless) | `authorization: Bearer`, plus `accept: application/json` | 401 |
   | Tavily | POST `https://api.tavily.com/search` `{query, max_results: 8}` → `results[] {title,url,content}` | POST `https://api.tavily.com/extract` `{urls:[url]}` → `results[0].raw_content`; `failed_results[]` | `authorization: Bearer` | 401 |

   Free or cheap key-test endpoints (invalid key → 401):
   - Tavily: GET `https://api.tavily.com/usage`.
   - Firecrawl: GET `https://api.firecrawl.dev/v2/team/credit-usage`.
   - Jina: GET `https://r.jina.ai/https://example.com`.
   - Exa: POST `https://api.exa.ai/contents` `{"urls":["https://example.com"]}`.
   - Brave: its search URL with `q=zilar&count=1`.

### Steps
1. **Contract** (`packages/api-contract/src/connections.ts`):
   - Add `'brave', 'exa', 'firecrawl', 'jina', 'tavily'` to `PROVIDER_IDS`.
   - Export `WEB_SEARCH_PROVIDER_IDS`, those five ids.
   - Export `WEB_CAPABILITIES: Readonly<Record<string, { search: boolean; read: boolean }>>`:
     - `deepseek`: search and read;
     - `brave`: search only;
     - `exa`, `firecrawl`, `jina`, `tavily`: search and read.

   One comment line: "What a key can do for an AI's web tools; the UI shows it as tags."
2. **Not an LLM, and key tests:**
   - `isLlmProvider` returns false for `WEB_SEARCH_PROVIDER_IDS`, like `github`.
   - In `probe.ts`, add the five endpoints from fact 7. `Endpoint` gains an optional `body` (a POST when present; Exa only).
   - A 422 also counts as a rejected key (Brave). Say so in a short comment on `outcomeFor`.
   - The five never take the compatible path.
3. **One source module:**
   - `git mv apps/server/src/web-tools/deepseek.ts apps/server/src/web-tools/sources.ts` and `git mv apps/server/src/web-tools/deepseek.test.ts apps/server/src/web-tools/sources.test.ts`.
   - Export `interface WebSource`:
     ```ts
     {
       provider: string;
       label: string;
       costUsd?: number;
       search?: (query: string, options: SourceOptions) => Promise<SearchOutcome>;
       read?: (url: string, options: SourceOptions) => Promise<ReadOutcome>;
     }
     ```
   - Export `webSource(provider, key): WebSource | null`. It is built from fact 7, with `search` or `read` only where the provider has it.
   - **DeepSeek** keeps today's requests and `costUsd: 0.00075` (moved from `components.ts:226`).
   - **Other providers** have no `costUsd`: the provider bills the key owner directly.
   - **One request helper** (GET or POST JSON, timeout, signal, the key only in its header) replaces `postJson`.
   - **Failure texts** take the label:
     - 401/403, and 422 for Brave → `"<Label> key rejected"`;
     - 402 → `"<Label> balance is empty"`;
     - 408/429/5xx → busy;
     - anything else → `search failed` / `fetch failed`.
   - **Result rows:**
     - The snippet is Brave's `description` (tags stripped with `stripTags` from `apps/server/src/markup/scan.ts`), Exa's `highlights` joined with " … ", Jina's `description` or its first 300 content characters, or Tavily's `content`.
     - A row with no title or no http(s) url is skipped, as `mapResults` does today.
     - An empty read is `no readable content`.
   - The labels are DeepSeek, Brave Search, Exa, Firecrawl, Jina and Tavily.
4. **Routing:** add `loadWebSource(db, cipher, aiId, need: 'search' | 'read'): Promise<WebSource | null>` to `apps/server/src/agents/gateway/model-target.ts`.
   1. If `loadModelTarget` gives provider `deepseek`, return the DeepSeek source.
   2. Otherwise select the owner's active connections, the same `pc.owner = ais.owner` scoping:
      ```sql
      SELECT pc.provider, pc.encrypted_key FROM ais
      JOIN provider_connections pc ON pc.owner = ais.owner
      WHERE ais.id = ${aiId} AND pc.status = 'active' AND pc.provider IN (…five…)
      ORDER BY pc.created_at ASC
      ```
      Pick the first whose `WEB_CAPABILITIES[provider][need]` is true, decrypt that key only, and return `webSource(...)`.
   3. Otherwise return `null`.
5. **State and adapters:**
   - In `shared.ts`:
     - `deepseekKeyFor` becomes `webSourceFor?: (aiId: string, need: 'search' | 'read') => Promise<WebSource | null>`;
     - `deepseekFetch` becomes `sourceFetch?: FetchLike` (the test hook, passed as `fetchImpl`).
   - In `components.ts`:
     - `web.fetch` asks for `'read'` and `web.search` for `'search'`;
     - the model text names `source.label` (`formatSearchResults(..., source.label)`);
     - `recordToolCost` runs only when `source.costUsd` is set;
     - `ctx.signal` is passed as today;
     - with no source, the current DuckDuckGo/guarded path stays (plan W3 removes it later).
   - The wiring calls `loadWebSource(db, gatewayCipher, aiId, need)`.
   - Rename `deepseekTargetHost` to `sourceTargetHost`.
   - `components.ts` must end at 800 lines or fewer.
6. **Tests** (the keys area, so a few only):
   - In `sources.test.ts`, keep the four existing cases, with renamed hooks.
   - Add one table-driven case for brave, exa, firecrawl, jina and tavily. A fake fetch checks the request URL and that the key is in that provider's header and never in the URL. It returns a canned body that maps to one search result, and for the four readers to read content.
   - In `model-target.test.ts`, add one case: an AI with an openai key whose owner has a `tavily` connection gets the Tavily source for `'read'`. A `brave` connection of another owner is never used, and an owner with only `brave` gets `null` for `'read'`.

### Allowed files
- `packages/api-contract/src/connections.ts`
- `apps/server/src/connections/providers.ts`
- `apps/server/src/connections/probe.ts`
- `apps/server/src/web-tools/deepseek.ts`
- `apps/server/src/web-tools/sources.ts`
- `apps/server/src/web-tools/deepseek.test.ts`
- `apps/server/src/web-tools/sources.test.ts`
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/agents/gateway/model-target.ts`
- `apps/server/src/agents/gateway/model-target.test.ts`
- `apps/server/src/startup/components.ts`
- `work/T-2219-web-search-keys-server.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/web-tools/sources.test.ts src/agents/gateway/model-target.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- No key ever appears in a URL, a log line or a summary.
- An AI whose model provider is not DeepSeek and whose owner has no web search key behaves exactly as today.
- The lead runs a live check after the deploy: the DeepSeek AI in "ai test › General" still says "(from DeepSeek)".
- **Size (lead, 10:36):** `apps/server/src/web-tools/sources.ts` is at most 450 lines. The six providers are one table of entries, `{ label, costUsd?, auth header, search?: { request, rows path, snippet }, read?: { request, title/content picks } }`. They are decoded by one tolerant row schema and one tolerant read schema (all fields optional and nullable), not 12 per-provider schemas, 6 builders and 11 parsers.

---

## Report (written by the worker when done)

### What I did
- Contract: added `brave`, `exa`, `firecrawl`, `jina` and `tavily` to `PROVIDER_IDS`, plus `WEB_SEARCH_PROVIDER_IDS` and `WEB_CAPABILITIES`.
- Providers and probes: `isLlmProvider` now refuses the five web search ids, and `probe.ts` has one cheap endpoint per provider (Exa is the only POST, via the new optional `body`). A 422 is also a rejected key, and the five never take the compatible path.
- Sources: renamed `deepseek.ts`/`deepseek.test.ts` to `sources.ts`/`sources.test.ts`. The module now exports `WebSource`, `SourceOptions`, `webSource(provider, key)` and one GET/POST JSON request helper with the existing timeout, abort signal and fixed failure texts. DeepSeek keeps its requests and `costUsd: 0.00075`; the keyed providers bill their owner, so they carry no cost. Keys travel only in provider headers.
- Routing: `loadWebSource(db, cipher, aiId, need)` returns the DeepSeek source for a DeepSeek AI, otherwise the owner's oldest active web key that has the requested capability, decrypting only that one key.
- Adapters: `web.fetch` asks for `read`, `web.search` asks for `search`, the model text names the source label, and a tool cost is recorded only when the source sets one. With no source, the existing guarded fetch / DuckDuckGo path is unchanged.
- Tests: kept the four DeepSeek adapter cases with the renamed `webSourceFor`/`sourceFetch` hooks; added a table-driven case for the five providers (URL, header-only key, result mapping and reads) and a Brave 422 case. Added routing tests for an owner's first capable key, another owner's key never being used, and a search-only owner returning `null` for `read`.

### Files changed
- `packages/api-contract/src/connections.ts`
- `apps/server/src/connections/providers.ts`
- `apps/server/src/connections/probe.ts`
- `apps/server/src/web-tools/sources.ts` (renamed from `deepseek.ts`)
- `apps/server/src/web-tools/sources.test.ts` (renamed from `deepseek.test.ts`)
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/agents/gateway/model-target.ts`
- `apps/server/src/agents/gateway/model-target.test.ts`
- `apps/server/src/startup/components.ts`
- `work/T-2219-web-search-keys-server.md`

### Commands and results
- `pnpm install`: completed, 1155 packages, no errors.
- `pnpm --filter @zilar/server exec vitest run src/web-tools/sources.test.ts src/agents/gateway/model-target.test.ts --reporter=dot`: 2 test files passed, 11 tests passed.
- `pnpm gate`: first run failed on formatting in `shared.ts`/`sources.ts`; after `prettier --write` on those two files, the final run ended with:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  SKIP  tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  Its only warnings were the soft 400-line size warnings for `components.ts` (796 lines) and `sources.ts` (708 lines); no file exceeds 800 lines.

### Problems / deviations
- None from the spec. The live DeepSeek check ("ai test › General" still says "(from DeepSeek)") is the lead's post-deploy check and was not run here.

### Open questions
- None.

### Round: prereview fixes
- Fixed finding 1 (should-fix): the cross-owner routing test was vacuous. In "uses the owner first web key that has the needed capability", the other owner now has an older `exa` key (search and read capable), so removing either `pc.owner = ais.owner` or the AI scoping makes both the `read` and `search` assertions return Exa and fail. In "returns null for read when the owner only has a search-only key", the other owner now has an older `tavily` key, so a leak would return Tavily instead of `null`.
- Nits 2 and 3 were left untouched: they are outside the lines this fix changes, per the instructions.
- Tests added/adjusted: the two routing tests above in `apps/server/src/agents/gateway/model-target.test.ts`.
- Single test run: `pnpm --filter @zilar/server exec vitest run src/agents/gateway/model-target.test.ts --maxWorkers=2 --reporter=dot` — 1 file passed, 5 tests passed.
- `pnpm gate`: `PASS` install/format/lint/typecheck/effect/build, `PASS tests @zilar/server`, scope clean, `GATE PASS` (only the existing soft size warnings for `components.ts` 796 and `sources.ts` 708 lines).

### Round 2: size bar
- Rewrote `apps/server/src/web-tools/sources.ts` as one provider table decoded by one tolerant search-row schema and one tolerant read-row schema. Each entry holds the label, auth header, cost and rejected statuses, plus its search request/rows/snippet and read request/pick/title/content pieces. The per-provider schemas, builders and parsers are gone.
- Behaviour is unchanged: same request URLs, methods and bodies; same header-only keys; same snippet and result mapping (including DeepSeek's `summary` fallback and date/site fields); same failure texts and DeepSeek cost.
- New line count: `sources.ts` 450 lines (was 708).
- Tests: `sources.test.ts` and `model-target.test.ts` unchanged; both passed (11 tests).

## Review (written by Claude)

Approved after two rounds. Source net +321: a new feature with five providers. Test +228.

**Round 1 (AUTOFIX):** the cross-owner test now gives the other owner a read-capable key while the owner has only Brave, so a scoping bug would fail it.

**Round 2 (lead size bar):** `sources.ts` went from 708 to 450 lines as one provider table, with one tolerant row schema and one tolerant read schema. The billing, key-not-logged and abort-signal comments are kept.

**What it does:**
- Brave, Exa, Firecrawl, Jina and Tavily are connection providers. They are not LLMs, and their key tests are the endpoints the lead checked (a Brave 422 counts as a rejected key).
- `loadWebSource(db, cipher, aiId, need)` returns the AI's DeepSeek key when its model provider is DeepSeek. Otherwise it returns the owner's oldest active web search key with that capability, scoped by `pc.owner = ais.owner`; otherwise null, which keeps the current path.
- Only DeepSeek records a tool cost; the other providers bill the key owner directly.

**Nit left open:** the table test asserts only result count and URL, not the snippets.

The live check after the deploy: the DeepSeek AI still answers searches "(from DeepSeek)". The web and phone screens follow in T-2220 and T-2223.
