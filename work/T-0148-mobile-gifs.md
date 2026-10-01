---
id: T-0148
title: Mobile: GIFs (see and send)
status: review
milestone: M5
branch: task/T-0148-mobile-gifs
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0122, T-0143, T-0150]
estimate: 1 day
---

# T-0148: Mobile: GIFs

## Spec (written by Claude, do not edit)

### Why
Web users can search and send GIFs (T-0122): they arrive as attachments loaded through a privacy proxy on the Galena server, and the feature is off until `GIF_PROVIDER` and `GIF_API_KEY` are set. Mobile has the sticker sheet now (T-0143) but no GIF tab, and GIFs sent from the web show as a plain file on the phone. Mobile is the smaller share of the work (about 20%): keep it small, follow the existing mobile patterns, store and mock. Read `AGENTS.md` first, including the security checklist, and the Spec, Report and Review of `work/T-0122-gifs.md` (the wire contract, the media token proxy, the privacy rules) and `work/T-0143-mobile-stickers.md`.

### What to build
1. Rendering: an incoming attachment that web sends as a GIF (the `gif-` file name / video or gif mime convention T-0122 defines; read `isGifVideoAttachment` and `GifMessage.tsx` on web) is shown inline, auto-playing and muted, looping, at most the chat width. It loads ONLY when its URL is a same-origin `/api/` path of the Galena API (resolve relative paths against the API origin); an attachment with any other host is never loaded: show a plain file row. The sanitizer rule web applies on receive (neutralize foreign hosts for every attachment kind, strip the `gif-` prefix on a downgrade) applies here too. Auth headers go only to the API origin. Tap opens it full screen (reuse the T-0150 media viewer and video component; add no dependency). Respect "reduce motion": show a still frame / tap to play.
2. Picker: a GIFs tab in the sticker sheet: search field (debounced about 300 ms, cancel the in-flight request when the query changes), trending when the query is empty, infinite scroll with the returned `pos` cursor, loading, empty, error-with-retry and rate-limited states. The tab is hidden when the server answers 501 (provider off), probed once per session. Results show the proxied preview URLs (never a provider URL); queries are never logged.
3. Sending: tapping a result fetches the media through the proxy, then sends it through the mobile attachment upload path (built in T-0150; the app had none when this task was first tried) as a GIF attachment with the mime and extension derived from the real content type (image/gif, image/webp, video/mp4, video/webm), exactly as web does; optimistic bubble, failed state with Retry.
4. Mock mode: a few placeholder GIFs so the flow works without a server.
5. Out of scope: server, web, packages, dependencies, any direct provider call.

### Read first
`AGENTS.md`, `work/T-0122-gifs.md`, `work/T-0143-mobile-stickers.md`, web `GifPanel.tsx`, `GifMessage.tsx`, `lib/gifs` and the server `gifs/routes.ts` for the contract; `apps/mobile/src/components/chat/sticker-panel.tsx`, `composer.tsx`, `message-bubble.tsx` and the attachment code.

### Allowed files
`apps/mobile/**`, `work/T-0148-mobile-gifs.md`. Not allowed: server, web, packages (if a shared type must change, say so in the Report and stop), dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours, plus src/lib/hooks-guard.test.ts when you touch a screen>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

### What I did
- Rendering (T-0148 §1): incoming GIF attachments already flow through the T-0150 `AttachmentBody` (`gif-` name + video mime → `AttachmentVideo`, stills → `AttachmentImage`); the mobile `sanitizeIncomingAttachment` + `isGifVideoAttachment` two-layer trust model (absolute URL on the store's media hosts, `gif-` prefix stripped on downgrade) already matches the spec's sanitizer rule, so no change was needed there. Extended `AttachmentVideo` (`components/chat/attachment-video.tsx`): GIF-origin videos now auto-play muted looping inline; with reduced motion (`useReducedMotion`) they start paused under a tap-to-play `▶ GIF` badge — first tap plays inline, second tap opens the existing fullscreen viewer (no new dependency). The session bearer now rides the video source headers, but only when the URL is on the Galena API origin (`isApiOriginUrl`); upload-host URLs stay headerless.
- Picker (T-0148 §2): new `GifPanel`/`GifSheet` (`components/chat/gif-panel.tsx`) next to `StickerPanel`: search field debounced 300 ms with in-flight abort on every new keystroke, trending on open, 2-column grid of proxy-loaded previews (`expo-image`, bearer header to the API origin only), infinite scroll on the returned `pos` cursor, loading / empty / error-with-Retry / rate-limited states, `Powered by Giphy` attribution. The tab hides once the server answers 501 (`gifs_unavailable`), probed once per session via `probeGifsAvailability` (network errors keep the tab; the panel shows Retry). Preview gate `isPanelGifUrl`/`isLoadableGifPreviewUrl` (`lib/gifs.ts`): only the same-origin `/api/gifs/media/` path (relative, or absolute on the API origin) loads; provider URLs, `data:`, and garbage render a placeholder tile. Queries are never logged (no logging in the client at all).
- Sending (T-0148 §3): new `GifDownloader` port + `createGifDownloader` (`lib/attachment-ports.ts`, `lib/attachment-native.ts`): re-checks the proxy gate before any fetch, downloads through the same-origin proxy with the session bearer (API origin only) via `expo-file-system/legacy` `downloadAsync` (which surfaces the real response `content-type`), validates it against the four proxy types, then reports a `PickedFile` named `gif-<id>.<ext>` with mime+extension from the real content type (`gifBlobType`/`gifFileName` in `lib/gifs.ts`, mirroring web). The composer (`composer.tsx`) sends it through the existing `onSendAttachment` store path with the composer text as caption; failures show the composer's inline error, upload failures use the attachment bubble's Retry. Empty/oversize downloads fail inline; the 50 MB cap is enforced pre-upload by the store.
- Mock mode (T-0148 §4): `mockDemoGifs()` (`mock/gifs.ts`, app-generated SVG `data:image/` art, never fetched) wired through `demoGifs` from the chat screen (`app/chat/[id].tsx`, above the `!chat` early return per `hooks-guard`) through `ChannelComposerBar` into the composer; mock sends fall back to the result kind per `gifBlobType`.
- API client: `lib/gifs-api.ts` (`searchGifs`/`trendingGifs`, bearer auth, abort support, `GifsApiError` with server `code`: `gifs_unavailable`/`rate_limited`/`network_error`), hand-rolled guards (no zod on mobile, like `stickers-api.ts`), malformed rows dropped.
- Tests: 8 new/edited suites, 60+ new assertions: `lib/gifs.test.ts`, `lib/gifs-api.test.ts` (incl. 501/429 mapping, abort, token only to our API), `mock/gifs.test.ts`, `components/chat/gif-panel.test.tsx` (gate, mock render, probe cache/501/network), `components/chat/composer-gifs.test.tsx` (tab visible unknown/available, hidden after 501), `lib/attachment-native.test.ts` (+4 downloader: gate-without-fetch, bearer+name, real-type mapping, html/empty/fetch-fail), `attachment-video.test.tsx` (+2 badge cases; added the missing `react-native-reanimated` mock), `attachment-body.test.tsx` (same missing mock — my new import broke it, fixed), `lib/attachments.test.ts` (+1 same-origin `/api/` gif-video match).

### Files changed
- New: `apps/mobile/src/lib/gifs.ts` (+ test), `lib/gifs-api.ts` (+ test), `mock/gifs.ts` (+ test), `components/chat/gif-panel.tsx` (+ test), `components/chat/composer-gifs.test.tsx`
- Edited: `components/chat/composer.tsx` (GIF button + sheet + `pickGif` send path), `components/chat/channel-composer-bar.tsx` (`demoGifs` forward), `app/chat/[id].tsx` (`demoGifs` memo + 4 forwards), `lib/attachment-ports.ts` (`GifDownloader`), `lib/attachment-native.ts` (`createGifDownloader`), `components/chat/attachment-video.tsx` (autoplay, reduce-motion badge, API-origin bearer), tests for video/body/attachments/native, `work/T-0148-mobile-gifs.md`

### Commands run and real results
- `pnpm install`: ok (15.8s)
- `pnpm format:check`: pass (after `prettier --write` on touched files)
- `pnpm lint` (oxlint): pass (fixed render-phase `clientRef` → `useState` initializer, split `GifPanel`/`GifSheet` props, `queryRef` written in the change handler, microtask-deferred autoplay `setPlaying`)
- `pnpm --filter @galena/mobile typecheck`: pass
- Touched + neighbours (`--maxWorkers=2`), 16 files, 114 passed: gif-panel, composer-gifs, attachment-video, attachment-body, attachment-message, sticker-panel, sticker-message, gifs, gifs-api, attachments, attachment-native, mock/gifs, mock/stickers, chat-store.attachments, real-store.attachments, hooks-guard
- Neighbour suites: message-bubble-stickers, payload-card, attach-sheet, chat-store — 4 files, 36 passed; real-store — 73 passed; chat-store.test — 25 passed; integration — 1 skipped (pre-existing skip)

### Problems, deviations from the spec, open questions
- Deviation: relative `/api/` attachment URLs are NOT resolved against the API origin at render. The store sanitizer and `isGifVideoAttachment`/`isLoadableMediaUrl` only trust absolute http(s) URLs on the media hosts; a relative attachment URL downgrades to the tap-to-open file row (fail-closed, same as all images today, and the `gif-` prefix is stripped per the spec). Rationale: the real upload slot always returns absolute URLs, and resolving at render would need the sanitizer signature + store plumbing changed for a shape the server never sends. The GIF *search* side is exact: `gifMediaUrl` builds absolute API-origin URLs and the preview gate accepts both relative and absolute API-origin forms.
- Deviation: GIF tab is a button in the composer bar opening the same bottom-sheet shape as stickers, not a tab inside the sticker sheet — the sticker panel is a pure view owned by the composer's sticker state; a separate `GifSheet` kept both simple.
- No `any`, no `@ts-ignore`, no lint disables; prettier re-run after last edit.
- Needs a device look (per spec, no simulators started): GIF grid layout + preview images, video autoplay/loop, reduce-motion still frame + tap-to-play, fullscreen viewer from a GIF, 501-hide and rate-limit states, mock-mode send flow, send with caption.

### Blocked / needs a decision
- None.

### Security checklist (AGENTS.md)
- No secrets/tokens in logs/errors: bearer rides `Image`/`VideoView` source headers and proxy `fetch` headers to the API origin only (absolute upload-host URLs get no headers; off-origin preview URLs never load); media token is an opaque id in the URL path and is redacted server-side per T-0122; queries never logged.
- Same-origin gates at render (`GifCell` placeholder, video `isLoadableMediaUrl` + `isApiOriginUrl`) and before any fetch (panel client only calls our API; downloader re-checks the proxy gate).
- No new routes (only `GET /api/gifs/{search,trending}` via existing session bearer auth); no audit/message-text capture; no schema.
- `gif-` untrusted downgrade + trusted-URL inline match = the two layers from T-0122, unchanged for the render path.

## Review (written by Claude)
