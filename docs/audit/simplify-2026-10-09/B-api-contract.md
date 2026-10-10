# B. API contract between server and clients

Auditor area: the HTTP contract (server `apps/server/src/*/api.ts`, web `apps/web/src/lib/api.ts` + `tools.ts` + `drafts.ts`, mobile `apps/mobile/src/lib/*-api.ts`, `packages/protocol`). Read-only. Scratch evidence lives in `scratchpad/audit/b-api/` (route list, endpoint JSON, coverage TSV, a working prototype, bundle probe).

## 1. Summary

- **The server already uses declarative `HttpApi`/`HttpApiGroup`/`HttpApiEndpoint`.** There are 157 endpoints in 37 groups and 36 separate `HttpApi`s. The one exception is the git proxy, which is a raw `HttpRouter` route and is not mounted. The contract can be derived, but it is locked inside server files next to handlers and server-only imports. Clients rewrite it by hand: `drafts.ts:3-6` says "The web app cannot import server code, so the shapes are copied here". **This is the root cause.**
- **Shapes are written 3 to 6 times.** Per layer: server schemas take 1,166 lines (243 schemas). Web has 782 schema lines plus 258 type lines (115 schemas). Mobile has 695 schema lines plus 863 interface lines (133 schemas and 141 interfaces). Of the 121 unique paths, 92 are called by both web and mobile. Examples: `GroupDetail` exists in 5 copies and `Me` in 6, and the copies drift (different subsets, nullability and leniency).
- **Mobile transport is copy-paste.** The 25 clients each carry about 92-122 lines of the same fetch, bearer, envelope and tagged-error boilerplate. That adds up to about 2,450 lines, plus 25 identical `XxxApiError` classes and 101 `Data.TaggedError` classes. 101 of the 312 mobile client test cases test this transport again, once per client.
- **Effect 4.0.2 ships `HttpApiClient` in core (`effect/http-api`).** I proved it end to end in a prototype (`b-api/proto.mjs`): one contract, a server built with `HttpApiBuilder`, a derived client, and one error mapping through `transformClient`. On the web it costs about +48 KB minified / +15 KB gzip once (about +3.6% of the current 412 KB gzip main bundle), before the hand-written schemas are removed.
- **Blocker 1, the server contract lies about status codes.** 14 handlers return `jsonUnsafe(..., {status: 201})` while they declare a 200 success. 7 endpoints declare `Schema.Void` (200) but send 204. A derived client fails on all of them; I verified "Decode error (201 POST…)" and "(204 DELETE…)". 33 of the 68 write endpoints declare no payload, and about 11 of them parse JSON by hand. **No endpoint declares an error schema.**
- **Blocker 2, Hermes has no `TextDecoder`.** I checked the iOS `hermesvm` binary: it contains `TextEncoder` but not `TextDecoder`. `HttpApiClient` decodes every body with `new TextDecoder()` (`HttpApiClient.js:514`), so mobile needs a small UTF-8 decoder polyfill first. Android is UNVERIFIED but very likely the same.
- **Errors are untyped and inconsistent.** `HttpError.code` is a plain `string` and there are 76 distinct status/code pairs. `xmpp_unavailable` is sent as 502 in 9 places and as 503 in 21, with the same sentence copied 33 times. Disabled features answer 501, 503 or 404 depending on the module. The pin limit is `pin_limit` 400 in one module and `too_many_pins` 409 in another. Clients compare code strings 287 times.
- **Duplicated server boilerplate:**
  - 157 hand-written route-manifest entries duplicate the endpoint declarations.
  - 25 copies of a `SchemaErrors` middleware.
  - 158 `withErrorEnvelope` + `requestIdOf` wrappers.
  - 37 `toWebHandler`s.
  - The edge converts every request twice (Effect → web `Request` → Effect again) after a linear scan of all 157 routes.
- **Target:** one `packages/api-contract` (schemas, groups, error envelope, middleware tags) shared by server, web and mobile, with clients derived from it. Estimated reduction: about 9,500 source lines (mobile ~6,000, web ~2,000, server ~1,500), plus about 2,000-2,500 test lines. The ~1,200 lines of server schemas move into the contract; they are not deleted. The work splits into 4 phases of tasks, each with existing tests as the safety net.

## 2. Measurements

| What | Command (abridged) | Result |
|---|---|---|
| Endpoints | `grep -ohE "HttpApiEndpoint\.(get\|post\|…)\("` over `find apps/server/src -name api.ts` | 157: 62 GET, 43 POST, 17 PUT, 8 PATCH, 27 DELETE; 37 groups, 36 `HttpApi.make` |
| Route manifest | `grep "method: 'X', path:"` | 157 hand entries (`b-api/server-routes.txt`), 121 unique paths after param normalisation |
| Endpoint options | `b-api/endpoints.mjs` (brace-matching parser) | 153 declare `success`; 68 write endpoints, 33 with no `payload`; **0 declare `error`** |
| Raw responses bypassing the success schema | `grep jsonUnsafe(` | 19 sites (14 with status 201), plus 39 `HttpServerResponse.*` raw returns |
| Status mismatch | `grep "success: Schema.Void"` + `HttpServerResponse.empty({ status: 204 })` | 7 Void declarations; tools/invite-links/backgrounds/routines/machines answer 204 |
| Server boilerplate | grep counts | 158 `withErrorEnvelope(`, 25 `layerSchemaErrorTransform` files, 46 middleware classes (18 rate-limit, 25 SchemaErrors), 37 `toWebHandler` files, 246 `new HttpError(` in api.ts |
| Error pairs | `grep -ohE "new HttpError\(\s*[0-9]{3},\s*'[a-z_]+'"` over server src | 76 distinct pairs (`b-api/errors.txt`); 87 `400 invalid_request`, 126 `404 not_found` |
| Schema/type lines per layer | `b-api/schemalines.mjs` (top-level `const X = struct/Schema.*(` and `export interface/type` blocks) | server api.ts 1,166 + 380; web 782 + 258; mobile 695 + 863; protocol 317 + 32 |
| File sizes | `wc -l` | server api.ts 14,731; web api.ts 2,690 + tools.ts 283; mobile *-api.ts 7,985; web mock 4,297 (api.ts) / 7,933 total; mobile mock 3,629 |
| Mobile transport span | first `Data.TaggedError` → last `return {` per file | 89-122 lines in 23 files, 220/251 in invite-links/stickers |
| Mobile boilerplate | grep | 25 `XxxApiError` classes, 101 `Data.TaggedError`, 24 `requestEffect`, 27× `"Could not reach the server"`, 30× `invalid_response` |
| Client coverage | `b-api/cover.mjs` | of 121 paths: web 112, mobile 93, both 92, none 8 (false negatives such as gifs/avatars are built dynamically) |
| Code compares | `grep "code === '…'"` | web 146, mobile 141; 52 distinct codes, 18 of them client-only (`network_error`, `invalid_response`, …) |
| Version-skew leniency | `grep -c older` | web api.ts 68, mobile clients 135 "Optional so older payloads parse" comments; no client reads `protocolVersion` |
| Client tests | `wc -l`; `grep -E "^\s*(it\|test)\("` | mobile 4,616 lines / 312 cases (101 transport/error cases); web 2,410 / 125 (10) |
| Fetch stubs in tests | grep | web: 108 `vi.stubGlobal('fetch'`; 91 web + 103 mobile assertions on fetch call args |
| Bundle probe | esbuild 0.25 minify, `b-api/bundle/{base,api}.ts` | baseline Effect + Schema + FetchHttpClient 317 KB min / 100 KB gz; + HttpApi + HttpApiClient (3 endpoints) 366 KB / 115 KB gz → **+48 KB min, +15 KB gz** |
| Web bundle | `apps/web/dist/assets/index-*.js` | 1.44 MB min, 412 KB gz; already contains `effect/http/FetchHttpClient` |
| Prototype | `node b-api/proto.mjs` | contract + `HttpApiBuilder` server + `HttpApiClient` + `transformClient` envelope: 201 decoded, extra key stripped by server encoding, 400 → `ApiError{code:'pin_limit'}` |
| Mismatch proof | `proto-mismatch.mjs`, `proto-201.mjs` | `HttpClientError: Decode error (204 DELETE …)` and `(201 POST …)` |
| Hermes | `strings -a …/hermesvm.framework/hermesvm \| grep TextDecoder` | 0 hits; `TextEncoder` present (iOS sim slice, Pods dated 28 Sep) |
| RN URL | `react-native/Libraries/Blob/URL.js` | getter-only `hash` (no setter), `searchParams` + `toString` work; Effect sets `hash` only when it is defined, so OK |
| Reference default | `effect/dist/Context.js:593-598` | `Context.Reference` default is cached on first use, so `FetchHttpClient.Fetch` captures `globalThis.fetch` once |

## 3. Findings (ranked by value/effort)

### B1. Make the server contract truthful (status codes, payloads), the precondition for everything else. Effort: S-M
**Evidence.**
- **14 creates send 201 through `jsonUnsafe` while they declare a 200 schema:** `pins/api.ts:243`, `stickers/api.ts:468,771`, `chat-folders/api.ts:238`, `ais/api.ts:459`, `roles/api.ts:202`, `invite-links/api.ts:306`, `groups/api.ts:412`, `contact-requests/api.ts:339`, `connections/api.ts:222`, `backgrounds/api.ts:210`, `topics/api.ts:419`, `machines/api.ts:315,552`.
- **7 `success: Schema.Void` endpoints answer `HttpServerResponse.empty({ status: 204 })`:** `tools/api.ts:258/565`, `invite-links/api.ts:208/337`, `backgrounds/api.ts:148,152/274`, `routines/api.ts:131/296`, `machines/api.ts:199,211/391,476`.
- **One endpoint answers two success statuses:** `contact-requests/api.ts:334-339` sends 200 for a reverse request and 201 otherwise.
- **33 write endpoints declare no payload.** About 11 of them read and decode the body inside the handler, for example `auth/api.ts:205,261-264` (PATCH /me), `connections/api.ts:206-212` and `stickers/api.ts:514`.

**Impact.**
- A derived client rejects every one of these with `DecodeError`. Verified: `b-api/proto-201.mjs` and `proto-mismatch.mjs`.
- `jsonUnsafe` also skips the success schema's encoding, which strips extra keys (shown in the prototype). So today a create can leak fields that are not in the schema. Whether any create actually leaks is UNVERIFIED (e.g. `ais/api.ts:459 created`).

**Recommendation.**
- One task per ~5 modules: replace `jsonUnsafe(x, {status: 201})` with `success: X.pipe(HttpApiSchema.status(201))` and return `x`.
- Replace `Schema.Void` + `empty(204)` with `HttpApiSchema.NoContent`.
- Give contact-requests two success schemas.
- Move in-handler decodes into `payload:` where the error order allows. Where the old error ordering must stay (a 503 before decode), keep the hand decode but still declare the payload schema.

**Safety net:** the 41 server test files that drive `app.request('/api/…')` assert statuses and bodies. **Risk:** low; byte-identical bodies are expected.

### B2. Derive the route manifest instead of writing it twice. Effort: S
**Evidence.**
- Every module keeps a `XXX_API_ROUTES` array that repeats its endpoint declarations: 157 entries, e.g. `pins/api.ts:183-187` vs `:158-178`.
- The edge compiles that array (`effect/edge.ts:255-262`), and the authz sweep reads it (`authz-sweep.test.ts`).
- Drift fails closed (an undeclared route returns 404). Even so, it is a second edit for every endpoint.

**Recommendation:** build `routes` with `HttpApi.reflect(api, { onEndpoint })` (`effect/dist/http-api/HttpApi.d.ts:146`) inside the shared mount helper, then delete the 37 arrays (about 230 lines). The sweep keeps working unchanged because it reads `app.routes`.

### B3. Move the contract into `packages/api-contract`; derive the types and clients from it. Effort: L, as about 8 tasks
**Evidence of duplication (root cause: the schemas sit beside handlers in server files):**
- **`GroupDetail`, 5 copies:**
  - `server/groups/service.ts:73-107` (TS interface)
  - `server/groups/api.ts:121-171` (Schema)
  - `web/lib/api.ts:185-217`
  - `mobile/lib/chat-api.ts:65-77` (interface) and `:221` (schema)

  The mobile copy has drifted: it has no `visibility`, `handle`, `background` or `listener`, and `GroupMember.handle` is `string?` instead of `string|null`.
- **`Me`, 6 copies:** `server/auth/api.ts` (MeView/PatchMeView), `web/lib/api.ts:46-58`, `mobile/auth-api.ts:7-12,37-42`, `mobile/chat-api.ts:141-146`, and `mobile/profile-api.ts:308`. Each copy holds a different subset of fields.
- **`Pin`:** `server/pins/api.ts:96-107`, the web `pinKindSchema` (`api.ts:1017`), and `mobile/pins-api.ts:23-32` (interface) plus `:85-94` (schema) plus `:59-71` (a third copy of the kind list).
- **Draft SSE events:** `server/drafts/events.ts:14-27` and `web/lib/drafts.ts:13-26` are identical, with a "keep them in sync" comment.

**Target design.**
1. **`packages/api-contract`**, plain TS source like `@zilar/protocol`, depending on `effect` only:
   - per feature, `pins.ts` exports the schemas and `PinsGroup = HttpApiGroup.make('pins').add(...)`;
   - `api.ts` exports `ZilarApi = HttpApi.make('zilar').add(PinsGroup)…prefix('/api')`;
   - `errors.ts` exports `ApiErrorBody` (the `{ error: { code, message, requestId?, ...detail } }` envelope) and a `code` literal union;
   - `middleware.ts` exports the middleware *tags* only: `Session`, `CurrentUser`, `SchemaErrors` and the rate-limit tags. They are plain `Context` keys with no server dependencies.
2. **Server:**
   - `HttpApiBuilder.group(ZilarApi, 'pins', handlers)` stays in `apps/server/src/pins/api.ts`, which keeps only the handlers and layers;
   - the layer implementations of the middleware stay in `http-core.ts`.
3. **Clients:** `HttpApiClient.make(ZilarApi, { baseUrl, transformClient })` built once per app runtime:
   - **web:** `apps/web/src/lib/effect/runtime.ts` already provides `FetchHttpClient.layer`. Cookies are same-origin by default, so no auth transform is needed;
   - **mobile:** `transformClient` adds `HttpClient.mapRequestEffect` to set `authorization: Bearer <token>` (or fail `unauthorized` when there is no token), plus the shared envelope mapping.
4. **One error mapping:** `transformClient` = `HttpClient.transformResponse`. Any status ≥ 400 decodes `ApiErrorBody` into one `ApiError` (`status`, `code`, `message`, `detail`). A malformed body falls back to `request_failed`, as now. Proven in `b-api/proto.mjs`.
5. **Keep the Promise ports.** Web keeps its exported functions and mobile keeps its `PinsApi`-style interfaces, so the ~85 web and ~105 mobile importers do not change. Their bodies become one-liners over the derived client, and the types become `typeof Pin.Type`.

**Migration path, one group per task, smallest first:**
1. **Contract package + root API.** Move pins, blocks and handles schemas and groups; the server imports them; server tests unchanged.
2. **Contract smoke test.** One vitest that runs `HttpApiClient` against `createTestContext()`'s app by injecting `FetchHttpClient.Fetch = (url, init) => app.fetch(new Request(url, init))`. This is the same trick as the prototype, and it is the permanent drift detector.
3. **Mobile per group.** Replace the transport and schemas in `<x>-api.ts` with the derived client. Keep the error class name as an alias of the shared `ApiError` so the 45 `instanceof` sites still work.
4. **Web per section of `api.ts`.** Same approach, keeping `ApiError` and its `detail`.
5. Repeat for the remaining groups (stickers, topics, tools and groups last; they are the biggest).

**Expected lines removed (method: the measurements in §2):**
- **Mobile:** 7,985 → about 2,000 (−6,000). Transport about −2,450; 1,558 schema/interface lines shrink to about 300 (lenient overrides plus type aliases); method objects (~1,100) about halve.
- **Web:** api.ts + tools.ts 2,973 → about 1,000 (−2,000). The 115 schemas and 7 hand-rolled fetch blocks go.
- **Server:** about −1,500 (B2 + B4). The 1,166 schema lines move into the contract.
- **Tests:** the mobile transport tests (101 cases, about 1,500 lines) collapse into one shared transport test. Adjusting the fetch-arg assertions is extra work.

**Bundle:** web +15 KB gz once (measured). Later, each moved group removes its hand schemas, so the net should approach zero. Mobile Hermes bytecode was 12.2 MB after T-0506 (`EFFECT_GUIDE.md:270`); expect +~50 KB (UNVERIFIED; measure with `expo export`).

**Risks and how to detect them:**
- **Hermes `TextDecoder`** (B6) is a hard blocker for mobile; it surfaces on first run (`pnpm phone:smoke`).
- **Test fetch injection.** `FetchHttpClient.Fetch`'s default is cached on first use (`Context.js:593-598`), so the 108 `vi.stubGlobal('fetch')` web tests would silently hit the first stub. The web adapter must provide `Fetch = (u, i) => globalThis.fetch(u, i)`, and mobile must provide its injected `fetchImpl`.
- **Fetch-call assertions** (91 web, 103 mobile). The derived client passes a `URL` object and lowercased `Headers`. Have the adapter pass `String(url)` and plain headers; tests that assert `'Content-Type'` casing still need edits. The repo rule "do not change existing tests" needs a lead exception here.
- **Readonly types.** Contract arrays are `ReadonlyArray`; web and mobile keep `Schema.mutable` / `Pin[]`. Typecheck will find any consumer that mutates them.
- **Version skew.** Mobile can talk to an older server (135 "older payload" comments), and a cached PWA can be older than the server. The contract needs an additive-only rule: new response fields enter as `Schema.optional`, and enum fields on the response side use one shared lenient decoder (unknown → fallback, the `LenientPinKindSchema` idea from `mobile/pins-api.ts:76-82`). Detect with the contract smoke test plus a "decode yesterday's fixture" test.
- **Auth.** The web uses better-auth cookies with same-origin `fetch`, so nothing changes. The mobile bearer moves into `transformClient`. The edge origin guard (`edge.ts:322-330`) sees the same requests as now.
- **SSE, uploads, binary GETs and better-auth:** keep them outside the derived client (§4).
- **Effect `http-api` is marked `@stability unstable`.** It is the same module the server already depends on for all 157 endpoints, so the risk is not new.

### B4. Collapse per-module server boilerplate into one API and one error middleware. Effort: M
**Evidence:**
- 25 copies of `class XSchemaErrors` + `schemaErrorLayer` in two variants (`roles/api.ts:97-108` has no fallback; `topics/api.ts:227-238` falls back to `|| 'Invalid request'`).
- 158 handler bodies wrapped as `const requestId = requestIdOf(request.request); return withErrorEnvelope(Effect.gen(...), logger, requestId)` (e.g. `pins/api.ts:229-276`).
- 37 `HttpApiBuilder.layer` → `toWebHandler` blocks.
- The envelope is written twice: `http-core.ts:86-101` and `edge.ts:153-171`.
- `hasControlCharacters` is copied 3 times (`pins/api.ts:52`, `roles/api.ts:47`, `topics/api.ts:64`).
- Per request, the edge does a linear match over 157 routes (`edge.ts:347-357`), then `toWeb` + `forwardEdgeRequest` + the module's own router + `fromWeb`. That is two request/response conversions. CPU cost UNVERIFIED (not benchmarked).

**Recommendation:**
- One `ErrorEnvelope` middleware applied with `ZilarApi.middleware(...)` (`HttpApi.d.ts:90`). It runs `catchDefect` around the handler and renders `failureResponse`.
- One shared `SchemaErrors` (400 `invalid_request`).
- One `HttpApiBuilder.layer(ZilarApi)` served by the edge's router directly, with the custom matcher deleted. Keep the edge's CORS, origin guard, request id and redacted log.
- Handlers become plain `Effect.gen`.

About −1,300 lines. **Risk:** the order of rate-limit before decode is a middleware property today and stays one, so this is low risk. Any status or body drift shows up in the server route tests and `authz-sweep.test.ts`.

### B5. One mobile transport, one error class. Effort: M (mechanical; it falls out of B3)
**Evidence:** `diff` of `pins-api.ts:117-209` against `search-api.ts:110-202`, with names stripped, differs only in abort support. All 25 files repeat the `XxxApiError(status, code, message)` class (`pins-api.ts:48-58`), 4 tagged errors, `requestEffect`, `withTokenEffect` and a `catchTags` back to the class.

**Recommendation:** even before B3, one `apps/mobile/src/lib/api-transport.ts` (request + bearer + envelope + abort) and one `ApiError`, with the old class names re-exported as aliases. That is about −2,000 lines and −1,500 test lines (keep one transport test file). If B3 is approved, skip this and go straight to the derived client.

### B6. Hermes lacks `TextDecoder`, which blocks `HttpApiClient` on mobile. Effort: S
**Evidence:** the iOS simulator `hermesvm` binary has `TextEncoder` strings and no `TextDecoder`. React Native's `Libraries/` has no polyfill, and the mobile `package.json` has none. Effect decodes every response body with `new TextDecoder().decode` (`effect/dist/http-api/HttpApiClient.js:514`, `http/HttpClientResponse.js:237`). Mobile has never run an Effect `HttpClient` request: it only provides the layer (`mobile/src/lib/effect/runtime.ts:7-10`), so this never surfaced.

**Recommendation:** add a ~30-line UTF-8 `TextDecoder` polyfill module imported first in the mobile entry (no package needed), plus a vitest that deletes `globalThis.TextDecoder` and decodes. Then verify on the emulator with `pnpm phone:smoke`. Android is UNVERIFIED.

### B7. Error codes and statuses: unify, then type them. Effort: S (constructors), M (typed union)
**Evidence (`b-api/errors.txt`):**
- **`xmpp_unavailable` uses two statuses.** It is 503 in pins, stickers, groups, roles, avatars and backgrounds, and in part of topics. It is 502 in `topics/rooms.ts:527` and in `topics/service.ts:348,522,656,746,759,937,1018,1100`. The same sentence is copied 33 times.
- **Disabled features use three answers:** 501 (`search_unavailable`, `gifs_unavailable`, `media_unavailable`, `files_unavailable`, `import_unavailable`), 503 (`ais_unavailable`, `push_unavailable`, `connections_unavailable`, `app.ts:534`) and 404 (push off, `app.ts:196`).
- **Limits use two shapes:** `pin_limit` 400 (`pins/service.ts:147`) and `too_many_pins` 409 (`chat-prefs/service.ts:336`, which is about pinned *chats*, so the near-identical names are confusing); `folder_limit` 409; and seven `too_many_*` codes at 409.
- **429 has two codes:** `rate_limited` (39) and `too_many_requests` (1).
- **Not-found codes vary:** `404 not_found` (126) next to `pack_not_found` and `machine_not_found`.
- **Format errors vary:** `avatar_not_image` 400 and `not_audio` 422.
- **`code: string` is untyped** (`errors.ts:5-23`). The tools client builds `ApiError` without `detail` (`web/lib/tools.ts:131-138` vs `api.ts:284-293`).

**Recommendation:**
1. Shared constructors in `apps/server/src/errors.ts`, such as `xmppUnavailable()`, `featureUnavailable(code)` and `rateLimited(msg)`.
2. Pick one status per class: 503 for an upstream/XMPP outage and for a feature that is off (or 501 everywhere), and 409 for limits.
3. Export the code union from the contract so client `code === '…'` checks become typed. The 287 compares will then catch typos at compile time.

Statuses are client-visible, so each status change needs the client checks found by grep. List them in the spec.

### B8. Endpoint naming inconsistencies (fix only during B3, behind aliases). Effort: S each
**Findings:**
- **snake_case in one camelCase API.** The sticker favorites body uses `{ sticker_id }` and `DELETE /api/sticker-favorites?sticker_id=` passes it as a query string on a DELETE (`stickers/api.ts:153`, mock `mock/api.ts:2433-2450`). A resource path would be `PUT/DELETE /sticker-favorites/:stickerId`. The machines runner payload `os_version`, `ram_gb`, … (`machines/api.ts:116-140`) is a CLI wire format; keep it.
- **Voice is spread over four paths:** `POST /api/voice` (transcode upload), `POST /api/voice/transcript`, `GET /api/voice/transcription` (a flag) and `…/settings/integrations/voice-transcription`.
- **Settings are scattered:** `/chat-background`, `/push/settings`, `/settings/integrations/*`, `/chat-prefs/:chatJid`, and `PUT /me/handle` next to `PATCH /me`.
- **Avatars are asymmetric:** `GET /avatars/:id` vs `PUT|DELETE /avatars/:kind/:ownerId`.
- **Mixed verb styles:** `POST /ai-memory/clear` vs `DELETE /ai-memory/facts/:id`, and `POST /approvals/:id/decision` (a noun) vs `…/approve`, `/accept`, `/pause` (verbs).
- **Three DELETE response styles:** `{ok}` (6), 204/Void (9) and the deleted row (12) (`b-api/endpoints.json`).
- **Path parameter names mix** `:id` with `:packId`, `:stickerId`, `:chatJid` and `:ownerId`.
- **"invites"** means sign-up codes (`/invites`), while group links are `/groups/:id/invite-links` and redemption is `/join/:token`.

**Recommendation:** write a short naming rule in `docs/` (resource paths, camelCase, DELETE → 204, actions as `POST /:id/<verb>`) and apply it only to new endpoints. Renaming live paths breaks old mobile builds, so do it only with a server alias for one release.

### B9. Web hand-rolled transports. Effort: S (falls out of B3)
**Evidence:** 7 fetch + envelope + decode copies: `api.ts:253`, `:1626` (search), `:1903` (sticker upload), `:2135` (gifs), `:2589` (avatar upload), `:2659` (backgrounds), and `tools.ts:117`. Each has its own mock branch (7 `isMockApiEnabled()` checks).

**Recommendation:** with B3, mock mode becomes one `FetchHttpClient.Fetch` override that calls `mockRequest(path, init)`, the same injection the prototype uses, and the 7 branches go. Uploads keep one `upload(path, blob, method)` helper.

## 4. Things that look bad but should stay

- **The draft SSE stays on `EventSource`** (`web/lib/drafts.ts:46`). It reconnects by itself and sends cookies; Effect's `StreamSse` client would need fetch streaming, which RN lacks. Move only `DraftEventSchema` into the contract.
- **better-auth `/api/auth/*` stays outside the contract** (`edge.ts:335-341`). Its client libraries (`web/lib/auth.ts:11`, mobile `authClient`) own those shapes.
- **Binary uploads and binary GETs stay hand-written.** These are sticker multipart/raw, avatar PUT, background, voice, `GET /avatars/:id`, `/stickers/:id/file` and `/gifs/media/:token`. The server enforces size caps while streaming (`stickers/api.ts:681+`). The contract can still declare their paths, so `HttpApiClient.urlBuilder` gives typed `<img src>` URLs.
- **The edge's CORS, origin guard, request-id and redacted log** (`edge.ts`) are real policy; only the route matcher should go.
- **The Promise port interfaces on both clients** are the test seams (fakes for the stores). Keep them and derive their implementations.
- **The envelope `{ error: { code, message, requestId, ...detail } }`** is fine and is already shared in spirit. Keep the shape and give it one schema.
- **Lenient decoding on mobile** (unknown enum → default) is correct for app-store version skew. Keep it, as one shared helper in the contract.
- **The web and mobile mock backends** (7,933 + 3,629 lines) are exempt by decision (`EFFECT_GUIDE.md:23`). With a contract they get type-checked against `typeof X.Type` for free. Turning them into `HttpApiBuilder` implementations is possible but not worth it now.

## 5. Open questions for the owner

1. Do you approve a new workspace package (`packages/api-contract`), or should the HTTP contract live inside `@zilar/protocol` (686 lines today, XMPP payloads only)?
2. The client migration changes about 194 test assertions on fetch arguments (URL object, header casing). Is a one-time exception to "do not change existing tests" acceptable for these mechanical edits?
3. Which status should mean "feature off": 501, 503 or 404? Which should mean "XMPP down": 502 or 503? Old mobile builds read some of these codes (`gifs_unavailable` 4×, `push_unavailable` 2×).
4. What is the version-skew promise for mobile? How many server releases back must a store build keep working? That decides how long new fields stay `optional` in the contract.
5. The Hermes `TextDecoder` polyfill: may a worker add a ~30-line in-repo polyfill, or do you prefer a package?
6. Should B5 (one mobile transport, no contract) go first as a quick win, or straight to B3?
