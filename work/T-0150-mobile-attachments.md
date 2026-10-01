---
id: T-0150
title: Mobile: attachments (pick, upload, see images, files and video)
status: todo
milestone: M5
branch: task/T-0150-mobile-attachments
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0143]
estimate: 2 days
---

# T-0150: Mobile: attachments

## Spec (written by Claude, do not edit)

### Why
Found while starting T-0148 (mobile GIFs): the mobile app has NO attachment support at all. The paperclip button is a stub; there is no picker, no upload (XEP-0363), no attachment rendering (an attachment sent from the web arrives as a caption-only bubble) and no video playback. Photos and files are core to a Telegram-like chat, and GIFs, voice notes and more build on this. Mobile is the smaller share of the work, but this is the missing base: build it small and clean, following how web does it. Read `AGENTS.md` first, including the security checklist.

### Dependencies (allowed for this task, and only these)
`expo-image-picker`, `expo-document-picker`, `expo-image` (animated GIF/WebP and fast images), `expo-video`, `expo-file-system`, installed with versions matching Expo SDK 57 (`~57.x`), the permission strings in `apps/mobile/app.json` (config plugins), and the lockfile. A native build is needed afterwards; say so in the Report. If another package is needed, stop and ask in the Report.

### What to build
1. Picker: the paperclip opens a bottom sheet: Photo or video from the library, Take a photo (only if cheap with `expo-image-picker`), File. Permission denied shows a plain explanation, never a crash. A size cap equal to the server's upload limit (ejabberd `mod_http_upload` `max_size`, 50 MiB; read it from the slot response when available) is checked before uploading, with a clear message.
2. Upload and send: request an upload slot (XEP-0363) on the chat's XMPP session, PUT the bytes to the slot URL with the slot's required headers (check the web implementation `sendAttachment` in `apps/web/src/store/realStore.ts` and `apps/web/src/lib/attachments.ts`, and the helpers in `packages/xmpp-core`; if xmpp-core lacks the slot helper, say so in the Report and stop: do not change packages), then send the message with the attachment payload exactly as web does (same wire shape, same caption rules). Optimistic bubble with progress, failed state with Retry, cancel while uploading. File names are sanitized; the MIME type is taken from the picked asset and validated against an allowlist the way web does.
3. Rendering: images (tap opens a full-screen viewer with pinch zoom and close), animated GIF/WebP, video (inline with controls via `expo-video`, tap opens full screen), generic files (icon, name, size, tap to open with the system share/open sheet). Apply the SAME trust rules as web: media auto-loads only from trusted hosts (the XMPP service host, the XMPP domain and `upload.<domain>`; read web `sanitizeIncomingAttachment` and `mediaTrustedHosts`); an attachment from any other host is NEVER fetched automatically: show a plain file row with the name and a "Not loaded: untrusted address" line. No user-supplied URL is ever opened without a tap. Auth headers only to the API origin.
4. Pins, replies and the message menu keep working with attachment messages (copy text is the caption; no edit of the attachment itself; delete works).
5. Mock mode: a couple of demo attachments (generated images) so the flow works without a server.
6. Out of scope: server, web, packages, voice messages (the mic button stays a stub), GIF search (T-0148), stickers.

### Read first
`AGENTS.md`, the web `Composer.tsx` attachment flow, `apps/web/src/lib/attachments.ts`, `realStore.ts` (`sendAttachment`, `sanitizeIncomingAttachment`, `mediaTrustedHosts`), `packages/xmpp-core/src/stanza.ts` and `types.ts` (attachment/slot shapes), `apps/mobile/src/components/chat/composer.tsx`, `message-bubble.tsx`, `message-list.tsx`, `apps/mobile/src/store/real-store.ts` (`toUiMessage`, `sendSticker` as the model for an optimistic send with retry), `work/T-0143-mobile-stickers.md`.

### Allowed files
`apps/mobile/**` (including `app.json`, `package.json`), `pnpm-lock.yaml`, `work/T-0150-mobile-attachments.md`. Not allowed: server, web, packages (stop and report if a shared type must change), any other dependency.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours, plus src/lib/hooks-guard.test.ts when you touch a screen>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what needs a native rebuild and a device look.

## Report (written by the worker)

## Review (written by Claude)
