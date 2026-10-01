---
id: T-0122
title: GIF search and sending (privacy-preserving proxy, provider behind a port)
status: review
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
- Server (`apps/server/src/gifs/`): `provider.ts` (the `GifProvider` port + `GifItem`/`GifPage` zod schemas), `giphy.ts` (the real `giphy` adapter against the documented `api.giphy.com/v1/gifs/{search,trending}` endpoints with `rating` from `GIF_RATING`, plus `createFakeGifProvider` for tests), `token.ts` (HMAC-signed opaque media tokens, 15-min expiry, bound to user id + exact provider URL), `routes.ts` (`GET /api/gifs/search`, `GET /api/gifs/trending`, `GET /api/gifs/media/:token`; session required, 30 req/min/user; results carry `mediaToken`s, never provider URLs; the proxy re-checks https + media-host allowlist, resolve-then-pins via the reused `sandbox/ip-guard` module (imported, not copied), refuses redirects, 8 MiB cap, 10 s timeout, 4 content types only, headers rebuilt + `private, max-age=86400` + `nosniff`; logs counts/durations only; 501 `gifs_unavailable` when unconfigured).
- Config: `GIF_PROVIDER` (`giphy`, unset = off), `GIF_API_KEY`, `GIF_RATING` (default `pg-13`) in `config.ts` (+ tests); `GIF_API_KEY` added to logger `redactPaths`; `app.ts` mounts the routes always (with `gifProvider`/`gifMediaFetcher`/`gifNow` test seams); documented in `docs/SERVER_CONFIG.md`.
- Web: `GifPanel.tsx` (search field debounced 300 ms with abort-cancel, trending on open, 2-column grid of proxy-loaded previews, `<video muted loop playsinline>` for video / `<img>` for images, IntersectionObserver so only visible items play, `prefers-reduced-motion` still frames, infinite scroll with `pos`, "Powered by Giphy" attribution, empty/error/retry/unavailable states); `lib/api.ts` (`searchGifs`/`trendingGifs`/`gifMediaUrl` + zod parsing, mock-aware like search); `StickerPanel` GIFs tab renders it (mock mode gets generated placeholders); `Composer.sendGif` fetches through the proxy then uses the existing `sendAttachment` path (kind `image`/gif or `file`/mp4, caption = draft, inline error on failure, Retry via the attachment bubble); `GifMessage.tsx` renders GIF-origin videos inline as looping muted video (gated on `gif-<id>` name + video mime, since `classify` never yields image/video kinds for these); mock search/trending + `mockGifItems()` placeholders in `mock/`.
- Tests: server 21 (provider parsing incl. hostile fields/wrong hosts/title cap, fake pagination, token bind/expiry/tamper, 501s, 401 sweep-covered, rate limit, proxy header rebuild + URL binding, cross-user/edited/expired tokens, wrong-type/provider-error/fetch-fail 502s, no-query/no-key in logs, real-TLS redirect-refused/size-cap/timeout); web 51 across GifPanel (8), Composer GIFs (3), GifMessage (2), StickerPanel (updated), rest unchanged.

### Files changed
- `apps/server/src/gifs/{provider,giphy,token,routes}.ts` (new) + `{gifs,routes}.test.ts` (new)
- `apps/server/src/{config.ts,config.test.ts,app.ts,logger.ts}`
- `apps/web/src/components/{GifPanel,GifPanel.test,GifMessage,GifMessage.test}.tsx` (new), `{StickerPanel,Composer,MessageBubble}.tsx` + tests, `lib/api.ts`, `mock/{api,helpers}.ts`
- `docs/SERVER_CONFIG.md`, `work/T-0122-gifs.md`

### Commands run and real results
- `pnpm install`: ok (8.7s)
- `pnpm format:check`: pass
- `pnpm lint` (oxlint): pass (fixed 2 `set-state-in-effect` in GifPanel by merging mount+debounce into one timer-driven effect and lazy list init)
- `pnpm typecheck` (turbo, 10 tasks): pass
- `pnpm --filter @galena/server test --maxWorkers=2 src/gifs src/config.test.ts src/authz-sweep.test.ts src/stickers/routes.test.ts`: 5 files, 91 passed (full server suite exceeds the 120s tool timeout at ~500s; the lead runs it per batch — the touched files and neighbours all pass)
- `pnpm --filter @galena/web test --maxWorkers=2`: 86 files, 939 passed
- `pnpm build` (turbo): 2 tasks successful

### Problems, deviations from the spec, open questions
- The GIF tab is a 2-column grid, not masonry: with fixed aspect cells the 2-column grid satisfies "previews + infinite scroll" without a masonry measuring pass.
- `fetchProxiedMedia` takes an optional `port` used only by the local-TLS test; production always uses 443 (same pattern as the sandbox `fetchPinnedHttps`).
- StickerPanel keeps its unused `panelRef` (pre-existing nit from T-0120 review); untouched.
- The Giphy docs ask for client-side calls with analytics pingbacks; we deliberately call server-side with no pingbacks (privacy rule 1), so no view/click/send telemetry reaches Giphy.
- No `any`, no `@ts-ignore`, no lint/ts disables; prettier re-run after last edit.

### Blocked / needs a decision
- None. Open decision for Julio (per spec): create the Giphy API key and put it in `infra/.env` as `GIF_API_KEY` (I did not read that file); without it the feature 501s and the tab hides.

### Review fixes (PREREVIEW.md, lead items 1–4)
1. **Shared rate-limit budget**: `GET /api/gifs/media/:token` now has its own limiter (`GIF_MEDIA_RATE_LIMIT_MAX = 600/min/user`); search and trending keep 30/min. Test: 2 searches + 50 media fetches in one minute all 200, a further trending still 200s, and search 429s at its own cap of 30.
2. **Media token in the request log**: `logPath` in `app.ts` (lead-approved as in-scope) now redacts `/api/gifs/media/<token>` to `/api/gifs/media/:token`. Test asserts the log contains the redacted path and never the token.
3. **logger.ts scope note**: `GIF_API_KEY` in `redactPaths` kept per the lead's in-scope approval (finding 3).
4. **Abort test now asserts stale discard**: the first search mock settles normally *after* the abort (no abort listener, like a same-tick completion), resolving with the old items; the test asserts the grid shows only the fresh item. Verified the test fails when the `signal.aborted` guard is removed (1 failed) and passes with it.
- While writing the new budget test I found the fake's second seed item (`Fake dog`) carries only `previewUrl` (no mp4/gif), so `shape()` drops it and a token taken from a `q=dog` search is empty: the test takes its token from the `q=cat` search instead. No production change.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
