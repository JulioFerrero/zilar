---
id: T-0154
title: Mobile voice messages (record, send, play)
status: review
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

### What I did
- Recording: `VoiceRecorderButton` (`components/chat/voice-recorder.tsx`) replaces the mic stub in `composer.tsx`. Tap-to-record with a timer row (red dot, elapsed time), trash to cancel, Send to send. Permission is asked on first use via `AudioModule.requestRecordingPermissionsAsync()`; denial shows "Zilar needs access to your microphone… allow it in Settings", never a crash. Under 1 s is refused ("too short"), the 5-min cap (`VOICE_MAX_DURATION_MS`) stops the recording automatically. Unmount (leaving the chat) cancels and releases the mic. Real recording via `expo-audio@~57.0.5` (`AudioRecorder` + `RecordingPresets.HIGH_QUALITY` m4a) behind the `VoiceRecorderPort` seam (`lib/voice-native.ts`); `app.json` gains the `expo-audio` plugin with the microphone permission string.
- Send: `lib/voice.ts` (mobile twin of web `lib/voice.ts`) — `createVoicePort` skips `POST /api/voice` for m4a/aac (extension or mime) using the recorder duration, else converts with the bearer and trusts the `x-zilar-duration-ms` header; `uploadVoice` requests the XEP-0363 slot (`voice.m4a`, `audio/mp4`) and PUTs through the T-0150 uploader seam. Real store gains `sendVoice`/`retryVoice`/`cancelVoice` + `runVoiceSend` (convert → upload → `voice` payload, optimistic bubble with local-URI playback, Retry/Cancel, echo merge by caption signature, bytes kept until send succeeds). Over-limit/empty refused with plain copy; `cancelled` passes through like attachments.
- Playback: `VoiceMessage` rewritten around a screen-owned `expo-audio` player (`components/chat/voice-player.ts`, `useVoicePlayerHost` in `app/chat/[id].tsx`): play/pause, waveform progress bar, elapsed/total time, 1x/1.5x/2x speed toggle. `createVoicePlayback` registry = one voice at a time; leaving the chat stops playback. Same trust rules as attachments: untrusted host = waveform + duration, never fetched; bearer only to the API origin.
- Mock mode: the Viernes chat already had a voice message; added `mock/voice.ts` (`mockDemoVoice`, passes `VoiceMetaSchema`) and the mock store sends/retries/cancels voice without a server.
- Deps: `expo-audio@~57.0.5` only, plus lockfile + `app.json` plugin/permission (as allowed).

### Files changed
- New: `lib/voice.ts` (+ test), `lib/voice-native.ts` (+ test), `components/chat/voice-recorder.tsx` (+ test), `components/chat/voice-player.ts`, `components/chat/voice-message.test.tsx`, `components/chat/voice-recorder.test.tsx`, `mock/voice.ts` (+ test), `store/real-store.voice.test.ts`, `store/chat-store.voice.test.ts`
- Rewrote: `components/chat/voice-message.tsx` (was a fake timer; now real player host wiring + Retry/Cancel + speed)
- Edited: `composer.tsx` (mic stub → `VoiceRecorderButton` + `onSendVoice`), `channel-composer-bar.tsx` (passthrough), `message-bubble.tsx` + `message-list.tsx` (voice retry/cancel/host plumbing), `app/chat/[id].tsx` (voice actions + `useVoicePlayerHost` in all 3 branches), `store/types.ts` (`SendVoiceRecording`, `sendVoice`/`retryVoice`/`cancelVoice`), `store/real-store.ts` (pipeline, sanitize, echo), `store/chat-store.ts` (mock actions), `app.json` (mic permission), `package.json` + lockfile
- NOT changed (per Allowed files): server, web, packages.

### Commands run and real results
- `pnpm install`: ok (7.1 s); `pnpm add expo-audio@~57.0.5`: ok (pre-existing `@types/react-dom` peer warning only)
- `pnpm format:check`: pass; `pnpm lint` (oxlint): pass; `pnpm --filter @zilar/mobile typecheck`: pass
- Spec checks (`voice attachment composer hooks-guard`, `--maxWorkers=2`): 17 files, 111 passed
- Neighbours (`src/components/chat src/store src/lib src/mock`): 100 files, 837 passed, 1 skipped, 1 failed — `message-bubble-stickers.test.tsx` "keeps Edit and Copy text" fails on the clean tree too (verified via `git stash`): it uses a fixed Oct 1 date against the 48 h edit window and today is Oct 3. Pre-existing, unrelated to this task.

### Problems, deviations from the spec
- Deviation: live position/progress bar does not tick yet — the bar is idle and the label shows the total until playback starts. `useAudioPlayerStatus` polls inside a component, but the host lives outside any bubble's lifecycle (deliberate: one shared player), so wiring the 120 ms ticks into each bubble needs a small subscription addition. Play/pause/speed/one-at-a-time all work; the bar animates only after that follow-up.
- Deviation: no real waveform extraction on device (web uses `AudioContext.decodeAudioData`; there is no equivalent here without a new dep) — sends use a flat placeholder waveform. Audible playback is unaffected.
- Deviation: press-and-hold/slide-to-cancel gesture not implemented — tap-to-record (web's click mode) only. The timer row, cancel, send, caps and denial copy match web.
- Deviation: local playback before upload completes relies on the recorder file URI, which Tron-style sandboxing may revoke on some Android builds — needs the device check.
- No `any`, no `@ts-ignore`, no lint disables; prettier clean.
- Needs a native rebuild (new native module + app.json plugin) and a device look: mic permission grant/deny, 5 s record → send → bubble with duration, play on mobile + on web, web voice plays on mobile, too-short/too-long/offline copy, one-at-a-time, Retry/Cancel, leaving mid-play, mock flow, transcript toggle, speed toggle.

### Blocked / needs a decision
- None.

### Security checklist (AGENTS.md)
- No secrets/tokens in logs/errors: bearer only in the `/api/voice` POST and the player source to the API origin; never logged. Hostile URLs get no headers.
- Deletes scoped: retraction strips `voice` + local fields on the same message only (existing `withEdits` path, already voice-aware).
- Caps enforced before any request (empty/oversized refused; 1 s floor; 5 min cap); no check-then-insert anywhere new.
- Nothing takes effect before permission checks: convert/upload need the XMPP session + voice port; playback needs a tap and a trusted http(s) URL; untrusted bytes never auto-fetch.
- Unknown vs. hidden: untrusted voices render the same metadata-only bubble regardless of host (no host oracle).
- No new routes (only existing `POST /api/voice` + XEP-0363 slot + PUT); no audit/message-text capture.

## Review (written by Claude)
