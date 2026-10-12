---
id: T-1185
title: "SEC-3 step 1: mobile loads every chat file (image, GIF/video, voice, file viewer/open) through GET /api/files?chat=…&url=… with the bearer token, like web, instead of the raw ejabberd /upload/ URL — so the edge can later stop serving /upload/ GETs"
status: merged
milestone: M5
branch: task/T-1185-mobile-media-via-proxy
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1185: Mobile reads files through the proxy

## Spec (written by Claude, do not edit)

### Why
`docs/audit/security-audit.md` SEC-3 (P1): `/upload/*` goes straight to ejabberd, has no access rule and sends `Access-Control-Allow-Origin: *`, so whoever holds a URL reads the file forever.
- **The planned fix (F6):** stop proxying `GET /upload/*` at the edge and keep `GET /api/files` (`apps/server/src/files/api.ts`, T-0454) as the only reader. That route checks the session and the chat membership.
- **Web already reads through the proxy:** `mediaSrc` (`apps/web/src/lib/attachments.ts:53-76`) rewrites a same-origin `/upload/` URL to `/api/files?chat=<chatId>&url=<url>`.
- **Mobile doesn't:** no mobile code calls `/api/files`. It loads `attachment.url` directly:
  - image: `apps/mobile/src/components/chat/attachment-message.tsx:70-75`;
  - GIF and video: `apps/mobile/src/components/chat/attachment-video.tsx:56-95`, which already sends `authorization: Bearer` to API-origin URLs (`:58-61`, `:95`, `isApiOriginUrl` at `:239`);
  - the file viewer: `apps/mobile/src/components/chat/attachment-body.tsx:69,116`;
  - opening a file: `apps/mobile/src/components/chat/chat-thread.tsx:65-71`;
  - voice playback: `apps/mobile/src/components/chat/voice-player.ts` and `voice-player-host.ts`; find where the source URI is set.
- **Bearer auth works:** the server accepts bearer tokens (better-auth `bearer()` plugin, `apps/server/src/auth/auth.ts:128`).
- **Order matters:** the edge change (step 2, a later task) must wait until the APK with this change is installed. That's why this goes first.

### What to build
1. **A `mediaUrl(chatId, url)` helper** in `apps/mobile/src/lib/attachment-common.ts`, the same rule as web's `mediaSrc`. An `/upload/` URL on the API origin (`isApiOriginUrl`'s origin) becomes `${API_URL}/api/files?chat=${encodeURIComponent(chatId)}&url=${encodeURIComponent(url)}`; every other URL (`file://`, local URIs, other origins) is returned unchanged.
2. **Use it in every reader listed above,** always with the bearer header:
   - image: the source `{ uri, headers: { authorization } }`;
   - video: it already has headers; switch its URI;
   - voice: the player source with headers. If the audio library can't send headers, download to a cache file with `expo-file-system` using the header, then play the local file. Say which one you did;
   - the file viewer and open: download with the header to a cache file, then open or share it.
   - **The token never goes to a non-API origin** (keep `isApiOriginUrl`'s guard).
   - The chat id comes from the message's chat. Every reader has it, or can be given it by its parent; cite where.
3. **`attachment-message.tsx` is 381 lines** and must stay at most 400. Put new logic in `attachment-common.ts` or a new `apps/mobile/src/lib/media-source.ts`.
4. **No tests** (UI). The server route is already tested.

### Read first
`AGENTS.md`, `docs/audit/security-audit.md` (SEC-3, F6), `docs/audit/upload-auth-plan.md`, `apps/web/src/lib/attachments.ts:40-80`, `apps/server/src/files/api.ts`, and all the mobile files listed in Why.

### Allowed files
`apps/mobile/src/lib/attachment-common.ts`, `apps/mobile/src/lib/media-source.ts`, `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/attachment-video.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/voice-player.ts`, `apps/mobile/src/components/chat/voice-player-host.ts`, `work/T-1185-mobile-media-via-proxy.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator against production:**
  - an existing photo, a GIF, a voice note and a file in a chat all load;
  - the server log shows `GET /api/files` for them.

---

## Report (written by the worker when done)

### What I did

Every mobile reader of an attachment/voice `/upload/` URL now goes through
`GET /api/files?chat=…&url=…` with the session bearer, like web, instead of
loading the raw ejabberd URL:

1. **`mediaUrl(chatId, url)`** and **`isApiOriginUrl(url)`** in
   `apps/mobile/src/lib/attachment-common.ts` (the `mediaSrc` rule from
   `apps/web/src/lib/attachments.ts`, native twin). A `/upload/` URL on the API
   origin becomes `<api origin>/api/files?chat=…&url=…`; anything else is
   returned unchanged. The token guard (`isApiOriginUrl`) moved here from
   `attachment-video.tsx`.
2. **`useMediaSource(chatId, url, enabled)`** in the new
   `apps/mobile/src/lib/media-source.ts`: it calls `mediaUrl`, reads the bearer
   from `getSessionToken()` only when the result is the API origin, and returns
   `{ uri, headers } | undefined` (undefined until the async token resolves).
   Used by the image bubble, the full-screen viewer and the video bubble.
3. **Readers wired:**
   - image bubble `AttachmentImage` — `{ uri, headers }` source (new `chatId`
     prop, passed from `attachment-body.tsx` as `message.chatId`).
   - full-screen viewer `AttachmentViewer`/`ZoomableImage` — same source (new
     `chatId` prop, same parent).
   - video/GIF `AttachmentVideo` — its URI is now the proxied one; it keeps its
     existing bearer header and `isApiOriginUrl` guard (new `chatId` prop).
   - voice `voice-player-host.ts` — `useVoicePlayerHost(chatId)` (called from
     `chat-thread.tsx` with `chat.id`) pushes the chat id into the host; `play`
     rewrites the source through `mediaUrl` and adds the bearer only for the API
     origin. **expo-audio supports `headers` in its `AudioSource`**
     (`expo-audio/build/Audio.types.d.ts:31`), so I did **not** download the
     audio to a cache file.
   - open a file — `chat-thread.tsx` now calls
     `opener.open(mediaUrl(chat.id, attachment.url), attachment.name)`; the
     existing opener already downloads to a cache file with the bearer (its
     `authHeadersFor` guard) and shares it.

### Chat id plumbing (cited)

`UiMessage.chatId` (`packages/chat-core/src/types.ts:57`) is the chat JID the
server's `resolveChatFilter` expects; `attachment-body.tsx` passes it to the
three bubbles, and `chat-thread.tsx` uses its `chat.id` prop for the opener and
the voice host. No reader needed a new upstream prop.

### Files changed

- `apps/mobile/src/lib/attachment-common.ts` (+ `isApiOriginUrl`, `mediaUrl`)
- `apps/mobile/src/lib/media-source.ts` (new: `useMediaSource`, `MediaSource`)
- `apps/mobile/src/components/chat/attachment-message.tsx` (392 lines)
- `apps/mobile/src/components/chat/attachment-video.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/voice-player-host.ts`
- `work/T-1185-mobile-media-via-proxy.md` (this report)

`apps/mobile/src/lib/attachments.ts` and `voice-player.ts` (the barrel) were in
scope but needed no change.

### Commands and results

```bash
pnpm install            # done, 17.5s
pnpm gate               # GATE PASS
```

`pnpm gate` summary:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (4.2s)
PASS  effect  (1.7s)
PASS  tests @zilar/mobile  (2.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single file-level tests were run: the change is UI only and no test in
`apps/mobile` imports these modules (the spec's item 4: no new tests).

### Deviations / notes

- `mediaUrl` returns an absolute `<api origin>/api/files?…` (native has no page
  origin); web returns a relative path. Same rule, same origin check.
- The voice host keeps `isApiOriginUrl`'s guard: the bearer is only ever built
  for the API origin, never for another host.
- `attachment-message.tsx` is 392 lines (limit 400).
- The acceptance check (the lead's emulator run against production) is the
  lead's to perform; I could not run it here.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 3 nits.**
- **`mediaUrl(chatId, url)`** (`attachment-common.ts`) rewrites an API-origin `/upload/` URL to `/api/files?chat=…&url=…` and leaves others unchanged.
- **`useMediaSource`** adds the bearer header only for API-origin targets.
- **Every reader goes through the proxy:** the image bubble, GIF and video, the voice player (expo-audio `AudioSource.headers`), the file viewer, and opening a file (the existing opener downloads with the bearer).
- **Still to do:**
  - **an emulator check against production before the APK goes to Julio:** a photo, a GIF, a voice note and a file all load;
  - **SEC-3 step 2** (the edge stops `GET /upload/*`) only after Julio's phone runs this APK.
