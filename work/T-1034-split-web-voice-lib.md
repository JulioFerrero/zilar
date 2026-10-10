---
id: T-1034
title: "Size split T112: apps/web/src/lib/voice.ts (420 lines) into lib/voice/{recorder,convert,waveform,sample}.ts, voice.ts a re-export facade; one promiseOf"
status: todo
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

## Review (written by Claude)
