---
id: T-0166
title: Fix voice notes on web (recording, play/pause state, waveform colors)
status: planned
milestone: M5
branch: task/T-0166-voice-fixes
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: []
estimate: 0.5 day
---

# T-0166: Fix voice notes on web

## Spec (written by Claude, do not edit)

### Why
Julio tested voice notes on chat.zilar.app and reported three bugs: it records nothing, the pause button never returns to play, and the playing color is white on a white background. Causes found by reading the code (not yet reproduced in a browser):

1. **Recording** (`apps/web/src/components/Composer.tsx`, `beginRecording`, `finishRecording`, `onMicPointerUp`): recording is hold-to-record only. On the first use the browser's microphone permission prompt appears while the button is still pressed; the pointer is released during the prompt, `released` becomes true, and as soon as `VoiceRecorder.start()` resolves the recording is cancelled silently, with no message. A plain click only flashes "Hold to record". On desktop, hold-to-record is also a poor interaction.
2. **Play/pause** (`apps/web/src/components/VoiceMessage.tsx`): `playing` is set by the button only. The `<audio>` has no `onEnded`, `onPause` or `onPlay` handlers, so when the audio finishes (or is paused by the system, another player or the media keys) the button stays on "Pause" forever.
3. **Colors** (same file): the waveform bars use hardcoded `bg-[#ededed]` (played) and `bg-[#525252]` (not played). The outgoing bubble is light grey (`--bubble-out: #dedede`), so the played bars are invisible there.

### What to build

**Recording: click to start, click to send, with a clear state.**
- A click (or tap) on the mic button starts recording and requests the microphone if needed. While recording the composer shows (it already has a recording row: reuse it) the elapsed time, a **Cancel** button (trash) and a **Send** button. Clicking Send stops and sends; Cancel discards. Escape cancels.
- Keep press-and-hold working for touch and mouse: if the press lasts longer than 400 ms, releasing sends (slide left still cancels), exactly as today; a shorter press leaves the recording running in click mode. The permission prompt must never cancel the recording: only an explicit release after the recorder has started can finish it, and if permission is granted after the pointer was released, switch to click mode and keep recording.
- Every failure shows a real message in the existing `voiceError` line: permission denied ("Microphone access is blocked. Allow it in the browser's site settings."), no microphone found, recording unsupported, recording too short (under `VOICE_MIN_MS`, "Recording too short"), too long. Never silent. Distinguish the cases using the `DOMException` name (`NotAllowedError`, `NotFoundError`) in `VoiceRecorder.start`, keeping the `VoiceError` codes pattern.
- Leaving the chat, unmounting the composer or switching chats while recording stops the microphone tracks (the browser's recording indicator must go off) and discards the recording.

**Player.**
- Track the real state of the `<audio>` element: `onPlay`, `onPause`, `onEnded` (and `onError`) set `playing`; on end the button returns to Play and progress resets to 0. Only one voice message plays at a time: starting one pauses any other.
- If the audio cannot be played (error or unplayable source), the button shows a disabled state with a title "Audio unavailable" instead of doing nothing.
- Waveform colors come from theme tokens, never hex: for an outgoing bubble the played bars use the foreground color of the bubble and the unplayed bars a muted version; for an incoming bubble the same with the incoming tokens. Check both the dark and the light theme and make the contrast visibly clear in all four combinations (own/incoming × dark/light). Add the small tokens to `index.css` if none fits.

### Read first
`AGENTS.md`, `apps/web/src/lib/voice.ts` and its test, `apps/web/src/components/Composer.tsx` (recording part), `apps/web/src/components/VoiceMessage.tsx` and its test, `apps/web/src/index.css` (bubble tokens, `key-primary`).

### Allowed files
`apps/web/src/lib/voice.ts`, `apps/web/src/lib/voice.test.ts`, `apps/web/src/components/Composer.tsx` and its tests, `apps/web/src/components/VoiceMessage.tsx` and its test, `apps/web/src/index.css` (only new small color tokens), `work/T-0166-voice-fixes.md`. No server changes, no new dependencies, no mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test --maxWorkers=2 src/lib/voice src/components/Composer src/components/VoiceMessage
```

### Acceptance
- A click starts recording, a click on Send sends one voice message that appears in the chat and plays; Cancel and Escape send nothing and turn the microphone off.
- Press and hold for more than 400 ms then release sends; a press under 400 ms keeps recording in click mode.
- With the permission prompt: pressing, granting after release, keeps recording (test with a fake `getUserMedia` that resolves after the pointer-up). Denied permission shows the blocked message.
- After playing to the end the button is Play again and the waveform resets; pausing and playing again works; starting a second voice message pauses the first.
- No hardcoded hex colors remain in the player; tests assert the token classes. Describe in the Report how you checked both themes.

### Out of scope
Transcripts, mobile voice (T-0154), server conversion, waveform scrubbing.

---

## Report (written by the worker when done)

## Review (written by Claude)
