---
id: T-1396
title: "Custom OpenAI-compatible provider: a connection with base URL + key (Groq, Together, Mistral, self-hosted...), SSRF-guarded at save, probe and every model call (pinned public IP), served by the Effect AI openai-compat client; migration 0058 adds base_url"
status: merged
milestone: M5
branch: task/T-1396-openai-compatible-provider
model: auto
effort: default
depends_on: [T-1394, T-1399, T-1413]
estimate: 1 day
---

# T-1396: Custom OpenAI-compatible provider

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, picked "Any OpenAI-compatible". Users can bring any service that speaks the OpenAI API (Groq, Together, Mistral, Fireworks, a self-hosted server) with a base URL and a key, the way OpenCode allows.

(This spec was rewritten on 2026-10-14 after LiteLLM was removed, by T-1399 and T-1413. Model calls now go through Effect AI.)

**Security (auth and keys area):** a user-supplied URL makes **our server** call that address. That is an **SSRF risk**, aimed at internal services such as ejabberd, Postgres and Coolify.

The guard must hold on **every** request, not only at save time, so DNS rebinding can't get through: validate, resolve, refuse any private address, and **connect to the pinned public IP**.

### Facts (the lead checked them on main, 2026-10-14)
- **Provider ids** are a fixed contract list (`packages/api-contract/src/connections.ts:17-25`). Server re-export: `apps/server/src/connections/providers.ts` (the `LLM_PROVIDER_IDS` list at `:7-14`). The client list is `packages/chat-core/src/ai-providers.ts:15-21`.
- **Model calls:**
  - `apps/server/src/ai/providers.ts`: `MODEL_PROVIDERS` at `:16-23`; `ModelTarget { provider, apiKey, model, apiUrl? }` at `:35-40`, where **`apiUrl` overrides the base URL** ("T-1396's custom provider later"); `COMPAT_BASE_URLS` at `:44-48`; `buildLanguageModel` with an `OpenAiCompat` branch.
  - `apps/server/src/ai/model-client.ts:309-322`: each call is provided `FetchHttpClient.layer`, and an optional `input.fetchImpl` replaces `FetchHttpClient.Fetch`. **This is where a pinned fetch goes.**
- **The target is loaded** in `apps/server/src/agents/gateway/model-target.ts` (`loadModelTarget`, SQL at `:29-33`; it returns `{ provider, apiKey, model }` at `:41`).
- **Key probes** live in `apps/server/src/connections/probe.ts` (one GET per provider, `:27-48`).
- **The IP guard** is `classifyIp`/`isIpLiteral` from `@zilar/desk/egress/ip-guard` (re-exported by `apps/server/src/sandbox/ip-guard.ts`). The resolve-classify-pin pattern is `apps/server/src/web-tools/guarded-fetch.ts:173-215` (`guardedGet`, GET only, `anyPublicHost` option).
- **Migrations:** the latest is `apps/server/drizzle/0057_ai_computer_mode.sql`. Start the new file with `SET lock_timeout = '5s';--> statement-breakpoint` and update `apps/server/src/db/rows.ts`.

### What to build
1. **Migration `0058_provider_base_url.sql`:** `provider_connections.base_url text NULL`, with a check that it is NULL or at most 300 chars. Update `rows.ts`.
2. **Contract:**
   - add provider id `openai-compatible` to `PROVIDER_IDS`, the server's LLM list and chat-core's list (label "OpenAI-compatible");
   - the create body takes `baseUrl` (required for this provider, refused for every other one);
   - the connection view returns `baseUrl`;
   - the label is required for this provider, so a user can tell several apart.
3. **`apps/server/src/connections/base-url.ts`** (new):
   - `validateBaseUrl(raw)`: **https only**, no credentials, no query or fragment, port 443 or empty; normalize away a trailing slash; a bare host gets `/v1`;
   - `resolvePublic(host)`: **every** resolved address must be public; IP literals are refused.
4. **`apps/server/src/connections/pinned-fetch.ts`** (new): a `fetch`-compatible function for **one validated base URL**.
   - Each request re-resolves the host, refuses any private address, and connects to the pinned public IP with the right SNI and `Host` (`node:https` with a fixed `lookup`, the same idea as `guarded-fetch.ts`).
   - It supports POST and streaming response bodies (the model call streams).
   - **It never follows redirects,** and it refuses any request whose URL host differs from the configured base host.
5. **Probe:** `GET {baseUrl}/models` with `Authorization: Bearer <key>` through the pinned fetch, a 10 s timeout. 2xx is ok; 401 or 403 is a bad key; anything else is unreachable. **Never log the key or the response body.**
6. **Model calls:**
   - `MODEL_PROVIDERS` gains `openai-compatible`;
   - `loadModelTarget` selects `pc.base_url` and sets `apiUrl` for it;
   - `buildLanguageModel` uses `OpenAiCompat` with that URL;
   - the model call passes the pinned fetch as `fetchImpl` for this provider only.
   
   The model id is free text (there's no catalog for this provider).
7. **Web and mobile:**
   - "OpenAI-compatible" in the provider dropdown (T-1394), with a Base URL field (placeholder `https://api.groq.com/openai/v1`) and a required Label;
   - the connection card shows the label and the host;
   - the AI wizard's model step is a text field for this provider.
   
   Read the T-1394 and T-1395 components first: web `apps/web/src/components/connections/`, `apps/web/src/components/ais/`; mobile `apps/mobile/src/components/connections/`, `apps/mobile/src/components/ais/`.
8. **Mock backend:** one OpenAI-compatible connection in the seed ("Groq", `https://api.groq.com/openai/v1`).

### Tests (keys and security: required)
- **`base-url.test.ts`:**
  - accepts a public https URL;
  - rejects http, credentials, a query, `localhost`, private, link-local and `169.254.169.254` literals;
  - rejects a host that resolves to one public and one private address.
- **`pinned-fetch.test.ts`:**
  - a request to another host is refused;
  - a redirect isn't followed;
  - a host that re-resolves to a private address on the second call is refused (inject the resolver).
- **One model-call test** with a fake OpenAI-compatible server: the call goes to `{baseUrl}/chat/completions` with the key. Reuse the fake server from `apps/server/src/agents/dm-turn.fake-provider.test.ts`, with the resolver injected so localhost is allowed **only in the test**.

### Read first
`AGENTS.md`, the files above, `apps/server/src/connections/service.ts`, `apps/server/src/connections/api.ts`, and `apps/server/src/connections/crypto.ts` (how keys are sealed).

### Allowed files
`apps/server/drizzle/0058_provider_base_url.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/connections/**`, `apps/server/src/ai/**`, `apps/server/src/agents/gateway/model-target.ts`, `apps/server/src/agents/*.test.ts`, `apps/server/src/ais/*.ts`, `packages/api-contract/src/connections.ts`, `packages/api-contract/src/ais.ts`, `packages/mock-backend/src/domains/connections/**`, `packages/chat-core/src/ai-providers.ts`, `packages/chat-core/src/ai-models.ts`, `apps/web/src/components/connections/**`, `apps/web/src/components/ais/**`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/*.ts`, `apps/mobile/src/components/connections/**`, `apps/mobile/src/components/ais/**`, `apps/mobile/src/lib/connections-api.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/app/ais/new.tsx`, `work/T-1396-openai-compatible-provider.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/connections src/ai --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- No request to a user base URL leaves the server except through the pinned fetch. Say in the Report how you made sure (grep for the call sites).

---

## Report (written by the worker when done)

Status: review.

### What I built
- **Migration `0058_provider_base_url.sql`**: `provider_connections.base_url text NULL` with a check (`NULL` or ≤300 chars), first line `SET lock_timeout = '5s';--> statement-breakpoint`. `db/rows.ts` gains `ProviderConnectionRow`; `connections/service.ts` uses it and reads/writes `base_url`.
- **Contract** (`packages/api-contract/src/connections.ts`): provider id `openai-compatible` in `PROVIDER_IDS`; `CreateConnectionPayload` takes an optional `baseUrl` (required for the custom provider, refused for every other one; a label is required for the custom provider); `ConnectionView` returns `baseUrl`. Server `connections/providers.ts` and `packages/chat-core/src/ai-providers.ts` add the id (label "OpenAI-compatible") to their LLM lists.
- **`connections/base-url.ts`**: `validateBaseUrl` (https only, no credentials/query/fragment, port 443 or empty, no `localhost`/IP literal, drops a trailing slash, bare host gets `/v1`, ≤300) and `resolvePublic` (every resolved address must be public; IP literals refused).
- **`connections/pinned-fetch.ts`**: `createPinnedFetch` is `fetch`-compatible for one base URL: refuses a request whose host/port differs, re-resolves the host on every request, refuses a blocked address, connects to the pinned address with the base host's SNI and `Host`, supports POST and streaming request/response bodies, and never follows redirects. `customProviderFetch(target)` returns it for `openai-compatible` only.
- **Save-time guard** (`connections/api.ts`): for `openai-compatible` it runs `validateBaseUrl` then `resolvePublic` and answers 400 with a fixed sentence on failure.
- **Probe** (`connections/probe.ts`): `GET {baseUrl}/models` with `Authorization: Bearer <key>` through the pinned fetch, 10 s timeout; 2xx ok, 401/403 a bad key, anything else unreachable. The key and the body are never logged.
- **Model calls**: `MODEL_PROVIDERS` gains the id; `agents/gateway/model-target.ts` selects `pc.base_url` and sets `apiUrl` (a null URL for the custom provider skips the turn); `ai/providers.ts` uses `OpenAiCompat` with that URL; `ai/model-client.ts` `chat()` provides the pinned fetch as `FetchHttpClient.Fetch` for this provider only.
- **Web**: `lib/api/ais.ts` sends `baseUrl`; `AddConnectionForm` shows a Base URL field (placeholder `https://api.groq.com/openai/v1`) and a required Label for the custom provider; `ConnectionsPage` shows the label and the base URL host; `ModelPicker` shows only the free-text field when a provider has no catalog/suggestions.
- **Mobile**: `lib/connections-api.ts` + `save-connection.ts` send `baseUrl`; `add-connection-form` shows the Base URL field and requires the label for the custom provider; `connection-card` shows the label and the host; the wizard model step is already the free-text field for an empty catalog.
- **Mock backend**: seed adds the "Groq" connection (`openai-compatible`, `https://api.groq.com/openai/v1`); the create route accepts `baseUrl`.

### Files changed (28: 22 modified, 6 new)
New: `apps/server/drizzle/0058_provider_base_url.sql`, `apps/server/src/connections/base-url.ts`, `apps/server/src/connections/pinned-fetch.ts`, `apps/server/src/connections/base-url.test.ts`, `apps/server/src/connections/pinned-fetch.test.ts`, `apps/server/src/ai/model-client.openai-compatible.test.ts`.
Modified: `apps/server/src/db/rows.ts`, `apps/server/src/connections/{service,api,probe,providers}.ts`, `apps/server/src/ai/{providers,model-client}.ts`, `apps/server/src/agents/gateway/model-target.ts`, `packages/api-contract/src/connections.ts`, `packages/chat-core/src/ai-providers.ts`, `packages/mock-backend/src/domains/connections/{seed,routes}.ts`, `apps/web/src/lib/api/ais.ts`, `apps/web/src/components/connections/AddConnectionForm.tsx`, `apps/web/src/components/ais/ModelPicker.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/mobile/src/lib/{connections-api,ais-api}.ts`, `apps/mobile/src/components/connections/{add-connection-form,connection-card,save-connection}.tsx/.ts`, `work/T-1396-openai-compatible-provider.md`.

### Commands run (real results)
Round 1:
- `pnpm install` — done (1137 packages, no errors).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections/base-url.test.ts src/connections/pinned-fetch.test.ts src/agents/dm-turn.openai-compatible.test.ts` — 3 files, 22 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/connections src/ai --reporter=dot` — 10 files, 72 tests passed.
- `pnpm gate` — GATE PASS (28 changed files).

Lead round (after the hardening below):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/model-client.openai-compatible.test.ts src/connections/pinned-fetch.test.ts` — 2 files, 8 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/connections src/ai --reporter=dot` — 11 files, 75 tests passed.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 29 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (2.5s)
  PASS  lint  (2.2s)
  PASS  typecheck  (7.0s)
  PASS  effect  (3.1s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (3.2s)
  PASS  tests @zilar/mobile  (5.0s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (13.4s)
  PASS  tests @zilar/web  (9.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

Round 2 (fix round, PREREVIEW `c0dedaf`):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ai/model-client.openai-compatible.test.ts` — 1 file, 4 tests passed (includes the new redirect regression test).
- `pnpm --filter @zilar/server exec vitest run src/connections src/ai --reporter=dot` — 11 files, 76 tests passed.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 28 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (8.1s)
  PASS  tests @zilar/web  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Round 2 (fix round, PREREVIEW `c0dedaf`)
PREREVIEW counts: must-fix=0, should-fix=2, nit=3, follow-up=0.

- **Finding 1 (should-fix — Effect client 3xx/redirect).** Verified from the installed library source; no change to the pinned fetch. For a model call the only `fetch` the compat client can use is the pinned one: `chat()` provides `FetchHttpClient.Fetch` (`apps/server/src/ai/model-client.ts:343-349`), and `@effect/ai-openai-compat` runs `HttpClient.filterStatusOk` on the response **before** it reads or streams a body (`OpenAiClient.js`, `createResponse` / `createResponseStream`). `filterStatusOk` fails every non-2xx (`effect/http/HttpClientResponse.js:151`), so a 3xx becomes an `HttpClientError` → `AiError` before anything could act on it; the client never issues a second request. Added a regression test that a 302 from the custom provider is surfaced as `ChatCompletionError(302, …)` and that the redirect target path is never requested. The pinned fetch keeps its documented contract (it hands the raw 3xx back; the existing `does not follow a redirect` unit test). Mapping 3xx to an error inside the pinned fetch was not needed.
- **Finding 2 (should-fix — mobile wizard model step).** No code change: the empty-state handling already exists. For `openai-compatible` both `modelSuggestionsFor` and `defaultModelFor` return `''`/`[]` (`packages/chat-core/src/ai-models.ts:13-20`), so `apps/mobile/src/components/ais/model-picker.tsx` renders only the free-text `Model` field (the `suggestions.length > 0 ? … : null` branch, `:98-113`), the same as web (`apps/web/src/components/ais/ModelPicker.tsx:115-118`), and `apps/mobile/src/app/ais/new.tsx:142-150` prefills nothing. `isLlmProvider('openai-compatible')` is true (`packages/chat-core/src/ai-providers.ts:31-50`), so the connection is selectable and step 4 enables Next once a model is typed. See Disagreements.

### Disagreements
- **PREREVIEW finding 2** asked to either add the mobile empty-state handling or verify it on-device. The handling is already present (`model-picker.tsx:98-113`, backed by `chat-core/ai-models.ts`), so there was nothing to add and no behaviour fix to test; per AGENTS.md UI code gets no tests and on-device smoke is the lead's. I verified the code path by reading it, not on a simulator, so the on-device check is still the lead's.

### How I made sure no request to a user base URL leaves the server except through the pinned fetch
I grepped for the URL (`apiUrl`) and the pinned fetch across `apps/server/src`:
- `connections/probe.ts:152` — the probe builds `createPinnedFetch(baseUrl)` and calls the stored URL through it.
- `ai/model-client.ts` — `chat()` resolves its transport with `modelTransport(input)`: for `openai-compatible` it **always** returns the pinned fetch (`customProviderFetch`), ignoring any caller-supplied `fetchImpl`, and throws when there is no base URL; for every other provider it returns `input.fetchImpl`. Every model call goes through `chat()`/`callOnce` (`requestCompletion` and its callers), so no turn path can bypass it and a future `fetchImpl`-passing caller cannot drop the guard.
- `ai/providers.ts:133` — builds the `OpenAiCompat` client with the URL but performs no I/O itself; the transport is the `HttpClient` that `chat()` provides (the pinned fetch above).
- `agents/gateway/model-target.ts:51` — only sets `apiUrl` from the stored `base_url`; it opens no connection.
So the two places a user URL can reach the network are the probe and the model call, and both use `createPinnedFetch`.

### Deviations / decisions
- `createPinnedFetch` has three test seams: `resolver` (DNS), `transport` (mirrors `guarded-fetch.ts`'s `fetcher`) and a documented **test-only** `allowBlockedAddresses`. Tests inject them through `pinnedFetchOptions` on the model call input (custom provider) or the `options` argument of `createPinnedFetch`; they never replace the fetch. Production callers never set the allow-private hook and the IP guard is on by default. The redirect and re-resolve tests use the injected resolver/transport, so no test opens a real socket.
- The pinned fetch accepts `http:` base URLs as well as `https:`, so the loopback fake server in the model-call test needs no TLS. Production only ever hands it a validated `https` URL (save-time `validateBaseUrl` + `resolvePublic`, and the stored value).
- `base-url.ts` and `pinned-fetch.ts` carry an `// effect-plain:` marker (the repo's ratchet escape for deliberately Promise-based network modules, like `packages/desk/src/egress/policy.ts`).
- `ProviderConnectionRow` was added to `db/rows.ts` (the file had no `provider_connections` row type) and `connections/service.ts`'s `ConnectionRow` is now an alias of it.
- UI code has no tests (per AGENTS.md); the gate typechecks web and mobile. I did not run the apps on a device/simulator, so the UI changes are type-checked but not visually verified.

### Lead round
Security hardening after the lead's review: `chat()` no longer lets a caller-supplied `fetchImpl` win for a custom provider. `modelTransport(input)` now returns the pinned fetch **always** for `openai-compatible`, ignores `input.fetchImpl` for it, and throws `openai-compatible requires a base URL` when `apiUrl` is missing (no fallback to the default client). Tests reach the loopback fake server by injecting the resolver / allow-private hook through the new `pinnedFetchOptions` field on `ModelCallInput`, never by replacing the fetch. The model-call test was moved from `apps/server/src/agents/dm-turn.openai-compatible.test.ts` to `apps/server/src/ai/model-client.openai-compatible.test.ts` (it now drives `chat()` directly) and gained a test proving a caller-supplied `fetchImpl` is not used for `openai-compatible`, plus one for the missing-base-URL failure.

### Open questions
None blocking.

## Review (written by Claude)
Lead, 2026-10-14: approved after a lead hardening round, then pre-review CLEAN, nit 3.
- modelTransport always uses the pinned fetch for openai-compatible (a caller fetchImpl can't replace it), and a missing base URL fails the call.
- The connections and ai tests pass locally (11 files, 76 tests); migration 0058 is expand-only with lock_timeout.
- Web ?mock=1: the Groq card shows its host; the add form shows Base URL, API key and Label.
- Phone smoke PASS (/settings/connections) on the second try; the first failed in Gradle packageRelease, before any app code ran.
