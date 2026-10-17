---
id: T-1876
title: "Phone: tapping a photo in an `images` card opens the app's own photo viewer (AttachmentViewer: swipe, zoom, save, share) on that photo instead of the system share sheet"
status: merged
milestone: M5
branch: task/T-1876-phone-card-photo-viewer
model: auto
effort: default
depends_on: [T-1868]
estimate: 20 min
---

# T-1876: Card photos open in the photo viewer (phone)

## Spec (written by Claude, do not edit)

### Why
**The T-1868 review follow-up.** In an `images` card, a photo tap calls the attachment opener with the name `'image'`. That name has no extension, so Android gets `application/octet-stream` and shows the share sheet instead of the photo. A chat photo opens in the app's own viewer.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/blocks/images-block.tsx`** (173 lines, from T-1868):
  - each tile's `onPress` calls `open(url)`, which runs `opener.open(url, 'image')` and sets an error line on failure;
  - the tile source is `useMediaSource('', cardMediaUrl(id), true)`.
- **`AttachmentViewer`** (`apps/mobile/src/components/chat/image-viewer.tsx:125`, re-exported by `apps/mobile/src/components/chat/attachment-message.tsx:15`):
  - props: `{ chatId, photos: ViewerPhoto[], startIndex, trustedHosts: ReadonlySet<string>, onClose }` (`:33-42`);
  - each photo loads through `useMediaSource(chatId, url, …)` only when its host is in `trustedHosts` (`:47-56`, `:90-110`).
- **`ViewerPhoto`** is `{ messageId, url, alt }` (`packages/chat-core/src/photos.ts:4-8`). The viewer keys items by `messageId`.
- **How `attachment-body.tsx` mounts it:** `{viewer !== null && … ? <AttachmentViewer … onClose={() => setViewer(null)} /> : null}` (`apps/mobile/src/components/chat/attachment-body.tsx:169-176`).
- **`cardMediaUrl(id)`** (`apps/mobile/src/lib/attachment-common.ts`, from T-1868) builds `${API origin}/api/card-media/<id>`. `API_URL` comes from `apps/mobile/src/lib/auth.ts:22`.

### Steps
1. **In `images-block.tsx`:**
   - keep a `viewerIndex` state (`number | null`);
   - a tile tap sets it to that tile's index;
   - build `photos` with `useMemo` from `block.items`: `{ messageId: id, url: cardMediaUrl(id) ?? '', alt: 'Photo' }`, skipping ids with no URL;
   - `trustedHosts` is a `Set` holding only the API host (`parseUrl(API_URL)?.hostname`, lowercased);
   - render `<AttachmentViewer chatId="" photos={photos} startIndex={viewerIndex} trustedHosts={…} onClose={() => setViewerIndex(null)} />` while `viewerIndex !== null`. The empty chat id is fine because card media aren't `/upload/` URLs; say so in a comment.
2. **Remove the opener, its error state and the error line** from the images block (`FileBlock` keeps its own).
3. **No tests** (UI). The file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/images-block.tsx`
- `work/T-1876-phone-card-photo-viewer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Tapping a card photo** opens the full-screen viewer on that photo.
- **Swiping** steps through the card's photos.
- **Close** returns to the chat.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/blocks/images-block.tsx`: a tile tap now sets
  `viewerIndex` instead of calling the attachment opener. `photos` is built with
  `useMemo` from `block.items` (`{ messageId: id, url: cardMediaUrl(id) ?? '', alt: 'Photo' }`,
  ids without a URL skipped), `trustedHosts` holds only the lowercased
  `parseUrl(API_URL)?.hostname`, and `<AttachmentViewer chatId="" …>` renders while
  `viewerIndex !== null`. Added the requested comment explaining why the empty chat id
  is unused for card media (not `/upload/` URLs).
- Removed the opener (`createAttachmentOpener`), its `Effect`/error plumbing, the
  `OPEN_FAILED_MESSAGE` error line and the now-unused imports. `FileBlock` is untouched.
- No tests: UI-only change, as the spec says. The file is 171 lines.

### Checks run
- `pnpm install`: `Done in 16s using pnpm v10.32.1`.
- `pnpm gate` from the repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: no test covers this UI change.

### Notes for the lead
- Swipe and close come from the existing `AttachmentViewer` (same component the chat
  photo bubbles use); I did not run the app on a device, so the phone smoke is still
  yours.
- `photos` follows the spec's `flatMap` skip of ids with no URL. Since `cardMediaUrl`
  depends only on `API_URL`, either all ids resolve or none do, so the tile index and
  the `photos` index cannot diverge in practice.
- Imported `AttachmentViewer` from `@/components/chat/attachment-message`, matching
  `media-bubble.tsx`.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `5cd20bb08`.
- **The emulator check** ran on the mock build (smoke PASS): in `zilar://dev/blocks`, tapping the first photo of the four-image card opens the full-screen viewer with "1 / 4", Save, Share and Close.
- **The photo itself is blank** in mock mode, because the ids have no media.
- **Back** closes it.
