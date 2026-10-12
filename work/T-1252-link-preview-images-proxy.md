---
id: T-1252
title: "TG-3 images, server + web: link previews get an og:image served only through our server (GET /api/link-preview/image/:key, key from a cached preview, never an open proxy; jpeg/png/webp/gif only, no SVG, 2 MB cap, memory cache) and the web card shows it — readers' IPs never reach the linked site"
status: merged
milestone: M5
branch: task/T-1252-link-preview-images-proxy
model: auto
effort: default
depends_on: [T-1234, T-1240]
estimate: 0.5 day
---

# T-1252: Link preview images through our server

## Spec (written by Claude, do not edit)

### Why
T-1234 and T-1240 ship previews with no image, on purpose: if the app loaded `og:image` from the linked site, every reader's IP would reach that site (T-1234's "Out of scope"). Telegram shows the image, so we serve it **through our server**.
- **Today's preview:** the schema has `title`, `description` and `siteName` (`packages/api-contract/src/link-preview.ts:13-15`), parsed in `apps/server/src/link-preview/parse.ts`, fetched and cached in `apps/server/src/link-preview/fetch.ts`.
- **The fetcher reads text only:** `guardedGet` (`apps/server/src/web-tools/guarded-fetch.ts`, 390 lines) accepts only the text types in `WEB_ALLOWED_CONTENT_TYPES` (`:41-46`) and decodes the body as text (`:250`). The raw bytes exist inside (`:135`, `:339`).

### What to build
1. **Parse:** read `og:image` (then `twitter:image`). Resolve it against the page URL, keep it **only if the result is `https:`**, and cap it at 2,000 chars.
2. **The image key, so this is never an open proxy:** when a preview with an image is cached, store `key → remote image URL` in the same in-memory cache (key = a random or SHA-256-derived id; cite your choice). The preview answer gets `image?: string` = the **server path** `/api/link-preview/image/<key>`; the remote URL never leaves the server.
3. **The image route,** a new GET at `/api/link-preview/image/:key`, session required. Mount it inside the media API module beside the preview route (as T-1234 did) so `apps/server/src/app.ts` doesn't change.
   - An unknown or expired key answers 404, so nothing outside the cache can be fetched.
   - Fetch through `guardedGet` with a new option `allowedContentTypes` (or an image mode) accepting only `image/jpeg`, `image/png`, `image/webp` and `image/gif`, with **no SVG**. Return the raw bytes; keep the private-address guard, https only, no redirects, `truncateAtMax: false` and a 2 MB cap (too large → 404).
   - Keep `guarded-fetch.ts` at most 400 lines; move helpers to `guarded-fetch-helpers.ts` if needed.
   - Answer the bytes with the upstream image content type, `Cache-Control: private, max-age=86400` and `X-Content-Type-Options: nosniff`.
   - Cache the bytes in memory: at most 200 images and 50 MB in total, oldest dropped first.
   - Rate-limit it like the preview route.
   - Log the host and outcome only.
4. **Contract:** add `image: Schema.optional(Schema.String)` to the preview, and the image endpoint (binary success; follow how another binary route is declared, for example the files or avatars API, and cite it).
5. **Web card** (`apps/web/src/components/message/LinkPreviewCard.tsx`): when `image` is set, show it as a small thumbnail (64 px square, `object-cover`, rounded, `loading="lazy"`) beside the text; with no image, keep today's look. A broken image hides the thumbnail.
6. **Tests** (the fetch guard and permissions), in `apps/server/src/link-preview/link-preview.test.ts`, up to 4:
   - `og:image` with a relative path resolves to https, and an `http:` image is dropped;
   - the image route answers 401 without a session and 404 for an unknown key;
   - an `image/svg+xml` answer is refused;
   - the preview answer never contains the remote image URL.

### Out of scope
Mobile: the next task.

### Read first
`AGENTS.md`, `work/T-1234-link-previews-server-web.md`, `work/T-1240-link-preview-ua-partial.md`, `apps/server/src/link-preview/`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/guarded-fetch-helpers.ts`, `apps/server/src/media/api.ts`, `packages/api-contract/src/link-preview.ts` and `apps/web/src/components/message/LinkPreviewCard.tsx`.

### Allowed files
`apps/server/src/link-preview/**`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/guarded-fetch-helpers.ts`, `apps/server/src/media/api.ts`, `packages/api-contract/src/link-preview.ts`, `apps/web/src/components/message/LinkPreviewCard.tsx`, `apps/web/src/lib/api/media.ts`, `packages/mock-backend/src/domains/media/**`, `work/T-1252-link-preview-images-proxy.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts src/web-tools --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, `app.ts` is unchanged, and every touched file stays at most 400 lines.
- **The lead's live check after deploy (read-only):**
  - the preview for `https://github.com` has an `image` path starting with `/api/link-preview/image/`;
  - fetching that path gives 200 with `image/*`;
  - a made-up key gives 404.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/link-preview/parse.ts`:** `parseLinkPreview(html, pageUrl?)` now reads `og:image` then `twitter:image`, resolves the candidate against `pageUrl` with `new URL`, keeps it only when the result is `https:` (so an `http:` image or a relative path with no base is dropped), and caps it at 2,000 chars. `LinkPreviewData` gained `imageUrl?: string` (the **remote** URL; the fetcher swaps it for a server path and never sends it out). The "no title and no description → null" rule is unchanged, so a page with an image but no title/description still answers `null`.
- **`apps/server/src/link-preview/fetch.ts`:**
  - `LinkPreviewData` (with `imageUrl`) is converted to the wire `LinkPreview` in `toView`: when there is an image it mints a key and stores `key → remote URL` in `imageKeys`, and the answer carries `image: '/api/link-preview/image/<key>'`. The cached preview value therefore holds only the server path.
  - **Key choice:** `createHash('sha256').update(remoteUrl).digest('hex')` (64 hex chars). It is deterministic (the same image shares one cache entry) and not reversible, so a guessed key reveals nothing about the URL. Only keys that a fetched preview registered are in the map.
  - `fetchLinkPreviewImage(key)`: unknown key → `null`; a key older than the 24 h hit TTL → `null` (and dropped). A hit in the bytes cache answers immediately; otherwise `loadImage` fetches through the guard and caches the bytes.
  - Byte cache: at most 200 images and 50 MB total, oldest first (a sibling `imageBytes` map plus a total counter; a duplicate concurrent fetch replaces its accounted size instead of double-counting). The key map is capped at the same 200 and expired keys answer 404.
  - `defaultImageFetcher`: `guardedGet` with `allowedContentTypes: ['image/jpeg','image/png','image/webp','image/gif']` (no SVG), a bot User-Agent and `accept: image/…`, 8 s, a 2 MB cap and `truncateAtMax: false` (too large → miss → 404). The private-address guard, https-only and no-redirects rules are the guard's, unchanged.
  - Logs `{ host, ok }` only for both the preview and the image, never the URL or the bytes.
- **`apps/server/src/web-tools/guarded-fetch.ts`:** added `allowedContentTypes?: readonly string[]` (replaces the default text list for that call) and `bytes: Uint8Array` on `GuardedBody` (the raw body, next to the decoded `text`). File is **389 lines**.
- **`apps/server/src/web-tools/guarded-fetch-helpers.ts`:** moved the pure `failure` and `redirectFailure` helpers here (unchanged behaviour; `redirectFailure` now takes `status`, `location`) so `guarded-fetch.ts` stays under 400. File is 91 lines.
- **`apps/server/src/media/api.ts`:** chained `.handle('image', …)` onto the existing `linkPreview` group builder. It rate-limits with the preview limiter (429), looks the key up through `fetchLinkPreviewImage`, throws the fixed 404 `not_found` for an unknown/expired key, and otherwise answers `HttpServerResponse.uint8Array(bytes, …)` with the upstream content type, `content-length`, `Cache-Control: private, max-age=86400` and `X-Content-Type-Options: nosniff`. `app.ts` is unchanged. File is 391 lines.
- **`packages/api-contract/src/link-preview.ts`:** added `image: Schema.optional(Schema.String)` to `LinkPreview` and a second endpoint `image` (`GET /link-preview/image/:key`, `params: { key }`, `success: HttpApiSchema.Empty(200)`), following the binary-declaration pattern of `backgrounds.ts` `getFile` (`HttpApiSchema.Empty(200)`, raw bytes returned by the handler) and `stickers.ts` `serveFile` (`stickers.ts:197-200`). Inside the existing `Session` + `SchemaErrors` + `/api` group.
- **`apps/web/src/components/message/LinkPreviewCard.tsx`:** when `image` is set the card renders it as a 64 px (`h-16 w-16`) `object-cover` `rounded-md` thumbnail with `loading="lazy"` beside the text (the anchor becomes `flex items-start gap-3`; the text gets `min-w-0 flex-1`). With no image the layout and classes are today's. A broken image is tracked by URL (`brokenImage`) and, when it matches, the thumbnail is hidden — no `setState` inside the effect, so the `react(set-state-in-effect)` rule is not tripped.
- **`apps/server/src/link-preview/link-preview.test.ts`:** the 4 tests from the spec (kept to 4).

### Files changed

- `apps/server/src/link-preview/parse.ts`
- `apps/server/src/link-preview/fetch.ts`
- `apps/server/src/link-preview/link-preview.test.ts`
- `apps/server/src/web-tools/guarded-fetch.ts`
- `apps/server/src/web-tools/guarded-fetch-helpers.ts`
- `apps/server/src/media/api.ts`
- `packages/api-contract/src/link-preview.ts`
- `apps/web/src/components/message/LinkPreviewCard.tsx`
- `work/T-1252-link-preview-images-proxy.md` (status + this Report)

All inside the task's Allowed files. `apps/server/src/app.ts` and `packages/mock-backend/**` are untouched (see the mock note below).

### Commands run and real results

- `pnpm install`: PASS ("Done in 12.6s", pnpm 10.32.1).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/link-preview/link-preview.test.ts`: PASS — `Test Files 1 passed (1)`, `Tests 10 passed (10)`.
- `pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts src/web-tools --reporter=dot` (the task's Checks command): PASS — `Test Files 1 passed (1)`, `Tests 10 passed (10)` (the `src/web-tools` filter selects no test files; it does not fail the run).
- `pnpm gate` (from the repo root, run once at the end): **GATE PASS**. Summary lines:
  - `gate: 9 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.6s)`
  - `PASS  typecheck  (2.1s)`
  - `PASS  effect  (0.4s)`
  - `SKIP tests @zilar/api-contract (no nearby test files)`
  - `PASS  tests @zilar/server  (3.2s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`
  - (The first `pnpm gate` failed only on `format` for `parse.ts`; `pnpm exec prettier --write apps/server/src/link-preview/parse.ts` fixed the line-wrapping and the next gate passed.)
- The 10 passing tests are: (parse) `og:` over `twitter:`/`<title>` with length caps; `<title>` fallback with `&amp;` and `null` when there is neither; **relative `og:image` resolves to https and an `http:` image is dropped**; (fetch) a `og:title` in a 600 KB body; **the preview answer carries only `/api/link-preview/image/…` and never the remote URL**; (guard) `anyPublicHost` + `10.0.0.1` still refused; **an `image/svg+xml` answer is refused when only image types are allowed**; (route) `/api/link-preview` 401 with no session; 400 for an `http:` URL; **`/api/link-preview/image/:key` answers 401 with no session and 404 for an unknown key**.

### Problems, deviations from the spec, open questions

1. **"the same in-memory cache" (spec item 2).** I read this as *the same module's in-memory state*, not literally the URL-keyed preview `Map` (whose entries are previews, not key→URL). The key→URL map is a sibling module-level `imageKeys` map in `fetch.ts`; the remote URL never enters the preview value or the route answer. If the lead meant the preview `Map` itself, say so and I will fold it in.
2. **Rate limiter.** The image route reuses the preview's `linkPreviewLimiter` ("rate-limit it like the preview route"); a page with an image thus spends two units of the same 60/min budget. A separate limiter of the same size would be a small change if preferred.
3. **`GuardedBody.bytes` is always populated.** I add the raw bytes to every successful `guardedGet`, so an image caller does not decode the body to text. The text path still decodes as before; the only construction site outside the guard is the test that fakes a `GuardedGetResult`, which I updated. `guarded-fetch.ts` is 389 lines.
4. **The image fetch path itself has no end-to-end unit test.** The spec names the fetch guard and permissions; the guard is covered by the `image/svg+xml` test (through `guardedGet` with `allowedContentTypes`), and the route by 401/404. `loadImage`'s happy path needs real network, so it is left to the lead's live check, like T-1234's 200 path.
5. **Mock backend untouched.** In mock mode `handleLinkPreview` answers 204 for every URL, so the card never renders an image and never requests `/api/link-preview/image/:key`. No mock change was needed; if mock mode should show thumbnails later, that is a follow-up.
6. No new dependency, no `any`, no `@ts-ignore`, no check disabled.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **What the lead read:**
  - **the key:** sha256 of the remote image URL, stored in `imageKeys` only when a preview with an image is cached. The route looks the key up and answers 404 when it's unknown or expired, so nothing outside the cache is fetched (not an open proxy);
  - **the fetch:** `defaultImageFetcher` uses the same `guardedGet` with `anyPublicHost`. The private-address guard, https-only and no-redirect rules still apply; `allowedContentTypes` covers only jpeg, png, webp and gif (no SVG), with a 2 MB cap and `truncateAtMax: false`;
  - **the response:** `nosniff` plus `private, max-age=86400`;
  - **the bytes cache:** at most 200 images and 50 MB in total, oldest first;
  - **the rate limiter:** shared with the preview route;
  - **the log:** host and ok only;
  - **the line count:** `app.ts` is unchanged, and every file stays at most 400 lines (`media/api.ts` 391, `guarded-fetch.ts` 389).
- **Tests:** `link-preview.test.ts`, 10 passed.
- **Next:** a live check after deploy, read-only (a github.com preview image path gives 200 `image/*`, a made-up key gives 404).
