---
id: T-0464
title: "Backgrounds E2 (web): upload, pick, dim and delete your own background images in the Chat background dialog"
status: todo
milestone: M5
branch: task/T-0464-web-background-images
model: auto
effort: low
depends_on: [T-0460, T-0462]
estimate: 0.6 day
---

# T-0464: web background images

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, decision 2 (images after presets). T-0460 serves image upload, list, read and delete. T-0462 built the dialog with presets. This task adds your own images to that dialog, with a dim slider. **Icons only, no emoji.**

### Verified facts (do not re-derive)
- **Server (T-0460):**
  - `POST /api/backgrounds` takes a raw body (still PNG or WebP, at most 1 MiB, 64-2048 px per side, at most 20 per user) and returns 201 `{ id, url, width, height }`;
  - `GET /api/backgrounds` returns `{ backgrounds: [{ id, url, width, height, createdAt }] }`, newest first;
  - `GET /api/backgrounds/:id` serves the bytes;
  - `DELETE /api/backgrounds/:id` returns 204.
  
  Errors: 413 is too large, 400 is a bad image, 409 means 20 images already.
- **Prefs:**
  - `PUT /api/chat-prefs/:chatJid` and `PUT /api/chat-background` accept `backgroundImageId` and `backgroundDim` (0-80; a dim needs an image; a preset and an image together give 400);
  - a deleted image is cleared from prefs by the server.
- **Web API (`apps/web/src/lib/api.ts`):**
  - `uploadAvatarBytes(path, blob)` (lines 2449-2481) does a raw-body fetch with a mock branch and `toApiError`, then a zod parse. **Copy that shape with POST** for the new upload;
  - `request(path, schema, init)` is at line 191;
  - T-0462 added `putChatBackgroundDefault`.
- **Image encoding pattern:** `apps/web/src/components/AvatarUploader.tsx` accepts `image/png,image/jpeg,image/webp,image/gif` (line 293), draws to a canvas and calls `canvas.toBlob(..., 'image/webp', 0.92)` (lines 58-70). It injects `imageLoader` and `exporter` so tests never touch a canvas (lines 105-127).
- **Dialog (`apps/web/src/components/ChatBackgroundDialog.tsx`, T-0462):**
  - `scope` (`'chat' | 'all'`);
  - `choose(presetId)` calls `store.setChatBackground` or `store.setDefaultBackground` (lines 50-60);
  - a 4-column swatch grid (line 86) and "Use default" (line 117);
  - `close()` resets the state.
- **Store:** `realStore.ts` `updatePref` carries the three background fields (T-0462). `setChatBackground(chatId, presetId)` and `setDefaultBackground(presetId)` send `{ backgroundPreset, backgroundImageId: null, backgroundDim: null }`. Painting is in `apps/web/src/lib/chatBackground.ts`, where images default to dim 40.

### What to build
1. **`lib/api.ts`:**
   - `uploadBackground(blob): Promise<{ id, url, width, height }>`, the POST twin of `uploadAvatarBytes`;
   - `listBackgrounds()`;
   - `deleteBackground(id)`.
2. **`mock/api.ts`:** in-memory `POST`, `GET` (list) and `DELETE /backgrounds`, with ids from a counter. The URL is `/api/backgrounds/<id>`.
3. **New `lib/background-image.ts`:**
   - `fitWithin(width, height, max = 2048)` returns integer `{ width, height }`, scaled down to fit, never up;
   - `prepareBackgroundImage(file, deps = { load, encode })`:
     - load the image;
     - throw `'too_small'` if a side is under 64;
     - otherwise draw it at `fitWithin` size and encode WebP at quality 0.85, then 0.7, then 0.5, until the result is at most 1 MiB;
     - if it is still too large, throw `'too_large'`.
     
     The defaults use `Image` and a canvas, and tests inject fakes.
4. **Store** (in `store.ts`, `realStore.ts` and the mock store):
   - `setChatBackgroundImage(chatId, imageId, dim)` calls `updatePref` with `{ backgroundPreset: null, backgroundImageId: imageId, backgroundDim: dim }`;
   - `setDefaultBackgroundImage(imageId, dim)` does the same through `putChatBackgroundDefault`, optimistic with rollback.
5. **Dialog:** below the swatches, add a "Your images" section:
   - **Thumbnails:** a row of thumbnail buttons (`<img src={url}>`, `aria-label="Background image N"`, `aria-pressed` when it is the selected image for the current scope). Each has a small `IconButton` with a lucide `Trash2` icon, `aria-label="Delete background image N"`, which deletes it. Delete asks first with an inline "Delete this image?" confirm row, not `window.confirm`.
   - **Upload:** an "Upload image" button with a lucide `ImagePlus` icon opens a hidden file input (`accept="image/png,image/jpeg,image/webp"`). On a pick:
     1. call `prepareBackgroundImage`, then `uploadBackground`;
     2. add the image to the list;
     3. select it for the current scope with dim 40.
     
     Show "Uploading…" while busy.
   - **Error messages:** "This image is too large", "This image is too small", "You already have 20 images, delete one first", and otherwise "Couldn't upload the image", all with `role="alert"`.
   - **Dim slider:** when the selected look for the scope is an image, show `<input type="range" min=0 max=80 step=5 aria-label="Dim">`, defaulting to the stored dim or 40. It saves 400 ms after the last change, through the same image setter.
   - **Loading:** `listBackgrounds` loads when the dialog opens. A failure shows the section with only the Upload button.
   - **Picking a preset** clears the image, which the existing setters already do.
6. **Tests:**
   - **New `lib/background-image.test.ts`:**
     - `fitWithin` with 4000x3000 gives 2048x1536, and 800x600 is unchanged;
     - `prepareBackgroundImage` with fakes: it steps down the quality until the result is at most 1 MiB, throws `too_large` and `too_small`.
   - **`components/ChatBackgroundDialog.test.tsx`:**
     - the list renders thumbnails;
     - an upload (stub `prepareBackgroundImage` and `uploadBackground`) selects the new image with dim 40 for "This chat";
     - a 409 shows the 20-images message;
     - the slider change saves after the debounce (fake timers) with the new dim;
     - delete with confirm calls `deleteBackground` and removes the thumbnail;
     - in "All chats", picking an image calls `setDefaultBackgroundImage`.
   - **`store/realStore.test.tsx`:** `setChatBackgroundImage` sends the three fields, and `setDefaultBackgroundImage` rolls back on failure.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §4 and §8, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/components/AvatarUploader.tsx:1-130` and `:180-200`, `apps/web/src/lib/api.ts:185-200` and `:2440-2490`, `apps/web/src/store/realStore.ts` (search `setChatBackground`, `setDefaultBackground`, `updatePref`), `apps/web/src/store/store.ts` (the same names), `apps/web/src/lib/chatBackground.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/lib/background-image.ts`, `apps/web/src/lib/background-image.test.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `work/T-0464-web-background-images.md`.

Touch the four `realStore.*`/`reload` test fakes only if a new `ApiClient` method needs a stub there. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot background-image ChatBackgroundDialog realStore
pnpm gate
```

### Acceptance
- In the Chat background dialog, the user uploads an image (resized to at most 2048 px, WebP, at most 1 MiB), picks it for this chat or all chats, dims it from 0 to 80%, and deletes it with a confirm.
- Server errors show plain messages.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
