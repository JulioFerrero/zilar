---
id: T-0154
title: Mobile voice messages (record, send, play)
status: planned
milestone: M5
branch: task/T-0154-mobile-voice-messages
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0154: Mobile voice messages (record, send, play)

## Spec (written by Claude, do not edit)

### Why
Web records and plays voice messages (`apps/web/src/components/Composer.tsx` mic button, server `POST /api/voice` converts a browser recording to AAC/M4A and returns the duration; the client uploads through XEP-0363 and sends an attachment). On mobile the mic button in `apps/mobile/src/components/chat/composer.tsx` is a stub ("the mic button stays a stub"). T-0150 gave mobile the upload and attachment machinery, so voice is now a small step. Julio's 200-person plan includes voice notes.

### What to build
1. Recording: press-and-hold or tap-to-record on the mic button (match web's gesture and states: recording indicator with a timer, cancel, send). Use `expo-audio` (add it; SDK 57 version `~57.x`, plus the microphone permission string in `app.json`; ask for the permission on first use, with a plain explanation on denial, never a crash). Cap at 5 minutes and refuse under one second (same limits as `VOICE_MAX_*` in `apps/server/src/voice/routes.ts`).
2. Send: the recorded file goes through the same path web uses (check `apps/web/src/lib` for the voice send helper): `POST /api/voice` for the conversion when the recording is not already AAC/M4A (on iOS `expo-audio` can record m4a directly: skip the conversion call when the file already is m4a/aac and its duration is known), then the T-0150 upload path (`sendAttachment` with a `kind: 'file'`, audio mime and the duration in the payload exactly as web builds it), progress, Retry and Cancel like any attachment.
3. Playback: a voice bubble (play/pause, a progress bar, elapsed/total time, playback speed toggle 1x/1.5x/2x is optional). Only one voice plays at a time; leaving the chat stops playback. Same trust rules as attachments (untrusted host: a file row, no auto-load; bearer only to the API origin, never to the upload host).
4. Mock mode: a demo voice message in the mock store so the UI can be seen without a server (`EXPO_PUBLIC_ZILAR_MOCK`).
5. Tests: the voice send helper (conversion skipped for m4a, duration limits, error mapping), the bubble (renders duration and play state), the permission-denied copy, the one-player-at-a-time rule. Native modules are mocked; no real microphone in tests.
6. Out of scope: server changes, web, transcription, waveform rendering (a plain progress bar is fine), push.

### Read first
`AGENTS.md`, `work/T-0150-mobile-attachments.md` (Review), `apps/server/src/voice/routes.ts`, the web voice code (`apps/web/src/components/Composer.tsx`, `apps/web/src/lib`), `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/lib/attachments.ts`.

### Allowed files
`apps/mobile/**` (new native dependency `expo-audio` allowed, plus `pnpm-lock.yaml` and the `app.json` plugin/permission), `work/T-0154-mobile-voice-messages.md`. Not allowed: server, web, packages.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 voice attachment composer hooks-guard
```

### Acceptance
- Tap/hold the mic, record, send, and the voice bubble appears with the right duration; the peer (web) can play it, and a web voice message plays on mobile.
- Permission denied, offline and over-limit cases show a plain message.
- One player at a time; Retry and Cancel work on a failed voice upload.
- Needs a native rebuild and a device check (describe it in the Report; the lead will do the device look).

## Report (written by the worker when done)

## Review (written by Claude)
