---
id: T-1442
title: "New AI shared logic in chat-core: provider choices from the models.dev catalog, key pages and placeholders, key-check flow (create, test, replace, clean up) with plain error copy, orb swatches; mock catalog serves kind/docUrl"
status: merged
milestone: M5
branch: task/T-1442-new-ai-shared
model: auto
effort: default
depends_on: [T-1429, T-1430]
estimate: 0.5 day
---

# T-1442: New AI shared logic

## Spec (written by Claude, do not edit)

### Why
Julio approved the New AI redesign on 2026-10-15. The boards are in `docs/design/mockups/new-ai/`; read `README.md` there and open the `.dc.html` files with `git show main:docs/design/mockups/new-ai/<file>`.

The web flow and the phone flow (the next two tasks) need the same data and rules. This task puts them in `packages/chat-core`, so both apps import one copy. **No UI in this task.**

### Facts (the lead read them on main, 2026-10-15)
- **The catalog:** `AiCatalog` / `AiCatalogProvider` live in `packages/api-contract/src/ais.ts:201-226`.
  - A provider has `id`, `name`, optional `kind` (`'native' | 'compatible'`) and optional `docUrl` (models.dev `doc`), plus `models`.
  - The server lists only callable providers: the built-ins as `native`, and models.dev OpenAI-compatible ones as `compatible` (`apps/server/src/ai/catalog-map.ts:195-221`).
  - Web reads it with `getAiCatalog` (`apps/web/src/lib/api/ais.ts:64`), mobile with `AisApi.getAiCatalog` (`apps/mobile/src/lib/ais-api.ts:91`).
- **Built-in providers:** `packages/chat-core/src/ai-providers.ts:14-25` lists `AI_PROVIDERS` (OpenAI, Anthropic, Google Gemini, DeepSeek, xAI, OpenRouter, OpenAI-compatible, GitHub). `LLM_PROVIDERS` (`:43`) excludes GitHub, and `providerLabel` is at `:53`.
- **Key check:** the probe is `POST /api/connections/:id/test` on a saved connection; it answers `{ ok: true } | { ok: false, message }` (`packages/api-contract/src/connections.ts:106-111`). The fixed server messages (`apps/server/src/connections/probe.ts:96-120`, plus the rate limit in `apps/server/src/connections/api.ts`) are:
  - "The provider rejected the key"
  - "The provider is rate-limiting this key. Try again in a minute."
  - "The provider returned an unexpected response"
  - "The provider is unreachable"
  - "Too many key tests, try again in a minute"
- **Web** has `createConnection` (`apps/web/src/lib/api/ais.ts:169`), `testConnection` (`:192`), `deleteConnection` (`:196`) and `replaceConnectionKey` (`:203`).
- **Mobile** `apps/mobile/src/lib/connections-api.ts:44-49` has `listConnections`, `createConnection`, `testConnection` and `deleteConnection`, but **no `replaceConnectionKey`**. The mock backend already answers the replace-key route (`packages/mock-backend/src/domains/connections/routes.ts:42-43`); find the exact method and path in the web `replaceConnectionKey`.
- **Orb:** `packages/chat-core/src/avatar.ts:74-86` exports `orbParamsFor(seed)`, `orbSvg(params, idSeed)` and `orbDataUri(params, idSeed)`. `BallParams` (`packages/ball-avatar/index.ts:35-44`) is `{ hue, rim, angle (radians), distance (0-1) }`.
- **The orb picker board** (`docs/design/mockups/new-ai/OrbPicker.dc.html`):
  - body hues `[[0,'Red'],[18,'Coral'],[32,'Orange'],[45,'Amber'],[58,'Yellow'],[90,'Lime'],[140,'Green'],[165,'Teal'],[190,'Cyan'],[215,'Blue'],[240,'Indigo'],[265,'Violet'],[290,'Purple'],[320,'Pink']]`;
  - rim lights `[[300,'Magenta'],[200,'Ice'],[160,'Mint'],[50,'Gold'],[20,'Ember'],[260,'Lilac'],[0,'Rose']]`;
  - the light distance is clamped to 0.4.
- **The mock catalog** (`packages/mock-backend/src/domains/ais/routes.ts:186+`, `MOCK_CATALOG`; the file is 298 lines) has no `kind` or `docUrl`.

### What to build
1. **New file `packages/chat-core/src/new-ai.ts`:**
   - `interface ProviderChoice { id: string; label: string; hasKey: boolean }`.
   - `providerChoices(catalog: AiCatalog | null, connections: readonly { provider: string; status: string }[]): ProviderChoice[]`:
     - one entry per catalog provider;
     - when `catalog` is null, the `LLM_PROVIDERS` except OpenAI-compatible;
     - **order** (as on `Main.dc.html`): OpenAI, then Anthropic, then the rest by label A-Z ignoring case, then OpenAI-compatible always last (it isn't a catalog entry, so add it);
     - `hasKey` is true when an `active` connection has that provider id.
   - `filterProviderChoices(choices, query)`: case-insensitive match on label or id. OpenAI-compatible always stays in the list.
   - `keyPageFor(providerId, catalog)` returns:
     - the known page for OpenAI `https://platform.openai.com/api-keys`, Anthropic `https://platform.claude.com/settings/keys`, Google `https://aistudio.google.com/apikey`, DeepSeek `https://platform.deepseek.com/api_keys`, xAI `https://console.x.ai`, or OpenRouter `https://openrouter.ai/keys`;
     - otherwise the catalog `docUrl` when it is non-empty;
     - otherwise `null`.
   - `keyPlaceholderFor(providerId)`: `sk-…` (openai, deepseek), `sk-ant-…`, `AIza…`, `xai-…`, `sk-or-…`; otherwise `Paste your key`.
   - `keyCheckMessage(providerLabel, serverMessage)` maps the five server messages to:
     - "{P} did not accept this key. Check that you copied all of it."
     - "{P} is limiting this key right now. Wait a minute and try again."
     - "{P} gave an unexpected answer. Try again."
     - "Could not reach {P}. Check the address and try again."
     - "Too many checks. Wait a minute and try again."
     - Anything else: "Could not check the key. Try again."
   - `ORB_HUES` and `ORB_RIMS` (readonly `{ value: number; name: string }[]`, from the board), `ORB_MAX_DISTANCE = 0.4`, `clampOrbLight(angle, distance)`, and `shuffleOrb(random: () => number): BallParams`.
2. **New file `packages/chat-core/src/connection-check.ts`**, the key-check flow with an injected API (`createConnection`, `testConnection`, `replaceConnectionKey`, `deleteConnection`):
   - `checkKey(api, state, input)`:
     - when `state.connectionId` is null, create the connection (provider, key, label, baseUrl) and then test it;
     - otherwise replace the key on that id and test again;
     - it returns `{ connectionId, verified, message? }`, where `message` comes from `keyCheckMessage`.
   - `abandonKeyCheck(api, state)` deletes the connection only when this flow created it and it was never verified. Failures are ignored.
   - Plain `async` functions, like the rest of chat-core.
3. Export both from `packages/chat-core/src/index.ts`.
4. **Mobile:** add `replaceConnectionKey(id, key)` to `apps/mobile/src/lib/connections-api.ts`, with the same route as web.
5. **Mock:** `MOCK_CATALOG` providers gain `kind: 'native'` and `docUrl`, plus one `compatible` provider (for example `{ id: 'together', name: 'Together AI', kind: 'compatible', docUrl: 'https://docs.together.ai', models: [one model] }`). Keep the file at 400 lines or fewer.

### Tests (keys are crucial)
In `packages/chat-core/src/connection-check.test.ts`:
1. The first check creates and then tests.
2. A failed check followed by a retry replaces the key on the same id; nothing new is created.
3. `abandonKeyCheck` deletes an unverified, flow-created connection, and leaves a verified one alone.

### Allowed files
- `packages/chat-core/src/new-ai.ts`, `packages/chat-core/src/connection-check.ts`, `packages/chat-core/src/connection-check.test.ts`, `packages/chat-core/src/index.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `packages/mock-backend/src/domains/ais/routes.ts`
- `work/T-1442-new-ai-shared.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/connection-check --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the 3 tests pass.
- No UI file changes.

---

## Report (written by the worker when done)

### What I did
- New `packages/chat-core/src/new-ai.ts`: `ProviderChoice`, `providerChoices` (catalog order OpenAI, Anthropic, rest A-Z ignoring case, OpenAI-compatible pinned last; `null` catalog falls back to `LLM_PROVIDERS` minus OpenAI-compatible; `hasKey` from `active` connections), `filterProviderChoices` (case-insensitive label/id, OpenAI-compatible kept), `keyPageFor` (known pages then catalog `docUrl`), `keyPlaceholderFor`, `keyCheckMessage` (the five server messages to plain copy), `ORB_HUES` (14), `ORB_RIMS` (7), `ORB_MAX_DISTANCE = 0.4`, `clampOrbLight`, `shuffleOrb`.
- New `packages/chat-core/src/connection-check.ts`: `checkKey` (create-and-test on the first check, replace-and-test after; returns the next state plus a plain `message` on failure) and `abandonKeyCheck` (deletes only a flow-created, never-verified connection; delete failures ignored).
- `packages/chat-core/src/index.ts`: exports both new modules.
- `apps/mobile/src/lib/connections-api.ts`: added `replaceConnectionKey(id, key)`, same route as web (`PATCH /connections/:id`, `connections.update`, key trimmed).
- `packages/mock-backend/src/domains/ais/routes.ts`: every `MOCK_CATALOG` provider gained `kind: 'native'` and a `docUrl`, plus one `compatible` provider (`together`, `Together AI`, `docUrl: 'https://docs.together.ai'`, one model). File is 330 lines (limit 400).

### Files changed
`packages/chat-core/src/new-ai.ts`, `packages/chat-core/src/connection-check.ts`, `packages/chat-core/src/connection-check.test.ts`, `packages/chat-core/src/index.ts`, `apps/mobile/src/lib/connections-api.ts`, `packages/mock-backend/src/domains/ais/routes.ts`, `work/T-1442-new-ai-shared.md`. All inside Allowed files. No UI file changed.

### Commands and results
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/connection-check` — 1 file passed, 5 tests passed (the 3 the spec asked for plus 2 more: abandon leaves a verified connection alone, and leaves a pre-existing one alone).
- `pnpm gate` — `GATE PASS`. Summary lines:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `PASS tests @zilar/chat-core`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/mock-backend (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: ...`, `size: every changed source file is within 400 lines`
- The first gate run failed on `format` (test file) and on `effect`; I ran prettier on the test file and added the marker below, then the gate passed.

### Deviations from the spec (all deliberate)
1. `providerChoices`/`keyPageFor` take a structural `CatalogView`/`CatalogProviderView` (`{ providers: { id, name, docUrl? }[] }`) instead of importing `AiCatalog`: `chat-core` does not depend on `@zilar/api-contract`, and the wire `AiCatalog` is assignable to this view. This follows `CatalogModelView` in `ai-models.ts:22-25`. The functions behave exactly as the spec describes.
2. `KeyCheckState`/`KeyCheckResult` carry a `created` flag (a superset of the spec's `{ connectionId, verified, message? }`). `abandonKeyCheck` needs it to tell a connection this flow created from a pre-existing one the caller passed in, which is the spec's own rule; without it, a flow adopting an existing id could delete it. `checkKey` returns the next state, so the caller just passes the result back in.
3. `checkKey` wraps create/replace/test in `try/catch`. On a thrown call it still returns the known `connectionId` (and the `created` flag) so the caller can abandon a half-made connection instead of leaking it; the message goes through `keyCheckMessage`, so raw error text never reaches the user.
4. `connection-check.ts` starts with `// effect-plain: ...`. The effect ratchet otherwise fails any new plain-`async` file; the spec says these are plain async functions like the rest of `chat-core`, so the exempt marker is the intended shape (same as `packages/chat-core/src/url.ts`).

### Open questions
None. Nothing blocked.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- The connection-check tests (5) pass locally.
- The exports the web and mobile New AI flows build on:
  - `providerChoices`, `filterProviderChoices`, `keyPageFor`, `keyPlaceholderFor`, `keyCheckMessage`;
  - `ORB_HUES`, `ORB_RIMS`, `clampOrbLight`, `shuffleOrb`;
  - `checkKey` and `abandonKeyCheck`.
- Mobile gained `replaceConnectionKey`, and the mock catalog serves `kind`/`docUrl` plus Together AI.
