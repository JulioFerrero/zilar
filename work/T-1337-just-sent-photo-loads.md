---
id: T-1337
title: "A photo you just sent shows at once and never sticks on 'Image unavailable': keep the local preview until the remote copy loads, retry /api/files a few times with backoff, and reset the broken state when the URL changes (web; check mobile for the same)"
status: merged
milestone: M5
branch: task/T-1337-just-sent-photo-loads
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1337: A just-sent photo loads

## Spec (written by Claude, do not edit)

### Why
The lead's live check, 2026-10-13: @claude_test sent a photo with a caption on chat.zilar.app (web).
- The new bubble showed **"Image unavailable"**, and the console had a **404** for a resource.
- After a page reload the same photo loaded fine (`GET /api/files?chat=…&url=…upload…` → 200 `image/jpeg`).

The web component (`apps/web/src/components/ImageMessage.tsx`, 92 lines):
- `const [broken, setBroken] = useState(false)` (`:26`) and `onError={() => setBroken(true)}` (`:46`) make one failed load **permanent**;
- `broken` never resets when `url` changes (local `blob:` preview → uploaded URL);
- there is no retry.

**Likely cause:** the first request to `/api/files` arrives before the server has indexed the just-sent upload (`apps/server/src/files/api.ts`; find where it looks the URL up, and cite it). It returns 404, and the image is then marked broken forever. Confirm it from the code and say what you found.

### What to build
1. **Web `ImageMessage`:**
   - while a message is outgoing and its upload preview (`blob:`/local URL) exists, keep showing the preview until the remote image has loaded, then swap without a flash. Find where the store keeps the preview URL for a pending attachment, and cite it;
   - on `onError` for an `/api/files` source, retry up to 4 times with backoff (about 1 s, 2 s, 4 s, 8 s) by re-setting `src` with a cache-busting retry counter, **before** showing "Image unavailable";
   - reset `broken` and the retries whenever `url` changes (key the state on `url`);
   - "Image unavailable" gets a small **Retry** button that restarts the attempts.
   - Apply the same to `apps/web/src/components/message/AlbumGrid.tsx` tiles if they use their own `<img onError>`.
2. **Mobile:** check `apps/mobile/src/components/chat/media-bubble.tsx` / `AttachmentImage` for the same sticky-failure pattern right after sending. If it's there, give it the same backoff retry and keep the local `file://` preview until the remote loads. Say what you found.
3. **Server:** only if the cause is a real indexing race and the fix belongs there, e.g. register the upload when the PUT completes. Otherwise leave the server alone and say so. This is message-pipeline code, so one small test is allowed there.
4. Every file stays at most 400 lines. **No UI tests.**

### Read first
`AGENTS.md`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/server/src/files/api.ts`, `apps/mobile/src/components/chat/media-bubble.tsx`.

### Allowed files
`apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/web/src/lib/media-retry.ts`, `apps/mobile/src/components/chat/media-bubble.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/album-grid.tsx`, `apps/mobile/src/lib/media-retry.ts`, `apps/server/src/files/**/*.ts`, `work/T-1337-just-sent-photo-loads.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live check after the deploy** (web, @claude_test → @test_julio): a newly sent photo shows at once and never shows "Image unavailable".

---

## Report (written by the worker when done)

Branch `task/T-1337-just-sent-photo-loads`. Status: review.

### Cause (confirmed from the code)
`GET /api/files` resolves the URL from `media_items` (`apps/server/src/files/api.ts:244` `findFileRow`). A just-uploaded file has no row yet, so the handler indexes the chat on demand (`indexChat`, `api.ts:259`) and looks again (`api.ts:278`). `indexChat` reads the XMPP archive (`apps/server/src/media/indexer.ts:119-120`; the cursor is `timestamp > indexed_through_micros`). The outgoing stanza is not in the archive yet when the browser asks right after the PUT, so both lookups miss and the handler answers `404 not_found` (`api.ts:289-291`). That is the console 404 the lead saw, and the later 200 after a reload. So the 404 is indexer lag: the fix belongs on the client (keep the preview, retry), not in the server's lookup.

### Where the store keeps the preview (asked for in the spec)
- Web: the optimistic message's `attachment.url` starts as the local `blob:` preview, created in `apps/web/src/store/effects/portAdapters.ts:107` (`URL.createObjectURL`) and stored in `packages/client-core/src/store/send/attachment.ts:163` (`url: info.localUrl ?? ''`). When the PUT finishes, `updateMessageAttachment` (`packages/client-core/src/store/ledger-mutators.ts:85-91`) replaces that URL with the uploaded one and the blob URL is not kept, so the component captures it itself.
- Mobile: the store keeps a separate `localUri` (`apps/mobile/src/store/effects/send.ts:97-110`) and never clears it after a successful upload (only on retract, `packages/client-core/src/store/ledger-edits.ts:161`), so the bubble already had a `file://` preview; there a single failed remote load set `broken` and jumped straight to the "Couldn't load" row.

### What I changed
Web
- New `apps/web/src/lib/media-retry.ts`: `useMediaRetry(chatId, url)`. A `/api/files` 404 is retried up to 4 times with backoff 1/2/4/8 s through a `&retry=N` cache-busting counter; all state is keyed on `url`, so a URL change resets the attempts; the first `blob:`/`data:` URL is captured and kept until the remote image loads; exposes `unavailable` and `retry()`.
- `apps/web/src/components/ImageMessage.tsx`: uses the hook, draws the captured preview over the remote `<img>` until it loads, and "Image unavailable" now carries a Retry button.
- `apps/web/src/components/message/AlbumGrid.tsx`: the same hook in `AlbumTile` (it had its own `<img onError>`); an exhausted tile shows "Image unavailable" with a Retry.

Mobile
- New `apps/mobile/src/lib/media-retry.ts`: `useMediaRetry(url, localUri)` + `withMediaRetry`, the native twin (same backoff, keeps the `file://` preview until `onLoad`, `restart()` for the Retry).
- `apps/mobile/src/components/chat/media-bubble.tsx` (`MediaImage`) and `apps/mobile/src/components/chat/album-grid.tsx` (`AlbumTile`): fetch the remote in the background while the local preview stays on top, retry with backoff, and keep the existing "Couldn't load" row for the no-preview case.
- I did not touch `apps/mobile/src/components/chat/attachment-body.tsx`: a photo attachment is media-first (`isMediaFirstMessage`, `media-bubble.tsx:32`), so it renders through `MediaBubble`/`MediaImage`, which is what I fixed.

Server
- `apps/server/src/files/api.ts`: added an optional, ignored `retry` field to `FilesQuery`. The client's cache-busting counter is an extra query key and the decode is strict (`onExcessProperty: 'error'`, `api.ts:64`), so without this the retried `<img>` would get `400`, not a fresh `200`. This is the one deliberate deviation: I did **not** attempt a server-side race fix; I only let the client's retry counter through. Every other unexpected key still answers `400`.
- `apps/server/src/files/routes.test.ts`: one test — `&retry=3` is served, an unknown key still gets `400 invalid_request`.

### Commands and real results
- `pnpm install`: done (warnings only, one unmet peer for @types/react).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files/routes.test.ts`: 18 passed.
- `pnpm gate` (final run), summary:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `PASS tests @zilar/mobile`, `PASS tests @zilar/server`, `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Deviations / notes
- The `retry` query field on the server (explained above); everything else is client-side.
- `AttachmentImage` in `apps/mobile/src/components/chat/attachment-message.tsx` has the same sticky-`broken` pattern, but that file is not in the Allowed files, and it is only reached for non-media-first image bodies, which an image attachment never is (media-first wins). Left as-is and reported here.
- No UI tests (per spec); the server query test is the only new test. The web package was skipped by the gate (no nearby test files).

### Open questions
- None blocking. If the lead prefers the server untouched, the alternative to the accepted `retry` field is a client-side cache-bust by remounting the `<img>` with a changing `key` instead of a query counter; I followed the spec's "cache-busting retry counter" and made the server tolerate it.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit, 2 follow-ups); the packet is current for `4e3ff90b`.**
- **Cause, from the worker:** indexer lag. `GET /api/files` finds the URL via `media_items`, and the on-demand `indexChat` reads the XMPP archive, which doesn't have the outgoing stanza yet right after the PUT, so it returns 404. Web and mobile each made one failure permanent.
- **Fix:**
  - client-side keep-preview, plus a 1/2/4/8 s retry with a `retry=N` cache-buster on web and mobile;
  - server: `FilesQuery` accepts the ignored `retry` key (the strict decode would otherwise 400).
- **Lead's checks:** server `routes.test.ts`: 18 pass; web and mobile tsc: 0 errors. The live web check follows the deploy.
