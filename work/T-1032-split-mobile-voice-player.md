---
id: T-1032
title: "Size split T109: apps/mobile/src/components/chat/voice-player.ts (423 lines) into chat/{voice-player-registry,voice-player-host}.ts"
status: todo
milestone: M5
branch: task/T-1032-split-mobile-voice-player
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1032: Split the mobile `voice-player.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-player.ts` is 423 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #105 (task T109): `components/chat/voice-player-registry.ts` and `chat/voice-player-host.ts`, under `apps/mobile/src/`. `voice-player.ts` re-exports every name it exports today.

Move the code unchanged, and skip the Dedup, because it reaches into `voice-message.tsx`.

The lead runs a phone smoke of a chat with a voice message in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #105, and `apps/mobile/src/components/chat/voice-player.ts`.

### Allowed files
`apps/mobile/src/components/chat/voice-player.ts`, `apps/mobile/src/components/chat/voice-player-registry.ts`, `apps/mobile/src/components/chat/voice-player-host.ts`, `work/T-1032-split-mobile-voice-player.md`.

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
