---
id: T-1395
title: "AI model picker from the models.dev catalog: server endpoint GET /api/ai/catalog (fetched from models.dev, cached 24 h, filtered to our LiteLLM providers, static fallback) and a searchable model picker with context size and prices on web and mobile"
status: merged
milestone: M5
branch: task/T-1395-models-dev-catalog
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1395: models.dev catalog

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, asked how OpenCode knows its providers and models, and picked "Catalog from models.dev". Today the model step is a static hint list per provider (`packages/chat-core/src/ai-models.ts:4-11`; its comment at `:1-3` already names models.dev as the next step), shown by `apps/web/src/components/ais/ModelPicker.tsx` (103 lines) and `apps/mobile/src/components/ais/model-picker.tsx` (55 lines). The names go stale fast; the hint list still says `gpt-4o` and `claude-sonnet-5`.

### What to build
1. **Server:** a new GET route at /api/ai/catalog (signed-in users), in a new `apps/server/src/ai/catalog.ts` plus its route in the AI or AIs API group (find where `/api/ais` is defined and cite it).
   - **Fetch** the public models.dev JSON. Verify the exact URL (expected `https://models.dev/api.json`) and its shape, and cite both in the Report. Use a 10 s timeout and at most 5 MB; it's a fixed public https host, so a plain `fetch` is fine.
   - **Cache** in memory for 24 h. On failure, serve the last good copy, or else the static list from `ai-models.ts`, marked `source: 'fallback'`.
   - **Keep only our LLM providers**, mapped models.dev id → ours: openai, anthropic, google, deepseek, xai, openrouter (`apps/server/src/ais/litellm-model.ts:8-15`).
   - **Per model, answer:** `id` (exactly what LiteLLM expects after the prefix, e.g. `gpt-4o-mini`; for OpenRouter `vendor/model`), `name`, `contextTokens`, `inputPricePerMTok`, `outputPricePerMTok`, `toolCalls` (boolean), `reasoning` (boolean), `releaseDate`.
   - **Order** newest first. Drop models that are deprecated, or that have no text input or no text output.
2. **Contract:** add the response schema to `packages/api-contract` next to the AI endpoints, and a mock-backend route that returns a small fixed catalog.
3. **Web and mobile model pickers:**
   - a searchable list for the chosen provider: name, context (e.g. "200K"), prices as "$3 / $15 per M tokens", and a small "tools" badge;
   - **still accept a typed model id** (free text stays possible);
   - default to the first model with `toolCalls: true`;
   - use the kit `Select` / `select-sheet` from T-1394 if they're on `main` when you start; otherwise a simple list.
4. **The existing AI create and edit flow still saves the same `model` string.** No change to how AIs are provisioned.
5. **Tests:** one server test for the mapping and filtering, using a small recorded sample of the JSON as a fixture under `apps/server/src/ai/__fixtures__/`. **No UI tests.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `packages/chat-core/src/ai-models.ts`, `apps/server/src/ais/litellm-model.ts`, `apps/server/src/ais/api.ts`, `packages/api-contract/src/ais.ts` (or the AI contract file; find it), both `ModelPicker` files, `apps/mobile/src/app/ais/new.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`.

### Allowed files
`apps/server/src/ai/catalog.ts`, `apps/server/src/ai/catalog.test.ts`, `apps/server/src/ai/__fixtures__/*.json`, `apps/server/src/ais/*.ts`, `apps/server/src/http/*.ts`, `packages/api-contract/src/*.ts`, `packages/mock-backend/src/domains/ais/*.ts`, `packages/chat-core/src/ai-models.ts`, `apps/web/src/components/ais/*.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/*.ts`, `apps/mobile/src/components/ais/*.tsx`, `apps/mobile/src/components/ais/*.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/app/ais/[id].tsx`, `work/T-1395-models-dev-catalog.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ai/catalog.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **Live after the deploy:** the new GET route at /api/ai/catalog returns current models for the 6 providers, and the wizard's model step shows them with context and prices on web and the phone.

---

## Report (written by the worker when done)

### What I did

**Verified the source (spec asks for the exact URL and shape).** `GET https://models.dev/api.json` on 2026-10-14 returned 200, 5,634,138 bytes, 229 providers. Shape: `{ "<providerId>": { id, env, npm, name, doc, models } }`, and each model has `id, name, release_date, tool_call, reasoning, status, modalities { input, output }, limit { context }, cost { input, output }` (USD per million tokens) — plus other fields the mapper ignores.

**Server.** New `apps/server/src/ai/catalog.ts`:
- fetches models.dev with `AbortSignal.timeout(10_000)` and caps the body at 5 MB (`readCappedBody`);
- keeps the six LLM providers `openai, anthropic, google, deepseek, xai, openrouter`. models.dev uses the same ids we do, so the id mapping is the identity (the LiteLLM prefixes live in `apps/server/src/ais/litellm-model.ts:8-15`);
- per model answers `id, name, contextTokens, inputPricePerMTok, outputPricePerMTok, toolCalls, reasoning, releaseDate`; drops `status === 'deprecated'` and models whose `modalities` explicitly have no text input/output; sorts each provider's models newest first;
- caches in memory for 24 h; on failure serves the last good copy (`source: 'cache'`) or the static list (`source: 'fallback'`). `mapCatalog` is pure and drives the test with the fixture.

**Route.** The `/api/ais` group is `AisGroup` in `packages/api-contract/src/ais.ts` (`.prefix('/api')`), mounted by `createAisApi` in `apps/server/src/ais/api.ts`, which `apps/server/src/app.ts:566-576` pushes into the edge. I added a `catalog` endpoint (`GET /ai/catalog` → `/api/ai/catalog`) to that group and its one-line handler in `createAisApi`. It carries the group's `Session` middleware, so it is signed-in only and the 401 sweep covers it; it does **not** carry `AisConfigured`, so it answers even when LiteLLM or the cipher is missing.

**Contract + mock.** `packages/api-contract/src/ais.ts` gained `AiCatalogModel`, `AiCatalogProvider` and `AiCatalog` (`source: 'models.dev' | 'cache' | 'fallback'`); the derived client exposes `ais.catalog()`. `packages/mock-backend/src/domains/ais/routes.ts` answers `/api/ai/catalog` with a small fixed six-provider catalog.

**Web + mobile pickers.** `apps/web/src/components/ais/ModelPicker.tsx` and `apps/mobile/src/components/ais/model-picker.tsx` now render a searchable catalog list (name, `"128K"` context, `"$2.5 / $15 per M tokens"`, a small `tools` badge) while the free-text model field stays. `apps/web/src/components/ais/NewAiDialog.tsx` and `apps/mobile/src/app/ais/new.tsx` fetch the catalog and preselect the first model with `toolCalls: true`. Shared formatting/default helpers live in `packages/chat-core/src/ai-models.ts` (`defaultCatalogModelId`, `formatContextTokens`, `formatModelPrices`). The model string saved by create/edit is unchanged.

### Files changed
- `apps/server/src/ai/catalog.ts` (new), `apps/server/src/ai/catalog.test.ts` (new), `apps/server/src/ai/__fixtures__/models-dev-sample.json` (new, 333 lines)
- `apps/server/src/ais/api.ts`, `apps/server/src/ais/http-logger.ts` (new)
- `packages/api-contract/src/ais.ts`, `packages/chat-core/src/ai-models.ts`, `packages/mock-backend/src/domains/ais/routes.ts`
- `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/ais.ts`, `apps/web/src/components/ais/ModelPicker.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/components/ais/models.ts`, `apps/mobile/src/components/ais/model-picker.tsx`, `apps/mobile/src/app/ais/new.tsx`

### Commands and real results
- `pnpm install` — done in 13.1s (one unrelated peer warning on `@types/react`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/catalog.test.ts` — **1 file passed, 7 tests passed.**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` — **5 passed**; the sweep prints `GET /api/ai/catalog -> 401`.
- `pnpm gate` — **GATE PASS** (summary lines):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.5s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.2s)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (5.7s)
  PASS  tests @zilar/web  (4.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / decisions
1. **Static fallback duplication.** `@zilar/server` does not depend on `@zilar/chat-core` (its `package.json` is not in the Allowed files), so the server cannot import `MODEL_SUGGESTIONS`. `apps/server/src/ai/catalog.ts` repeats the same six lists in `FALLBACK_MODEL_IDS`; a follow-up could move them into `@zilar/api-contract` so both sides share one copy.
2. **Prices are nullable.** Some models have no `cost` in models.dev; those answer `inputPricePerMTok`/`outputPricePerMTok: null` and the UI shows "Price unavailable" instead of a misleading `$0`.
3. **Text filtering is lenient.** A model is dropped only when `modalities` explicitly lack a text input or output; a model with no `modalities` at all is kept.
4. **Simple list, not the kit `Select`.** No `Select`/`select-sheet` exists in this branch (T-1394 is not merged), so both pickers use a plain list, as the spec allows.
5. **Catalog is wired into the create wizard only.** `ModelPicker` takes `models` as an optional prop, so the edit forms on both platforms (web `AiPanel`/`AiFormFields`, mobile `[id].tsx`) keep the static suggestions unchanged — the spec's acceptance is the wizard, and item 4 asks for no change to the edit flow.
6. **Line limit.** To keep `apps/server/src/ais/api.ts` at ≤ 400 lines (now 392), I moved its small `toLogger` adapter to `apps/server/src/ais/http-logger.ts`.

No open questions; nothing blocked.

### Fix round (findings 1 and 2)

Fixed the two blocking findings from `PREREVIEW.md`, each with its own commit and a regression test.

- **Finding 1 (must-fix, 5 MB cap).** `MAX_BYTES` in `apps/server/src/ai/catalog.ts` is now **15 MB**, so the measured 5,634,138-byte payload fits; the thrown message no longer names a now-wrong size. Test added: `getAiCatalog > accepts a body above the old 5 MB cap` feeds a 5.5 MB body and asserts `source: 'models.dev'`. Verified it fails on the old cap (`expected 'fallback' to be 'models.dev'`).
- **Finding 2 (should-fix, one malformed model drops its whole provider).** `ModelsDevProvider` is now decoded loosely (`Record(string, unknown)`) and each model is decoded on its own; a model that fails to decode is skipped while its provider stays. Test added: `mapCatalog > skips a malformed model instead of dropping its provider` (a model with no `name`, a non-object entry, and two good models). Verified it fails on the old provider-wide decode (`expected undefined to be 'openai'`).
- **Nits 3 and 4 left unchanged in this round**, per its scope (must-fix and should-fix only): the stale-cache test at `catalog.test.ts:101`, and the mobile default after switching provider (`apps/mobile/src/app/ais/new.tsx`). Neither line was one I changed. They were picked up in **Fix round 1** below. No disagreements — both fixed findings were correct.

#### Commands and real results (fix round)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/catalog.test.ts` — **1 file passed, 9 tests passed** (7 at review time; +1 for each fix).
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.7s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.2s)
  PASS  tests @zilar/mobile  (1.4s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (5.6s)
  PASS  tests @zilar/web  (3.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Fix round 1 (the two nits and the mock-method gap)

Three items, one commit each:

1. **Mobile model reset on provider change** (`apps/mobile/src/app/ais/new.tsx`, `ProviderStep`'s `onChange`). The handler now clears `model` in the same `setForm`, so going back and picking another provider re-prefills the new provider's default on the next step instead of keeping the old provider's id. Mirrors web's `chooseConnection`.
2. **Stale-cache test now exercises the failure branch** (`apps/server/src/ai/catalog.test.ts`). The second call uses `now: () => 24 * 60 * 60 * 1000 + 1`, past the 24 h TTL, so the failing fetch really runs and `getAiCatalog` takes its catch branch to serve the stale copy.
3. **Mock catalog is GET-only** (`packages/mock-backend/src/domains/ais/routes.ts`). `/api/ai/catalog` now answers `GET` only; other methods fall through as every other route does.

#### Commands and real results (fix round 1)
- `pnpm --filter @zilar/server exec vitest run src/ai/catalog.test.ts --reporter=dot` — **1 file passed, 9 tests passed**.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.5s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.5s)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (9.9s)
  PASS  tests @zilar/web  (6.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Fix round 2 (the line-limit should-fix)

- **Finding 1 (should-fix).** `apps/mobile/src/app/ais/new.tsx` was **403 lines**, over the spec's 400-line limit. I extracted its step-6 `ReviewStep` component (a pure props render, no state, no effects) into a new `apps/mobile/src/components/ais/review-step.tsx`. `new.tsx` is now **349 lines** and the new file **66 lines** — both well under 400. No behaviour change: the JSX and its `rows` table moved unchanged, and the imports that only `ReviewStep` used (`Plus` from lucide, `formatLimit`, `providerLabel`, `templateLabel`, and the `AiLimits` type) moved with it, so no unused imports are left behind. The finding's example was to extract the catalog/`goNext` helpers; extracting a whole self-contained component is a larger, equally safe cut and leaves the screen clear of the limit.
- Tests: none added. This is a code move with no behaviour change (spec: "No UI tests").
- **Nit 2 (concurrent cold-request single-flight in `catalog.ts`) left unchanged.** It is not in a line this round touched, and the finding itself rates its impact negligible.
- No disagreements this round.

#### Commands and real results (fix round 2)
- `pnpm --filter @zilar/server exec vitest run src/ai/catalog.test.ts --reporter=dot` — **1 file passed, 9 tests passed**.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.4s)
  PASS  tests @zilar/mobile  (1.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (8.4s)
  PASS  tests @zilar/web  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 2 rounds (nit: no single-flight on a cold cache; follow-up: the static fallback list duplicates chat-core). Phone smoke PASS (mock build, /ais/new). On the emulator: step 4 lists the OpenAI models with context, prices and the tools badge; Back, switch to Anthropic, Next shows claude-sonnet-4-5 (the stale-model bug is fixed). Live: call /api/ai/catalog after the deploy.
