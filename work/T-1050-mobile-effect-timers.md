---
id: T-1050
title: "Dedup F8b: one mobile lib/effect/timers.ts (runLater, interruptFiber) for the message list, GIF panel and voice recorder"
status: merged
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

Done, ready for review.

### What I did
- Created `apps/mobile/src/lib/effect/timers.ts`:
  - `runLater(ms, run)` — the body moved verbatim from `use-stable-handlers.ts:8-9`, still returning the forked fiber.
  - `interruptFiber(fiber)` — forks `Fiber.interrupt(fiber)` only when the fiber is defined, replacing the three hand-written copies.
- `use-stable-handlers.ts`: removed `runLater` and its now-unused `Effect`/`Fiber` import (the file uses React only now).
- `message-list.tsx` and `use-message-list-scroll.ts`: import `runLater` from `@/lib/effect/timers` instead of `use-stable-handlers`.
- `gif-panel.tsx`: `runUntilCleanup`'s returned cleanup and `cancelWait` call `interruptFiber`. `cancelWait` is kept as a one-line wrapper per spec item 3; `Fiber` stays imported for the `debounceWait` ref type.
- `voice-recorder-gesture.ts`: `stopTicker` still clears `ref.current` first, then calls `interruptFiber`; `startTicker` unchanged.
- `message-search.ts` untouched (out of scope).
- Behaviour is unchanged: same delays and same order of operations.

### Files changed
- `apps/mobile/src/lib/effect/timers.ts` (new)
- `apps/mobile/src/components/chat/use-stable-handlers.ts`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/voice-recorder-gesture.ts`
- `work/T-1050-mobile-effect-timers.md`

### Commands and results
- `pnpm install`: done in 15s. Warning (pre-existing): `@types/react-dom` unmet peer `@types/react@^19.3.0` (found 19.2.18).
- `grep -rn "Fiber.interrupt" apps/mobile/src/components/chat`: no longer lists `gif-panel.tsx` or `voice-recorder-gesture.ts` (acceptance met; other files still have their own uses, by design).
- `pnpm gate`:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.3s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate's typecheck step is `turbo run typecheck --affected` (mobile is affected and has a `typecheck` script), so it covers the task's `pnpm --filter @zilar/mobile typecheck` check; per the working instructions I did not also run that command on its own.
- Single tests: none run. No test file is named after or imports any changed module, and `pnpm gate` reported "no nearby test files" for `@zilar/mobile` (the changing code is UI wiring, which per AGENTS.md gets no tests).

### Deviations / notes
- `cancelWait` in `gif-panel.tsx` remains a one-line forwarder to `interruptFiber` (spec item 3 names `cancelWait` as a caller of `interruptFiber`).
- `use-message-list-scroll.ts` keeps `Effect.runSync(Fiber.interrupt(timer))` in its two cleanups; the spec only asked to change the `runLater` import there, and the acceptance still allows those lines.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** a new `apps/mobile/src/lib/effect/timers.ts` holds two helpers.
  - `runLater` is the exact body moved from `use-stable-handlers.ts`.
  - `interruptFiber` runs `Effect.runFork(Fiber.interrupt(fiber))` when the fiber is defined.
  - `gif-panel.tsx` (`cancelWait`, `runUntilCleanup`) and `voice-recorder-gesture.ts` (`stopTicker`, which still clears the ref first) call `interruptFiber`, and `message-list.tsx` and `use-message-list-scroll.ts` import `runLater` from it.
- **Same behaviour:** the lead read the diff. Each replaced line is the same `Effect.runFork(Fiber.interrupt(...))` call.
- **The lead's phone smoke** (mock, Ana's chat):
  - two swipes up load the October 7 history;
  - a typed GIF search shows the six cells;
  - a 2.5 s mic hold records a note. It reads "Not sent" on this branch only because T-1047's uploader was not in it.
- **Possible follow-up:** about 9 other `Effect.runFork(Fiber.interrupt(...))` sites under `components/chat` could use `interruptFiber`. The `runSync` ones differ and stay.
- **Check:** the gate passed.
