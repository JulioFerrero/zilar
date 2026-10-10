---
id: T-0864
title: "packages/api-contract pilot: the pins group shared by server, web and mobile with derived HttpApiClient clients; Hermes TextDecoder polyfill"
status: merged
milestone: M5
branch: task/T-0864-api-contract-pilot
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0864: packages/api-contract pilot: the pins group shared by server, web and mobile with derived HttpApiClient clients; Hermes TextDecoder polyfill

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings B-B3, B-B1 (pins part) and B-B6 in `docs/audit/simplify-2026-10-09/B-api-contract.md` (read sections 3 and 4 fully, and the prototype `/private/tmp/claude-501/-Users-julio-personal-projects-galena/9686fd0a-230a-4af9-9695-0d5ca8d8e063/scratchpad/audit/b-api/proto.mjs`).
- **Three copies of `Pin`:** the contract lives in server files, so the clients copy it: `apps/server/src/pins/api.ts:96-107`, the web `pinKindSchema` (`apps/web/src/lib/api.ts:1017`), and `apps/mobile/src/lib/pins-api.ts:23-32, 59-71, 85-94`.
- **Status:** the create at `pins/api.ts:243` sends 201 through `jsonUnsafe` while it declares a 200 success.
- **`HttpApiClient`** is in effect 4.0.2 core (`effect/http-api`). It decodes every body with `new TextDecoder()` (`HttpApiClient.js:514`), and Hermes has no `TextDecoder`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
This is the pattern-setting task for the contract migration; later tasks repeat it per group.
1. **The package:** create `packages/api-contract` (TS source like `@zilar/protocol`, depending on `effect` only). It holds `errors.ts` (the `{ error: { code, message, requestId?, … } }` envelope schema), `middleware.ts` (tags only, if the pins group needs them), `pins.ts` (the schemas and `PinsGroup`) and `api.ts` (`ZilarApi` with pins).
2. **Server:** `apps/server/src/pins/api.ts` implements `PinsGroup` from the contract and keeps only handlers and layers. Make the create declare 201 (`HttpApiSchema.status(201)` or the 4.0.2 equivalent; check the .d.ts) instead of `jsonUnsafe`. Server pins tests unchanged.
3. **Contract smoke test:** one vitest that runs the derived client against `createTestContext()`'s app with an injected fetch, as the prototype does.
4. **Web:** the pins functions in `apps/web/src/lib/api.ts` become thin wrappers over the derived client, keeping their names, signatures and `ApiError`. Provide `FetchHttpClient.Fetch = (u, i) => globalThis.fetch(String(u), i)` so test stubs keep working (see the report's risk list).
5. **Mobile:** add a small UTF-8 `TextDecoder` polyfill in `apps/mobile/src/lib/polyfills.ts`, only when the global is missing. Make `apps/mobile/src/lib/pins-api.ts` use the derived client, with the bearer token in `transformClient`, keeping the `PinsApi` interface and the error class name as an alias so `instanceof` sites work.
6. **Bundle:** measure the web build size before and after (gzip).
7. **Report:** write a precise "how to move a group" recipe, including the test-adapter details.

Existing web and mobile pins tests may need edits only where they assert fetch-argument shapes (URL object or header casing). Keep those edits minimal and list them; this is the lead's exception for this task.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`packages/api-contract/**`, `apps/server/src/pins/**`, `apps/server/package.json`, `apps/server/src/contract-smoke.test.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api*.test.ts`, `apps/web/src/lib/effect/**`, `apps/web/package.json`, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.test.ts`, `apps/mobile/src/lib/polyfills.ts`, `apps/mobile/src/lib/polyfills.test.ts`, `apps/mobile/src/lib/effect/**`, `apps/mobile/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/agent-drivers/**`, `apps/server/src/git/**`, `README.md`, `docs/PROJECT_PLAN.md` and `work/T-0856-delete-agent-drivers-git-proxy.md` (lead: carried by the T-0856 merge for the lockfile), `apps/web/Dockerfile`, `apps/server/Dockerfile` and `apps/web/src/test/setup.ts` (lead, fix round 1), `work/T-0864-api-contract-pilot.md`.

### Checks (wave mode)
```bash
pnpm install
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/pins src/contract-smoke.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio pins and unpins a message on web and on the phone.

---

## Report (written by the worker when done)

### Dockerfiles (resolved in fix round 1)
`apps/web/Dockerfile` and `apps/server/Dockerfile` copy each workspace package by name. Round 1 added `packages/api-contract` to both, in the manifest layer and in the source copy; see the fix round 1 section below.

### Package layout (`packages/api-contract`, TS source like `@zilar/protocol`, depends on `effect` only)
- `errors.ts`: `ApiErrorBody`, the envelope schema `{ error: { code, message, requestId?, ...detail } }`; the shared `ApiError extends Error (status, code, message, detail)`; `apiErrorFromBody(status, raw)` (a body that is not the envelope gives `request_failed`).
- `middleware.ts`: tags only. `CurrentUser`, `Session` (provides `CurrentUser`), `PinsSchemaErrors`, `PinsWriteRateLimit` (requires `CurrentUser`). They use the same keys as today. None is `requiredForClient` and none declares an error, so the client skips them (`HttpApiClient.js:114`, key `${tag.key}/Client`).
- `lenient.ts`: `lenientLiterals(literals, fallback)`, the one shared version-skew decoder. An unknown value decodes to the fallback; encoding (the server side) is strict.
- `pins.ts`: the limits, `PIN_KINDS`/`PinKind`, `ListPinsQuery`, `CreatePinPayload`, `Pin` (kind lenient → `text`), `PinList`, and `PinsGroup` with the same annotations, middleware order and `/api` prefix as before. The create success is `Pin.pipe(HttpApiSchema.status(201))` (checked in `HttpApiSchema.d.ts:84`).
- `api.ts`: `ZilarApi = HttpApi.make('zilar').add(PinsGroup)`.
- `client.ts`: `makeZilarClient(httpClient, { baseUrl? })` = `HttpApiClient.makeWith(ZilarApi, …)`. It adds `acceptJson`, a text body (see below), `withApiErrors` (`HttpClient.transformResponse`: status ≥ 400 fails with `apiErrorFromBody`), and a `transformResponse` that maps a success-body `SchemaError` to `invalid_response`. Also `withFetch(fetch)` (`HttpClient.transform` + `Effect.provideService(FetchHttpClient.Fetch, fetch)`), `toApiError` (Transport → `network_error` 0; Encode/InvalidUrl → `invalid_request` 0; Decode/StatusCode/EmptyBody → `invalid_response` with the response status; a leftover `SchemaError` comes from the request encode → 400 `invalid_request`) and `runApi(effect)`, the Promise edge, which rejects with `ApiError` only. Type: `ZilarClient = HttpApiClient.ForApi<typeof ZilarApi, ApiError>`.
- `client.test.ts`: 8 tests.
- Source is 364 lines plus a 132-line test. I used `makeWith` rather than `make` because `make`'s `transformClient` is typed `HttpClient → HttpClient`, so an `ApiError` could not be in the typed error channel (`HttpApiClient.d.ts`, `make`/`makeWith`).

### What each layer now contains
- **Server** `apps/server/src/pins/api.ts`: handlers, layers, limiter and routes only. It imports the group and tags from the contract.
  - Create returns the pin and the declared 201 renders it; `jsonUnsafe` is gone. Before the edit I re-read `pins/api.ts:243`, and the audit's line was right.
  - `contractSessionLayer` bridges the contract `Session` to `http-core`'s `sessionLayer`. It runs the core middleware and re-provides the core `CurrentUser` as the contract `CurrentUser`. The keys are equal, so this is only a types bridge, and it goes away when `effect/http-core.ts` takes its tags from the contract (that file is not in my scope).
  - `service.ts` now takes `PinView`/`CreatePinBody`/`PinKind` and the limits from the contract. The unused duplicate `pinKindSchema` was removed.
- **Web** `apps/web/src/lib/effect/api-client.ts`: builds the client once over `webRuntime`'s `HttpClient`, with the web fetch adapter, and exposes `callApi(call)`.
  - In `api.ts`, `listPins`/`pinMessage`/`unpinMessage` are one-liners over `callApi`. Names and signatures are unchanged; `Pin`/`PinKind` are now contract types (readonly fields, and typecheck found no consumer that mutates them).
  - `api.ts`'s own `ApiError` class and `errorBodySchema`/`toApiError` were replaced by the contract's `ApiError`/`apiErrorFromBody`, so web has one error class for hand-written and derived calls (6 call sites).
  - The exported but unused `pinKindSchema`/`pinSchema` were removed. I grepped: no importer.
- **Mobile** `apps/mobile/src/lib/effect/api-client.ts`: `createApiClient({ getToken, fetchImpl, apiUrl })` adds the bearer with `HttpClient.mapRequestEffect`. A missing token fails 401 `unauthorized` "No session" before any fetch.
  - `pins-api.ts` keeps the `PinsApi` port, `createPinsApi`, `parsePin`, `parsePinKind` and the snapshot re-exports. `PinsApiError` is now `export const PinsApiError = ApiError` (plus the type), so `instanceof` works. I grepped: no other file names `PinsApiError`. `Pin` is the contract type.
  - The transport, the 4 tagged errors and the schemas are gone (228 lines changed, net −~150).

### The fetch adapters (test-adapter details)
- **Text body.** `HttpApiClient` sends JSON as an `HttpBody.Uint8Array` that keeps `.text` (`HttpBody.js:205`). `makeZilarClient` swaps that for `HttpBody.raw(text)`, so `fetch` gets the same JSON string as before, and the mock backend's `readJsonBody` and the stubs' `JSON.parse(init.body)` keep working. No `TextDecoder` is needed on the request side.
- **URL and headers.** `FetchHttpClient` passes a `URL` object and Effect `Headers` (lowercased keys). Both adapters pass `String(url)` and a plain record. Web turns a same-origin URL back into the relative `/api/...` path and adds `credentials: 'same-origin'`. In mock mode it calls `mockRequest(path, init)` instead of fetch, so the 7th `isMockApiEnabled` branch lives in one place.
- **Late fetch binding.** `withFetch` provides `FetchHttpClient.Fetch` on every request, and the web adapter reads `globalThis.fetch` per call. A `vi.stubGlobal('fetch')` installed after the first call is reached; tested in `api.pins.test.ts`.
- **jsdom realm (new finding, not in the audit).** Web tests run jsdom under `pool: 'vmThreads'` (`apps/web/vite.config.ts:27`). There, `Response.arrayBuffer()` returns a host-realm `ArrayBuffer`, and `HttpApiClient` decodes with `Schema.instanceOf(globalThis.ArrayBuffer)` (`HttpApiClient.js:499`). Every body decode failed with `invalid_response`; I verified this with a probe (`instanceof ArrayBuffer` false, tag `[object ArrayBuffer]`).
  - Fix (since round 1): `apps/web/src/test/setup.ts` wraps `Response.prototype.arrayBuffer` so the bytes are copied into the test file's realm. The web adapter has no workaround.
  - The mobile and server tests run in node, where this does not happen.
- **Content type.** `HttpApiClient` ignores the response content type when an endpoint has one success schema (`makeResponseDecoder`, `HttpApiClient.js:400-404`), so the stubs without `content-type` keep working.

### TextDecoder polyfill and how it is tested
- The audit says Hermes lacks `TextDecoder` (B6). That is true of Hermes itself, but **Expo 57 already installs a UTF-8 `TextDecoder` on native** before app code runs. The chain: `expo/src/winter/runtime.native.ts:15`, through `expo/src/Expo.fx.tsx:2`, imported by `expo-router/build/renderRootComponent.js:38` (`require("expo")`). The audit missed this, so on a device my polyfill should be a guarded no-op. I did not run the emulator.
- I still added it as the spec asks, in `apps/mobile/src/lib/polyfills.ts`. `Utf8TextDecoder` is a WHATWG-style UTF-8 decoder: it strips the BOM, writes one U+FFFD per broken sequence (the byte that broke it is read again) and builds surrogate pairs, without fatal or stream mode. It throws `RangeError` for a non-UTF-8 label and is installed only when `globalThis.TextDecoder` is not a function. It is about 95 lines, not 30, because of the replacement rules.
- Tests (`polyfills.test.ts`, 4 new):
  - it matches Node's native decoder on 12 byte sequences, including overlong, surrogate, out-of-range, truncated and stray-continuation bytes;
  - it reads an ArrayBuffer, a DataView with an offset, a long body (2,000 repeats with emoji) and no input;
  - it installs only when the global is missing (`vi.stubGlobal('TextDecoder', undefined)`);
  - end to end with the global removed, the contract client decodes a success body and a 404 envelope with "Gone ✅", and a spy proves `Utf8TextDecoder.prototype.decode` ran.

### Web bundle (vite build, `index-*.js` is the only JS chunk; output in my scratchpad)
| | raw | gzip (vite) | gzip -9 |
|---|---|---|---|
| before (main 5290fcbd) | 1,437,399 B | 416.18 kB | 410,983 B |
| after (1e153928) | 1,478,022 B | 429.66 kB | 424,200 B |
| delta | +40,623 B (+2.8%) | +13.48 kB (+3.2%) | +13,217 B |

This is the one-time cost of `HttpApiClient`, in line with the audit's +15 KB gz estimate; it should shrink as each later group drops its hand-written schemas. I did not measure the mobile Hermes bundle.

### Test lines I changed in existing tests, and why
- `apps/mobile/src/lib/pins-api.test.ts` `jsonResponse`: the fake `{ ok, status, json }` object became `new Response(JSON.stringify(body), { status })`. `HttpClientResponse.fromWeb` reads `headers` and `arrayBuffer()`, which the fake lacked. That is the only edit to an existing assertion or fixture; the 3 existing cases are unchanged otherwise.
- New tests:
  - `pins-api.test.ts`: +2 cases (bearer, headers, trimmed string body; `PinsApiError` instanceof, network, `invalid_response`, lenient kind);
  - `apps/web/src/lib/api.pins.test.ts` (new, 7 cases);
  - `apps/server/src/contract-smoke.test.ts` (new, 2 cases);
  - `packages/api-contract/src/client.test.ts` (new, 8 cases);
  - `polyfills.test.ts`: +4 cases.
- Server pins tests: unchanged. Web `PinnedMessages`/`PinsPanel`/store tests (outside the Checks): unchanged and passing (164/164). Mobile store pins tests: unchanged, 25/25.

### Behaviour notes (deliberate, small)
- **Client-side validation.** The derived client encodes the payload with the contract schema, so an input the server would reject is now rejected before sending, as 400 `invalid_request` with the same schema message.
  - Because `Schema.Trim` encodes only trimmed strings (I checked: `" ab "` fails `isTrimmed`), both clients trim `senderName` before sending. The server trimmed it anyway, so the stored result is identical.
- **Lenient kind on web.** An unknown pin `kind` now decodes to `text` on web too. Before, web failed the whole list with `invalid_response`; mobile already did this.
- **Status on `invalid_response`.** For a 2xx body that does not decode, the status is now always 200 (mobile's old value). Web used to report the real status (201 for a create). An undeclared status (for example 200 where 201 is declared) still carries the real status.
- **Envelope decode.** It now declares `requestId` as an optional string. A non-string `requestId` (the server never sends one) would give `request_failed`.

### How to move a group (the recipe)
1. **Re-read the module.** Re-read `apps/server/src/<x>/api.ts` and list:
   - every `jsonUnsafe(..., {status})` and every `HttpServerResponse.empty({ status: 204 })`;
   - every in-handler body decode;
   - every endpoint-level and group-level middleware, in order.
2. **Create `packages/api-contract/src/<x>.ts`.** Move the schemas, the limit constants the schemas need, and any helper used only by a schema filter. Name them by wire role (`<Thing>`, `<Thing>List`, `Create<Thing>Payload`, `List<Thing>Query`).
   - Declare the true statuses: `X.pipe(HttpApiSchema.status(201))`, and `HttpApiSchema.NoContent` for a 204. Then the handler returns the value, never `jsonUnsafe`.
   - Response-side enums use `lenientLiterals(LITERALS, fallback)`. New response fields enter as `Schema.optional`.
   - Keep `.annotate(HttpApi.QueryParseOptions/PayloadParseOptions, …)`, the middleware order and `.prefix('/api')` exactly as they were.
3. **Middleware tags.** Move the group's middleware tags into `middleware.ts` with the same key strings. If it uses `Session`/`CurrentUser`, use the contract ones.
   - The first group that does this after the pilot should also change `apps/server/src/effect/http-core.ts` to re-export `Session`/`CurrentUser` from the contract, and delete `contractSessionLayer` from `pins/api.ts`.
4. **Add the group** to `ZilarApi` in `api.ts` and export the file from `index.ts`.
5. **Server.** `apps/server/src/<x>/api.ts` keeps `HttpApi.make('<x>').add(<X>Group)`, `HttpApiBuilder.group`, the layers and `<X>_API_ROUTES`, with handlers that return plain values. The service takes its view types from the contract (`type XView = X`).
   - Run the module's tests unchanged. A status or body drift shows up there.
6. **Smoke test.** Add one case per group to `apps/server/src/contract-smoke.test.ts` (create, list, delete, one error) through `cookieClient`/`bearerClient`. The fetch is `app.request(String(url), init)`, `baseUrl: TEST_BASE_URL`, and the base `HttpClient` comes from `Effect.service(HttpClient.HttpClient)` with `FetchHttpClient.layer`.
7. **Web.** In `apps/web/src/lib/api.ts`, each function becomes `callApi((client) => client.<x>.<endpoint>({ params, query, payload }))`.
   - Keep the names, signatures and exported types (`export type { X }` from the contract); copy readonly arrays with `[...rows]` where the old signature returned `T[]`.
   - Normalise input the server used to transform (trim and the like) before calling.
   - Delete the hand-written schemas and run `pnpm --filter @zilar/web exec vitest run src/lib` plus the components that use the group.
   - Fetch stubs keep seeing a relative path, a plain lowercase header record and a string body. Only assertions on `'Content-Type'` casing need an edit (use `content-type`).
8. **Mobile.** In `apps/mobile/src/lib/<x>-api.ts`, build `createApiClient({ getToken, fetchImpl, apiUrl })` once in `create<X>Api`; each method is `runApi(client.<x>.<endpoint>(…))`.
   - Keep the port interface. Replace the error class with `export const XApiError = ApiError; export type XApiError = ApiError;`.
   - Delete the transport, the tagged errors and the schemas. Keep `parse*` helpers by decoding with the contract schema.
   - In tests, turn fake `{ ok, status, json }` responses into `new Response(JSON.stringify(body), { status })`.
9. **Bundles and line numbers.** Binary uploads and GETs, SSE and better-auth stay outside the client (audit §4). Re-measure the web bundle when a group removes many schemas.

### Commands run (wave mode; the last 3 runs are after the last code commit)
- `pnpm install`: done, lockfile updated (+15 lines, workspace links only).
- `pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/pins src/contract-smoke.test.ts`: 12 passed (12), 3 of 3 runs.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib`: 413 passed (413), 41 files, 3 of 3 runs.
- `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib`: 821 passed (821), 88 files, 3 of 3 runs.
- `pnpm --filter @zilar/api-contract exec vitest run --reporter=dot`: 8 passed (8).
- Extra, outside the Checks:
  - web `PinnedMessages.test.tsx`, `PinsPanel.test.tsx`, `realStore.test.tsx`, `reload.test.tsx`: 164 passed (164);
  - mobile `real-store.general-only`, `real-store.prefs-pins`, `effects/pins`: 25 passed (25).
- `pnpm --filter @zilar/{server,web,mobile,api-contract} typecheck`: all exit 0.
- `pnpm exec oxlint <all 21 changed .ts files>`: exit 0, no findings. `prettier --write` was run on every changed file before each commit.
- I did not run `pnpm gate` (wave mode).

### Risks seen
- The `contractSessionLayer` bridge is temporary; the next group that moves should remove it (recipe step 3).
- `effect/http-api` is `@stability unstable`; the server already depends on it, so this is not a new risk.

### Unsure / not done
- I did not check on a phone or the emulator (`pnpm phone:smoke` is the lead's). The Expo TextDecoder finding comes from reading the code, not from a device.
- I did not run the mobile Hermes bundle size or `expo export`.
- Process slips: I appended the polyfill tests to `polyfills.test.ts` with a shell heredoc, not the edit tool. I also overwrote my own new `api.pins.test.ts` with a throwaway probe and restored it from a scratchpad copy. The final content is what the edit tools would have produced; I mention both because the rule says to use edit tools only.

### Fix round 1
1. **Dockerfiles.** I added `COPY packages/api-contract/package.json packages/api-contract/` to the manifest layer and `COPY packages/api-contract packages/api-contract` to the source copies of `apps/web/Dockerfile` and `apps/server/Dockerfile`, next to the existing package lines, and added `@zilar/api-contract` to each file's "keep in sync" comment. The server change is only those lines, so the T-0861 rebase stays simple.
2. **jsdom realm fix moved to `apps/web/src/test/setup.ts`.** It is test-only: a browser's `Response.arrayBuffer()` always returns this realm's `ArrayBuffer`, so the adapter needs nothing, and `withRealmBody` is gone from `apps/web/src/lib/effect/api-client.ts`.
   - The setup patch wraps `Response.prototype.arrayBuffer` and copies a foreign-realm buffer into the current file's realm. That covers fetch stubs and the mock backend alike.
   - `Response` may be shared by every realm of a worker, so the original method is kept once under `Symbol.for('zilar.test.hostArrayBuffer')` and re-wrapped per file; wrappers never stack.
   - Because the setup file affects the whole web suite, I ran the full suite once (`--maxWorkers=2`): 1,949 passed and 1 failed, `Composer.voice.test.tsx` "clicks to record and sends through the Send button".
   - That file is load-sensitive, not affected by this change. The machine's load average was 133 to 171. With the patch, 3 runs in a row failed 1, then 3, then 7 tests. Committed HEAD 68c0c6a4 (adapter fix, no setup patch) also failed 2 of 11 under the same load, and the run with the setup patch reverted failed 3. The only app code calling `arrayBuffer()` is `voice.ts:358`, and it calls it on a `Blob`, never a `Response`.
   - Re-run it when the machine is idle.
3. **Docker.** `docker info` works. `docker build -f apps/web/Dockerfile -t zilar-web-t0864-check .` succeeded: both api-contract COPY steps ran, and `pnpm --filter @zilar/web build` produced `index-*.js` at 1,477.82 kB, 429.57 kB gzip. The image is 83.2 MB (83,236,720 B); I deleted it afterwards. I did not build the server image (not asked, and T-0861 rewrites it).

Checks after round 1:
- `pnpm install`: done.
- Server `src/pins` + contract smoke: 12 passed (12).
- Web `src/lib`: 413 passed (413).
- Mobile `src/lib`: 821 passed (821).
- Web pin component and store tests: passing (45 files, 577 tests, together with `src/lib`).
- Typechecks for server, web, mobile and api-contract: exit 0.
- `oxlint` on the changed `.ts` files: exit 0.
- `prettier --write` was run.

## Review (written by Claude)

**Lead, 2026-10-10: approved after fix round 1.**
- **What changed:** `packages/api-contract` holds the pins group. The server implements it, and web and mobile derive their clients from it with `HttpApiClient`. The create now declares its true 201.
- **Fix round:** both Dockerfiles copy the package, and the web image builds locally. The jsdom ArrayBuffer-realm workaround moved into `apps/web/src/test/setup.ts`.
- **Cost:** web bundle +13 kB gzip for the derived client. That cost is paid once, and later groups add little.
- **Next:** the recipe in the Report drives the wave 5 group moves, and the first move deletes `contractSessionLayer`.
- **Live check for Julio:** pin and unpin on web and mobile.
