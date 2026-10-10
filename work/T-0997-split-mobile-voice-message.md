---
id: T-0997
title: "Size split T51: apps/mobile/src/components/chat/voice-message.tsx (631 lines) into chat/{voice-playback-source,use-voice-transcribe,voice-message-bars}; one TranscriptToggle"
status: todo
milestone: M5
branch: task/T-0997-split-mobile-voice-message
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0997: Split the mobile voice message

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-message.tsx` is 631 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #47 (task T51): `components/chat/voice-playback-source.ts`, `chat/use-voice-transcribe.ts`, `chat/voice-message-bars.tsx`, under `apps/mobile/src/`. `voice-message.tsx` keeps the component and every export it has today.

The in-file Dedup is in scope: the two identical "Aa" transcript toggles become one `TranscriptToggle`.

The lead runs a phone smoke of a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #47, and `apps/mobile/src/components/chat/voice-message.tsx`.

### Allowed files
`apps/mobile/src/components/chat/voice-message.tsx`, `apps/mobile/src/components/chat/voice-playback-source.ts`, `apps/mobile/src/components/chat/use-voice-transcribe.ts`, `apps/mobile/src/components/chat/voice-message-bars.tsx`, `work/T-0997-split-mobile-voice-message.md`.

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
