---
id: T-1915
title: "Smooth app P5 (phone): the splash stays up until the cached chat list and cached messages have been read (capped at 400 ms after fonts), so a cold start — including a notification tap into a chat — shows real content in the first frame instead of a skeleton that swaps"
status: merged
milestone: M5
branch: task/T-1915-splash-waits-cache
model: auto
effort: default
depends_on: [T-1914]
estimate: 35 min
---

# T-1915: Cold start paints real content in the first frame

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §4 P5.** On a cold start, the splash hides as soon as the primary font is ready. The cached chat list and the cached messages are read **after** that, from files (async). So the first frames of a chat opened from a notification are a whole-screen skeleton (`apps/mobile/src/app/chat/[id].tsx:33-42`, shown while `!chat && chatsLoad === 'loading'`), which then swaps for the real header and thread.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/app/_layout.tsx`** (173 lines):
  - `SplashScreen.preventAutoHideAsync()` at `:50`;
  - the splash hides in an effect when `fontsReady` (`:138-143`). `fontsReady = primaryLoaded || primaryError !== null || fontCapReached` (`:121`), with a cap timer of `FONT_READY_CAP_MS`.
- **`apps/mobile/src/store/effects/lifecycle.ts:149-163`, `prepareStart`:** when the store has no chats it:
  - sets `chatsLoad: 'loading'`;
  - starts `void readChatListCache().then(...)` (`:155`), which paints `chats` and `chatsLoad: 'loaded'`;
  - calls `hydrateOfflineCache()` (`:162`, defined at `:107`), a fire-and-forget async that reads the session user id and the offline file, then seeds `messagesByChat` and the cached pins (T-1914).

### Steps
1. **New `apps/mobile/src/lib/startup-paint.ts`** (small, with a doc comment):
   - `markCachePainted(): void` resolves a module-level promise once;
   - `waitForCachePaint(capMs: number): Promise<void>` resolves when it is marked, or after `capMs`, whichever comes first.
2. **`lifecycle.ts`:**
   - `hydrateOfflineCache` returns its promise;
   - `prepareStart` waits for both `readChatListCache()` (and its paint) and the hydrate with `Promise.allSettled`, then calls `markCachePainted()`;
   - when the store already has chats (a non-cold start), call `markCachePainted()` at once.
3. **`_layout.tsx`:** hide the splash when `fontsReady` **and** `waitForCachePaint(400)` has resolved. Start the wait in the effect, and on unmount ignore it. A signed-out start never marks, so the 400 ms cap bounds it. Keep the existing startup mark (`markStartup('fonts-ready')`).
4. **No tests** (UI timing). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/startup-paint.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/app/_layout.tsx`
- `work/T-1915-splash-waits-cache.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A cold start of a signed-in app, straight into a cached chat,** shows the real header and messages in the first frame after the splash, with no skeleton swap.
- **The splash never waits more than 400 ms** past the fonts.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/lib/startup-paint.ts`: a module-level promise, `markCachePainted()` (first call wins) and `waitForCachePaint(capMs)` (resolves on the mark or the cap timer, and clears the timer when the mark wins). It carries an `// effect-plain:` marker: the gate's Effect ratchet rejects a new file with a plain promise and timer, and this gate has no I/O or ports and must be callable from a React effect outside the runtime.
- `apps/mobile/src/store/effects/lifecycle.ts`: `hydrateOfflineCache` is now an `async` function that returns its promise (the fire-and-forget IIFE is gone). `prepareStart` keeps the cached-list paint in a `paintChatList` promise, `Promise.allSettled` waits for it and for the hydrate, then calls `markCachePainted()`. When the store already has chats (non-cold start) it marks at once. The `allSettled` also removes the old unhandled-rejection path when the chat-list cache read fails.
- `apps/mobile/src/app/_layout.tsx`: added `CACHE_PAINT_CAP_MS = 400`. The splash effect now runs only when `fontsReady`, keeps `markStartup('fonts-ready')`, starts `waitForCachePaint(400)` and hides the splash when it resolves, guarded by a `cancelled` flag so an unmount ignores the result. A start that never marks (signed out) still hides at the 400 ms cap.
- No tests were added, per the spec (UI timing).

### Checks run
- `pnpm install --prefer-offline`: Done in 12.6s.
- `pnpm gate` (first run): FAIL on `effect` — `apps/mobile/src/lib/startup-paint.ts needs Effect (H1, H3)`. Fixed with the `// effect-plain:` marker; all other checks were already PASS.
- `pnpm gate` (final run, after the commit), from the repo root:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (4.0s)
  PASS  format  (1.5s)
  PASS  lint  (1.3s)
  PASS  typecheck  (1.3s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the task has no test and the change is UI timing. The gate's `tests @zilar/mobile` PASS covers the package.

### Notes for the lead
- The first-frame result is not measured on a device. I verified by reading the code that the splash now stays up until `prepareStart`'s cached list + hydrate settle (or 400 ms), and that a signed-out start is bounded by the cap.
- The wait starts at `fonts-ready`, as specified. The store starts inside `ChatStoreProvider` once the session is `authenticated`, and `SessionBootstrap` also begins then, so on a slow session restore the paint can land after the 400 ms cap; that is the spec's bound, not a new delay.
- `markCachePainted` is a one-way module flag: after the first launch it stays marked, so later store restarts in the same JS runtime never wait again (the splash is already gone).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `afabb3cc8`.
- **The change:**
  - `startup-paint.ts` holds a one-shot mark with a capped wait;
  - `prepareStart` marks after `allSettled([list paint, hydrate])`, or at once on a non-cold start;
  - the root layout hides the splash after fonts **and** that wait (400 ms cap);
  - the hydrate is now awaitable, with the same behaviour, and a failure no longer goes unhandled.
- **Emulator** (mock, force-stop then cold start `zilar://chat/ana%40zilar.test`): the splash hides and the app works.

  Mock mode has no offline cache, so the thread fills from the mock history a few seconds in, the same as before. The real first-frame gain shows only on the live build, with a cached chat.
