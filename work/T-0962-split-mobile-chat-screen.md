---
id: T-0962
title: "Size split T15: apps/mobile/src/app/chat/[id].tsx (1,118 lines) into components/chat/{use-chat-screen,chat-header-bar,chat-thread,chat-composer-dock,chat-overlays,topic-info-host} + lib/effect/run-in-background.ts"
status: todo
milestone: M5
branch: task/T-0962-split-mobile-chat-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0962: Split the mobile chat screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/chat/[id].tsx` is 1,118 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #11 (task T15). The new files:
- `lib/effect/run-in-background.ts`;
- `components/chat/use-chat-screen.ts`;
- `components/chat/chat-header-bar.tsx`, `components/chat/chat-thread.tsx`, `components/chat/chat-composer-dock.tsx`, `components/chat/chat-overlays.tsx`, `components/chat/topic-info-host.tsx`;

all under `apps/mobile/src/`.

The route file `app/chat/[id].tsx` stays the screen: Expo Router needs its default export there. The entry's in-file Dedup applies: the `MessageList` and `DismissBanner` stack repeated at about 728–769 and 949–990 becomes one `chat-thread.tsx`.

There are no mobile UI tests (Julio's rule). The lead runs a phone smoke of the chat screen.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #11, and `apps/mobile/src/app/chat/[id].tsx`.

### Allowed files
`apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/lib/effect/run-in-background.ts`, `apps/mobile/src/components/chat/use-chat-screen.ts`, `apps/mobile/src/components/chat/chat-header-bar.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/chat-composer-dock.tsx`, `apps/mobile/src/components/chat/chat-overlays.tsx`, `apps/mobile/src/components/chat/topic-info-host.tsx`, `work/T-0962-split-mobile-chat-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's phone smoke passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
