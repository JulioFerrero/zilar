---
id: T-0010
title: Voice message spike — record on web, convert with ffmpeg to AAC/M4A, send and play in a chat
status: todo
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
   Telegram style already used by `composer.tsx`: press to start, release to
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
(`GALENA_VOICE_INTEGRATION=1`) that records or uses a fixture, converts it
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
-

### The verdict
**Is voice worth building on this stack, and with which upload path?** Yes / No / Yes with caveats
-

### Format findings
- Browser produced:
- Converted to:
- ffprobe output:
- Size:

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:
- integration run:

### Problems, deviations from the spec, open questions
-

### What the voice-message task has to do
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
