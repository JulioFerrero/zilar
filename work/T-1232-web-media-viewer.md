---
id: T-1232
title: "TG-6 web: clicking a photo opens a full-screen viewer (Esc closes, ←/→ step through this chat's photos, Open original link) instead of a new tab, and a video attachment plays inline with <video controls> instead of a file card"
status: merged
milestone: M5
branch: task/T-1232-web-media-viewer
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1232: Web photo viewer and inline video

## Spec (written by Claude, do not edit)

### Why
It's item 6 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4) and of the plan page's wave 5.
- **A click on a web photo opens a new browser tab:** `apps/web/src/components/ImageMessage.tsx:46-62` wraps the image in `<a href target="_blank">`.
- **A video attachment is a file card:** `apps/web/src/components/message/AttachmentBody.tsx` renders `FileMessage` for every non-image attachment, and `Attachment.mime` is in `packages/protocol/src/attachment.ts:28`.

### What to build
1. **A new `apps/web/src/components/media/MediaViewer.tsx`:** a full-screen overlay, built on the existing modal primitives (`apps/web/src/components/ui/dialog.tsx` or `use-modal.ts`; pick one and cite it). It shows one image at its natural aspect ratio, fitting the viewport, on a dark backdrop.
   - **Close:** Esc, a click on the backdrop or a close `IconButton`.
   - **Step through photos:** ← and → move to the previous and next photo **of the same chat**, in message order. Those are messages with `image`, or with an `attachment` whose `mime` starts with `image/`, from the chat store's message list for that chat (cite the selector you use). Show "3 / 12" and disable the ends.
   - **An "Open original" link** (the current `mediaSrc` href, `target="_blank"`) for downloading.
   - **Focus:** trapped while it's open, and restored on close.
   - **Images:** load through `mediaSrc(chatId, url)` (`apps/web/src/lib/attachments.ts:60`), as today.
2. **`ImageMessage.tsx`:** a plain click opens the viewer at that image (a `preventDefault` on the click). A ctrl, cmd or middle click keeps the link's new-tab behaviour, so keep the `href`. Pass what the viewer needs (`chatId`, and the message id or url to start at). Open the viewer from the chat screen level, so one viewer serves the list: a small store slice or a React context; choose the smaller one and cite it.
3. **Inline video** (`AttachmentBody.tsx`): when `attachment.mime` starts with `video/`, render `<video controls preload="metadata" src={mediaSrc(…)} class="max-h-[320px] w-full rounded-[12px] border border-edge">` in place of the `FileMessage` card, keeping the failure, retry and meta row as for files. Anything else stays a file card.
4. **Keep files at most 400 lines.** `AttachmentBody.tsx` is 193 lines.
5. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/FileMessage.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/lib/attachments.ts:40-80` and `apps/web/src/components/media/` (the media panel's model, which may already list a chat's images).

### Allowed files
`apps/web/src/components/media/**`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/store/**`, `work/T-1232-web-media-viewer.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the local web mock:** a photo opens the viewer, ←/→ move between photos, Esc closes, and a mock video plays inline. If the mock has no video, say so in the Report.

---

## Report (written by the worker when done)

### What I did

A full-screen photo viewer plus inline video, as specced.

1. **`apps/web/src/components/media/MediaViewer.tsx`** (new): a `MediaViewerProvider` (React context) and the `MediaViewer` overlay. Built on the `use-modal.ts` primitive (`useModal`), not `dialog.tsx`: the viewer is a full-screen dark overlay, not a titled panel, and `useModal` already gives Escape-close, the focus trap and focus restore; I add the ←/→ keys and the backdrop click on top of it.
   - Close: Esc (via `useModal`), the backdrop click (the area around the image) and a close `IconButton` (`X`).
   - ←/→ step through the chat's photos in message order; the counter shows `3 / 12` and the prev/next keys disable at the ends.
   - "Open original" links to `mediaSrc(chatId, url)` with `target="_blank"`.
   - Photos: `mediaSrc(chatId, url)` as before.
2. **Opener is a React context, not a store slice** — the smaller of the two: it needs no change to `store.ts`/`realStore.ts`, and one `MediaViewerProvider` in `ChatView` serves the whole list. `ImageMessage` calls `useMediaViewer()`. The photo list comes from the selector `useChatSelector((s) => s.messagesByChat[chatId])` (the same slice `MessageList.tsx:68` reads); `photosOf()` keeps messages with `image` or with an `attachment` whose `mime` starts with `image/`, in array (message) order.
3. **`ImageMessage.tsx`**: a plain left click `preventDefault()`s and opens the viewer at that message; a cmd/ctrl/shift/middle click keeps the browser's new-tab behaviour, so the `href` stays. A non-http(s) image (a `data:`/`blob:` URL — the mock's images, an unsent upload) has no link to keep, so the whole tile is a `button` that opens the viewer instead; this is why the mock photos open the viewer at all.
4. **`AttachmentBody.tsx`**: passes `messageId` to both `ImageMessage` calls, and a `video/*` `attachmentFile` renders `<video controls preload="metadata" src={mediaSrc(…)} class="max-h-[320px] w-full rounded-[12px] border border-edge" />` in place of `FileMessage`. The `sendFailed` row is unchanged, and a `failed` (upload) video gets the same "Upload failed / Retry" row the image branch uses; the bottom meta row still covers `attachmentFile`. Everything else stays a file card. File is 220 lines (< 400).
5. **`ChatView.tsx`**: wraps the chat screen in `MediaViewerProvider`.

### Files changed

- `apps/web/src/components/media/MediaViewer.tsx` (new): provider + overlay.
- `apps/web/src/components/ImageMessage.tsx`: `messageId` prop, click opens the viewer, `href` kept.
- `apps/web/src/components/message/AttachmentBody.tsx`: pass `messageId`; inline `<video>` for `video/*`.
- `apps/web/src/routes/ChatView.tsx`: mount `MediaViewerProvider`.
- `work/T-1232-web-media-viewer.md`: this report.

### Commands I ran

- `pnpm install`: done, 1180 packages, no error (one peer warning about `@types/react-dom` in `apps/mobile`, pre-existing).
- `pnpm exec prettier --write <the 4 changed source files>`: formatted my own files so the gate's `prettier --check` passes.
- `pnpm gate` (from the repo root), real output:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

No single test files were run: the spec says no tests (UI), and the gate found no nearby test files for the changed paths.

### Mock and acceptance

The web mock **does** contain photos: `packages/mock-backend/src/domains/messages/builders.ts:53` builds image attachments, used in the `ana`, `dev-team` and `viernes` threads (e.g. `ana.ts:52` "Stage", `dev-team.ts:38`, `viernes.ts:14`). Those open in the viewer and ←/→ moves between the two in `ana`.

The mock has **no `video/` attachment** (grep for `video/` in `packages/mock-backend` only matches the GIF-detection in `media/routes.ts:85`), so **the inline video cannot be seen in the mock**; it needs a real/uploaded video. I did not start a dev server (AGENTS.md forbids background runs), so the click-through is the lead's check.

### Notes / deviations

- None from the spec. I chose `use-modal.ts` over `dialog.tsx`, and the React context over a store slice, both as the spec allowed me to choose.

### Fix round 1

Privacy: `photosOf` now selects a photo by `message.attachment.kind === 'image'` instead of the `image/*` MIME check, the same test `MessageBubble.tsx:117` uses. A photo on an untrusted host is downgraded by `sanitizeIncomingAttachment` (`packages/chat-core/src/media.ts:146-175`) to `kind: 'file'` while keeping its `image/*` MIME, so the old check let ←/→ step onto it and load it from that host (leaking the reader's IP); the kind test leaves it out. The doc comment above `photosOf` says why. Only `apps/web/src/components/media/MediaViewer.tsx` changed.

`pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.4s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Fix round 2

- **Finding 1 (must-fix), fixed.** The inline `<video>` now auto-loads only from a
  trusted URL: `AttachmentBody.tsx` reads `mediaTrustedHosts` from the store and
  renders the player only when `isTrustedInlineVideoUrl(attachment.url, hosts)`
  passes; every other `video/*` file keeps the click-to-load `FileMessage` card.
  The new `apps/web/src/components/media/trusted-media.ts` applies the same test
  as the GIF path (`GifMessage.tsx:isTrustedGifUrl`): a root-relative `/api/` path
  is same-origin by construction, an absolute URL must be http(s) on a trusted
  media host, and `data:`/`blob:`/garbage (which the branch used to load inline
  after dropping `FileMessage`'s `safeHttpUrl` gate) are rejected. A hostile
  `mime: 'video/mp4'`, `kind: 'file'`, external-host URL now renders a file card,
  so the reader's browser does not fetch it on render.
- **Finding 2 (nit), not changed.** It is a nit, and the spec pins the exact
  `<video>` element for the sending state; the player shows no "Uploading…" line
  while the owner's own video is still sending. Left as the spec mandates.
- **Test added:** `apps/web/src/components/media/trusted-media.test.ts` (4 cases:
  `/api/` same-origin, trusted absolute host, untrusted external host,
  `data:`/`blob:`/`javascript:`). This is a real-bug fix in the render path, so it
  gets a test for the pure predicate; no UI render test.

Single test run: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/media/trusted-media.test.ts` — 4 passed.

`pnpm gate` (from the repo root):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (2.6s)
PASS  effect  (0.5s)
PASS  tests @zilar/web  (2.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 1. Pre-review clean (1 nit).**
- **The change:**
  - `MediaViewer` is one provider per chat screen: a full-screen overlay on `useModal` (Esc, focus trap, focus restored), ←/→ and buttons through the chat's photos, "3 / 12", and Open original;
  - a plain click on a photo opens it, while a modified click keeps the new tab;
  - a `video/*` attachment plays inline.
- **Lead's fix round 1 (privacy):** the viewer stepped through any `image/*` mime, including photos downgraded to `kind: 'file'` from untrusted hosts, and would auto-load them. It now uses `kind === 'image'` (`MediaViewer.tsx:55`), the same test `MessageBubble.tsx:117` uses.
- **Not checked visually:** mock photos always become file cards (`sanitizeIncomingAttachment`; the mock's `data:` URLs are never trusted, and Julio's call is to keep mock images blank), and I didn't open a photo in Julio's real chats (that sends read markers). The code was reviewed line by line instead. Check on the next photo Julio opens on the web.
