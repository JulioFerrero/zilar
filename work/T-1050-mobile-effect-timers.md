---
id: T-1050
title: "Dedup F8b: one mobile lib/effect/timers.ts (runLater, interruptFiber) for the message list, GIF panel and voice recorder"
status: todo
milestone: M5
branch: task/T-1050-mobile-effect-timers
model: auto
effort: default
depends_on: [T-1039]
estimate: 0.25 day
---

# T-1050: Mobile effect timers

## Spec (written by Claude, do not edit)

### Why
`docs/audit/size-plan.md` §4.1 F8 names a mobile `lib/effect/timers.ts` for the sleep-fiber copies. The lead read them (main, 2026-10-10):
- **`runLater(ms, run)`:** `Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(run))))`, at `apps/mobile/src/components/chat/use-stable-handlers.ts:8-9`. It is exported there and used by `message-list.tsx:224` and `use-message-list-scroll.ts:58,107`.
- **The same "interrupt this fiber" step in three places:**
  - `cancelWait` (`apps/mobile/src/components/chat/gif-panel.tsx:36-40`);
  - the body of `runUntilCleanup`'s returned function (`gif-panel.tsx:28-33`);
  - `stopTicker` (`apps/mobile/src/components/chat/voice-recorder-gesture.ts:21-27`), which also clears the ref first.

### What to build
1. **The new file:** create `apps/mobile/src/lib/effect/timers.ts`. The folder holds `api-client.ts`, `api-effect.ts`, `errors.ts`, `raw-request.ts`, `run-in-background.ts`, `runtime.ts`, `use-action.ts` and `use-query.ts`. It exports:
   - `runLater(ms, run): Fiber.Fiber<void>`, the exact body from `use-stable-handlers.ts:8-9`;
   - `interruptFiber(fiber: Fiber.Fiber<unknown, unknown> | undefined): void`, which runs `Effect.runFork(Fiber.interrupt(fiber))` when the fiber is defined.
2. **`use-stable-handlers.ts`:** drop its `runLater`. Update the two importers, `message-list.tsx:14` and `use-message-list-scroll.ts:7`, to import `runLater` from `@/lib/effect/timers`.
3. **`gif-panel.tsx`:** `cancelWait` and `runUntilCleanup`'s returned function call `interruptFiber`.
4. **`voice-recorder-gesture.ts`:** `stopTicker` keeps clearing `ref.current` first, then calls `interruptFiber(fiber)`. `startTicker` stays as it is.
5. **Out of scope:** `apps/mobile/src/components/chat/message-search.ts` keeps `defaultScheduler` as it is. Its `Effect`/`Fiber` import is what keeps that file passing the gate's effect step (T-1031 Report).
6. **Same behaviour:** every timer keeps its delay and its order of operations.

The lead runs a phone smoke in mock mode: scroll a chat, open the GIF tab, and hold the mic.

### Read first
`AGENTS.md`, and every file named above.

### Allowed files
`apps/mobile/src/lib/effect/timers.ts`, `apps/mobile/src/components/chat/use-stable-handlers.ts`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts`, `work/T-1050-mobile-effect-timers.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "Fiber.interrupt" apps/mobile/src/components/chat` no longer lists `gif-panel.tsx` or `voice-recorder-gesture.ts`.

---

## Report (written by the worker when done)

## Review (written by Claude)
