---
id: T-1234
title: "TG-3 link previews, server + web: GET /api/link-preview?url= fetches an https page through the SSRF-guarded fetcher (any public host, no redirects, 10 s, 2 MB), parses og:/twitter:/<title> into {title, description, siteName}, caches 24 h in memory; the web shows a small card under a message's first https link. No image in v1 (privacy)."
status: merged
milestone: M5
branch: task/T-1234-link-previews-server-web
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1234: Link previews (server and web)

## Spec (written by Claude, do not edit)

### Why
It's item 3 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): a pasted URL is just a link today. The server already has a safe fetcher for the AI web tools, `guardedGet` (`apps/server/src/web-tools/guarded-fetch.ts:125`). It's https only and port 443 only; it resolves DNS and refuses private, loopback and link-local addresses via `classifyIp` (`apps/server/src/sandbox/ip-guard.ts:175`); it pins the IP, never follows redirects, and caps time and bytes (`:29-31`). But it only fetches hosts from an exact allowlist (`options.allowedHosts`, checked at `:166`).

### What to build
1. **`guarded-fetch.ts`:** add an option `anyPublicHost?: boolean` to `GuardedGetOptions` (`:49-56`). When it's true, the allowlist check at `:166` is skipped; **every other check stays.** Keep the file at most 400 lines (it's 386); if the change doesn't fit, move a helper out and cite it.
2. **The new server module `apps/server/src/link-preview/`:**
   - **`parse.ts`:** from the HTML head, read `og:title`, `og:description` and `og:site_name`, then `twitter:title` and `twitter:description`, then `<title>` and `<meta name="description">`. Decode entities, trim, and cap the title at 200 chars and the description at 300. Use the existing `apps/server/src/web-tools/html.ts` helpers if they fit (cite them). The result is `{ title?, description?, siteName? }`, or `null` when there's no title and no description.
   - **`fetch.ts`:** `guardedGet(url, { anyPublicHost: true, timeoutMs: 8000, maxResponseBytes: 512 * 1024 })`, for `text/html` only. A 3xx, an error or a non-HTML answer is `null`.
   - **The cache:** in memory, keyed by the normalized URL (no fragment), with 24 h for a hit and 1 h for `null`. Cap it at 2,000 entries, oldest dropped first. Two concurrent requests for the same URL share one fetch.
   - **Logging:** never log the URL or the page content; log the host and the outcome only.
3. **Route:** a new GET route at `/api/link-preview?url=…`, session required.
   - **Contract:** a new `packages/api-contract/src/link-preview.ts` group, added to the client's group list the way `MediaGroup` is (`packages/api-contract/src/api.ts:22,61`).
   - **Server:** mount it **inside the media API module** (`apps/server/src/media/api.ts`: add the group to `MediaApi`, `:182`, and its handler beside `:195`) so `apps/server/src/app.ts` **doesn't change**.
   - **Answers:** 200 with `{ title?, description?, siteName? }`, or 204 when there's nothing.
   - **Rate limit:** 60 per minute per user, the way other read routes limit (cite it).
   - **Bad input:** answer 400 for a URL that isn't https or is longer than 2,000 chars.
4. **The web card:** under a message bubble whose text has an https link (the first one, from `splitLinks`, `packages/chat-core/src/links.ts:60`), and which has no image or attachment, show a small card with the site name, a bold title and a two-line description, linking to the URL (`target="_blank" rel="noopener noreferrer"`).
   - Fetch it through `client.…linkPreview(…)` with a module-level cache and in-flight dedupe, so a list re-render doesn't refetch.
   - Nothing shows while loading or for 204.
   - The new component is `apps/web/src/components/message/LinkPreviewCard.tsx`, mounted from `MessageTextBody.tsx` (`apps/web/src/components/message/MessageTextBody.tsx`) below the text. Use theme tokens and no emoji.
5. **Tests** (permissions and the fetch guard; keep to these), in a new `apps/server/src/link-preview/link-preview.test.ts`, with a fake fetcher:
   - `parse` picks `og:` over `<title>` and caps the lengths;
   - the route answers 401 without a session and 400 for an `http:` URL;
   - with `anyPublicHost`, a host resolving to `10.0.0.1` is still refused (call `guardedGet` with a fake resolver).

### Out of scope (note in the Report)
- Preview images: they need a server image proxy so readers' IPs never reach the site.
- Mobile: the next task.

### Read first
`AGENTS.md`, `docs/audit/telegram-parity-audit.md` §4 row 3, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/html.ts`, `apps/server/src/sandbox/ip-guard.ts`, `apps/server/src/media/api.ts`, `packages/api-contract/src/media.ts`, `packages/api-contract/src/api.ts` and `apps/web/src/components/message/MessageTextBody.tsx`.

### Allowed files
`apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/link-preview/**`, `apps/server/src/media/api.ts`, `packages/api-contract/src/link-preview.ts`, `packages/api-contract/src/api.ts`, `packages/api-contract/src/index.ts`, `apps/web/src/components/message/LinkPreviewCard.tsx`, `apps/web/src/components/message/MessageTextBody.tsx`, `apps/web/src/lib/api/**`, `work/T-1234-link-previews-server-web.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and `app.ts` is unchanged.
- **The lead's checks after deploy:**
  - `/api/link-preview?url=https://github.com` answers 200 with a title;
  - an `http://` URL answers 400;
  - on the web, a message with a link shows the card.

---

## Report (written by the worker when done)

### What I did

- **`guarded-fetch.ts`:** added `anyPublicHost?: boolean` to `GuardedGetOptions`. When `true`, the exact-host allowlist check is skipped; every other guard is unchanged (https only, port 443, no credentials, `isIpLiteral` refusal, DNS pin, `classifyIp` refusal, no redirects, time/byte caps). File is 392 lines (was 386).
- **`apps/server/src/link-preview/parse.ts`** (new, pure): reads `og:title`/`og:description`/`og:site_name`, then `twitter:title`/`twitter:description`, then `<title>`/`<meta name="description">`; decodes entities, trims, collapses whitespace, caps title at 200 and description at 300; returns `null` when there is no title and no description.
- **`apps/server/src/link-preview/fetch.ts`** (new): `fetchLinkPreview(url)` calls `guardedGet(url, { allowedHosts: [], anyPublicHost: true, timeoutMs: 8000, maxResponseBytes: 512 * 1024 })`, keeps only `contentType === 'text/html'`, and returns the parsed preview or `null` (a 3xx, an error, a non-HTML body and an empty head are all `null`). In-memory cache keyed by the URL without its fragment: 24 h for a hit, 1 h for `null`, capped at 2,000 entries (oldest first), with a `Map` of in-flight promises so two concurrent calls share one fetch. Logs `{ host, ok }` at `debug` only — never the URL or the page text.
- **Contract:** `packages/api-contract/src/link-preview.ts` defines `LinkPreview` and `LinkPreviewGroup` (`GET /api/link-preview`, query `{ url: RawQueryValue }`, `success: [LinkPreview, HttpApiSchema.NoContent]`, `Session` + `SchemaErrors`, prefix `/api`). Added to `ZilarApi` (`api.ts`) next to `MediaGroup` and to the barrel (`index.ts`).
- **Server route:** mounted inside the media module (`apps/server/src/media/api.ts`): added `LinkPreviewGroup` to `MediaApi`, a second `HttpApiBuilder.group(..., 'linkPreview', ...)`, merged the two group layers. Handler order is session (middleware) → limiter → manual query decode → fetch. Answers `200 { title?, description?, siteName? }` or a raw `HttpServerResponse.empty()` (204). A missing, non-`https`, or >2,000-char `url` is `400 invalid_request`. Rate limit: 60/min per user through a `createRateLimiter` in this module, the same way the gallery limits (`MEDIA_RATE_LIMIT_MAX`, `media/api.ts:44`, checked at the top of the gallery handler). `apps/server/src/app.ts` is unchanged.
- **Web:** `apps/web/src/lib/api/media.ts` gained `linkPreview(url)` over `client.linkPreview.get({ query: { url } })` with a module-level cache and in-flight dedupe (and `resetLinkPreviewCache` for tests). `apps/web/src/components/message/LinkPreviewCard.tsx` (new) reads it, shows nothing while loading/for 204, and renders an `<a target="_blank" rel="noopener noreferrer">` with the site name, a bold title and a two-line description using theme tokens and no emoji. `MessageTextBody.tsx` computes the first `https` link via `splitLinks` when the message has no `image` and no `attachment`, and mounts the card below the text.
- **Tests:** new `apps/server/src/link-preview/link-preview.test.ts` with the three cases from the spec.

### Files changed

- `apps/server/src/web-tools/guarded-fetch.ts`
- `apps/server/src/link-preview/parse.ts` (new)
- `apps/server/src/link-preview/fetch.ts` (new)
- `apps/server/src/link-preview/link-preview.test.ts` (new)
- `apps/server/src/media/api.ts`
- `packages/api-contract/src/link-preview.ts` (new)
- `packages/api-contract/src/api.ts`
- `packages/api-contract/src/index.ts`
- `apps/web/src/components/message/LinkPreviewCard.tsx` (new)
- `apps/web/src/components/message/MessageTextBody.tsx`
- `apps/web/src/lib/api/media.ts`
- `work/T-1234-link-previews-server-web.md` (status + this Report)

All inside the task's Allowed files.

### Commands run and real results

- `pnpm install`: PASS (resolved 1270, added packages, "Done in 10.7s").
- `pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts --reporter=dot` (the task's Checks command): PASS — `Test Files 1 passed (1)`, `Tests 5 passed (5)`.
- `pnpm gate` (from the repo root, run once at the end): **GATE PASS**. Summary lines:
  - `gate: 12 changed file(s) against main`
  - `PASS  install (frozen)  (0.9s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.7s)`
  - `PASS  typecheck  (2.8s)`
  - `PASS  effect  (0.5s)`
  - `SKIP tests @zilar/api-contract (no nearby test files)`
  - `PASS  tests @zilar/server  (3.1s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`
  - (An earlier `pnpm gate` failed on `react(set-state-in-effect)` in the card; the redundant synchronous `setState({ kind: 'loading' })` in the effect was removed and the next gate passed.)
- The 5 passing tests: `parseLinkPreview` picks `og:` over `twitter:`/`<title>` and caps the description at 300; `parseLinkPreview` falls back to `<title>` (with `&amp;`) and returns `null` for a page with neither title nor description; `guardedGet` with `anyPublicHost: true` and a resolver returning `10.0.0.1` still answers `{ ok: false, summary: 'host not allowed' }`; the route answers 401 without a session; the route answers 400 for an `http:` URL.

### Problems, deviations from the spec, open questions

1. **Entity decoder.** `web-tools/html.ts` (out of Allowed files) keeps `decodeEntities` private and strips `<head>`, so neither helper fits. `parse.ts` carries its own small decoder (named entities + numeric). This is the spec's "use the existing helpers if they fit" fallback.
2. **Effect ratchet.** The gate's `effect` step fails a new counted source file that is "needs-effect". `parse.ts` is pure and got an `// effect-plain:` marker (like `html.ts`). `fetch.ts` returns an `Effect` at its public edge (`Effect.suspend`/`Effect.promise` over the guard's own `Promise`), keeping the cache implementation plain; `LinkPreviewCard.tsx` is presentational and got an `// effect-plain:` marker since the api module owns the fetch.
3. **Rate limit placement.** The contract middleware tags live in `packages/api-contract/src/middleware.ts`, which is not in Allowed files, so the budget is a `createRateLimiter` inside `media/api.ts` (exactly how the gallery does it), not a contract middleware.
4. **Web barrel.** `apps/web/src/lib/api.ts` is not in Allowed files, so `LinkPreviewCard.tsx` imports `linkPreview` from `@/lib/api/media` directly (precedent: `apps/web/src/store/effects/groupSettings.ts` imports from `@/lib/api/groups`).
5. **I did not test the 200 path end to end.** The spec's test list stops at 401/400 for the route, and hitting a real host is not allowed from tests; the 200/204 encoding is only covered by `pnpm typecheck` and the live checks below. `app.ts` unchanged is confirmed by `git status`.
6. **Out of scope (as noted in the spec):** preview images (need a server image proxy) and mobile.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (3 nits, left as they are).**
- **Guard:** `anyPublicHost` skips only the host allowlist; https only, port 443, the DNS pin, the private-address refusal and no redirects all stay. The test proves that `10.0.0.1` is still refused with the flag on.
- **Fetch:**
  - 512 KB cap and 8 s timeout;
  - a 24 h cache for a hit and 1 h for `null`, at most 2,000 entries, with concurrent requests deduped;
  - logs carry the host and outcome only.
- **Route:** in the media API module (`app.ts` is unchanged). It's session-gated, rate-limited (429), and answers 400 for a URL that isn't https or is too long.
- **Web:** `LinkPreviewCard` under the first https link in a text-only message, with a module cache.
- **Lead's live check after deploy (`e49b7ba62`):**
  - 200 with a title for example.com, news.ycombinator.com, bbc.com/news and effect.website;
  - **204 for github.com and wikipedia.org**, probably no User-Agent header (Wikimedia refuses those) or the page is over the 512 KB cap (a too-large page fails instead of parsing the head). Follow-up: send a bot User-Agent, and read only the first 512 KB;
  - an `http://` URL gives 400.
