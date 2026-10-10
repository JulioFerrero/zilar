---
id: T-1034
title: "Size split T112: apps/web/src/lib/voice.ts (420 lines) into lib/voice/{recorder,convert,waveform,sample}.ts, voice.ts a re-export facade; one promiseOf"
status: merged
milestone: M5
branch: task/T-1034-split-web-voice-lib
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1034: Split the web `lib/voice.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/lib/voice.ts` is 420 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #108 (task T112). The new files go in a new `apps/web/src/lib/voice/` folder: `recorder.ts`, `convert.ts`, `waveform.ts` and `sample.ts`. `apps/web/src/lib/voice.ts` stays at its path as a thin facade and re-exports every name it exports today. Leave the existing `apps/web/src/lib/useVoiceTranscription.ts` as it is.

The in-file Dedup is in scope:
- the three Promise wrappers (`convertVoice`, `uploadVoice` and `computeWaveform`) become one `promiseOf(effectFn)`;
- each keeps its name and signature.

The lead checks recording a voice note in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #108, and `apps/web/src/lib/voice.ts`.

### Allowed files
`apps/web/src/lib/voice.ts`, `apps/web/src/lib/voice/recorder.ts`, `apps/web/src/lib/voice/convert.ts`, `apps/web/src/lib/voice/waveform.ts`, `apps/web/src/lib/voice/sample.ts`, `work/T-1034-split-web-voice-lib.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/lib/voice.ts` (420 lines) into `apps/web/src/lib/voice/` and
kept `voice.ts` as a thin re-export barrel. Code was moved unchanged following
`docs/audit/split-rules.md` and plan entry `docs/audit/size-plan.md` §2.2 #108:

- `voice/recorder.ts` — constants (`VOICE_MAX_BYTES`, `VOICE_MIN_MS`,
  `VOICE_FILENAME`, `VOICE_MIME`, `WAVEFORM_BUCKETS`), `VoiceError`,
  `RECORDER_MIME_TYPES`, `isVoiceRecordingSupported`, `pickRecorderMime`,
  `RecordedVoice`, `VoiceRecorder`, `voiceErrorFromGetUserMedia` (old 7–191).
- `voice/convert.ts` — `ConvertedVoice`, `errorCodeOf`, `errorCode`,
  `convertVoice`, `convertVoiceEffect`, `UploadSlotRequester`, `uploadVoice`,
  `uploadVoiceEffect`, `VoicePort`, `defaultVoicePort` (old 193–314).
- `voice/waveform.ts` — `computeWaveform`, `peaksOf`, `computeWaveformEffect`
  (old 316–368).
- `voice/sample.ts` — `sampleVoiceDataUrl`, `writeAscii`, `base64` (old 370–419).

Dedup applied (in scope): the three `Promise` wrappers `convertVoice`,
`uploadVoice` and `computeWaveform` no longer inline `runWeb(...)`; each keeps
its name and signature (including the `fetchFn = fetch` / `buckets = WAVEFORM_BUCKETS`
defaults, which the effect functions cannot carry) and its body is now
`promiseOf(() => <effect>(...))`. `promiseOf` is defined once in `voice/convert.ts`
and imported by `voice/waveform.ts`. It is deliberately **not** re-exported by the
barrel, so the public API of `@/lib/voice` is unchanged.

No importer was edited. No new tests. No dependencies added. Files use a value
`import { Effect } from 'effect'`, so the Effect ratchet classifies them as
`effect` (no `// effect-plain:` marker needed; none added).

### Files changed

- `apps/web/src/lib/voice.ts` (modified, now the barrel)
- `apps/web/src/lib/voice/recorder.ts` (new)
- `apps/web/src/lib/voice/convert.ts` (new)
- `apps/web/src/lib/voice/waveform.ts` (new)
- `apps/web/src/lib/voice/sample.ts` (new)
- `work/T-1034-split-web-voice-lib.md` (this report)

### Line counts (`wc -l`)

```
old:  420  apps/web/src/lib/voice.ts (main)
new:   29  apps/web/src/lib/voice.ts (barrel)
      189  apps/web/src/lib/voice/recorder.ts
      134  apps/web/src/lib/voice/convert.ts
       57  apps/web/src/lib/voice/waveform.ts
       51  apps/web/src/lib/voice/sample.ts
```
Every file is well under 400 lines.

### Export list before → after

Old (`git show main:apps/web/src/lib/voice.ts | grep -E "^export"`) vs new
(barrel + new files), same 22 public names, same kinds:

```
export const VOICE_MAX_BYTES      -> recorder.ts + barrel
export const VOICE_MIN_MS         -> recorder.ts + barrel
export const VOICE_FILENAME       -> recorder.ts + barrel
export const VOICE_MIME           -> recorder.ts + barrel
export const WAVEFORM_BUCKETS     -> recorder.ts + barrel
export class VoiceError           -> recorder.ts + barrel
export function isVoiceRecordingSupported -> recorder.ts + barrel
export function pickRecorderMime  -> recorder.ts + barrel
export interface RecordedVoice    -> recorder.ts + barrel (type)
export class VoiceRecorder        -> recorder.ts + barrel
export function voiceErrorFromGetUserMedia -> recorder.ts + barrel
export interface ConvertedVoice   -> convert.ts + barrel (type)
export function convertVoice      -> convert.ts + barrel
export const convertVoiceEffect   -> convert.ts + barrel
export interface UploadSlotRequester -> convert.ts + barrel (type)
export function uploadVoice       -> convert.ts + barrel
export const uploadVoiceEffect    -> convert.ts + barrel
export interface VoicePort        -> convert.ts + barrel (type)
export const defaultVoicePort     -> convert.ts + barrel
export function computeWaveform   -> waveform.ts + barrel
export const computeWaveformEffect -> waveform.ts + barrel
export function sampleVoiceDataUrl -> sample.ts + barrel
```

The only extra `export` in the new files is `promiseOf` (the sanctioned dedup
helper) in `voice/convert.ts`; it is not re-exported by the barrel, so no public
name was added or lost.

### Commands run

- `pnpm install` — done (1172 packages, ok).
- `pnpm --filter @zilar/web build` — `✓ built in 897ms` (success; only the
  pre-existing >500 kB chunk-size warning).
- `pnpm gate` (from repo root) summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single tests: none run — there are no test files next to `apps/web/src/lib/voice.ts`
  or in the new `voice/` folder, and the task writes no new tests (split-rules
  item 5), so gate's nearest-test search selected none.

### Deviations / questions

- `promiseOf`'s home is not named by the plan (only the four content files are).
  It lives in `voice/convert.ts` (2 of the 3 wrappers are there) and is imported
  by `voice/waveform.ts`; it is not exported from the barrel. No importer changed.
- No deviations from the spec otherwise. No open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `lib/voice.ts` (420 lines) is now a 29-line facade, plus `lib/voice/{recorder,convert,waveform,sample}`. One `promiseOf` serves the three Promise wrappers.
- **The lead's line check:** the only code changes are the three `runWeb(xEffect(...))` bodies, now `promiseOf(() => xEffect(...))`. That is the same Effect, run the same way.
- **The lead's check:** headless Chromium with a fake microphone, in mock Ana's chat, branch against main.
  - Record shows Cancel and Send.
  - Send adds a voice bubble with Play voice message, Show transcript, Retry sending message and Delete unsent message. Sending fails because the mock has no upload.
  - Both builds log the same two mock 404s.
  - The lead's Chrome tab could not record: it is hidden and has no microphone.
- **Check:** the gate passed, and so did the web build.
