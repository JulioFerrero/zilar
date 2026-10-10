---
id: T-1030
title: "Size split T96: apps/mobile/src/lib/voice-native.ts (451 lines) into lib/{voice-recorder,voice-playback,voice-failure}.ts, the old path re-exports"
status: todo
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

## Review (written by Claude)
