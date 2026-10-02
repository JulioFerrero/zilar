---
id: T-0166
title: Fix voice notes on web (recording, play/pause state, waveform colors)
status: review
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

### What I did
Fixed all three voice-note bugs on web:

1. **Recording (click-to-record + hold-to-send)** (`Composer.tsx`): the mic button
   now starts recording on pointer-down. Releasing after holding past 400 ms sends
   (slide-left still cancels); releasing sooner locks into click mode with an elapsed
   timer, a **Cancel** (trash) button and a **Send** button. Escape cancels via a
   document keydown listener (the textarea is hidden while recording). The
   permission prompt can never cancel silently: only a release after the recorder
   started finishes the press, and a grant-after-release keeps recording in click
   mode. Every failure shows a real `voiceError` message (blocked / no mic / busy /
   unsupported / too short / too long). Chat switch or unmount cancels the recorder
   so the browser's recording indicator goes off and nothing is sent.
2. **Player** (`VoiceMessage.tsx`): the button now reflects the `<audio>` element's
   real state via `onPlay`/`onPause`/`onEnded`/`onError` (event-driven, not
   `audio.paused`, which jsdom and idle elements misreport). Ended resets to Play
   with progress 0. A module-level `activeVoiceAudio` pauses any other playing
   message when one starts, and unmount cleanup clears the slot. Unplayable audio
   (error event or rejected `play()`) shows a dimmed button with
   `title="Audio unavailable"`.
3. **Colors** (`VoiceMessage.tsx` + `index.css`): waveform bars use new theme tokens
   `bg-voice-played` / `bg-voice-unplayed` (no hex left in the player). The tokens
   resolve per bubble: `.bubble-out` → played `#0a0a0a` / unplayed `#8a8a8a`,
   `.bubble-in, .bubble-gen` → played `#ededed` / unplayed `#525252`. Tokens are
   declared in `:root` and mapped in `@theme inline`, following the existing
   `--color-bubble-*` pattern.
4. **Error mapping** (`voice.ts`): `VoiceRecorder.start()` maps `getUserMedia`
   rejections to `VoiceError` codes via a new exported `voiceErrorFromGetUserMedia`
   (`NotAllowedError`/`SecurityError` → `voice_blocked` with the site-settings
   message, `NotFoundError`/`OverconstrainedError` → `voice_no_microphone`,
   `NotReadableError`/`AbortError` → `voice_unavailable`).

### Files changed
- `apps/web/src/lib/voice.ts` — `voiceErrorFromGetUserMedia` + mapping in `start()`.
- `apps/web/src/lib/voice.test.ts` — 2 new tests for the mapping.
- `apps/web/src/components/Composer.tsx` — click/hold recording state machine,
  Send/Cancel row, Escape, unmount/chat-switch discard, specific error messages.
- `apps/web/src/components/Composer.voice.test.tsx` — **new**, 8 tests (click→Send,
  grant-after-release, blocked message, long-hold sends, trash cancel, Escape
  cancel, chat-switch stops mic, too-short message).
- `apps/web/src/components/VoiceMessage.tsx` — real-state player, single-playback,
  unavailable state, token classes.
- `apps/web/src/components/VoiceMessage.player.test.tsx` — **new**, 6 tests
  (token classes + no hex, end→Play, external pause, second pauses first,
  error→unavailable, missing url→unavailable).
- `apps/web/src/index.css` — `--voice-played`/`--voice-unplayed` tokens + per-bubble
  overrides (only addition, no other CSS touched).

### Commands and real results
- `pnpm install` — exit 0 (lockfile up to date, 1049 resolved).
- `pnpm format:check` — pass after `prettier --write` on 2 files.
- `pnpm lint` (`oxlint .`) — pass, no output.
- `pnpm typecheck` (`turbo typecheck`, 11 tasks) — pass.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/lib/voice src/components/Composer src/components/VoiceMessage` — **5 files, 54 tests, all pass**
  (incl. the 16 new tests: 8 Composer voice + 6 player + 2 error mapping).
- Neighbours `src/components/MessageBubble src/components/MessageContent src/components/AttachmentBubbles` — 2 files, 20 tests pass.

### Theme check (both themes)
The app is dark-only (`index.css` header + `docs/design/ui-style.md`: "Dark only for
now"); there is no light theme, no `data-theme` switch and no `light:` variant in
the codebase. I verified the four own/incoming combinations against the single
dark theme by computing WCAG contrast of the waveform tokens vs. the bubble fills
from the token values in `index.css`:
- own played `#0a0a0a` on `#dedede` → **14.72**; own unplayed `#8a8a8a` → 2.57
  (muted by design, clearly distinct from played).
- incoming played `#ededed` on `#161616` → **15.46**; incoming unplayed `#525252`
  → 2.32 (muted by design, clearly distinct from played).
Played bars use each bubble's own foreground, so they stay readable in every
combination; the player tests assert the `bg-voice-*` token classes and the
absence of hex. A real-browser visual check was not possible in this environment.

### Problems / deviations
- `fireEvent.pointerUp` on the mic button never reaches the component because the
  recording row replaces the button mid-press (and jsdom has no pointer capture),
  so release/slide handling moved to **document-level** `pointerup`/`pointermove`
  listeners. This also matches real browsers better (release outside the window).
- `audio.paused`/`audio.ended` are unreliable in jsdom (always true/false), so the
  player is purely event-driven; verified with debug tests that React `onPlay`
  fires in jsdom but the properties never change.
- `VoiceMessage` gained an `aria-labelledby` linking the `<audio>` to the visible
  duration (previously the audio was unlabeled); needed for the new `title`-based
  unavailable state to stay accessible.
- Chat-switch test navigates via the "Viernes 🍻" chat list entry (real user path).
- Out of scope as specced: transcripts, mobile, server conversion, scrubbing.

### Security checklist
- No secrets/tokens/logs touched; error messages carry no audio bytes or URLs.
- No deletes/updates scoping change (voice send goes through the existing
  `store.sendVoice` path, unchanged).
- No caps/uniqueness, permissions, 404, rate-limit or audit surface added.
- No checks, tests or lint rules disabled; no `--no-verify`.

## Review (written by Claude)
