---
id: T-0148
title: Mobile: GIFs (see and send)
status: todo
milestone: M5
branch: task/T-0148-mobile-gifs
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0122, T-0143]
estimate: 1 day
---

# T-0148: Mobile: GIFs

## Spec (written by Claude, do not edit)

### Why
Web users can search and send GIFs (T-0122): they arrive as attachments loaded through a privacy proxy on the Galena server, and the feature is off until `GIF_PROVIDER` and `GIF_API_KEY` are set. Mobile has the sticker sheet now (T-0143) but no GIF tab, and GIFs sent from the web show as a plain file on the phone. Mobile is the smaller share of the work (about 20%): keep it small, follow the existing mobile patterns, store and mock. Read `AGENTS.md` first, including the security checklist, and the Spec, Report and Review of `work/T-0122-gifs.md` (the wire contract, the media token proxy, the privacy rules) and `work/T-0143-mobile-stickers.md`.

### What to build
1. Rendering: an incoming attachment that web sends as a GIF (the `gif-` file name / video or gif mime convention T-0122 defines; read `isGifVideoAttachment` and `GifMessage.tsx` on web) is shown inline, auto-playing and muted, looping, at most the chat width. It loads ONLY when its URL is a same-origin `/api/` path of the Galena API (resolve relative paths against the API origin); an attachment with any other host is never loaded: show a plain file row. The sanitizer rule web applies on receive (neutralize foreign hosts for every attachment kind, strip the `gif-` prefix on a downgrade) applies here too. Auth headers go only to the API origin. Tap opens it full screen (reuse the existing media viewer if there is one). Respect "reduce motion": show a still frame / tap to play.
2. Picker: a GIFs tab in the sticker sheet: search field (debounced about 300 ms, cancel the in-flight request when the query changes), trending when the query is empty, infinite scroll with the returned `pos` cursor, loading, empty, error-with-retry and rate-limited states. The tab is hidden when the server answers 501 (provider off), probed once per session. Results show the proxied preview URLs (never a provider URL); queries are never logged.
3. Sending: tapping a result fetches the media through the proxy, then sends it through the existing attachment upload path as a GIF attachment with the mime and extension derived from the real content type (image/gif, image/webp, video/mp4, video/webm), exactly as web does; optimistic bubble, failed state with Retry.
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

## Review (written by Claude)
