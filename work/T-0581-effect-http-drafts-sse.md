---
id: T-0581
title: "Effect C (HTTP): GET /drafts/stream (SSE) onto HttpApi as the streaming pilot; same SSE bytes, headers, heartbeat and unsubscribe-on-disconnect; item-11 wrapper for the test mount; tests unchanged; guide item 14"
status: todo
milestone: M5
branch: task/T-0581-effect-http-drafts-sse
model: auto
effort: low
depends_on: [T-0573]
estimate: 1 day
---

# T-0581: AI draft stream (SSE) on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. The recipe is `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-13.

**No module has served Server-Sent Events through HttpApi yet.** This is the pilot.

### Verified facts (do not re-derive)
- **`apps/server/src/drafts/routes.ts`** (81 lines) has one route, **`GET /drafts/stream`**:
  1. session (401 otherwise);
  2. the headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`, plus whatever Hono's `streamSSE` itself sets. **Read `streamSSE` in `node_modules/hono` and list its exact headers in the Report**, for example `Content-Type: text/event-stream` and `Connection: keep-alive`, and set the same ones;
  3. subscribe to `hub.subscribe(user.id, listener)`;
  4. write each hub event as SSE `event: <event.type>` / `data: <JSON.stringify(event)>`. **Keep the exact bytes Hono's `writeSSE` produces;** read it and say in the Report how you matched it;
  5. when idle for `DRAFT_SSE_HEARTBEAT_MS` (25 s), write the comment `: heartbeat\n\n`;
  6. **on client disconnect, unsubscribe**: no leaked listener.
- **Deps and exports:** `DraftsRoutesDependencies { auth, hub? }` (the default is `sharedDraftHub`), and the exports `DRAFT_SSE_HEARTBEAT_MS` and `createDraftsRoutes`.
- **Tests:** `apps/server/src/drafts/routes.test.ts` mounts `createDraftsRoutes({ auth, hub })` directly (line 107), so keep it as the item-11 wrapper. It checks:
  - a 401 (line 110);
  - the exact SSE format, for the caller only (116);
  - **the listener count going back to 0 on disconnect** (163);
  - **the heartbeat with `vi.useFakeTimers()` and `advanceTimersByTimeAsync`** (186-206). The idle wait must therefore use a timer that vitest's fake timers control. Effect's default clock uses `setTimeout`; check this works.
- **The mount:** `apps/server/src/app.ts:452`, `app.route('/api', createDraftsRoutes({ auth }))`. Change it to `mountEffectRoutes(...)` at the same position.
- **Tests (all unchanged):** `apps/server/src/drafts/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/drafts/api.ts`** with the route:
   - the response body is a stream of SSE text frames;
   - build it with an Effect `Stream` (for example `Stream.callback` and a scoped subscribe with release on interruption), merged with a heartbeat on the same 25-second idle rule;
   - answer with `HttpServerResponse.stream(...)` or a raw web `ReadableStream`, with the same headers;
   - **client disconnect must interrupt the stream and run the unsubscribe.**
   
   Export `createDraftsApi(deps)` and `DRAFTS_API_ROUTES`.
2. **`routes.ts`:** the item-11 wrapper, `DraftsRoutesDependencies` and `DRAFT_SSE_HEARTBEAT_MS`.
3. **`app.ts`:** mount as described above.
4. **`docs/EFFECT_GUIDE.md`:** add item 14 "Server-Sent Events" to the HTTP recipe, at most 6 lines, pointing at `drafts/api.ts`.
5. **Tests:** every listed test passes **unchanged**.

   If the disconnect cannot reach the stream's finalizer, or the fake-timer heartbeat test cannot pass, **stop and report BLOCKED**. Say what you tried, and name the exact effect source files you read.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/voice/api.ts`, `apps/server/src/effect/http.ts`, `apps/server/src/drafts/routes.ts`, `apps/server/src/drafts/routes.test.ts` (all of it), `apps/server/src/drafts/hub.ts` and `apps/server/src/app.ts` (lines 448-456).

### Allowed files
`apps/server/src/drafts/api.ts`, `apps/server/src/drafts/routes.ts`, `apps/server/src/app.ts`, `docs/EFFECT_GUIDE.md`, `work/T-0581-effect-http-drafts-sse.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot drafts authz-sweep app.test
pnpm gate
```

### Acceptance
- The draft stream is served by Effect `HttpApi`, with the same SSE bytes, headers, heartbeat and unsubscribe on disconnect.
- The guide has item 14.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
