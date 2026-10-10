---
id: T-1083
title: "Web mock: a dev-server-only vite middleware serves the shared backend's seed sticker files, so sticker images show in ?mock=1"
status: merged
milestone: M5
branch: task/T-1083-web-mock-sticker-files-dev-middleware
model: auto
effort: default
depends_on: [T-1082]
estimate: 0.25 day
---

# T-1083: Web mock sticker images via a dev middleware

## Spec (written by Claude, do not edit)

### Why
This is slice 1 of `docs/audit/mock-sweep-status.md` §3.1 and §4 (T-1082). The lead re-read main (2026-10-11):
- **The url:** sticker rows carry the relative url `/api/stickers/:stickerId/file`, from `mockStickerFileUrl` in `packages/mock-backend/src/domains/stickers/seed.ts:92`.
- **The `<img>`:** `apps/web/src/components/sticker/StickerThumb.tsx:27-35` renders `<img src={sticker.url}>`. The browser fetches it itself, so it never reaches `dispatch` (`apps/web/src/mock/backend.ts`).
- **The 404:** the vite dev server proxies `/api` to `process.env.ZILAR_API_URL ?? 'http://localhost:3000'` (`apps/web/vite.config.ts:13-20`). Mock mode runs no server there, so the image fails and the tile is blank.
- **The backend can already answer:** its route `GET /stickers/:id/file` returns the seed's SVG art with `Content-Type: image/svg+xml` (`packages/mock-backend/src/domains/stickers/routes.ts:30-31`, `:115-121`), and web `<img>` renders SVG.
- **The production check stays:** `apps/web/src/lib/stickers.ts:93-120` (same-origin `/api/stickers/:id/file` only) stays exactly as it is.

### What to build
1. **A small vite plugin** in a new `apps/web/src/mock/dev-sticker-files.ts`, registered in `apps/web/vite.config.ts`. It has `apply: 'serve'`, so it is never part of `vite build`.
   - In `configureServer`, load `@zilar/mock-backend` through `server.ssrLoadModule`, so vite compiles the TypeScript workspace package. Create one `createMockBackend({ delayMs: 0 })`.
   - Add a middleware that runs **before** the `/api` proxy. For `GET /api/stickers/:stickerId/file`, call `backend.http` with that same path and `{ method: 'GET' }`.
     - A `200` answer is piped back with its status, `Content-Type` and body.
     - Any other path, method or status calls `next()`, so the request goes to the proxy as today. A real server's sticker ids are not in the seed, so dev against a real server is unchanged.
   - Keep the plugin under 80 lines, with a comment saying it is dev-only, mock-seed-only and production-free.
2. **Prove it in the Report:**
   - start vite in the worktree (`pnpm --filter @zilar/web exec vite --port 5198 --strictPort --host 127.0.0.1`);
   - `curl -s -o /dev/null -w "%{http_code} %{content_type}"` a seed sticker file such as `/api/stickers/21111111-1111-4111-8111-111111111111/file`; show `200 image/svg+xml`;
   - curl an unknown id; show that it falls through, as a proxy error or 404;
   - then stop vite.
3. **No other files change.** No app code, no tests, and no changes to `lib/stickers.ts`.

The lead's web check (`?mock=1`): the sticker panel's Cats and Moods tiles show their art.

### Read first
`AGENTS.md`, `apps/web/vite.config.ts`, `apps/web/src/mock/backend.ts`, `packages/mock-backend/src/domains/stickers/routes.ts`, `packages/mock-backend/src/domains/stickers/seed.ts`, and `docs/audit/mock-sweep-status.md` §3.1.

### Allowed files
`apps/web/vite.config.ts`, `apps/web/src/mock/dev-sticker-files.ts`, `work/T-1083-web-mock-sticker-files-dev-middleware.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the two curl results.

---

## Report (written by the worker when done)

### What I did

1. Added `apps/web/src/mock/dev-sticker-files.ts`: a Vite plugin with
   `apply: 'serve'`. In `configureServer` it loads `@zilar/mock-backend` through
   `server.ssrLoadModule` (so Vite compiles the TypeScript workspace package),
   creates one `createMockBackend({ delayMs: 0 })`, and installs a middleware
   with `server.middlewares.use` **before** the `/api` proxy (Vite awaits every
   `configureServer` hook before it installs the proxy, so a middleware added
   here runs first). For `GET /api/stickers/:id/file` it calls
   `backend.http(path, { method: 'GET' })`; a `200` is piped back with its
   status, `Content-Type` and body, and every other path, method or status
   calls `next()` so the request goes to the proxy unchanged. A live backend's
   sticker ids are not in the seed, so dev against it is untouched. 60 lines,
   with a header comment saying it is dev-only, mock-seed-only and
   production-free.
2. Registered the plugin in `apps/web/vite.config.ts`:
   `plugins: [devStickerFiles(), react(), tailwindcss()]`.

No other files changed. `lib/stickers.ts` is untouched.

### Files changed

- `apps/web/src/mock/dev-sticker-files.ts` (new)
- `apps/web/vite.config.ts` (register the plugin)
- `work/T-1083-web-mock-sticker-files-dev-middleware.md` (this report)

### Commands and real results

- `pnpm install` — done, no errors (peer-dep warnings only).
- Dev-server check. The literal spec commands use a backgrounded `vite` plus
  `kill` to stop it; the lead's guard rejected the `kill` ("Workers can't kill
  processes"), and AGENTS.md forbids leaving a daemon behind, so I adapted:
  I ran the real Vite dev server and real `curl`, with the server bounded to a
  25 s lifetime by `perl -e 'alarm 25; exec @ARGV'` instead of a manual `kill`,
  from `apps/web`:
  `perl -e 'alarm 25; exec @ARGV' ./node_modules/.bin/vite --port 5198 --strictPort --host 127.0.0.1`
  (ready in 630 ms, `Local: http://127.0.0.1:5198/`), then:
  - seed sticker:
    `curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:5198/api/stickers/21111111-1111-4111-8111-111111111111/file`
    -> **`200 image/svg+xml`**
  - unknown id:
    `curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:5198/api/stickers/00000000-0000-4000-8000-deadbeef0000/file`
    -> **`404 text/html; charset=utf-8`** (falls through to the `/api` proxy;
    a real backend node is listening on `localhost:3000` and returned its 404,
    i.e. it was not answered by the plugin). The server then self-terminated
    (`server_exited`), and `lsof -iTCP:5198 -sTCP:LISTEN` showed no listener.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.9s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/web  (3.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- **Server start/stop method:** as above, I used a bounded
  (`perl alarm`) server plus the exact `curl -s -o /dev/null -w
  "%{http_code} %{content_type}"` invocations instead of a backgrounded vite +
  `kill`, which the guard rejects and AGENTS.md forbids leaving running. The
  curl results above are real.
- **First gate run failed, then passed.** The first `pnpm gate` failed
  `typecheck` with `TS7016`/`TS7006` errors in
  `packages/xmpp-core/src/**` about `@xmpp/client`. Cause: my first draft typed
  the plugin with `typeof import('@zilar/mock-backend')`, and
  `tsconfig.node.json` compiles the plugin through `vite.config.ts`; that type
  import pulled `xmpp-core` into that program, which does not include
  `xmpp-core`'s ambient `@xmpp/client` shim. I replaced it with a small local
  structural type (`MockBackendModule` / `DevMockBackend`) covering only
  `createMockBackend({ delayMs })` and `http(path, init)`. Typecheck then
  passed. No files outside my Allowed files were changed to fix it.
- I did not run any test suites individually; the gate's `tests @zilar/web`
  covers the touched package.

### Open questions

None. Ready for the lead's `?mock=1` web check.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `apps/web/src/mock/dev-sticker-files.ts` (66 lines) is a vite plugin with `apply: 'serve'`.
  - It loads `@zilar/mock-backend` through `ssrLoadModule` and answers `GET /api/stickers/:id/file` from the seed, ahead of the `/api` proxy.
  - Any other path, method or status calls `next()`.
  - It is registered in `vite.config.ts`. `lib/stickers.ts` is untouched.
- **The lead's check** (branch on port 5199):
  - `curl` of a seed sticker file gives `200 image/svg+xml`;
  - in `?mock=1`, the sticker panel's Recent sticker and all six Cats show their art. They were blank before.
- **Permission:** the lead answered one worker request ("once"): start vite with a 25 s alarm, then curl it.
- **Check:** the gate passed.
