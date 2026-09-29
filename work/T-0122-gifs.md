---
id: T-0122
title: GIF search and sending (privacy-preserving proxy, provider behind a port)
status: planned
milestone: M5
branch: task/T-0122-gifs
model: meta/muse-spark-1.3-contributor
depends_on: [T-0120]
estimate: 2 days
---

# T-0122: GIFs

## Spec (written by Claude, do not edit)

### Why
D27: Julio wants a GIF section like Telegram's. Two rules make it fit Galena: (1) **the user's browser never talks to the GIF provider** (that would leak IP addresses and searches), the server does; (2) **a sent GIF is stored by us**, not hot-linked, so old messages keep working when a provider link dies. GIFs are sent as normal **attachments** (T-0065: XEP-0363 upload + `attachment` payload), so chat history, the media handling and the upload limits are reused.

> **Open decision for Julio (GIF provider).** The code is written against a `GifProvider` port with one real adapter chosen by `GIF_PROVIDER` (start with `giphy`; `klipy` or another can be added as a second adapter later). Julio must create an API key with the provider and put it in `infra/.env` as `GIF_API_KEY`. Do not read that file; without the key the feature reports itself as unavailable.

### Server (`apps/server/src/gifs/**`)
- Port: `interface GifProvider { search(q, { limit, pos }): Promise<GifPage>; trending({ limit, pos }): Promise<GifPage> }` with `GifItem = { id, title (≤ 100), previewUrl, mp4Url | gifUrl, width, height, sizeBytes? }` (only fields the UI needs; provider-specific junk dropped by a zod parse of the provider response, **strict about hosts**: every URL must be `https:` on the provider's documented media hosts, listed in the adapter, otherwise the item is dropped).
- Adapter `giphy` (read the provider's public docs; use their documented endpoints and rating filter `rating=pg-13` by default, env `GIF_RATING`), plus a `fake` provider for tests. New env (zod): `GIF_PROVIDER` (`giphy`, default unset = feature off), `GIF_API_KEY`, `GIF_RATING` (default `pg-13`). Key never logged, never returned.
- Routes (session required, rate limit 30 requests/minute/user): `GET /api/gifs/search?q=&pos=`, `GET /api/gifs/trending?pos=`, `GET /api/gifs/media/:token`. Results do **not** contain provider URLs: each media URL is replaced by an opaque `mediaToken` (HMAC-signed, expiring after 15 minutes, binding the exact provider URL and the user id). `GET /api/gifs/media/:token` verifies the token, then **streams the media from the provider** with: https only, host in the allowlist, the SSRF guard (resolve, reject private/loopback/link-local addresses, connect to the validated IP; reuse the pure `ip-guard` module from `apps/server/src/sandbox/ip-guard.ts`, import it, do not copy it), no redirects, 8 MiB cap, 10 s timeout, only `image/gif`, `image/webp`, `video/mp4`, `video/webm`, response headers rebuilt from scratch (no cookies, no provider headers) plus `Cache-Control: private, max-age=86400`, `nosniff`. Search text is never logged or audited (log counts and durations only).
- The endpoints answer 501 `gifs_unavailable` when the provider is not configured; the web hides the tab.

### Web
- **GIFs tab** in the sticker panel (T-0120 shows "Coming soon" now): a search field (debounced 300 ms, cancelling), trending on open, a masonry/2-column grid of previews loaded **through the proxy** (`<video muted loop playsinline autoplay>` for mp4/webm, `<img>` for gif/webp; only visible items play; `prefers-reduced-motion` shows still frames), infinite scroll with `pos`, attribution line as the provider requires, empty/error/unavailable states.
- **Sending:** click → the client fetches the media through the proxy, then uploads it with the **existing attachment upload path** (T-0065) and sends an attachment message (kind `image` for gif/webp, `file` with a video mime for mp4/webm, whichever the existing renderer shows inline as a looping muted video; if the renderer does not loop videos yet, add that for GIF-origin attachments only). A caption is optional. Failures show the usual retry.
- Mock mode: a handful of generated GIF-like animated WebP/canvas placeholders.

### Read first
- `AGENTS.md`; `work/T-0120-stickers.md` (the panel), `work/T-0065-attachments-web.md` (upload path and rendering), `work/T-0102-tool-sandbox.md` + `apps/server/src/sandbox/{ip-guard,host-fetch}.ts` (SSRF rules you must reuse)
- `apps/server/src/{config.ts,app.ts,rate-limit.ts}`, `authz-sweep.test.ts`; `apps/web/src/components/{Composer,AttachmentPreview,ImageMessage,FileMessage}.tsx`, `store/realStore.ts` (attachment sending), `lib/api.ts`

### Allowed files
- `apps/server/src/gifs/**` (new), `config.ts` (+ test), `app.ts`, `authz-sweep.test.ts`; importing `../sandbox/ip-guard` is allowed, editing the sandbox is not
- `apps/web/src/**` (components, lib, store, mock, tests)
- `docs/SERVER_CONFIG.md`, `work/T-0122-gifs.md`

**Not allowed:** protocol changes, mobile, dependencies, reading `infra/.env`.

### Tests (no real network, no real key)
- Server: provider response parsing (hostile fields, wrong hosts dropped, missing sizes), token signing/expiry/binding to user and URL (a token for user A fails for user B, an edited token fails), proxy limits (size cap, wrong content type, redirect refused, private-address resolution refused, timeout), headers rebuilt, 501 when unconfigured, rate limit, key never in logs/responses (capture logger + JSON), sweep.
- Web: search debounce/cancel, pagination, reduced-motion still frames, send path builds the attachment through the existing uploader (fake), unavailable hides the tab, mock mode.

### Acceptance criteria
- [ ] The browser never contacts the provider; nothing about the user or the search reaches it except from our server.
- [ ] A sent GIF is stored as our attachment and keeps working if the provider disappears.
- [ ] The media proxy cannot be used to fetch arbitrary URLs or internal addresses.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Saved/favorite GIFs, a second provider adapter, mobile UI, GIF creation, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
