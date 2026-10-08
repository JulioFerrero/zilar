---
id: T-0573
title: "Effect C (HTTP): POST /api/voice onto HttpApi as the binary pilot (raw bytes in under a streaming cap, raw audio/mp4 bytes out with the duration header); same 413/400/415/422 order and texts, temp dir always removed; tests unchanged; guide item 12"
status: todo
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

## Review (written by Claude)
