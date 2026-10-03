---
id: T-0179
title: Mobile: transcribe a voice note on the phone with Whistle (button in the voice bubble, on-device, free, private)
status: review
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

### What was built
On-device voice-note transcription for mobile (T-0179), driven by the
Whistle spike module from T-0177/T-0178. All audio and text stays on the
phone; the protocol package is untouched (transcripts are local-only state
keyed by message id, never sent on the wire).

- `apps/mobile/src/lib/voice-transcripts.ts` (new): `readTranscripts()`,
  `saveTranscript(id, entry)`, `deleteTranscript(id)` over one JSON file
  `Paths.document/voice-transcripts.json` through `expo-file-system`
  (`File`), with an injectable file seam. Zod validation on read (hostile
  JSON reads as `{}`), 500-entry cap (oldest dropped, re-save moves newest),
  20 000-char text cap, silent failure (never throws, never logs text).
- `apps/mobile/src/lib/voice-transcribe-flow.ts` (new):
  `transcribeVoiceNote({ port, source, audioMs, onPhase })` — pure logic,
  no React. Checks `isAvailable()`; when the model is not ready it asks the
  `confirmDownload()` callback first (`false` -> `cancelled`), then
  `downloadModel` with progress + `loadModel`; downloads a served URL to
  `Paths.cache` with its headers; runs `port.transcribe`; always deletes
  the cached file (success and failure, via `finally`); maps error codes to
  short user messages (unavailable, download failed, too long,
  nothing-heard on empty text, generic failed). File seam injectable.
- `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx` (new):
  small bottom sheet in the `attach-sheet.tsx` shape — "Download the
  transcription model? 17 MB, once. Everything stays on your phone." with
  Download / Cancel, no emoji.
- `apps/mobile/src/components/chat/voice-message.tsx`: when
  `port.isAvailable()` is true, no transcript is stored for the message,
  and the voice is playable, an `AudioLines` Transcribe icon button shows
  next to the play controls (same `iconKey` size/colours as the speed
  toggle). First tap with a missing model opens the confirm sheet; then an
  in-bubble progress line (download %, "Loading the model…",
  "Transcribing…"); then the transcript renders in the existing transcript
  block with the working Aa toggle. Failures show one short line with
  Retry. A stored transcript is read in the bubble at mount and shown at
  once (no re-run). New `whistle` / `transcripts` / `onSaveTranscript`
  props are test seams defaulting to the real port/store. The dev screen
  `dev/whistle.tsx` is untouched.
- Tests: `voice-transcribe-flow.test.ts` (11: confirm/download/load,
  cancelled confirm, unavailable, empty text, code mapping, served URL
  with headers, cache deleted on success and failure, download failure,
  safe cache name), `voice-transcripts.test.ts` (9: round trip, hostile
  JSON, hostile-then-save, 500 cap, re-save newest, 20k text cap, delete,
  failing storage never throws, empty id/text stores nothing),
  `voice-message.test.tsx` (+4: button hidden when unavailable, shown
  when available, hidden + toggle shown when stored, hidden when not
  playable), `voice-transcribe-confirm.test.tsx` (4: closed renders
  nothing, copy, Download calls back, busy disables + shows Downloading).

### Files changed
- new: `apps/mobile/src/lib/voice-transcripts.ts`,
  `voice-transcribe-flow.ts` (+ their tests),
  `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx` (+ test)
- edited: `apps/mobile/src/components/chat/voice-message.tsx` and its
  test. `apps/mobile/src/lib/whistle-*` untouched (no export needed: the
  bubble imports `createWhistlePort` directly, like the dev screen).

### Commands and real results
- `pnpm install`: ok (Done in 9.5s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 voice whistle transcript`:
  16 files passed, 153 passed, 0 failed.
- `pnpm format:check`: pass ("All matched files use Prettier code
  style!"). Note: `npx` is blocked on this machine; used
  `pnpm prettier --write <files>` instead (same binary).
- `pnpm lint`: pass (fixed 2 oxlint errors along the way:
  `set-state-in-effect` restructured to lazy `useState` init; a useless
  spread fallback removed).
- `pnpm typecheck`: pass (11/11 tasks; fixed `dialog` role -> `menu`
  like attach-sheet, and partial-port test fakes -> `createWhistlePort`
  seam).
- The lead tests on the emulator and the phone (per spec: not run here).

### Problems / deviations
- Static-markup component tests only (no test renderer in the repo), so
  tap->confirm->progress->text is covered at the flow level, and the
  bubble level covers visibility rules + stored rendering. The bubble's
  async run path is thin wiring over the fully-tested flow.
- `transcribeCacheName` sanitizes `.` too (dots are not in the safe set),
  so `../../x` becomes `voice-transcribe-______x.m4a` — still safe and
  unique per message; test asserts the real value.
- The 500-entry cap is enforced in-memory on read-modify-write, not
  atomically; fine for a single-process phone cache with one writer.

### Open questions
- None. The one open item for the lead: emulator/phone verification
  (first-tap 17 MB download, text persists after restart, no button on
  iOS/web/unsupported).

### Security checklist
- No secrets/tokens/text in logs: the flow and store never log; auth
  headers pass through `voiceAudioSource` untouched and are never logged.
- Local-only: transcripts live in one document JSON file, never sent;
  cached served audio is always deleted (`finally`); no protocol change.
- One run at a time per bubble (`transcribeBusy` + request id guard);
  user-tap driven, no auto-transcribe.

## Review (written by Claude)
