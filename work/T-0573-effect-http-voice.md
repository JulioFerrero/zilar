---
id: T-0573
title: "Effect C (HTTP): POST /api/voice onto HttpApi as the binary pilot (raw bytes in under a streaming cap, raw audio/mp4 bytes out with the duration header); same 413/400/415/422 order and texts, temp dir always removed; tests unchanged; guide item 12"
status: merged
milestone: M5
branch: task/T-0573-effect-http-voice
model: auto
effort: low
depends_on: [T-0563]
estimate: 1 day
---

# T-0573: voice conversion on Effect HTTP (the binary pilot)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. The JSON recipe is `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP", items 1-11.

**No module has moved a raw binary body yet.** This is the pilot for bytes in and bytes out. Avatars, backgrounds, files and stickers follow its pattern later.

### Verified facts (do not re-derive)
- **`apps/server/src/voice/routes.ts`** (139 lines) has one route, `POST /voice` (line 35). The order:
  1. the session;
  2. a declared `content-length` above `maxBytes` gives **413** `voice_too_large` "The recording is too large";
  3. **`readCapped`** (line 106) reads the body stream chunk by chunk and **cancels as soon as the total passes the cap**, giving the same 413. A `null` body is empty;
  4. zero bytes gives **400** `voice_empty` "The recording is empty";
  5. a `mkdtemp` temp directory, then write the input file;
  6. `engine.probe(input)`: `NotAudioError` gives **415** `voice_not_audio` "The upload is not a supported recording", and any other error rethrows;
  7. an input duration above 5 minutes gives **422** `voice_too_long` "The recording is too long";
  8. `engine.convert`;
  9. `engine.probe(output)`: an undefined duration or one above 5 minutes gives the same 422;
  10. it answers **200** with the converted bytes and the headers `content-type: audio/mp4`, `content-length`, `cache-control: no-store` and `x-zilar-duration-ms`;
  11. **`finally` always removes the temp directory**, and a failed remove is ignored.
- **The deps:** `VoiceRoutesDependencies` (line 15) holds `auth`, `engine?` and `maxBytes?`. The exports are `VOICE_MAX_BYTES` and `VOICE_MAX_DURATION_MS`.
- **The mount:** `apps/server/src/app.ts:561-568` (around there) mounts `createVoiceRoutes({ auth, engine?: voice, maxBytes?: voiceMaxBytes })` through `app.route('/api', …)`. The only importer of `createVoiceRoutes` is `app.ts` (check with grep); `voice/routes.test.ts` builds through `createApp`.
- **The adapter already lets a handler answer a raw response:** see the `HttpServerResponse` handling in `apps/server/src/effect/http.ts` (around lines 60-140). Use `HttpServerResponse` (for example `uint8Array` or `raw`) with the headers above.
- **Tests (all unchanged):** `apps/server/src/voice/routes.test.ts`, `apps/server/src/voice/integration.test.ts`, `apps/server/src/voice/engine.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/voice/api.ts`** with `POST /voice` on `HttpApi`:
   - **no payload schema;** read the body in the handler;
   - **keep the streaming cap.** Read the request body as a stream (from the Effect request, or the underlying web `Request` the adapter forwards) and stop at the cap. **Never buffer an unbounded body first;**
   - the same order, statuses, texts and headers;
   - the temp-directory cleanup in an `Effect.ensuring`/`acquireRelease` (or the same `try/finally`).
   
   Export `createVoiceApi(deps)` and `VOICE_API_ROUTES`.
2. **`routes.ts`:** keep `VoiceRoutesDependencies`, `VOICE_MAX_BYTES` and `VOICE_MAX_DURATION_MS`, plus `readCapped` if `api.ts` reuses it. Remove the Hono factory, since only `app.ts` used it.
3. **`app.ts`:** `mountEffectRoutes(...)` at the same position, with the same deps.
4. **`docs/EFFECT_GUIDE.md`:** add item 12 to the HTTP recipe, of at most 6 lines: "Binary bodies: how to read a raw body under a cap, and how to answer raw bytes with custom headers", pointing at `voice/api.ts`.
5. **Tests:** every listed test passes **unchanged**.

   If HttpApi cannot read the raw body without buffering it whole, or cannot answer raw bytes with these headers, **stop and report BLOCKED**. Say what you tried, and include the exact API names you checked in `node_modules/effect`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/voice/routes.ts`, `apps/server/src/voice/routes.test.ts` and `apps/server/src/app.ts` (lines 550-575).

### Allowed files
`apps/server/src/voice/api.ts`, `apps/server/src/voice/routes.ts`, `apps/server/src/app.ts`, `docs/EFFECT_GUIDE.md`, `work/T-0573-effect-http-voice.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice authz-sweep app.test
pnpm gate
```

### Acceptance
- `POST /api/voice` is served by Effect `HttpApi`, with the same answers, headers and order, the streaming cap kept and the temp directory always removed.
- The guide has item 12.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
`POST /api/voice` now runs on Effect `HttpApi` (T-0573, the binary pilot).

- **`apps/server/src/voice/api.ts` (new):** `VoiceGroup` = `HttpApiGroup.make('voice').add(HttpApiEndpoint.post('convert', '/voice')).middleware(Session).prefix('/api')`, wrapped in `HttpApi.make('voice')`. The endpoint declares **no payload schema**, so nothing is decoded or buffered before the handler. The handler:
  1. `yield*` session via `.middleware(Session)` (401 before the body is touched);
  2. checks the declared `content-length` against `maxBytes` → 413 `voice_too_large`;
  3. reads `request.request.stream` through a local `readCapped` that uses `Stream.runForEachWhile` and stops the instant the running total passes the cap (the over-cap chunk is not collected), never buffering an unbounded body; cap exceeded → the same 413;
  4. zero bytes → 400 `voice_empty`;
  5. `mkdtemp` then `writeFile` the input;
  6. `engine.probe` with `NotAudioError` → 415 `voice_not_audio`, anything else rethrown;
  7. input duration > 5 min → 422 `voice_too_long`;
  8. `engine.convert`;
  9. output `probe` undefined or > 5 min → the same 422;
  10. answers `HttpServerResponse.uint8Array(converted, { status: 200, headers: { content-type: audio/mp4, content-length, cache-control: no-store, x-zilar-duration-ms } })`. `HttpApiBuilder` returns a handler-returned `HttpServerResponse` untouched, so the bytes and headers survive.
  The temp directory is removed on every exit path with `Effect.ensuring(... rm(dir, { recursive: true, force: true }).catch(() => {}))`.
  Exports `createVoiceApi(deps)` and `VOICE_API_ROUTES = [{ method: 'POST', path: '/api/voice' }]`.
- **`apps/server/src/voice/routes.ts`:** now keeps only `VOICE_MAX_BYTES`, `VOICE_MAX_DURATION_MS` and `VoiceRoutesDependencies`. The Hono factory is gone (only `app.ts` imported it). `readCapped` moved to `api.ts` in its Effect `Stream` form, so the web-`ReadableStream` version is not reused and was removed rather than left dead.
- **`apps/server/src/app.ts`:** the `app.route('/api', createVoiceRoutes(...))` block is replaced by `createVoiceApi({ auth, logger, engine?, maxBytes? })` + `mountEffectRoutes(app, voiceApi.routes, voiceApi.handler)` at the same position. Import changed to `./voice/api`.
- **`docs/EFFECT_GUIDE.md`:** HTTP recipe item 12 (6 lines) on binary bodies, pointed at `voice/api.ts`.

### Files changed
`apps/server/src/voice/api.ts` (new), `apps/server/src/voice/routes.ts`, `apps/server/src/app.ts`, `docs/EFFECT_GUIDE.md`, `work/T-0573-effect-http-voice.md`.

### Effect 4 API names checked
- `HttpServerRequest` exposes `stream: Stream.Stream<Uint8Array, E>` (via `HttpIncomingMessage`), the raw body stream — used instead of the platform `source` object.
- `Stream.runForEachWhile` (stops on the first `false`) for the cap; `Effect.orDie` turns the stream's typed `HttpServerError` into the defect the envelope already handles.
- `HttpServerResponse.uint8Array(body, { status, headers })` for the raw reply; `HttpApiBuilder`'s internal `Response.isHttpServerResponse` check (source `HttpApiBuilder.ts`, in the request path) returns it unencoded.
- `HttpApiEndpoint.post(id, path)` with no `options` (success defaults to `HttpApiSchema.NoContent`), `HttpApiBuilder.group/layer`, `HttpRouter.toWebHandler(..., { disableLogger: true })`.

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice/routes.test.ts` → `1 passed`, `6 tests passed`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice authz-sweep app.test` → `7 passed | 2 skipped` files, `60 passed | 3 skipped` tests (the 401 sweep prints `POST /api/voice -> 401`).
- `pnpm gate` (first run) → `GATE FAIL` on `format` only (`apps/server/src/voice/api.ts`); scope line read `every changed file is inside the Allowed files`.
- `pnpm exec prettier --write apps/server/src/voice/api.ts`.
- `pnpm gate` (second run) →
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (3.7s)
  PASS  format  (68.1s)
  PASS  lint  (2.3s)
  PASS  typecheck  (36.2s)
  PASS  tests @zilar/server  (676.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Tests
All listed tests pass **unchanged**: `voice/routes.test.ts` (6), `voice/engine.test.ts`, `voice/integration.test.ts` (skipped without `ZILAR_VOICE_INTEGRATION=1`), `authz-sweep.test.ts`, `app.test.ts`. No test file was edited.

### Deviations from the spec
1. **`routes.ts` no longer has `readCapped`.** The spec allowed keeping it only if `api.ts` reuses it. `api.ts` reads the Effect `Stream` directly (the spec's preferred option), so the old web-`ReadableStream` helper would have been dead code and was removed.
2. **`VoiceRoutesDependencies` is unchanged, and `api.ts` adds `VoiceApiDependencies extends VoiceRoutesDependencies { logger: Logger }`.** The Effect adapter needs a pino logger for `sessionLayer` and `withErrorEnvelope`; the old Hono factory did not. This is the same `XApiDependencies extends XRoutesDependencies` shape as `push/api.ts`. `app.ts` passes the existing `logger`.
No other spec item was altered; the order, statuses, texts and headers are byte-identical.

### Problems / open questions
None. No BLOCKED condition: the raw body reads as a stream under the cap and the raw bytes answer with the custom headers, both through public `effect/http` and `effect/http-api` APIs.

## Review (written by Claude)

**2026-10-08, lead:** approved. This is the binary pilot.
- **Pre-review:** clean, 0 findings. The packet (08:12) is newer than HEAD d2aff1ac.
- **No test file changed.**
- **Lead check:**
  - `readCapped` uses `Stream.runForEachWhile` on `request.request.stream` and stops once the total passes the cap, without collecting the over-cap chunk;
  - the reply is `HttpServerResponse.uint8Array` with `audio/mp4`, `content-length`, `no-store` and `x-zilar-duration-ms`;
  - the temp directory is removed in `Effect.ensuring`;
  - guide item 12 documents the pattern for avatars, backgrounds, files and stickers.
