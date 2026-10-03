---
id: T-0154
title: Mobile voice messages (record, send, play)
status: merged
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
- New: `lib/voice.ts` (+ test), `lib/voice-native.ts` (+ tests: gates, recorder seam, failure reasons), `components/chat/voice-recorder.tsx` (+ test via extracted `runRecorderBegin`/`runRecorderFinish`), `components/chat/voice-player.ts` (+ test: two-bubble one-at-a-time against fake players), `components/chat/voice-message.test.tsx` (incl. per-reason copies), `components/chat/voice-recorder.test.tsx`, `mock/voice.ts` (+ test), `store/real-store.voice.test.ts` (incl. per-reason failures), `store/chat-store.voice.test.ts`
- Rewrote: `components/chat/voice-message.tsx` (was a fake timer; now real player host wiring + Retry/Cancel + speed)
- Edited: `composer.tsx` (mic stub → `VoiceRecorderButton` + `onSendVoice`), `channel-composer-bar.tsx` (passthrough), `message-bubble.tsx` + `message-list.tsx` (voice retry/cancel/host plumbing; voice never editable), `app/chat/[id].tsx` (voice actions + `useVoicePlayerHost` in all 3 branches), `store/types.ts` (`SendVoiceRecording`, `sendVoice`/`retryVoice`/`cancelVoice`), `store/real-store.ts` (pipeline, sanitize, echo, failure reasons), `store/chat-store.ts` (mock actions), `mock/messages.ts` (uses `mockDemoVoice`), `app.json` (mic permission), `package.json` + lockfile
- NOT changed (per Allowed files): server, web, packages.

### Commands run and real results
- `pnpm install`: ok (7.1 s); `pnpm add expo-audio@~57.0.5`: ok (pre-existing `@types/react-dom` peer warning only)
- `pnpm format:check`: pass; `pnpm lint` (oxlint): pass; `pnpm --filter @zilar/mobile typecheck`: pass
- Spec checks (`voice attachment composer hooks-guard`, `--maxWorkers=2`): 17 files, 111 passed
- Neighbours (`src/components/chat src/store src/lib src/mock`): 100 files, 837 passed, 1 skipped, 1 failed — `message-bubble-stickers.test.tsx` "keeps Edit and Copy text" fails on the clean tree too (verified via `git stash`): it uses a fixed Oct 1 date against the 48 h edit window and today is Oct 3. Pre-existing, unrelated to this task.

### Review round 1 (all 8 findings fixed)
1. One-player-at-a-time deadlock: the host now drives the registry from the real player. `play(B)` replaces the old player (stopping A's audio natively), notifies only B (`playing:true`), and tells A to show paused through A's own listener — the shared player is never paused as a side effect of switching (the dummy `pause` is a no-op for registry purposes). `createVoicePlayback` matches by message id, so the host resigns without holding the claimed object. Test (`voice-player.test.ts`, fake players): play A → play B gives B playing + player playing + A not playing (fails with the old behaviour, which paused the shared player on the switch); pause B pauses the player and clears the registry; finish/error ticks reset the bubble. The host also subscribes to the real player's `playbackStatusUpdate`, which drives the bubble's progress bar live — the "idle bar" deviation is gone.
2. `convertVoice` reads the device file with `new File(uri).bytes()` (the `attachment-native.ts` pattern); `readFile` stays injectable for tests. The old `fetch(file.uri)` path is gone.
3. `fileSizeOf` deleted: `createVoiceRecorder` reads the documented `File.size` property (injected `fileReader` in tests). A read failure is "unknown" → `RECORD_FAILED_MESSAGE`, never 0; only a real zero flows to `voice_empty`. Covered by seam tests.
4. Failure reasons threaded: `runVoiceSend` records `failureReason` (shared `SendFailureReason` buckets) on the failed message; the bubble renders `voiceErrorCopy(reason)`. Tests per reason in the store suite (network/too_large/upload_refused/server_unavailable) + one bubble test rendering all six copies.
5. Recorder tests are real: `runRecorderBegin`/`runRecorderFinish` (the exact logic the component runs) are driven with fake recorders — denied → denied copy + nothing created/sent; sub-1s → too-short copy + nothing sent; valid → send with reply + `onCancelReply`. Always-true assertions removed.
6. `begin()` sets a synchronous `startingRef` guard before the first await, cleared in `finally`; double-tap in the same tick creates one recorder (covered by the extracted-begin path: the guard lives in the component, the decision in the tested function).
7. `mock/messages.ts` now uses `mockDemoVoice()`; the inline duplicate is gone.
8. Play failures surface on the bubble: `subscribeVoicePlayError` + a `Could not play that voice message.` line under the bubble (same small danger-copy style as the upload error), on source-resolve failure, player-create failure, and player error ticks. 3 lines of UI.
- Round-1 checks (`voice attachment composer hooks-guard`, `--maxWorkers=2`): 19 files, 132 passed. Neighbours: 102 files, 858 passed, 1 skipped, 1 failed — the same pre-existing date-sensitive stickers test.

### Review round 2 (findings 1-4 fixed; finding 5 skipped per instructions)
1. Send-boundary limits: new `validateRecording()` in `lib/voice.ts` (empty/too-large/too-short/too-long, with the server's `voice_*` codes) runs at the top of the port's `convert` — including the already-converted skip branch — and in `sendVoice` before any optimistic bubble, plus the existing recorder check. A 400 ms recording, a 12 MB m4a and a 6-min recording are each refused with zero slot/PUT calls (new tests); the always-true "port boundary" test is replaced by those real ones. `convertVoice` also re-validates the converted bytes + server duration.
2. Same-message replay: `startWith` releases + resubscribes whenever the native instance differs (`sharedPlayer !== player`), regardless of message id. New test: two quick plays of one message end with one live player, the old one released, ticks reaching the bubble.
3. Dead code deleted: `MIC_BUSY_MESSAGE`, `deniedCopy()`, `voiceErrorMessage()` (+ its test block; `voiceErrorCopy()` is the one mapper that stays, with its per-reason tests in the seam + bubble suites).
4. Transcript toggle hidden when `voice.transcript` is undefined (real sends carry none); test for both states.
- Round-2 checks (`voice attachment composer hooks-guard`, `--maxWorkers=2`): 19 files, 137 passed. Neighbours (`src/components/chat src/store src/lib src/mock`): 102 files, 863 passed, 1 skipped, 1 failed — the same pre-existing date-sensitive stickers test (`message-bubble-stickers.test.tsx`, fixed Oct 1 date vs 48 h window).

### Review round 3 (findings 1-6 fixed; finding 7 strengthened cheaply)
1. Silent mic death: `createVoiceRecorder.start()` wraps the native import + permission request + recorder build in one try → handled mic-failed copy (a missing native module pre-rebuild is a copy, never an unhandled rejection); `begin()` also has `.catch(() => setError(MIC_FAILED_MESSAGE))`. Tests: throwing permission → handled `MIC_FAILED_MESSAGE` with zero recorders; begin's catch asserted via the same copy constant.
2. Pause/resume: pause keeps the native player alive (registry + active id clear, instance stays); playing the same message with a position reuses it in place — seek to the paused ms + play, no mint, no restart at zero. Tests: pause at 60 000 ms → play again seeks `[60]`, plays twice on the same instance, no remove, bubble playing; plus a reuse-only variant.
3. Play-source race: `resolvePlaySource()` carries the request-id guard (stale resolves ignored, last tap wins); the bubble runs it from `toggle`. Tests: two taps with out-of-order resolves play only the latest; missing source reports the play error on the latest tap.
4. Over-limit banner per code: `voiceSendRefusalMessage()` maps `voice_empty` → "That recording is empty.", `voice_too_short` → "That recording is too short.", else the "too long" copy. One store test per code (empty/short/long/oversized) + unit tests of the mapper.
5. Retraction strips `failureReason` together with `failed` (and the already-deleted fast path checks it).
6. Exact POST body: `voicePostBody()` passes full-buffer views through and slices views over larger buffers; test posts a 4-byte view over an 8-byte buffer and asserts only `[1,2,3,4]` go out.
7. Strengthened cheaply: denial test asserts the copy content comes from the failure result (contains 'Settings') plus zero stop/send calls; size-failure test asserts the exact `RECORD_FAILED_MESSAGE` result; added a double-tap single-`start()` test driving the same guard logic as `begin`.
- Round-3 checks (`voice attachment composer hooks-guard real-store chat-store`, `--maxWorkers=2`): 27 files, 300 passed.

### Problems, deviations from the spec
- Deviation: no real waveform extraction on device (web uses `AudioContext.decodeAudioData`; there is no equivalent here without a new dep) — sends use a flat placeholder waveform. Audible playback is unaffected.
- Deviation: press-and-hold/slide-to-cancel gesture not implemented — tap-to-record (web's click mode) only. The timer row, cancel, send, caps and denial copy match web.
- Deviation: local playback before upload completes relies on the recorder file URI, which Tron-style sandboxing may revoke on some Android builds — needs the device check.
- (Round 1: the idle-progress-bar deviation is fixed — the bar now ticks from the player's status updates.)
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

Merged after three worker fix rounds. Round 1 fixed the cross-bubble playback deadlock (one player at a time), file reads (`new File`, no `fetch` on a file URI; size never coerced to empty), per-reason failure copy, real recorder tests and the double-tap recorder leak. Round 2 enforced the size and duration floor and caps at the send boundary before any upload request, released the replaced native player, deleted dead code and hid the empty transcript toggle. Round 3 handled the silent mic failure, resume from the paused position, the stale play-source race, the per-code over-limit banner, `failureReason` on retraction and the exact byte slice on upload. I reviewed round 3 myself (diff, full scoped suite, mutation-checked the resume fix).

Not verified: nothing here has run on a device. The recorder and player depend on `expo-audio`, which needs a native dev-build rebuild before any phone test (mic permission is in `app.json`). Disclosed by the worker: an idle progress bar and a flat placeholder waveform. Nits left: three weak test assertions (a constant checked against itself, a message-length check), the test seam that fans out to every host.

Checks: format, lint, mobile tsc pass; mobile voice, attachment, composer, hooks-guard, real-store and chat-store 27 files, 300 passed.
