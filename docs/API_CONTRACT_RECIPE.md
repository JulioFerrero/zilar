# API contract recipe: how to move a group into `@zilar/api-contract`

Copied from the Report of `work/T-0864-api-contract-pilot.md` ("How to move a group"), updated by T-0891 and T-0897.

## The shared files

- **One list of groups.** `packages/api-contract/src/api.ts` imports every group and passes them to one `HttpApi.make('zilar').add(...)` call, in alphabetical order. Add your `import { FooGroup } from './foo';` and one `FooGroup,` line. There are no chain blocks or per-chain arrays.
- **One export list.** `packages/api-contract/src/index.ts` has one `export * from './<x>';` line per file, alphabetical.
- **One middleware file.** Every middleware tag lives in `packages/api-contract/src/middleware.ts`. Add yours there, with the same key string as before. Do not create a per-module or per-chain middleware file.
- **Smoke case.** Your smoke case goes in `apps/server/src/<x>/contract.smoke.test.ts`, using `createSmokeHarness` from `apps/server/src/contract-smoke-support.ts` (`cookieClient`, `bearerClient`, `requestCount`).
- **Session and CurrentUser.** `Session`/`CurrentUser` come from `@zilar/api-contract` (no bridge). `apps/server/src/effect/http-core.ts` re-exports them, and `sessionLayer(auth, logger)` provides the contract tag. Use `sessionLayer` in your module's layers.

## The recipe

1. **Re-read the module.** Re-read `apps/server/src/<x>/api.ts` and list:
   - every `jsonUnsafe(..., {status})` and every `HttpServerResponse.empty({ status: 204 })`;
   - every in-handler body or query decode;
   - every endpoint-level and group-level middleware, in order.
2. **Create `packages/api-contract/src/<x>.ts`.** Move the schemas, the limit constants the schemas need, and any helper used only by a schema filter. Name them by wire role (`<Thing>`, `<Thing>List`, `Create<Thing>Payload`, `List<Thing>Query`).
   - Declare the true statuses: `X.pipe(HttpApiSchema.status(201))`, and `HttpApiSchema.NoContent` for a 204. Then the handler returns the value, never `jsonUnsafe`.
   - Response-side enums use `lenientLiterals(LITERALS, fallback)`. New response fields enter as `Schema.optional`.
   - Keep `.annotate(HttpApi.QueryParseOptions/PayloadParseOptions, …)`, the middleware order and `.prefix('/api')` exactly as they were.
3. **Middleware.** A group uses `.middleware(Session)` and `.middleware(SchemaErrors)` (400 `invalid_request` with the schema's text). A budget or guard tag goes in `middleware.ts`; the server provides it with `rateLimitLayer(tag, limiter, message)` from `apps/server/src/effect/rate-limit-middleware.ts` (`limiter` only needs `allow`). A group that needs a fixed or typed decode answer declares its own `<X>SchemaErrors` tag and the server provides `schemaErrorLayerFor(tag, logger, message | render)` from `http-core.ts`. Do not write a per-module layer.
4. **Add the group** to `api.ts` and export the file from `index.ts`.
5. **Server.** `apps/server/src/<x>/api.ts` keeps `HttpApi.make('<x>').add(<X>Group)`, `HttpApiBuilder.group`, the layers and `<X>_API_ROUTES`, with handlers that return plain values. The service takes its view types from the contract (`type XView = X`).
   - Run the module's tests unchanged. A status or body drift shows up there.
6. **Hand-decoded endpoints.** When a handler must decode its own body or query (a guard, a 503/501 or a limiter has to run before the 400, or the 400 text is fixed), do not leave the endpoint out of the contract. Declare the shape so the derived client is typed and encodes the call, and keep the handler's own decode:
   - **Payload:** declare `payload: X` in the contract and serve the endpoint with `.handleRaw('name', handler(...))`. `handleRaw` skips only the payload decode (params and query are still decoded), so the handler reads `request.request.json` itself and decodes with the contract schema (`Schema.decodeUnknownOption(X, { onExcessProperty: 'error' })`). `apps/server/src/auth/api.ts` (`patchMe`) is the model.
   - **Query:** the router always decodes a declared query before the handler, so declare each key as `RawQueryValue` (`packages/api-contract/src/raw-query.ts`: a string or a list, which never fails). The handler keeps reading `request.originalUrl` and decoding with its strict schema after its guards.
   - Put the strict schema in the contract and have the handler import it, so there is one copy.
7. **Smoke test.** Add `apps/server/src/<x>/contract.smoke.test.ts` with one case per group (create, list, delete, one error) through `cookieClient`/`bearerClient` of `createSmokeHarness`. The fetch is `app.request(String(url), init)`, `baseUrl: TEST_BASE_URL`, and the base `HttpClient` comes from `Effect.service(HttpClient.HttpClient)` with `FetchHttpClient.layer`; the support module already does all of that.
8. **Web.** In `apps/web/src/lib/api.ts`, each function becomes `callApi((client) => client.<x>.<endpoint>({ params, query, payload }))` (`callApiAbortable` when the caller may cancel).
   - Keep the names, signatures and exported types (`export type { X }` from the contract); copy readonly arrays with `[...rows]` where the old signature returned `T[]`.
   - Normalise input the server used to transform (trim and the like) before calling: the contract encodes the trimmed form and rejects an untrimmed or empty value on the client.
   - Delete the hand-written schemas and run `pnpm --filter @zilar/web exec vitest run src/lib` plus the components that use the group.
   - Fetch stubs keep seeing a relative path, a plain lowercase header record and a string body. Only assertions on `'Content-Type'` casing need an edit (use `content-type`).
9. **Mobile.** In `apps/mobile/src/lib/<x>-api.ts`, build `createApiClient({ getToken, fetchImpl, apiUrl })` once in `create<X>Api`; each method is `runApi(client.<x>.<endpoint>(…))`.
   - Keep the port interface. Replace the error class with `export const XApiError = ApiError; export type XApiError = ApiError;`.
   - Delete the transport, the tagged errors and the schemas. Keep `parse*` helpers by decoding with the contract schema.
   - A module whose rows are decoded leniently (a malformed row is dropped, the page stays) keeps its hand-written client: the derived client decodes the whole response strictly, so one bad row would fail the page. Today these are the mobile gifs, media and stickers clients.
   - In tests, turn fake `{ ok, status, json }` responses into `new Response(JSON.stringify(body), { status })`.
10. **Bundles and line numbers.** Binary uploads and GETs, SSE and better-auth stay outside the client (audit §4). Re-measure the web bundle when a group removes many schemas.
