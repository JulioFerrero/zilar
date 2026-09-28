---
id: T-0065
title: Attachments on web — send and receive images and files (XEP-0363 upload, `attachment` payload), image bubbles, file cards, paste and drag-and-drop
status: planned
milestone: M1
branch: task/T-0065-attachments-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0061]
estimate: 1.5 days
---

# T-0065: Attachments (web)

## Spec (written by Claude, do not edit)

### Goal

`docs/PROJECT_PLAN.md` §21 lists "Image and file upload" for the MVP, and the web has a dead paperclip button in the composer. Make it work in DMs and groups, using exactly the path voice messages already proved (T-0010): a slot from the XMPP upload service (XEP-0363), a PUT of the bytes, then a Galena payload message that carries the URL.

It runs after T-0061 because both tasks edit the composer, `realStore.ts` and `MessageBubble.tsx`.

### Protocol (decided; follow it)

A new payload type `attachment` in `@galena/protocol`, next to `voice`:
```ts
AttachmentSchema = z.strictObject({
  kind: z.enum(['image', 'file']),
  url: z.url().max(8192),            // the XEP-0363 download URL
  name: z.string().min(1).max(255),  // the original file name, shown on file cards
  size: z.int().min(0).max(100 * 1024 * 1024),
  mime: z.string().min(1).max(100),
  width: z.int().min(1).max(20000).optional(),   // images only
  height: z.int().min(1).max(20000).optional(),
})
```
and the payload envelope `{ v: 0, type: 'attachment', data }`. The message body carries the caption (may be empty), like any message. Receivers must only follow `http:` and `https:` URLs (validate with `URL`, as the voice and link code does). Do not add XEP-0066 in this task.

**Upload cap:** 50 MB (plan question D6, default). Enforce it in the client before asking for a slot, and show "That file is larger than 50 MB." Images are sent as they are (no re-encoding, no thumbnails).

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0010-*.md` is not in the repo; read the code instead: `apps/web/src/lib/voice.ts` (`UploadSlotRequester`, `uploadVoice`, the PUT), `apps/web/src/store/realStore.ts` (`sendVoice`, `updateMessageVoice`, `objectUrlFor`, optimistic messages, `pendingOutgoing`), `packages/xmpp-core/src/client.ts` (`requestUploadSlot`), `packages/protocol/src/voice.ts` and `payload.ts`
- `packages/chat-core/src/types.ts` (`UiMessage`, `UiImage`) and `messages.ts` (`previewBody`)
- Web: `Composer.tsx`, `MessageBubble.tsx`, `ImageMessage.tsx`, `VoiceMessage.tsx` (for the card style), `routes/ChatView.tsx`, the mock store files
- `docs/design/ui-style.md` §4 (keys, wells) and §5 (bubbles, composer)

### Allowed files
- `packages/protocol/src/attachment.ts` (new), `attachment.test.ts` (new), `payload.ts`, `payload.test.ts`, `index.ts`
- `packages/chat-core/src/types.ts`, `messages.ts`, `messages.test.ts`, `index.ts`
- `apps/web/src/lib/attachments.ts` (new), plus its test
- `apps/web/src/store/realStore.ts`, `store.ts`, the mock store files, plus tests
- `apps/web/src/components/Composer.tsx`, `MessageBubble.tsx`, `ImageMessage.tsx`, `FileMessage.tsx` (new), `AttachmentPreview.tsx` (new), their tests, and `apps/web/src/index.css`
- `apps/web/src/routes/ChatView.tsx` (wiring only)
- `apps/web/src/mock/**`
- `work/T-0065-attachments-web.md` and `work/screenshots/T-0065/**`

**Not allowed:** `packages/xmpp-core/**` (`requestUploadSlot` already exists; if it lacks something, say so in the Report), `apps/server/**`, mobile, docs. No new dependencies.

### What to build

1. **Protocol.** `AttachmentSchema` and the payload variant, with tests: valid image, valid file, an oversize `size`, a non-URL `url`, an unknown `kind`, an extra key (strict), the 64 KiB envelope cap still holding.
2. **Chat-core.** `UiMessage.attachment?: Attachment` (the schema type). `previewBody`: an image attachment shows `🖼 Photo`, a file shows `📎 <name>`; a caption is shown after it when present (`🖼 Photo, <caption>`). Tests.
3. **`lib/attachments.ts`.**
   - `MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024`.
   - `classify(file: File): 'image' | 'file'`: only `image/png`, `image/jpeg`, `image/gif`, `image/webp` are images. **SVG is a file, never an image** (it can carry script). Judge by the MIME the browser reports, and fall back to `file` when it is empty.
   - `readImageSize(file)`: width and height through an `Image` and an object URL (revoked afterwards), with a 5 s timeout; on failure the size is omitted.
   - `uploadAttachment(requester, file)`: request a slot with `{filename, size, contentType}`, PUT the bytes with the slot's headers (as `uploadVoice` does), return the `getUrl`. A failed PUT throws an `AttachmentError` with a code and a human message. Do not log URLs' query strings or file contents.
   - Filenames: strip path parts and control characters, cap at 255.
4. **Store.** `sendAttachment(chatId, file, options?: { caption?: string; replyTo? })`:
   - an optimistic outgoing message at once, with a local object URL for images (so the bubble shows the picture immediately), status `sending`, and an upload progress-free "Uploading…" state on file cards;
   - after the upload, `core.sendMessage(chat, kind, caption, { payload: {v:0,type:'attachment',data}, replyTo })`, then link ids exactly like `sendVoice` does (`linkMessageIds`, `linkLocalToServer`, status `sent`);
   - on failure, the message goes to a visible **failed** state with a Retry action on the bubble (keep the `File` in memory for the retry). Do not leave it silently "sending".
   - Incoming and history messages with an `attachment` payload map to `UiMessage.attachment`, like voice (`ui.voice = …`); an invalid payload is ignored (the message shows its body).
5. **Composer.**
   - The paperclip opens a file picker (`multiple: false` in this task).
   - **Paste** an image from the clipboard and **drag a file** onto the chat panel: both open the same preview.
   - A **preview bar** above the composer well (`AttachmentPreview`): a thumbnail for images (object URL, revoked on close) or a file icon, the name and a size like `2.4 MB`, an ✕ to cancel, and the composer text becomes the caption. Send (Enter or the send key) uploads and sends. `Esc` cancels the preview when the text field is empty.
   - Over the cap or unsupported (0 bytes): the inline red message the voice errors use, and no preview.
   - Every new control has an `aria-label` and a focus ring.
6. **Bubbles.**
   - Image: `ImageMessage` becomes safe and stable: reserve the space from `width`/`height` (aspect ratio) so the list doesn't jump, `loading="lazy"`, `alt` = the name, max height 320, click opens the image in a new tab with `rel="noopener noreferrer"` (http/https only). A broken image shows a small "Image unavailable" tile instead of the browser's broken icon.
   - File: `FileMessage`, a raised card with a file icon, the name (truncated), `size · type`, and a download link (`download` attribute, `rel="noopener noreferrer"`, http/https only). While uploading, "Uploading…". On failure, the Retry.
   - Caption text renders under it as normal message text. Existing behaviour for voice, replies, reactions, edit/delete (T-0061) must keep working; a deleted attachment message becomes the tombstone like any other message.
7. **Mock store:** two mock attachment messages (an image, a file) so the states can be screenshotted.

### Tests (Vitest, no network)
- Protocol and chat-core as above.
- `attachments.ts`: classify (SVG → file, empty MIME → file), the cap, filename cleaning, `uploadAttachment` against a fake requester and a fake `fetch` (slot request fields, PUT headers, failure).
- Store: an optimistic image message appears at once; after the fake upload it sends a payload with the right fields and links ids; an upload failure gives a failed state, and Retry works; an incoming attachment payload maps; an invalid payload is ignored; a reply carries the `replyTo`.
- Composer: the picker, paste and drop each open the preview; ✕ and `Esc` cancel; an oversize file shows the error; the caption goes with the send.
- Bubbles: image ratio reserved, broken-image fallback, a `javascript:` URL is never a link, the file card download link.
- Make fakes slow where it matters (a deferred upload), so the "sending" state is really exercised (playbook gotcha 19).

### Integration / visual check
- You may run against the live stack read-only: **never** start a second server on 3188 and never touch ports 3000, 3188, 5173, 8081. Use your own Vite port with `GALENA_API_URL=http://localhost:3188` only if the spec of your live check needs it, and **send no real messages**: use mock mode (`?mock`) for screenshots. Live upload against ejabberd is verified by the lead.
- Screenshots (max ~10, downscaled with `sips -Z 900` before viewing; a session holds at most 30 images): the preview bar with an image, with a file, the error, an image bubble, a file bubble, the failed state with Retry. Save under `work/screenshots/T-0065/`. **Stop any dev server you start.**

### Acceptance criteria
- [ ] Paperclip, paste and drag-and-drop all lead to the preview; sending shows the message at once and completes.
- [ ] SVG is never rendered as an image; only http(s) URLs are ever opened or downloaded.
- [ ] Files over 50 MB are refused before any request.
- [ ] A failed upload is visible and retryable.
- [ ] History reload shows attachments (payload survives MAM, as voice does).
- [ ] Voice, replies, reactions and T-0061's edit/delete keep working.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Multiple files at once, albums, thumbnails, image editing, upload progress bars.
- Server-side scanning, mobile, an image lightbox, video/audio file playback (they are plain files).
- Voice changes.

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
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
