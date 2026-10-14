---
id: T-1429
title: "Every models.dev OpenAI-compatible provider can back an AI: the catalog lists them, a connection stores the catalog base URL, turns and key tests go through the pinned OpenAI-compatible path"
status: merged
milestone: M5
branch: task/T-1429-catalog-providers
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1429: Every models.dev OpenAI-compatible provider

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-15: providers must come from a live list, as OpenCode does, never a hardcoded one. The approved New AI design (canvas https://claude.ai/artifact/WMbGfFmbgAHeuEKKHvBg2k) has a searchable provider dropdown fed by models.dev.

**models.dev data (`https://models.dev/api.json`, verified 2026-10-15):**
- 229 providers.
- 189 of them have `npm: "@ai-sdk/openai-compatible"`, and all 189 carry an `api` base URL (for example `together`, `deepseek` → `https://api.deepseek.com`).
- Every provider record has `id`, `name`, `env`, `npm`, `doc` and `models`, plus `api` on the compatible ones.

### Facts (the lead read them on main)
- **Catalog:** `apps/server/src/ai/catalog.ts`.
  - `:25` keeps only 6 ids (`PROVIDERS`), with names at `:29-36` and fallback model ids at `:40-47`.
  - `mapCatalogDocument` loops over `PROVIDERS` (`~:124`).
  - The public catalog shape is `packages/api-contract/src/ais.ts:197-211` (`AiCatalogProvider {id, name, models}`, `AiCatalog {providers, source, fetchedAt}`).
- **Provider ids:** `packages/api-contract/src/connections.ts:17-33` (`PROVIDER_IDS`, `ProviderIdSchema = Schema.Literals(...)`). The create payload's base-URL rules are at `:46-65`: a base URL is allowed only for `openai-compatible`.
- **Create connection:** `apps/server/src/connections/api.ts:174-183`. It stores `baseUrl` only for `openai-compatible`, via `validatedBaseUrl` (`:99`, `validateBaseUrl` plus `resolvePublic` from `./base-url`). The `provider_connections.provider` column is plain `text` (migration 0004) and `base_url` is `text` (0058), so no migration is needed.
- **LLM check:** `apps/server/src/connections/providers.ts:8-21` (`isLlmProvider`, 7 ids).
- **Turn target:** `apps/server/src/agents/gateway/model-target.ts`.
  - `:38` returns `null` for a provider that `isModelProvider` refuses.
  - `:43` makes `openai-compatible` require `baseUrl`.
  - `:47-52` builds the target.
- **Model clients:** `apps/server/src/ai/providers.ts:16-25` (`MODEL_PROVIDERS`) and `:118` (compat base URLs). `apps/server/src/ai/model-client.ts:334-341`: `modelTransport` uses the pinned fetch (SSRF guard, T-1396) only for `openai-compatible`.
- **Usage rows:** `target.provider` is recorded at `apps/server/src/agents/gateway/group-turn-body.ts:328` and `apps/server/src/agents/gateway/dm-turn.ts:334`. `apps/server/src/ais/usage-store.ts:32-42` prices by `(provider, model)` (`apps/server/src/ai/cost.ts:20` `priceKey`).
- **Key probe:** `apps/server/src/connections/probe.ts:31-73` (`ENDPOINTS` per id), `:133` (custom outcome mapping) and `:143-160` (custom path).

### What to build
1. **Catalog** (`catalog.ts`): keep the 6 native providers as they are, and add every models.dev provider whose `npm` is `@ai-sdk/openai-compatible` with an `https://` `api`.
   - `AiCatalogProvider` (`packages/api-contract/src/ais.ts`) gains `kind: 'native' | 'compatible'` and `docUrl: string` (models.dev `doc`, `''` when absent).
   - Sort providers: natives first in the current order, then compatible ones by name.
   - Prices are kept for every listed provider.
   - Keep each compatible provider's base URL in a server-only map with an exported lookup, `catalogBaseUrl(id): string | null`. It is never sent in the response.
   - On fallback (models.dev down, no cache), only the natives are listed.
   - Keep `catalog.ts` at 400 lines or fewer; move the document mapping into a new `apps/server/src/ai/catalog-map.ts` if needed.
2. **Provider ids:** `ProviderIdSchema` accepts the existing `PROVIDER_IDS` or any id matching `^[a-z0-9][a-z0-9.-]{0,63}$`. Keep `PROVIDER_IDS` exported unchanged.
3. **Create connection** (`connections/api.ts`): a provider not in `PROVIDER_IDS` must be a `compatible` catalog provider. Its base URL comes from `catalogBaseUrl(id)` and goes through the same `validatedBaseUrl` checks before it is stored in `base_url`. A client-sent `baseUrl` is still refused for anything but `openai-compatible`. An unknown id is a 400: `Unknown provider`.
4. **`isLlmProvider`** (`connections/providers.ts`): true for the 7 ids, and for an id that `catalogBaseUrl` knows.
5. **Turn target** (`model-target.ts`): a connection whose provider is not a model provider but has a `base_url` becomes `{ provider: 'openai-compatible', apiUrl: base_url, usageProvider: <its id> }`. It therefore always takes the pinned fetch.
   - Add an optional `usageProvider?: string` to `ModelTarget` (`ai/providers.ts`).
   - At the two usage call sites (`group-turn-body.ts:328`, `dm-turn.ts:334`), pass `target.usageProvider ?? target.provider`, with no line growth (both files are at 390+ lines).
6. **Probe:** a catalog provider tests exactly like `openai-compatible` (`<base_url>/models`, bearer), through the same pinned path.

### Tests (keys and auth are crucial)
- Creating a connection with a catalog id stores the catalog base URL.
- An unknown id gets a 400.
- A client `baseUrl` for a catalog id gets a 400.
- `loadModelTarget` maps a catalog connection to `openai-compatible` with `usageProvider`.
- `mapCatalogDocument` keeps a compatible provider from `apps/server/src/ai/__fixtures__/models-dev-sample.json`; add one compatible provider to the fixture.

Put each test in the nearest existing test file, or a new `*.test.ts` next to the code.

### Allowed files
- `apps/server/src/ai/catalog.ts`, `apps/server/src/ai/catalog-map.ts`, `apps/server/src/ai/catalog.test.ts`, `apps/server/src/ai/__fixtures__/models-dev-sample.json`, `apps/server/src/ai/providers.ts`
- `apps/server/src/connections/api.ts`, `apps/server/src/connections/providers.ts`, `apps/server/src/connections/probe.ts`, `apps/server/src/connections/catalog-provider.test.ts`
- `apps/server/src/agents/gateway/model-target.ts`, `apps/server/src/agents/gateway/model-target.test.ts`, `apps/server/src/agents/gateway/group-turn-body.ts`, `apps/server/src/agents/gateway/dm-turn.ts`
- `packages/api-contract/src/connections.ts`, `packages/api-contract/src/ais.ts`
- `work/T-1429-catalog-providers.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ai src/connections src/agents/gateway --reporter=dot
pnpm gate
```

### Acceptance
- `GET /api/ai/catalog` lists the natives plus about 189 compatible providers, each with `kind` and `docUrl`.
- A DeepSeek-style catalog connection runs a turn through the pinned fetch.
- Every changed file stays at 400 lines or fewer.

---

## Report (written by the worker when done)

### What I did
- **Catalog mapping** moved to a new `apps/server/src/ai/catalog-map.ts` (Effect Schema): the six natives stay first in their fixed order, then every models.dev provider with `npm: "@ai-sdk/openai-compatible"` and an `https://` `api`, sorted by name. `mapCatalogDocument` now also publishes each compatible base URL in a server-only map, read through the exported `catalogBaseUrl(id)`. `catalog.ts` keeps the fetch, 24 h cache and fallback (natives only) and re-exports `catalogBaseUrl`. Catalog files: `catalog.ts` 188 lines, `catalog-map.ts` 211.
- **Contract**: `AiCatalogProvider` gains `kind` (`native` | `compatible`) and `docUrl`. `ProviderIdSchema` is now `PROVIDER_IDS` **or** any id matching `^[a-z0-9][a-z0-9.-]{0,63}$`; `PROVIDER_IDS` is unchanged.
- **Create connection** (`connections/api.ts`): a provider outside `PROVIDER_IDS` resolves its base URL from `catalogBaseUrl`, runs it through the same `validatedBaseUrl`, and stores it; an id no catalog knows gets `400 Unknown provider`. A client `baseUrl` is still refused for anything but `openai-compatible` (the contract filter).
- **`isLlmProvider`** is true for the 7 ids and for an id `catalogBaseUrl` knows.
- **Turn target** (`model-target.ts`): a non-model provider with a `base_url` becomes `{ provider: 'openai-compatible', apiUrl: base_url, usageProvider: <its id> }`, so it always takes the pinned fetch. `ModelTarget` gains `usageProvider?: string`; both usage call sites pass `target.usageProvider ?? target.provider` with no line growth (`group-turn-body.ts` 390, `dm-turn.ts` 393).
- **Probe** (`probe.ts`): a catalog id probes like `openai-compatible` (`<base_url>/models`, bearer) through `createPinnedFetch`. `usesCompatiblePath` also catches an id absent from the endpoint table, so a stored catalog connection still probes after a restart.
- **Fixture**: added a compatible `together` provider (with `doc`, `npm`, `api`) and a native `doc` to keep the mapper covered.

### Files changed
`apps/server/src/ai/catalog.ts`, `apps/server/src/ai/catalog-map.ts` (new), `apps/server/src/ai/catalog.test.ts`, `apps/server/src/ai/__fixtures__/models-dev-sample.json`, `apps/server/src/ai/providers.ts`; `apps/server/src/connections/api.ts`, `apps/server/src/connections/providers.ts`, `apps/server/src/connections/probe.ts`, `apps/server/src/connections/catalog-provider.test.ts` (new); `apps/server/src/agents/gateway/model-target.ts`, `apps/server/src/agents/gateway/model-target.test.ts` (new), `group-turn-body.ts`, `dm-turn.ts`; `packages/api-contract/src/connections.ts`, `packages/api-contract/src/ais.ts`. All inside the Allowed files (gate confirms).

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/catalog.test.ts` → 11 passed (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections/catalog-provider.test.ts` → 4 passed (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/model-target.test.ts` → 3 passed (1 file).
- `pnpm gate` (final tree):
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
- **`kind` and `docUrl` are optional in `AiCatalogProvider`.** `packages/mock-backend` (outside Allowed files) annotates a `MOCK_CATALOG: AiCatalog` without them, and `turbo --affected` typechecks it, so required fields would fail the gate. The server always sends both (acceptance still holds); a follow-up can make them required once the mock is updated. Flagging it here rather than editing outside scope.
- `ProviderProbe.testKey` and `testKeyEffect` now take `provider: string` instead of `ProviderId`, because catalog ids are valid at runtime. The endpoint lookup casts back to `ProviderId` only after `usesCompatiblePath` proves it is a known endpoint.
- `catalog.ts` carries a `// effect-plain:` marker: the Effect Schema mapping moved to `catalog-map.ts`, so `catalog.ts` is now a plain fetch/cache module (it would otherwise flip from `effect` to `needs-effect` and trip the ratchet).

### Open questions/risks
- The compatible base-URL map is populated when the catalog is mapped (`getAiCatalog`). After a server restart and before anyone fetches `/api/ai/catalog`, `catalogBaseUrl` is empty, so creating a connection with a catalog id answers `400 Unknown provider` and `isLlmProvider` returns false for such a connection until the catalog is fetched once. `loadModelTarget` and the probe only need the stored `base_url`, so turns still work. This matches spec item 4 ("an id that `catalogBaseUrl` knows"); say the word if you want the map warmed at startup instead.

## Follow-up 1 (cold start, lead review)

- Fixed: `connectionBaseUrl` now `await getAiCatalog()` once (cached or fallback, never rejects) before refusing a non-`PROVIDER_IDS` id, then re-reads the map; `isLlmProvider(provider, hasBaseUrl = false)` returns true for any non-`github` provider whose connection stored a `base_url`, so an existing catalog connection survives a restart with a cold map; `resetCatalogCache()` also drops the derived base-URL map, and a new test creates a `together` connection from a cold map with the fixture stubbed over `fetch`. `pnpm --filter @zilar/server exec vitest run src/connections src/ai --maxWorkers=2 --reporter=dot`: 13 files, 86 passed; `pnpm gate`: GATE PASS.
- Outside-Allowed caller not updated: `apps/server/src/ais/provisioning.ts` calls `isLlmProvider(connection.provider)` at lines 36 and 250 and should pass `connection.baseUrl !== null` so a catalog connection stays usable when created after a restart; listing it here per the review instead of editing outside scope.

## Review (written by Claude)
Lead, 2026-10-15: approved after one lead round (cold start: connection create loads the catalog before refusing an id; `isLlmProvider` takes `hasBaseUrl`). Pre-review CLEAN, nit 1, follow-up 2.
- Local tests: ai, connections and agents/gateway (18 files, 105).
- Follow-ups:
  - pass `hasBaseUrl` at the two `isLlmProvider` calls in `apps/server/src/ais/provisioning.ts` (a tiny task, launched next);
  - make `kind` and `docUrl` required once mock-backend serves them (with the New AI flow tasks).
