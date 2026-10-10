---
id: T-1012
title: "Size split T93: apps/mobile/src/components/chat/voice-recorder.tsx (470 lines) into chat/{voice-recorder-flow,voice-recorder-gesture}; one VoiceRecorderPort import"
status: todo
milestone: M5
branch: task/T-1012-split-mobile-voice-recorder
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1012: Split the mobile voice recorder

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-recorder.tsx` is 470 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #89 (task T93): `components/chat/voice-recorder-flow.ts` and `chat/voice-recorder-gesture.ts`, under `apps/mobile/src/`. `voice-recorder.tsx` keeps the component and every export it has today.

- **In scope:** the in-file part of the Dedup. The two `VoiceRecorderPort` imports fold into one.
- **Out of scope:** the `lib/effect/timers.ts` item, because it crosses files.
- **Same behaviour:** the hold-to-record gesture (press, slide to cancel, lock) keeps its thresholds exactly.

The lead runs a phone smoke of a chat's composer in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #89, and `apps/mobile/src/components/chat/voice-recorder.tsx`.

### Allowed files
`apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-flow.ts`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts`, `work/T-1012-split-mobile-voice-recorder.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
