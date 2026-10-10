---
id: T-1030
title: "Size split T96: apps/mobile/src/lib/voice-native.ts (451 lines) into lib/{voice-recorder,voice-playback,voice-failure}.ts, the old path re-exports"
status: merged
milestone: M5
branch: task/T-1030-split-mobile-voice-native
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1030: Split `voice-native.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/lib/voice-native.ts` is 451 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #92 (task T96): `lib/voice-recorder.ts`, `lib/voice-playback.ts` and `lib/voice-failure.ts`, under `apps/mobile/src/`. `voice-native.ts` re-exports every name it exports today.

Move the code unchanged, and skip both Dedup items, because they cross packages. The same-origin bearer block (`voice-native.ts:437-450`) decides which host gets the session token, so not one line of it changes.

The lead runs a phone smoke of recording a voice note in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #92, and `apps/mobile/src/lib/voice-native.ts`.

### Allowed files
`apps/mobile/src/lib/voice-native.ts`, `apps/mobile/src/lib/voice-recorder.ts`, `apps/mobile/src/lib/voice-playback.ts`, `apps/mobile/src/lib/voice-failure.ts`, `work/T-1030-split-mobile-voice-native.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did
Split `apps/mobile/src/lib/voice-native.ts` into three modules and left the old path as a barrel:

- `apps/mobile/src/lib/voice-recorder.ts` — the four recording messages, `FinishedRecording` / `RecordResult` / `VoiceRecorderPort` / `NativeRecorderShape` / `RecordingAudio` (and the private `AudioMode` / `StartResult`), `buildRecordingOptions`, `createVoiceRecorder`, and the lazy expo-audio helpers (`loadExpoAudio`, `platformOs`, `setAudioModeEffect`, `readFileSize`).
- `apps/mobile/src/lib/voice-playback.ts` — `VOICE_SPEEDS` / `VoiceSpeed`, `VoiceSpeaker`, `createVoicePlayback` / `VoicePlayback`, `isPlayableVoiceUrl`, `voiceAudioSource`.
- `apps/mobile/src/lib/voice-failure.ts` — `VoiceFailureReason`, `voiceFailureReasonFor`, `voiceErrorCopy`.
- `apps/mobile/src/lib/voice-native.ts` — now a thin barrel that re-exports all 21 names it exported before.

Code moved unchanged. The same-origin bearer block (was `voice-native.ts:437-450`) is byte-identical in `voice-playback.ts`. Both plan Dedup items were skipped as the spec says (they fold into `packages/chat-core` and `@zilar/client-core`, i.e. other packages).

**Deviation from the plan ranges.** The plan entry §2.2 #92 assigns `voice-failure.ts` lines 30–81, `voice-recorder.ts` 83–339, `voice-playback.ts` 341–451, leaving the four recording messages (was 16–20) and the `VoiceFailureReason` doc/type (22–28) unassigned. I put the four messages in `voice-recorder.ts` (three of the four are used there, `RECORD_TOO_LONG_MESSAGE` is the fourth recording copy) and the `VoiceFailureReason` type next to the failure functions in `voice-failure.ts`.

### Line counts (`wc -l`)
- old `apps/mobile/src/lib/voice-native.ts`: **451**
- new `apps/mobile/src/lib/voice-native.ts`: **33**
- new `apps/mobile/src/lib/voice-recorder.ts`: **272**
- new `apps/mobile/src/lib/voice-playback.ts`: **125**
- new `apps/mobile/src/lib/voice-failure.ts`: **67**

Every new file and the barrel are ≤ 400 lines.

### Export diff (old file vs barrel + new files)
Old exports (21, `grep -E "^export" main:.../voice-native.ts`):
`buildRecordingOptions createVoicePlayback createVoiceRecorder FinishedRecording isPlayableVoiceUrl MIC_DENIED_MESSAGE MIC_FAILED_MESSAGE NativeRecorderShape RECORD_FAILED_MESSAGE RECORD_TOO_LONG_MESSAGE RecordingAudio RecordResult VOICE_SPEEDS voiceAudioSource voiceErrorCopy VoiceFailureReason voiceFailureReasonFor VoicePlayback VoiceRecorderPort VoiceSpeaker VoiceSpeed`

New exports (21, same extraction over the three new files): **identical set** — `diff` of the two sorted lists is empty. I also checked every old name is present in the barrel's `export`/`export type` statements. Kinds are unchanged: constants and functions re-exported as values; `FinishedRecording` / `VoiceRecorderPort` / `NativeRecorderShape` / `RecordingAudio` / `VoiceSpeaker` as `export type`, and `VoiceFailureReason` / `RecordResult` / `VoiceSpeed` / `VoicePlayback` as `export type`.

### Commands and results
I ran the Checks and no checks one by one, per the lead's instruction; `pnpm gate` ran them all once.

```
$ pnpm gate
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (3.9s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (2.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Changed files: the four `apps/mobile/src/lib/voice-*.ts` files plus this task file — all inside the Allowed files. No test file sits next to `voice-native.ts`, so the gate's nearest-tests step selected the other tests directly in `apps/mobile/src/lib` (`auth-api.test.ts`, `auth.test.ts`, `session-token.test.ts`); they passed.

### Effect ratchet
No `// effect-plain:` marker was needed. `voice-recorder.ts` and `voice-playback.ts` import `effect` (kind `effect`); `voice-failure.ts` and the barrel are `plain` (no async / timer / Promise / storage / expo-import signals). The gate's `effect` step passed.

### Problems / open questions
None. Behaviour is unchanged and no importer was touched.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `voice-native.ts` (451 lines) is now a 33-line barrel, plus `voice-recorder` (272), `voice-playback` (125) and `voice-failure` (67).
- **The lead's line check:** the old file's non-import code lines against the new files'. They are identical, including the same-origin bearer block.
- **The lead's phone smoke** (mock, Ana's chat): a 2.5 s hold on the mic records a 0:02 note. It then fails with "Could not send", because the mock has no upload, as in the T-1012 smoke.
- **Check:** the gate passed.
