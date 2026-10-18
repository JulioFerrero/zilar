---
id: T-2022
title: "Chat perf W3b (phone): each message row uses one GestureDetector (a horizontal Pan for swipe-to-reply raced with the double-tap react) driving one shared value, instead of a ReanimatedSwipeable plus a separate Tap detector — same feel: swipe right past 60 px replies with a haptic, double tap reacts, long press opens the menu, vertical scroll never blocked"
status: merged
milestone: M5
branch: task/T-2022-phone-one-row-gesture
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2022: One gesture per message row (perf W3b)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: scrolling a chat on Android is janky.
- **The measurement.** On the emulator, with the 800-message mock chat (T-2017) and the audit's fling script, W1 and W2 reach older pages sooner but don't lower janky frames: about 84–87%, against 68–86% before. The cost is per row.
- **The audit's finding.** `docs/audit/chat-scroll-perf.md` (C3 and W3) found every row mounts a `ReanimatedSwipeable`, with its own animated views, left-actions renderer and pan, plus a second `GestureDetector` with a double-tap `Tap`.

W3a (T-2018, one menu per list) is merged. This task is W3b. The UI has no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18 at `7dc1c7aca`; paths under `apps/mobile/src/components/chat/`)
- **Swipe to reply.** `swipe-to-reply.tsx` (74 lines) wraps a row in `ReanimatedSwipeable` (`react-native-gesture-handler/ReanimatedSwipeable`):
  - `leftThreshold={REPLY_THRESHOLD}` (60), `overshootLeft={false}`;
  - `renderLeftActions` draws a `Reply` icon whose opacity and scale follow the swipe progress;
  - `onSwipeableWillOpen` fires a light haptic, and `onSwipeableOpen` closes the swipeable and calls `onReply()` for a right swipe.
- **Double tap.** `bubble-gesture.tsx` (62 lines) wraps the bubble in `GestureDetector` with `Gesture.Tap().numberOfTaps(2).enabled(canReact).runOnJS(true).onEnd(...)`. That reacts with `QUICK_REACTIONS[0]` and a light haptic. It is disabled for drafts, for sending or failed messages, and in select mode.
- **The bubble.** `message-bubble.tsx` (374 lines) uses `<BubbleGesture ... enabled={selecting !== true && !draft}>` around the bubble (`:220-287`) and `<SwipeToReply color=... enabled={selecting !== true} onReply=...>` around the row (`:305-...`).
- **Long press.** It opens the menu through the bubble's own `Pressable` `onLongPress` (T-2018), which isn't a gesture-handler gesture.

### Steps
1. **One detector.** Replace both wrappers with one component (keep the file name `swipe-to-reply.tsx`, or add `row-gesture.tsx`) that mounts **one** `GestureDetector` with `Gesture.Race(pan, doubleTap)`. If long-press needs it, use `Gesture.Exclusive`.
   - **The pan:**
     - `Gesture.Pan().activeOffsetX([12, 9999]).failOffsetY([-10, 10])`, so only a rightward horizontal drag activates, and vertical list scrolling fails it at once;
     - it drives one `useSharedValue` translateX, clamped to 0..96;
     - at release past 60 it fires the light haptic and calls `onReply` through `runOnJS`; it always springs back to 0.
   - **The reply icon:** drawn with `useAnimatedStyle` from the same shared value, with opacity and scale like today's `ReplyAction`. Mount it only while translateX > 0 if that is simple; otherwise keep one absolutely positioned icon.
   - **The double tap:** keeps today's rules exactly.
2. **The bubble.** It uses the new component once, with the same `enabled` rules as today (swipe off in select mode; double tap off for drafts and in select mode). Delete `bubble-gesture.tsx` if nothing else imports it.
3. **Size.** `message-bubble.tsx` must not grow. Every file stays at or under 400 lines.
4. **Keep behaviour:**
   - swipe right past about 60 px replies with a haptic, and a short swipe springs back with no reply;
   - double tap toggles 👍 with a haptic;
   - long press opens the menu, on photo tiles too;
   - a fast vertical fling scrolls the list and never starts a swipe;
   - nothing reacts in select mode, where a tap toggles selection as today.

   No tests (UI).

### Allowed files
- `apps/mobile/src/components/chat/swipe-to-reply.tsx`
- `apps/mobile/src/components/chat/row-gesture.tsx`
- `apps/mobile/src/components/chat/bubble-gesture.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `work/T-2022-phone-one-row-gesture.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead emulator mock smoke** (`/chat/viernes@rooms.zilar.test`):
  - swipe a bubble right, and the reply bar shows;
  - double tap shows 👍;
  - long press opens the menu;
  - 10 fast vertical flings scroll with no swipe;
  - the janky-frames comparison runs against the W3a build.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/row-gesture.tsx` (`RowGesture`): the
  row-level swipe-to-reply, replacing the per-row `ReanimatedSwipeable`.
  - One `Pan` uses `activeOffsetX([12, 9999])` and `failOffsetY([-10, 10])`,
    drives one `useSharedValue` clamped to 0..96, fires a Light haptic and calls
    `onReply` through `runOnJS` on a successful release at or past 60 px, and
    always springs back to 0 (the old swipeable's stiff spring).
  - The reply arrow is one absolutely positioned `Reply` icon; its opacity and
    scale are driven by the same shared value (`translateX / 60`, clamped).
  - The pan keeps its identity across renders through a stable-callback hook
    (the `useStableIndexChange` pattern in `folder-pager.tsx`), so it no longer
    depends on the message.
- `message-bubble.tsx`: replaced `SwipeToReply` with `RowGesture` around the row
  (`swipeEnabled={selecting !== true}`) and kept `BubbleGesture` around the
  bubble (`enabled={selecting !== true && !draft}`), as before. The file stays
  at 374 lines; the long press still comes from the bubble's own `Pressable`.
- Deleted `swipe-to-reply.tsx` (its only importer was `message-bubble.tsx`).

### Lead fix round (after the emulator smoke)

- Pre-review finding 1: the double tap goes back to a `GestureDetector` around
  the bubble only, in a restored `bubble-gesture.tsx`; the row keeps its pan.
  The two are two light detectors per row (the shape restored in round 3).
- A swipe that starts on the bubble still replies: `RowGesture` publishes its
  pan through `RowPanContext`, and `BubbleGesture` calls
  `simultaneousWithExternalGesture(rowPan)` on the tap (or leaves it standalone
  when the bubble is used outside a row).
- Double-tapping an avatar or a reaction chip no longer adds 👍: those are
  outside the bubble's detector again (restored in round 3 below).
- Finding 2 is gone with `Gesture.Race`: the pan is memoised independently of
  `message`, so "keeps its identity across renders" is now true; the tap still
  follows `message` and `onReact` like the old `BubbleGesture`.
- Deleted `PREREVIEW.md`.

### Checks run

- `pnpm install` — completed (already up to date).
- `pnpm gate` (from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (1.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did not run an individual test file: the change is UI only, and the gate's
  `tests @zilar/mobile` step is the nearest suite (`dm-chat-id.test.ts` is the
  only test in `components/chat/`).
- I also ran `prettier --check` and `oxlint` on the three changed chat files
  while iterating (both clean); the final gate above is the authoritative run.

### Round 2 (fixing PREREVIEW findings)

- **Finding 1 (must-fix).** `row-gesture.tsx` uses `.activeOffsetX(12)`. The
  single value sets only the activation distance, so the pan activates after a
  12 px rightward drag and not at rest. This deviates from the spec snippet's
  `[12, 9999]`, which the finding showed sets a start threshold and activates
  on any touch.
- **Finding 2 (should-fix).** Back to one detector per row:
  `row-gesture.tsx` mounts `Gesture.Race(pan, doubleTap)` and
  `message-bubble.tsx` wraps the row in `RowGesture` with `swipeEnabled` and
  `reactEnabled`; `bubble-gesture.tsx` is deleted again. Consequence, as the
  finding noted: the double tap is row-wide, so a double tap on an avatar or a
  reaction chip adds 👍. The bubble's own `Pressable` long press is unchanged.
  **Overruled in round 3** after the lead's emulator check (see below).
- **Tests added:** none. This is UI-only (the spec and AGENTS.md say no UI
  tests), the findings name no test, and the Allowed files list has no test
  file.
- `pnpm gate` from the repo root after both fixes:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (10.5s)
  PASS  format  (5.3s)
  PASS  lint  (3.6s)
  PASS  typecheck  (1.8s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/mobile  (4.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did not run a separate test file: the nearest mobile suite
  (`dm-chat-id.test.ts`) is unrelated to gestures and the gate already ran it.

### Round 3 (lead decision)

- The lead overruled finding 2 after an emulator check: double-tapping the ❤️
  reaction chip toggled it twice and also added 👍. Restored the earlier
  scoping: the double tap is its own `GestureDetector` around the bubble only
  (`bubble-gesture.tsx`, linked to the row pan with
  `simultaneousWithExternalGesture`), the row keeps only the horizontal pan,
  finding 1's `.activeOffsetX(12)` stays, and `PREREVIEW.md` is deleted.
- `pnpm gate` from the repo root:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The lead's emulator check on round 2 found the row-wide double tap added 👍
  when double-tapping the ❤️ reaction chip. Round 3 restores the bubble-scoped
  tap, so a double tap on a chip or the avatar adds nothing while a swipe that
  starts on the bubble still replies.
- The swipe area is still the whole row, as with the old `SwipeToReply`; the
  double tap remains bubble-scoped. Reaction chips, the avatar and the handoff
  line are outside the tap detector.
- The reply icon is always mounted with opacity 0 at rest (the spec allowed
  either); mounting it only while swiping would need a React state toggle
  mid-gesture, which I judged worse for the row cost this task targets.
- `voice-recorder.tsx:160` still mentions `swipe-to-reply.tsx` as a haptic-style
  example. That file is outside my Allowed files, so I left the comment alone;
  it points at code that now lives in `row-gesture.tsx`.
- No tests were added (UI, per the task and AGENTS.md).


## Review (written by Claude)

Approved after two lead emulator rounds.
- **What changed.**
  - Each row's `ReanimatedSwipeable` became one light row `Pan`. It activates only on a rightward drag, and one shared value drives the reply icon.
  - The double tap lives on its own detector around the bubble only.
  - The lead overruled pre-review finding 2 ("one detector per row"): with the tap on the row, double-tapping a reaction chip also added 👍.
- **Lead emulator check** (mock release build at `b6e5f7db0`, Ana's chat):
  - double-tapping the ❤️ chip leaves ❤️ 2 and 👍 1 unchanged;
  - double tap on a bubble adds 👍;
  - a swipe that starts on the bubble shows "Reply to Ana";
  - long-press opens the menu;
  - no crash.
- **Jank.** A first W3a against W3b comparison showed no clear frame gain, and readings are noisy under load. The win is fewer native views per row.
