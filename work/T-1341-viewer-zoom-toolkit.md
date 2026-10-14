---
id: T-1341
title: "Mobile photo viewer on a library: replace the hand-rolled pager with react-native-zoom-toolkit's Gallery (swipe carousel, pinch, pan, double-tap, pull-down to close), keeping the counter, Save and Close"
status: merged
milestone: M5
branch: task/T-1341-viewer-zoom-toolkit
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1341: Viewer on react-native-zoom-toolkit

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, after two hand-rolled attempts (T-1338) failed on his Android phone: "it's not working, what are you using? can it be with a library or something, even native". The lead picked **`react-native-zoom-toolkit`**:
- latest 5.1.1, published 2026-08-30;
- built on `react-native-gesture-handler` and `react-native-reanimated`, which the app already has (`apps/mobile/package.json:63-64`: RNGH ~2.32.0, reanimated 4.5.1);
- its **`Gallery`** component gives a native-feeling swipe carousel with per-item pinch, pan and double-tap zoom, and vertical-swipe callbacks.

**Check its README/peer docs for reanimated 4 and Expo SDK compatibility before coding, and say what you found.** If it isn't compatible, stop and report (status `blocked`); don't hand-roll again.

The current viewer, to replace:
- `apps/mobile/src/components/chat/image-viewer.tsx` (`AttachmentViewer`, 144 lines; RN `Modal` + `GestureHandlerRootView`; the "3 / 12" counter, Save, Close);
- `apps/mobile/src/components/chat/photo-pager.tsx` (the hand-rolled gestures, T-1256).

It's opened from `media-bubble.tsx` and `attachment-body.tsx` with `photos` and a `startIndex` (`ViewerPhoto[]` from `packages/chat-core/src/photos.ts`). T-1338 is dropped; start from `main`.

### What to build
1. **Add `react-native-zoom-toolkit`:**
   - pin exactly 5.1.1 (or the newest version at least two weeks old) in `apps/mobile/package.json`, then run `pnpm install`;
   - follow its setup notes (e.g. wrap in `GestureHandlerRootView`, which the modal already has).
2. **Rewrite `AttachmentViewer` with `Gallery`:**
   - `data` = the photos;
   - `initialIndex` = `startIndex`;
   - `renderItem` = an `expo-image` (or RN `Image`) at the photo's size with `contentFit="contain"`, using the same `source` resolution as today (trusted hosts only; a blank source for an untrusted photo, as now);
   - `onIndexChange` updates the counter and Save;
   - `onVerticalPull` / its equivalent closes on pull-down, Telegram-style;
   - `onTap` toggles the top bar.
   - Keep Save and Close and the counter overlay.
3. **Delete `photo-pager.tsx`** and anything only it used.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, the library's README (in its package folder after `pnpm install`), `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/photo-pager.tsx`, `apps/mobile/src/components/chat/media-bubble.tsx`, `packages/chat-core/src/photos.ts`.

### Allowed files
`apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/photo-pager.tsx`, `apps/mobile/src/components/chat/photo-gallery.tsx`, `apps/mobile/src/components/chat/media-bubble.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/attachment-message.tsx`, `work/T-1341-viewer-zoom-toolkit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** an Android release build compiles.
- **Julio's check on his phone:**
  - the swipe carousel (the neighbour slides in);
  - pinch, drag when zoomed, double tap;
  - pull down to close.

---

## Report (written by the worker when done)

### What I did

Replaced the hand-rolled pager with `react-native-zoom-toolkit`'s `Gallery`.

- Pinned `react-native-zoom-toolkit: 5.1.1` in `apps/mobile/package.json` (the newest
  published version; 5.1.1 was published 2026-08-30, over two weeks before today),
  then ran `pnpm install`.
- Rewrote `AttachmentViewer` in `apps/mobile/src/components/chat/image-viewer.tsx`:
  - `data` = the chat's `ViewerPhoto[]`, `initialIndex` = `startIndex`,
    `keyExtractor` = `messageId`;
  - `renderItem` renders a `ViewerImage` per item: an `expo-image` at the screen size
    with `contentFit="contain"`, resolving the same trusted-host source as before
    (`viewableUrl` + `useMediaSource`; an untrusted/non-http(s) photo stays blank and
    its bytes are never fetched);
  - `onIndexChange` updates the counter and the current Save target;
  - `onVerticalPull` (a worklet over a `ViewerMotion` object, written through it so it
    satisfies the repo's `react(immutability)` lint rule) closes on pull-down past
    120 px or a fast downward flick, and fades the backdrop with the pull, Telegram-style;
  - `onTap` toggles the counter/Save/Close overlay;
  - kept Save (same `savePhoto` seam and fixed messages), Close and the "3 / 12" counter.
- Deleted `apps/mobile/src/components/chat/photo-pager.tsx`. Nothing else imported or
  used it (`attachment-message.tsx` re-exports `AttachmentViewer` from `image-viewer.tsx`;
  `media-bubble.tsx` and `attachment-body.tsx` pass the same props, so they were left
  unchanged).
- `image-viewer.tsx` is 259 lines (limit 400). No tests (UI).

### Library compatibility check (spec asked for this)

- Installed 5.1.1 (latest; also the newest version at least two weeks old). Its own
  `package.json` (`main` branch == 5.1.1) is developed against `react-native` 0.83.6,
  `react-native-reanimated` ~4.1.1, `react-native-worklets` 0.5.1 and
  `react-native-gesture-handler` ~2.28.0, i.e. a Reanimated 4 / new-architecture stack.
  This app has RN 0.86.3, reanimated 4.5.1, worklets 0.10.1 and RNGH ~2.32.0 — newer
  versions of the same majors, and the library declares only `react`/`react-native` as
  peers.
- Every symbol it imports from reanimated (`clamp`, `interpolate`, `Extrapolation`,
  `withTiming`, `withDecay`, `useSharedValue`, `useAnimatedStyle`, `useAnimatedReaction`,
  `useDerivedValue`, `cancelAnimation`, `SharedValue`, …) still exists in reanimated
  4.5.1, and `scheduleOnRN` exists in worklets 0.10.1. Expo is supported by design
  (TypeScript-only, no native modules).
- Note: the docs site's installation table says RN `>= 0.81` needs toolkit `>= 6.0.0`,
  but no 6.x is published (npm `latest` = 5.1.1) and 5.1.1 itself is built on RN 0.83.
  I read that table as documenting unreleased `main`. Conclusion: 5.1.1 is the correct
  choice and is Reanimated 4 / Expo compatible. I could not run an Android build here,
  so the lead's release-build check is still the real proof (this is the spec's caveat,
  not a claim I tested).

### Files changed (all inside Allowed files)

- `apps/mobile/package.json` — added `"react-native-zoom-toolkit": "5.1.1"`.
- `pnpm-lock.yaml` — the new package (install).
- `apps/mobile/src/components/chat/image-viewer.tsx` — rewritten on `Gallery`.
- `apps/mobile/src/components/chat/photo-pager.tsx` — deleted.
- `work/T-1341-viewer-zoom-toolkit.md` — status + this Report.

### Commands run (real results)

- `pnpm install` (twice): completed, added the package; the only warning is the
  pre-existing `@types/react-dom` peer warning for `@types/react`.
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- The first `pnpm gate` run failed lint on two `react(immutability)` errors from writing
  `useSharedValue(...).value` directly in the component; I moved those writes into a
  module-level worklet that takes the shared values through a plain object (the
  `folder-pager.tsx` pattern) and re-ran the gate, which then passed.
- I did not run any single test file: this change is UI-only and the mobile package's
  nearest tests are run by the gate (`PASS tests @zilar/mobile`). I ran `pnpm gate` once
  after the fix, as AGENTS.md asks.

### Problems / deviations / open questions

- No deviation from the spec. I kept the overlay and Save/Close/counter, and used
  `onVerticalPull` for the Telegram-style pull-down. I could not test the gestures on a
  device (spec says UI gets no tests); Julio's phone check covers carousel, pinch/pan/
  double-tap and pull-down.
- `key={index}` is gone: `PhotoPager` was remounted per step; `Gallery` owns its items,
  so `ViewerImage` remounts are driven by `recyclingKey`/`messageId` instead.
- `tapOnEdgeToItem` is left at the library default (`true`): a centre tap toggles the
  overlay via `onTap`, an edge tap steps to the neighbour. Say the word if you want only
  `onTap`.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `811a1e50`.**
- **Julio's check:** he tested build `811a1e50` on his Android phone and said "omg perfect" (carousel swipe, pinch, pan, double tap, pull to close).
- **The nit:** edge-tap stepping (`tapOnEdgeToItem`, the library default) is kept.
- **Superseded:** T-1338 is replaced by this task and stays blocked (unmerged).
