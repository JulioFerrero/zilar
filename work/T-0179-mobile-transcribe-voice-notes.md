---
id: T-0179
title: Mobile: transcribe a voice note on the phone with Whistle (button in the voice bubble, on-device, free, private)
status: planned
milestone: M5
branch: task/T-0179-mobile-transcribe-voice-notes
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0177, T-0178]
estimate: 1 day
---

# T-0179: Transcribe voice notes on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03, after Whistle transcribed a 2-minute clip on his phone in 12.8 s: "for a first version is great and free, let's add that perfect". Voice notes on mobile get a "Transcribe" action that runs the on-device Whistle model: free, offline after the one-time 17 MB model download, and the audio never leaves the phone.

### Verified facts (do not re-derive)
- The spike module is merged: `apps/mobile/modules/zilar-whistle/` and the port `apps/mobile/src/lib/whistle-port.ts` (`createWhistlePort()` gives `isAvailable()`, `modelStatus()` -> `'ready' | 'missing'`, `downloadModel(onProgress)`, `loadModel()`, `transcribe(fileUri, { language?, audioMs? })` -> `{ text, language, ttftMs, decodeTps, audioMs, wallMs }`). It works on arm64 Android only; `isAvailable()` is false elsewhere (iOS, web, tests).
- The dev screen `apps/mobile/src/app/dev/whistle.tsx` shows the full flow (download, load, transcribe, errors, progress). Copy its logic, not its look. Keep it.
- `VoiceMessage` (`apps/mobile/src/components/chat/voice-message.tsx`) already shows a transcript block and an icon toggle ("Show transcript") but only when `voice.transcript` exists (around lines 311-350). The type is `voice.transcript: { text, language?, source }` where `source` is a protocol enum; this task must NOT change the protocol package, so the on-device transcript is kept locally (below) and passed to the bubble as extra local state, never sent on the wire.
- Playable audio: `voiceAudioSource({ voice, localUri, trustedHosts })` in `apps/mobile/src/lib/voice-native.ts` returns `{ uri, headers? }`. A `localUri` is already a local file. A served URL needs a download with the headers first: use `File.downloadFileAsync(url, destinationDirectory, { headers })` from `expo-file-system` into `Paths.cache`, transcribe, then delete the cached file.
- Persistence: there is no general key-value store (sticker recents are in memory). Store transcripts in one JSON file `Paths.document/voice-transcripts.json` through `expo-file-system` (`File`), keyed by the message's stable id (`message.id` after `aliasRoot`-style linking is not needed: use the id the bubble receives). Validate on read with zod, cap at 500 entries (drop oldest), text capped at 20 000 chars, never log text.
- No new dependency (expo-file-system and zod are already in `apps/mobile`).

### What to build
1. `apps/mobile/src/lib/voice-transcripts.ts`: `readTranscripts()`, `saveTranscript(id, entry)`, `deleteTranscript(id)` over the JSON file with an injectable file seam, zod validation, the caps above.
2. `apps/mobile/src/lib/voice-transcribe-flow.ts`: `transcribeVoiceNote({ port, source, audioMs, onPhase })` that: checks `port.isAvailable()`; if `modelStatus() !== 'ready'` calls a `confirmDownload()` callback first (returns false -> stop with `cancelled`), then `downloadModel` with progress and `loadModel`; downloads a served URL to the cache; runs `port.transcribe`; always deletes the cache file; maps errors to short user messages (unavailable, model download failed, audio too long, nothing heard when the text is empty, generic failed). Pure logic with injected seams, no React.
3. `VoiceMessage`: when `port.isAvailable()` is true, no transcript is stored for this message, and the voice has a playable source, show a "Transcribe" icon button next to the play controls (lucide `AudioLines` or `Captions`, never emoji, same size and colours as the speed toggle). Tapping it: first time on this phone (model not ready) opens a small confirm sheet "Download the transcription model? 17 MB, once. Everything stays on your phone." with Download / Cancel; then shows a progress state inside the bubble (download %, then "Transcribing..."), then the existing transcript block with the text, and the toggle works like today. A failure shows one short line under the bubble with Retry. A stored transcript is shown at once on the next app start (read it in the bubble with the stored value, no re-run).
4. Tests (Vitest, same style as `voice-message.test.tsx`): the flow (model missing -> confirm -> download -> transcribe; cancelled confirm; unavailable; empty text; cache file deleted on success and on failure; served URL downloaded with headers), the transcript store (round trip, hostile JSON dropped, 500 cap, text cap, no text in logs), the bubble (button hidden when unavailable or when a transcript exists, shown otherwise; tap shows the confirm; stored transcript rendered).

### Read first
`AGENTS.md`, `docs/design/ui-style.md` (voice bubble, sheets), `apps/mobile/src/components/chat/voice-message.tsx` and `voice-message.test.tsx`, `apps/mobile/src/lib/voice-native.ts` (`voiceAudioSource`), `apps/mobile/src/lib/whistle-port.ts`, `apps/mobile/src/app/dev/whistle.tsx`, `apps/mobile/modules/zilar-whistle/README.md`, `apps/mobile/src/components/chat/attach-sheet.tsx` (a sheet to copy for the confirm).

### Allowed files
`apps/mobile/src/components/chat/voice-message.tsx` and its tests, a new `voice-transcribe-confirm.tsx` (and test) in the same folder, `apps/mobile/src/lib/voice-transcripts.ts`, `voice-transcribe-flow.ts` and their tests, `apps/mobile/src/lib/whistle-*` (only to add exports).

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 voice whistle transcript
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- On an arm64 Android phone every playable voice note shows a Transcribe button; the first tap asks to download the 17 MB model, later taps just run; the text appears in the bubble and is still there after an app restart.
- On web, iOS, tests and unsupported phones nothing changes (no button).
- Audio and text are never sent anywhere and never logged; the cached audio file is always deleted.
- No emoji in UI, no new dependency, no protocol change.

### Out of scope
Web or iOS transcription, sending the transcript to the other person, translation, search over transcripts, auto-transcribe, the server transcription of T-0170.

---

## Report (written by the worker when done)

## Review (written by Claude)
