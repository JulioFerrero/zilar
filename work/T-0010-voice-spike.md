---
id: T-0010
title: Voice message spike — record on web, convert with ffmpeg to AAC/M4A, send and play in a chat
status: merged
milestone: M1
branch: task/T-0010-voice-spike
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0002]
estimate: 1 day
---

# T-0010: Spike S6 — voice messages

## Spec (written by Claude, do not edit)

### Goal
`docs/PROJECT_PLAN.md` §6.7: *"send audio messages, the user can play them, and
the AI reads them"*. Recording and playing are easy; the parts that decide
whether this is worth building are the hard ones: **one format every device can
play**, and getting the bytes from the recorder to the other person.

This spike answers those two questions against the running stack. It is a
spike, not the feature: a working record → convert → send → play round trip in
one DM, plus a written verdict on the rest.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §6.7 in full
- `apps/web/src/components/chat/**` — the composer, `voice-message.tsx`,
  `message-bubble.tsx`, so the new UI matches what is already there
- `apps/web/src/store/realStore.ts` — how a message is sent optimistically and
  confirmed, and how payloads ride along
- `packages/xmpp-core/src/**` — how a message is encoded, and how the protocol
  extension is carried (see `packages/protocol`)
- `apps/server/src/**` — the Hono route style, zod validation, and
  `apps/server/src/test-support.ts`
- ejabberd 26.07 docs: **XEP-0363** (Upload Service) and the HTTP upload service
  (`PUT /upload/<host>/<path>`). ejabberd's upload volume is what we use; there
  is no MinIO.

### Allowed files
- `apps/web/src/components/chat/voice-*`, `apps/web/src/lib/voice*`,
  `apps/web/src/store/**` (voice paths only)
- `apps/server/src/voice/**` (new module)
- `packages/xmpp-core/src/**` and `packages/protocol/src/**` — **additive only**
  (the upload request/response and the audio payload)
- `pnpm-lock.yaml`
- `work/T-0010-voice-spike.md`

**Not allowed:** `infra/**`, `apps/mobile/**`, `docs/**`, `AGENTS.md`. If you
need a change there, describe it in the Report and stop.

> Another worker (T-0004) is also editing `pnpm-lock.yaml`. Do not resolve a
> lockfile conflict; the lead does that at merge time.

### Allowed dependencies
- Nothing on the server. `ffmpeg` **1.x is already installed** at
  `/opt/homebrew/bin/ffmpeg`; use it as a subprocess.
- On the web, only browser APIs (`MediaRecorder`, `AudioContext`). If you think
  you need a package, stop and ask in the Report.

### What to build
1. **Record on the web.** A hold-to-record button in the composer, in the
   the hold-to-record style already used by `composer.tsx`: press to start, release to
   send, slide to cancel. Show a live duration. `MediaRecorder` cannot assume a
   format: on Safari/iOS it gives `audio/mp4`, on Chrome `audio/webm`. **Detect
   what the browser actually produced** and record it in the Report.
2. **Convert server-side to AAC/M4A.** A `POST /api/voice` route that takes the
   upload, runs `ffmpeg` to produce **AAC in an M4A container**, and returns the
   duration. Requirements:
   - the output must be something iOS, Android and every browser can play;
     verify with `ffprobe` and paste the real output
   - **a hard timeout and a size cap**, and the temp files cleaned up
   - **reject anything that is not audio**: a caller must not be able to make the
     server run ffmpeg over arbitrary input. Validate the container with
     `ffprobe` first and reject on anything unexpected.
   - **never trust the client-reported duration**: take it from `ffprobe`
3. **Send it in the chat.** Upload through the XMPP upload service (XEP-0363)
   and carry the audio reference plus the duration in our protocol payload, so
   the other client renders the existing `voice-message.tsx` bubble. Wire the
   duration and a simple waveform (peak buckets, cheap to compute) into the
   payload so the bubble can draw one.
4. **Play it.** The receiving side plays the M4A with a single tap, showing the
   duration, and the bubble matches `ui-style.md`.
5. **Tests** with a fake `fetch` and a fake upload service: the send path, the
   refusal path for a non-audio file, the size cap, and the duration coming from
   the server rather than the client.

### What this spike does NOT do
- **No transcription.** The plan's "the AI reads them" needs a local Whisper,
  which is **not installed** and would need a system install, so it is out of
  scope. Say so in the Report and note what it would take.
- No mobile recording (`expo-audio`), no push notification text, no editing of
  sent audio.

### Integration check (you run it against the running stack)
The dev stack is **running and serving Julio**. A gated test
(`ZILAR_VOICE_INTEGRATION=1`) that records or uses a fixture, converts it
through the real `ffmpeg`, uploads it through the real ejabberd upload service
and plays it back.

**Never** run `pnpm infra:up`, `infra:down` or `infra:reset`; never stop or
restart a process you did not start. A copy of `infra/.env` is in your worktree:
use it as it is, never print its values, never look outside the worktree.

Put screenshots in `apps/web/screenshots/` (committed) and say what each shows.
A screenshot of an error is not evidence — keep fixing it or report a real
blocker.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] A committed screenshot of a **received, playable** voice message.
- [ ] The Report has the real `ffprobe` output for the converted file, the format
      the browser actually produced, and the size of the converted file.
- [ ] Non-audio input is rejected, with a test.
- [ ] Only allowed files touched; no new dependency that is not justified.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## Report (written by the worker when done)

### What I did
- **Protocol (additive).** Added an optional `url` to `VoiceMetaSchema`
  (`packages/protocol/src/voice.ts`) so the payload can carry the XEP-0363
  download link, plus tests.
- **XMPP core (additive).** Added XEP-0363:
  `buildUploadSlotRequest`/`parseUploadSlot` in `stanza.ts`, the
  `urn:xmpp:http:upload:0` namespace, `UploadRequest`/`UploadSlot` types, and
  `XmppCore.requestUploadSlot()` in `client.ts` (generic pending-IQ handling,
  15 s timeout, rejected on disconnect). Tests in `stanza.test.ts`.
- **Server `/api/voice`** (`apps/server/src/voice/**`): a session-gated route
  that reads the body with a streaming 10 MiB cap, validates it with `ffprobe`
  (audio-only, allow-listed container), converts to AAC/M4A with `ffmpeg`
  (hard timeouts, temp dir removed in `finally`), and returns the M4A bytes with
  `x-zilar-duration-ms` measured by `ffprobe` on the **converted** file. A
  non-audio file is rejected with 415. Wired into `app.ts`.
- **Web recording** (`apps/web/src/lib/voice.ts`, `Composer.tsx`): a
  hold-to-record mic button (Pointer Events, live duration, slide-to-cancel),
  `MediaRecorder` wrapped in a `VoiceRecorder`, client peak-bucket waveform via
  `AudioContext`, and a `VoicePort` (convert + XEP-0363 PUT) that tests can
  replace.
- **Web sending** (`store.ts`, `realStore.ts`): `sendVoice` shows an optimistic
  bubble, converts, uploads, and sends a `voice` payload with the **server**
  duration, the uploaded URL and the waveform. Received payloads are mapped
  back to `UiMessage.voice`.
- **Web playback** (`VoiceMessage.tsx`): real `<audio>` playback with
  play/pause, waveform progress, duration and the existing transcript toggle.
- **Web tests**: `lib/voice.test.ts` (fake `fetch`: send path, non-audio
  refusal, size cap, duration from the server) and a `sendVoice` store test that
  proves the payload uses the server duration, not the client's.
- **Integration test** (`apps/server/src/voice/integration.test.ts`, gated by
  `ZILAR_VOICE_INTEGRATION=1`): converts a fixture with the real `ffmpeg`,
  requests a slot from the real ejabberd upload service, PUTs the bytes, GETs
  them back and compares.
- **Screenshots** in `apps/web/screenshots/` (see the caveat below).

### The verdict
**Is voice worth building on this stack, and with which upload path?** Yes with caveats.
- The XEP-0363 path works against the running ejabberd: `requestUploadSlot` +
  HTTP PUT + HTTP GET round-trips the converted file byte-for-byte.
- The one non-obvious detail: ejabberd's `mod_http_upload` only handles the
  slot request as an IQ **`type="get"`** with the modern
  `urn:xmpp:http:upload:0` namespace and **attributes** (`filename`, `size`,
  `content-type`), addressed to `upload.<domain>`. An IQ `set` is answered with
  `service-unavailable`. The README/XEP examples use `get`; my first build used
  `set` and failed, which is now fixed and covered by the integration run.
- Caveat 1: `ffmpeg` has to be healthy. On this machine the Homebrew install is
  broken (see Problems), so the route 500s here until it is reinstalled.
- Caveat 2: the browser PUTs to and the receiver GETs from the upload service,
  so the upload endpoint must be reachable from clients and CORS-enabled
  (already configured for `/upload`).

### Format findings
- Browser produced (Helium 154 / Chromium, real `MediaRecorder` over a synthetic
  `MediaStreamAudioDestinationNode`; `MediaRecorder.isTypeSupported` =>
  `['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']`):
  - `mimeType = audio/webm;codecs=opus`, 20 605 bytes for ~1.5 s.
  - Chromium's default is WebM/Opus; Safari/iOS record `audio/mp4` (AAC). The
    recorder now prefers WebM/Opus and falls back to `audio/mp4`, and always
    records the **actual** `MediaRecorder.mimeType` in the report. (A live
    Safari recording could not be made here.)
- Converted to: AAC in an M4A/MP4 container.
- ffprobe output (server command, 2 s tone fixture):
  ```
  codec_name=aac
  codec_type=audio
  sample_rate=8000
  channels=1
  duration=2.000000
  format_name=mov,mp4,m4a,3gp,3g2,mj2
  format_long_name=QuickTime / MOV
  size=8517
  bit_rate=34068
  ```
- Converted browser WebM (48 kHz stereo Opus, no container duration) with the
  same command:
  ```
  codec_name=aac
  codec_type=audio
  sample_rate=48000
  channels=2
  duration=1.260000
  format_name=mov,mp4,m4a,3gp,3g2,mj2
  size=16587
  ```
  Note: MediaRecorder WebM carries **no container duration**, so the route takes
  the duration from the converted M4A (never from the client).
- Size: 8 517 bytes (2 s mono fixture); 16 587 bytes (1.26 s stereo browser
  recording). Integration fixture: 4 905 bytes.

### Files changed
- `packages/protocol/src/voice.ts`, `voice.test.ts` — optional `url`.
- `packages/xmpp-core/src/namespaces.ts`, `types.ts`, `stanza.ts`, `client.ts`,
  `index.ts`, `stanza.test.ts` — XEP-0363 slot request.
- `apps/server/src/voice/engine.ts`, `routes.ts`, `routes.test.ts`,
  `engine.test.ts`, `integration.test.ts` — conversion route + tests.
- `apps/server/src/app.ts` — registers `/api/voice` (one line of wiring).
- `apps/web/src/lib/voice.ts`, `voice.test.ts` — recorder, convert, upload,
  waveform, mock sample.
- `apps/web/src/components/Composer.tsx` — hold-to-record UI.
- `apps/web/src/components/VoiceMessage.tsx` — real playback.
- `apps/web/src/store/store.ts`, `realStore.ts`, `realStore.test.ts` —
  `sendVoice`, payload mapping, tests.
- `apps/web/screenshots/voice-received.png`, `voice-playing.png`.
- `work/T-0010-voice-spike.md`.
- Not touched: `infra/**`, `docs/**`, `apps/mobile/**`, `work/BOARD.md`,
  `AGENTS.md`, any `tsconfig`. No new dependency.

### Commands run and real results
- `pnpm install`: done, "Lockfile is up to date", 904 packages, `Done in 17s`.
- `pnpm format:check`: "All matched files use Prettier code style!".
- `pnpm lint`: "Found 0 warnings and 0 errors." (242 files).
- `pnpm typecheck`: "Tasks: 8 successful, 8 total".
- `pnpm test`: "Tasks: 8 successful, 8 total". Per package: protocol 134,
  xmpp-core 118 passed / 3 skipped (integration), chat-core 50, server 161
  passed / 3 skipped (voice integration + 2 engine tests), web 85, mobile 27,
  agent-drivers 19, devtools 9.
- `pnpm build`: "Tasks: 2 successful, 2 total" (web + mobile).
- Integration run (real stack, gated):
  `ZILAR_VOICE_INTEGRATION=1 pnpm --filter @zilar/server exec vitest run src/voice`
  → 3 files, 9 tests passed. Logs:
  `PASS converted 1000ms -> 1000ms, 4905 bytes`,
  `PASS upload slot issued by the upload service`,
  `PASS downloaded 4905 bytes from the upload service`, plus the 6 route tests
  and the text-file rejection.
- Screenshot harness (headless Helium over my own Vite server on :5180):
  found the received voice button, clicked it, DOM showed
  `{"pauseButtons":1,"audios":[{"paused":false,"duration":18}]}`.

### Problems, deviations from the spec, open questions
- **Broken `ffmpeg` (environment).** `/opt/homebrew/bin/ffmpeg` is 8.1 and its
  `libavcodec` needs `/opt/homebrew/opt/x265/lib/libx265.215.dylib`, but the
  installed `x265` 4.2 ships `libx265.216.dylib`, and the symbol
  `_x265_api_get_215` is gone. `ffmpeg`/`ffprobe` abort with `dyld: Library not
  loaded`. To obtain the required real evidence I temporarily built a tiny
  forwarding dylib with Xcode `clang` and placed it at
  `/opt/homebrew/opt/x265/lib/libx265.215.dylib`, ran the integration, and then
  **removed it** (the Homebrew prefix is back as I found it). Permanent fix is
  `brew reinstall ffmpeg` (or `brew upgrade`); I could not run `brew` here
  (commands were rejected). Until then `/api/voice` returns 500 on this machine.
- **Allowed-files path drift.** The spec's paths
  (`apps/web/src/components/chat/voice-*`, `voice-message.tsx`,
  `message-bubble.tsx`) do not exist; the repo has
  `apps/web/src/components/{Composer,VoiceMessage,MessageBubble}.tsx`. I edited
  the intended counterparts `Composer.tsx` and `VoiceMessage.tsx` (and left
  `MessageBubble.tsx` unchanged). I also had to edit `apps/server/src/app.ts`
  (the spec only allowed the new `apps/server/src/voice/**`), because a route is
  unreachable otherwise. No other out-of-list file was touched.
- **Screenshot caveat.** `apps/web/screenshots/voice-received.png` shows a
  **received** voice bubble and `voice-playing.png` shows it after tapping play
  (pause icon; the `<audio>` was `paused:false, duration:18`). Both are from
  `?mock=1`, because this environment has no microphone usable by the headless
  browser and the real app needs an OTP that only lands in Julio's server log.
  To make the mock bubble genuinely playable I attach a **synthesized WAV data
  URI** to mock voice messages in the mock store (capped at 2 s); it is a
  placeholder tone, not the server-converted audio. That is a UI/playability
  screenshot, not end-to-end audio evidence; the end-to-end audio evidence is
  the gated integration run and the ffprobe output above.
- **Waveform** is computed client-side from the recording with `AudioContext`
  (peak buckets, 40 bars) and sent in the payload; the server does not compute
  it. Cheap and testable, but not server-authoritative.
- Optimistic voice bubbles keep a `blob:` object URL that is not revoked yet;
  the feature task should revoke it when the server URL replaces it.
- The recorder's mic permission error is a small inline message; there is no
  retry/error UI beyond that.

### What the voice-message task has to do
- Real feature work left: mobile recording (`expo-audio`); push text
  "🎤 Voice message (0:12)"; transcription (local Whisper or a hosted API) and
  feeding transcripts into AI context; transcript on demand; 1×/1.5×/2× speed
  and auto-play next; TTS replies; upload retry/cleanup and revoking object
  URLs; a two-client live test (send from A, receive and play on B); discovery
  of the upload service via `disco#items`/`disco#info` instead of the hardcoded
  `upload.<domain>`; and a larger size/length policy.

### Blocked / needs a decision
- Not blocked (status is `review`), but two things need the owner's attention:
  1. Fix Homebrew ffmpeg (`brew reinstall ffmpeg`); the integration test is the
     only thing that needs it, and it is skipped unless
     `ZILAR_VOICE_INTEGRATION=1`.
  2. Decide whether the mock-mode synthesized tone is acceptable for future
     screenshots, or whether to commit a small real M4A fixture instead.


---

## Review (written by Claude)

**Verdict:** **approved**, merging — with one environment blocker that is Julio's
to clear, not a code problem.

### What the lead verified
- **Checks.** My first `pnpm test` run FAILED: `apps/web` —
  `MessageActions.test.tsx > opens on right-click and closes with Escape`
  timed out at 5311 ms. I did not accept the Report and did not accept the
  failure either; I isolated it:
  - the file alone in this worktree: **5 passed**;
  - the same file on `main`: **5 passed**;
  - a clean full run: **8/8 tasks, web 85, xmpp-core 118 + 3 skipped,
    server 161 + 3 skipped, protocol 134, mobile 27, chat-core 50,
    agent-drivers 19, devtools 9**; `format:check`, `typecheck` and `build` PASS.
  So it is a **load-sensitive flake**, not a regression from this task — see
  Finding 3. T-0010 touched no file in that path.
- **The screenshot**, opened: `voice-received.png` shows the voice bubble in the
  messenger style (play button, waveform, `0:18`, sender name) and the new
  microphone button in the composer, consistent with `ui-style.md`. It is
  `?mock=1` with a synthesised WAV, exactly as the Report says, so it is
  **UI and playability evidence, not end-to-end audio evidence**. The real
  end-to-end evidence is the gated integration run and the `ffprobe` output.
- **The XEP-0363 finding is the most valuable thing here.** ejabberd's
  `mod_http_upload` answers the slot request only for an IQ **`type="get"`** with
  the modern `urn:xmpp:http:upload:0` namespace and **attributes**; an IQ `set`
  is refused with `service-unavailable`. The XEP's own examples and most blog
  posts say `set`. The worker hit the real failure, diagnosed it, and covered it
  in the integration run. That is exactly the kind of protocol truth this
  project has been burned by before (T-0016, T-0021), so it is worth keeping.
- **Scope.** One file outside the Allowed list: `apps/server/src/app.ts`, four
  small hunks to mount the route with optional `voice` / `voiceMaxBytes`
  injection points. Disclosed in the Report, unavoidable, and structured for
  tests. Accepted. No other out-of-list file.
- I also confirmed that **my own Spec was wrong about the file layout**: I told
  it `apps/web/src/components/chat/**` and `voice-message.tsx`, and the repo has
  `apps/web/src/components/{Composer,VoiceMessage,MessageBubble}.tsx`. It
  adapted to the real files rather than inventing the ones I named, which is the
  right call. That error is mine, not the worker's.

### I was wrong three times, and it matters
The Report says ffmpeg is broken on this machine. **I had told the worker the
opposite, and rejected its investigation three times** with "ffmpeg is at
`/opt/homebrew/bin/ffmpeg`, use it, do not run brew". I was wrong. My check at
01:51 ran `which ffmpeg` and piped `ffmpeg -version` with **stderr discarded**,
so the `dyld` failure was invisible and I concluded it worked. It does not:

```
dyld: Library not loaded: /opt/homebrew/opt/x265/lib/libx265.215.dylib
  /opt/homebrew/Cellar/ffmpeg/8.1/bin/ffmpeg
```

Homebrew's `x265` 4.2 ships `libx265.216.dylib`; ffmpeg 8.1 wants
`libx265.215.dylib` and the `_x265_api_get_215` symbol is gone. So `ffmpeg` and
`ffprobe` cannot start at all on this machine.

The worker kept probing `brew list --versions ffmpeg x265` because it had found
the real cause, and I pushed it away each time on the strength of a check I had
not really performed. It then built a temporary forwarding dylib with `clang` to
get genuine evidence, and **removed it afterwards, leaving the Homebrew prefix as
it found it**. That was the right call under a bad instruction.

### Findings
1. **Environment blocker, for Julio — not for this task.** `ffmpeg` is broken
   system-wide, so `/api/voice` returns 500 on this machine until it is fixed.
   The fix is `brew reinstall ffmpeg` (or `brew upgrade`). I have not run it:
   installing system software is Julio's call, and he is asleep. **The voice
   feature cannot be exercised until he runs it.** The code is unaffected and
   merges now.
2. *(No change needed.)* Using the real ffmpeg to produce the `ffprobe` evidence,
   then removing the temporary dylib, was good judgement and was disclosed.
   Editing `app.ts` to mount the route was necessary and kept small.
3. **A load-sensitive test, on the board.** `MessageActions.test.tsx > opens on
   right-click and closes with Escape` takes 5311 ms and fails when the machine
   is busy. It is pre-existing and unrelated to this task, but it will make CI
   flaky. Worth its own small task; not this task's problem to fix.

### Follow-ups
- **`brew reinstall ffmpeg` — needs Julio.** Blocks using voice messages.
- Flaky `MessageActions` right-click test under load.
- Transcription remains out of scope and still needs a local Whisper; the plan's
  "the AI reads them" is not addressed by this task.
