# API contract recipe: how to move a group into `@zilar/api-contract`

Copied from the Report of `work/T-0864-api-contract-pilot.md` ("How to move a group") and updated by T-0891. Four chains move groups in parallel, so the shared files have one block per chain.

## What changed after the pilot (T-0891)

- **Your chain's block.** Add your group in your chain's block in `packages/api-contract/src/api.ts` (its `import { FooGroup } from './foo';` line in your chain's "imports" area, and one line, `FooGroup,`, inside `chainAGroups` .. `chainDGroups`; never add imports at the top) and in your chain's block in `packages/api-contract/src/index.ts` (`export * from './<x>';`). Never edit another chain's block.
- **Smoke case.** Your smoke case goes in `apps/server/src/<x>/contract.smoke.test.ts`, using `createSmokeHarness` from `apps/server/src/contract-smoke-support.ts` (`cookieClient`, `bearerClient`, `requestCount`). Do not touch the pins file or the support module.
- **Session and CurrentUser.** `Session`/`CurrentUser` come from `@zilar/api-contract` (no bridge). `apps/server/src/effect/http-core.ts` re-exports them, and `sessionLayer(auth, logger)` provides the contract tag. Use `sessionLayer` in your module's layers.

## The recipe

1. **Re-read the module.** Re-read `apps/server/src/<x>/api.ts` and list:
   - every `jsonUnsafe(..., {status})` and every `HttpServerResponse.empty({ status: 204 })`;
   - every in-handler body decode;
   - every endpoint-level and group-level middleware, in order.
2. **Create `packages/api-contract/src/<x>.ts`.** Move the schemas, the limit constants the schemas need, and any helper used only by a schema filter. Name them by wire role (`<Thing>`, `<Thing>List`, `Create<Thing>Payload`, `List<Thing>Query`).
   - Declare the true statuses: `X.pipe(HttpApiSchema.status(201))`, and `HttpApiSchema.NoContent` for a 204. Then the handler returns the value, never `jsonUnsafe`.
   - Response-side enums use `lenientLiterals(LITERALS, fallback)`. New response fields enter as `Schema.optional`.
   - Keep `.annotate(HttpApi.QueryParseOptions/PayloadParseOptions, …)`, the middleware order and `.prefix('/api')` exactly as they were.
3. **Middleware tags.** Move the group's middleware tags into `middleware.ts` with the same key strings. If it uses `Session`/`CurrentUser`, use the contract ones (no bridge).
4. **Add the group** in your chain's block in `api.ts` and export the file in your chain's block in `index.ts`.
5. **Server.** `apps/server/src/<x>/api.ts` keeps `HttpApi.make('<x>').add(<X>Group)`, `HttpApiBuilder.group`, the layers and `<X>_API_ROUTES`, with handlers that return plain values. The service takes its view types from the contract (`type XView = X`).
   - Run the module's tests unchanged. A status or body drift shows up there.
6. **Smoke test.** Add `apps/server/src/<x>/contract.smoke.test.ts` with one case per group (create, list, delete, one error) through `cookieClient`/`bearerClient` of `createSmokeHarness`. The fetch is `app.request(String(url), init)`, `baseUrl: TEST_BASE_URL`, and the base `HttpClient` comes from `Effect.service(HttpClient.HttpClient)` with `FetchHttpClient.layer`; the support module already does all of that.
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
