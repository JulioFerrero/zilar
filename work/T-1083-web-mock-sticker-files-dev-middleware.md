---
id: T-1083
title: "Web mock: a dev-server-only vite middleware serves the shared backend's seed sticker files, so sticker images show in ?mock=1"
status: todo
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

## Review (written by Claude)
