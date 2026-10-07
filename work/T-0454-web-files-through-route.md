---
id: T-0454
title: "Upload lock 2 (web): images, GIFs, files, voice notes and the media panel load this server's /upload files through /api/files"
status: todo
milestone: M5
branch: task/T-0454-web-files-through-route
model: auto
effort: low
depends_on: [T-0453]
estimate: 0.4 day
---

# T-0454: web loads uploads through the file route

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/upload-auth-plan.md`, task 3, with §7. T-0453 added `GET /api/files?chat=<jid>&url=<upload URL>`. Web is same-origin with `/api`, so the session cookie rides along.

This task makes every web load of this server's `/upload/` files go through that route. Once Caddy stops serving `/upload` GETs directly, web keeps working.

### Verified facts (do not re-derive)
- **`apps/web/src/lib/attachments.ts`:** `trustedMediaHosts` (lines 99-116) and `isTrustedMediaUrl(url, trustedHosts)` (lines 118-134) decide auto-loading from the **raw** URL's hostname. They must keep getting the raw URL.
- **Load sites**, each holding a raw upload URL:
  - `apps/web/src/components/ImageMessage.tsx`: `ImageMessage({ url, alt, width, height })` (line 18), with `src={url}` (line 32) and `href = safeHttpUrl(url)` (line 43). It is rendered from `MessageBubble.tsx:545-550` and `:563-568`.
  - `apps/web/src/components/FileMessage.tsx`: `href = safeHttpUrl(attachment.url)` (line 25), rendered from `MessageBubble.tsx:602`.
  - `apps/web/src/components/GifMessage.tsx`: `href` (line 32), `<video src={attachment.url}>` (line 35) and the trust check (line 85). It is rendered at `MessageBubble.tsx:622`.
  - `apps/web/src/components/VoiceMessage.tsx`: `VoiceMessage({ voice, own })` (line 53) with `<audio src={voice.url}>` (lines 207-210). Lines 133 and 155 send `voice.url` to the transcription API, **which must keep the raw URL**. It is rendered at `MessageBubble.tsx:656`.
  - `apps/web/src/components/ChatMediaPanel.tsx`: `MediaThumb` with `<img src={item.url}>` (line 155). `ChatMediaPanel({ chatId, onClose })` is at line 166.
- **`UiMessage.chatId`** is the chat JID (`packages/chat-core/src/types.ts:57`).
- **Production:** uploads are `https://<site>/upload/...` on the same origin as the web app. **Dev:** ejabberd hands out `http://<host>:5280/upload/...`, another origin, which the server route rejects. Those must keep loading directly.

### What to build
1. **`lib/attachments.ts`:** export `mediaSrc(chatId: string, url: string, origin: string = window.location.origin): string`. It returns `` `/api/files?chat=${encodeURIComponent(chatId)}&url=${encodeURIComponent(url)}` `` when `url` parses, its origin equals `origin`, and its path starts with `/upload/` (and is longer than `/upload/`). Any other URL (another origin, `blob:`, `data:`, or garbage) comes back unchanged.
2. **Apply it at every load site.** Add a `chatId: string` prop where one is missing, passing `message.chatId` from `MessageBubble`:
   - `ImageMessage`: `src` and the open-in-new-tab `href`;
   - `FileMessage`: `href`;
   - `GifMessage`: `src` and `href` (the trust check stays on the raw URL);
   - `VoiceMessage`: the `<audio src>` only (transcription keeps `voice.url`);
   - `ChatMediaPanel` `MediaThumb`: `src`, using the panel's `chatId`.

   The trust checks keep the raw URL everywhere.
3. **Tests:**
   - `lib/attachments.test.ts`: `mediaSrc` maps a same-origin `/upload/x/y.png` and leaves another origin, `blob:`, a bare `/upload/` and garbage unchanged. Pass `origin` explicitly.
   - Extend `ImageMessage.test.tsx`, `FileMessage.test.tsx`, `GifMessage.test.tsx`, `VoiceMessage.test.tsx` and `ChatMediaPanel.test.tsx` with one case each: a same-origin upload URL renders `/api/files?chat=…&url=…`. jsdom's origin is `window.location.origin`, so build the URL from it. Update their existing renders for the new `chatId` prop.
   - **In `VoiceMessage`,** the transcription request still sends the raw URL.

### Read first
`AGENTS.md`, `docs/audit/upload-auth-plan.md` §3(a) and §7, `apps/web/src/lib/attachments.ts:90-140`, `apps/web/src/components/ImageMessage.tsx`, `FileMessage.tsx`, `GifMessage.tsx`, `VoiceMessage.tsx:53-70`, `:125-215`, `apps/web/src/components/ChatMediaPanel.tsx:140-170`, `apps/web/src/components/MessageBubble.tsx:540-660`.

### Allowed files
`apps/web/src/lib/attachments.ts`, `apps/web/src/lib/attachments.test.ts`, `apps/web/src/components/ImageMessage.tsx`, `apps/web/src/components/ImageMessage.test.tsx`, `apps/web/src/components/FileMessage.tsx`, `apps/web/src/components/FileMessage.test.tsx`, `apps/web/src/components/GifMessage.tsx`, `apps/web/src/components/GifMessage.test.tsx`, `apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/components/VoiceMessage.test.tsx`, `apps/web/src/components/VoiceMessage.player.test.tsx`, `apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/components/ChatMediaPanel.test.tsx`, `apps/web/src/components/MessageBubble.tsx`, `work/T-0454-web-files-through-route.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot attachments ImageMessage FileMessage GifMessage VoiceMessage ChatMediaPanel MessageBubble
pnpm gate
```

### Acceptance
- Every web load of a same-origin `/upload/` file uses `/api/files?chat=&url=`.
- Trust checks and voice transcription still use the raw URL, and other URLs are untouched.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
