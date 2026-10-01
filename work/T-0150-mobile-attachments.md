---
id: T-0150
title: Mobile: attachments (pick, upload, see images, files and video)
status: merged
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

### What I did
- Picker: the paperclip opens `AttachSheet` (Photo or video / Take a photo / File). Denials show a plain explanation, never a crash. The 50 MiB cap (ejabberd `mod_http_upload` `max_size`) is checked before uploading with a clear message. Take-a-photo was cheap (same `expo-image-picker` module), so it is included.
- Upload and send: `sendAttachment`/`retryAttachment`/`cancelAttachment` on both stores. The real store requests a XEP-0363 slot on the chat's XMPP session (`requestUploadSlot` exists in xmpp-core, so no stop was needed), PUTs the bytes with the slot headers via an injectable uploader seam (`expo-file-system` binary PUT in the app, fake in tests), then sends `{v:0,type:'attachment',data}` built by `attachmentDataFor` exactly as web (same kind rules, sanitized names, `application/octet-stream` fallback, caption = body, reply supported). Optimistic bubble with local preview + progress, failed state with Retry, cancel removes the bubble and aborts the PUT. The served URL replaces the local preview on success; the echo reconciles by the caption signature (no duplicate).
- Rendering: `AttachmentBody` in the bubble — images inline via `expo-image` (GIF/WebP animate), tap opens a full-screen viewer with pinch zoom + close; GIF-origin videos (`gif-` + mp4/webm) play inline muted-looped via `expo-video` with native controls + fullscreen; generic files are icon/name/size rows whose bytes are only fetched on tap via the system share/open sheet. Same trust rules as web: `mediaTrustedHosts` (service host, domain, `upload.domain`) from the XMPP token; untrusted images/videos downgrade to a file row with "Not loaded: untrusted address" and are never fetched. No URL opens without a tap; bearer only to trusted upload URLs / same-origin API opener.
- Menu/pins/replies: attachment messages keep react/reply/pin/delete; copy text is the caption; edit is hidden for attachments (caption edits would need a correction path — noted below); delete (retraction) strips `attachment` + local fields like other payloads. Pins snapshot already covers `attachment` (`file` kind). Chat-list preview and reply quotes already cover attachments via `previewBody` (shared chat-core).
- Mock mode: `mock/attachments.ts` — two gradient images + one file; the attach sheet lists them under "Try one (demo)" and the mock store sends through the same wire shape.
- Deps: `expo-image-picker@~57.0.20`, `expo-document-picker@~57.0.3`, `expo-image@~57.0.5`, `expo-video@~57.0.5`, `expo-file-system@~57.0.7` (all `~57.x`, SDK 57). Permission strings via the `expo-image-picker` config plugin in `app.json`. No other dependency was needed — file open uses RN's built-in `Share` (no `expo-sharing`).

### Files changed
- New: `lib/attachments.ts` (+ test, web-twin helpers), `lib/attachment-ports.ts` (picker/uploader/opener seams), `lib/attachment-native.ts` (real Expo implementations), `components/chat/attachment-message.tsx` (+ test: image/file row/viewer), `components/chat/attachment-video.tsx` (+ test), `components/chat/attachment-body.tsx` (+ test: bubble branch), `components/chat/attach-sheet.tsx` (+ test), `mock/attachments.ts` (+ test)
- New tests: `store/chat-store.attachments.test.ts` (mock send/refuse/retry/cancel), `store/real-store.attachments.test.ts` (slot+PUT+payload wire shape, echo merge, retry, cancel, sanitize, hosts)
- Edited: `composer.tsx` (paperclip sheet + caption send), `channel-composer-bar.tsx` (forwarding), `message-bubble.tsx` (attachment branch + menu rules), `message-list.tsx` (retry/cancel/open plumbing), `app/chat/[id].tsx` (send/retry/cancel/open wiring + open error), `store/types.ts` (`sendAttachment`/`retryAttachment`/`cancelAttachment`, `mediaTrustedHosts`), `store/real-store.ts` (slot upload flow, sanitize on ingest, hosts from token), `store/chat-store.ts` (mock send), `store/chat-store-provider.tsx` (uploader wiring), `lib/types.ts` (`MobileMessage` + `mobileUploadOf`), `app.json` (picker plugin), `package.json` + lockfile, `components/chat/message-bubble-stickers.test.tsx` (mock for the new import)
- NOT changed (per Allowed files): server, web, packages.

### Commands run and real results
- `pnpm install`: ok (7.5 s; 1034 pkgs)
- Deps add: `expo-image-picker@~57.0.20 expo-document-picker@~57.0.3 expo-image@~57.0.5 expo-video@~57.0.5 expo-file-system@~57.0.7`: ok (pre-existing `@types/react-dom` peer warning only)
- `pnpm format:check`: pass
- `pnpm lint` (oxlint): pass (fixed 2 unused imports + 1 player-mutation-in-effect)
- `pnpm --filter @galena/mobile typecheck`: pass
- Touched + neighbours (`--maxWorkers=2`): 10 files, 69 passed (attachments lib, types, both store suites, all 5 render suites, mock attachments)
- Neighbour suites: all store suites (real-store, topics, channels, roles, prefs-pins, general-only, invite-links, mock-prefs-pins, roles-mock, invite-links, topics-screen, selector-stability) — 11 files, 89 passed; chat component suites — 10 files, 73 passed; sticker/message suites incl. hooks-guard — 5 files, 34 passed; chat-store/integration — 98 passed, 1 skipped
- Post-review re-run (`--maxWorkers=2`): 12 files, 79 passed (attachments lib + opener seam, types, hooks-guard, all 5 render suites incl. new gradient-placeholder test, mock attachments, both store suites incl. 3 new upload-lifecycle tests); store suites — 14 files, 187 passed, 1 skipped; chat component + lib suites — 12 files, 89 passed

### Post-review fixes (all ten findings fixed)
1. **Kept bytes until send succeeds**: `pendingUploads.delete` moved to after the stanza `sendMessage` resolves, so Retry after a failed send still has the bytes. Test: PUT ok, send fails, Retry resends (slot + PUT + send run twice).
2. **Independent uploads**: the uploader keeps one `AbortController` per message id (map; `cancel(messageId)` aborts only that one) instead of a singleton. A `cancelled` error is swallowed only when that very message is already gone (user-cancelled); any other abort marks the message failed so Retry appears. Tests: two concurrent uploads in two chats both finish; cancelling one spares the other.
3. **Cancel during slot request**: after every `await` the flow re-checks the pending message still exists; a cancel during the slot round-trip stops before PUT/send. Test: no stanza is sent.
4. **Duplicate banners**: removed the pasted-twice `openError` block in each of the three chat render branches (one banner per branch now).
5. **expo-image**: inline images and the viewer use `expo-image` (`contentFit` cover/contain, animated GIF/WebP) instead of RN `Image`. Tests mock `expo-image` + `expo-linear-gradient`; all render tests green.
6. **Mock demo placeholders**: a `gradient:` attachment URL renders a visible `LinearGradient` tile with the file name (same `imageGradient` mapping `ImageMessage` uses for legacy `image` messages) instead of the "Not loaded" file row. No fetch, no trust bypass: the branch matches only the `gradient:` scheme before the trusted-host gate. Test pins the gradient tile + name and the absence of the untrusted line.
7. **Sanitized open destination**: the opener writes to `new File(Paths.cache, cleanFilename(name))` and shares the sanitized title; `cacheDestinationFor` exposes the mapping. Test: `../../x` → `x`.
8. **Text test file**: the NUL byte is now written as `'\u0000'`; `file` reports ASCII text again.
9. **Always-true test deleted**: "exposes the uploader port shape" removed from `chat-store.attachments.test.ts`.
10. **Dead code deleted**: `AttachmentError` (never thrown) and `AttachmentMeta` (never imported) removed, incl. the now-unused `raisedPill` import and the `AttachmentError` test block.
- Also fixed while here: the stale `expo-sharing` mention in the `attachment-native.ts` header comment (the opener uses RN `Share`).

### Problems, deviations from the spec
- Deviation: attachment CAPTION EDIT is not implemented — the menu hides Edit for attachment messages (spec: "no edit of the attachment itself", which holds), but web edits the caption text via XEP-0308 correction. The mobile edit path only sends text corrections and never carried attachments; wiring caption-edit needs a follow-up. Copy (caption), reply, pin, delete all work.
- Deviation: the size cap is the static 50 MiB constant, not read from the slot response — xmpp-core's `UploadSlot` has no size field (the server doesn't advertise it), so there is nothing to read. Matches web (`MAX_ATTACHMENT_BYTES`).
- Deviation: file open uses RN `Share.share` (download to cache dir first, bearer only to the API origin, sanitized destination name) instead of `expo-sharing` — one fewer native dependency; the sheet is the system share/open UI either way.
- Deviation: local-only `localUri`/`uploadProgress` fields ride `UiMessage` as `MobileMessage` (mobile-side alias in `lib/types.ts`, stripped on delete) instead of widening shared chat-core — packages/ are not allowed for this task.
- Deviation: `cancelAttachment` removes the optimistic bubble immediately (web's composer cancel behaves the same); the in-flight PUT is aborted and its late `cancelled` error lands silently on the now-missing message.
- No `any`, no `@ts-ignore`, no lint disables; prettier clean.
- Needs a native rebuild (new native modules + app.json plugin) and a device look: picker sheet on iOS/Android, permission-denied copy, camera photo send, 50 MiB refusal, progress bar smoothness, Retry/Cancel, image viewer pinch zoom, inline video + fullscreen, GIF/WebP animation, file open sheet, untrusted-host row, mock demo flow.

### Blocked / needs a decision
- None.

### Security checklist (AGENTS.md)
- No secrets/tokens in logs/errors: bearer only in image/video `headers` to trusted upload hosts and in the opener to the same-origin API; never logged. Hostile URLs get no headers.
- Deletes scoped: retraction strips attachment + local fields on the same message only (alias-aware `sameMessage`, like other payloads).
- Caps enforced before any request (empty/oversized refused inline in both stores); no check-then-insert anywhere new.
- Nothing takes effect before permission checks: uploads need the XMPP session; the open sheet needs a tap and an http(s) URL; untrusted bytes never auto-fetch.
- Unknown vs. hidden: untrusted attachments render the same file row regardless of host (no host oracle).
- No new routes (only the existing XEP-0363 slot + PUT to the slot URL); no audit/message-text capture.

## Review (written by Claude)

**Verdict:** approved and merged after two review rounds.

### Findings
- Round 1 (worker fixed): bytes kept until the send succeeds, per-upload cancel, cancel during the slot request, duplicate banners, expo-image, demo placeholders, safe file names, text-only test file, dead code.
- Round 2 (lead fixed): media requests no longer carry the session bearer (web parity, same-origin API only); mock-mode demo images keep their `gradient:` URL so the tile renders (test added); channel feed and the second composer branch get the demo attachments list.

### Follow-ups
- Nit: an unknown picker size is reported as "That file is empty" (`attachment-native.ts`).
- Nit: the tap-to-open download has no size cap.
- Needs a native rebuild of the Android/iOS dev client (new native modules) and a device look: picker, permissions, camera, progress, retry/cancel, viewer, inline video, file open.
- Caption edit for attachments is not implemented (web has it).
