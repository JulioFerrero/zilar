---
id: T-1937
title: "Web: the composer floats over the message list, so messages scroll under it (no solid band)"
status: merged
milestone: M5
branch: task/T-1937-web-floating-composer
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1937: Floating web composer

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, with a screenshot of the web chat: "the input bar at the bottom is not really floating like the elements dont go under it there is a hard background under".

The composer is a flex row under the message list. It paints its own `chat-background` (`Composer.tsx:301`) without the chat's background style, which the list does apply. So the messages stop at a hard edge above a separate band. The pill should float over the list, with messages visible as they scroll under and around it, as in Telegram.

### Facts (read by the lead on 2026-10-18)
- **`apps/web/src/routes/ChatView.tsx`** (377 lines):
  - `<MessageList …/>` (`:278`), then one of three bottom bars:
    - `<SelectionBar>` (`:287`);
    - `<ChannelComposerBar>` (`:294`);
    - a zero-height `relative z-10 h-0` block holding `<AiStatusLine>` (`:297-300`), followed by `<Composer>` (`:302-307`).
  - All of these sit in the column `flex h-full min-h-0 flex-col` (`:240`).
- **`apps/web/src/components/MessageList.tsx`** (248 lines):
  - the root is `relative min-h-0 flex-1` (`:193`);
  - the scroller is `chat-background scrollbar-thin h-full overflow-y-auto` with `style={backgroundStyle}` (`:199-200`);
  - the content padding is `pt-4 pb-14 wide:pt-6 wide:pb-14` for topics and `py-4 wide:py-6` otherwise (`:205`);
  - the jump button is `absolute right-4 bottom-4` (`:240`).
- **The bar wrappers** each use `chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5`: `Composer.tsx:301`, `ChannelComposerBar.tsx:52` and `SelectionBar.tsx:99`.
- **`apps/web/src/components/useMessageListScroll.ts:160-165`:** a `ResizeObserver` on the content keeps a pinned list at the bottom. It observes the default content box, so a padding change alone does not fire it.
- **`StickerPanel`** is `fixed right-4 bottom-24` (`StickerPanel.tsx:255`) and is not affected.

### Steps
1. **New `apps/web/src/components/ComposerDock.tsx`** (about 40 lines):
   - It renders `<div ref className="pointer-events-none absolute inset-x-0 bottom-0 z-10">{children}</div>`.
   - A `ResizeObserver` on that div sets `--composer-h` (its `offsetHeight` in px) on `ref.current.parentElement`.
   - Set it once on mount as well, and clear it on unmount.
2. **`ChatView.tsx`:**
   - Wrap the `MessageList` and the bottom-bar branch in `<div className="relative flex min-h-0 flex-1 flex-col">`.
   - Put the bar branch (SelectionBar, ChannelComposerBar, or the AiStatusLine block plus Composer, unchanged) inside `<ComposerDock>`.
   - The file must stay at 400 lines or fewer.
3. **The three bar wrappers** (`Composer.tsx:301`, `ChannelComposerBar.tsx:52`, `SelectionBar.tsx:99`):
   - Drop `chat-background` and `shrink-0`.
   - Add `pointer-events-none *:pointer-events-auto`, so clicks in the transparent gaps reach the messages underneath while the pill, reply preview and strips stay clickable.
   - Keep the padding.
   - If the composer pill (`ComposerControls`) or the reply preview has no background of its own, give it `bg-panel`, so text under it doesn't show through.
4. **`MessageList.tsx`:**
   - Content bottom padding: topics use `pb-[calc(var(--composer-h,0px)+3.5rem)]`; others use `pb-[calc(var(--composer-h,0px)+1rem)] wide:pb-[calc(var(--composer-h,0px)+1.5rem)]`. Keep the top padding as it is.
   - Jump button: `bottom-[calc(var(--composer-h,0px)+1rem)]`.
5. **`useMessageListScroll.ts:164`:** observe the content with `{ box: 'border-box' }`, so the list stays at the bottom when the composer grows (a reply, a multi-line draft, attachments).
6. **No tests** (UI).

### Allowed files
- `apps/web/src/components/ComposerDock.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/ChannelComposerBar.tsx`
- `apps/web/src/components/SelectionBar.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/useMessageListScroll.ts`
- `work/T-1937-web-floating-composer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The band is gone:** in a chat with a custom background, the background runs all the way to the bottom edge. Messages scroll under the composer and show around and below the pill.
- **Nothing is hidden at the bottom:** the newest message sits fully above the composer, and the jump-to-bottom button sits above it too.
- **Pinning holds:** opening a reply or typing three lines keeps the list pinned to the bottom.
- The selection bar and the channel bar float the same way.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **New `apps/web/src/components/ComposerDock.tsx`**: an absolutely positioned, `pointer-events-none`
  dock (`absolute inset-x-0 bottom-0 z-10`) that renders the bottom bar over the message list.
  A `ResizeObserver` publishes its `offsetHeight` as `--composer-h` on its parent (the new
  relative column in `ChatView`), sets it once on mount, and removes the property on unmount.
- **`ChatView.tsx`**: wrapped `MessageList` and the bottom-bar branch in
  `<div className="relative flex min-h-0 flex-1 flex-col">`; the branch (SelectionBar,
  ChannelComposerBar, or the AiStatusLine block plus Composer, unchanged apart from the point
  below) now lives inside `<ComposerDock>`. The file is 380 lines.
- **`Composer.tsx`, `ChannelComposerBar.tsx`, `SelectionBar.tsx`**: dropped `chat-background` and
  `shrink-0`, added `pointer-events-none *:pointer-events-auto`, kept the padding, so the chat
  background shows through the gaps and clicks in them reach the messages.
  No `bg-panel` was needed: the composer pill and the reply preview both use `Well`
  (`well-surface`, a solid `var(--well)` background), and the channel/selection bars use
  `bg-surface-raised`.
- **`MessageList.tsx`**: content bottom padding is now
  `pb-[calc(var(--composer-h,0px)+3.5rem)]` for topics and
  `pb-[calc(var(--composer-h,0px)+1rem)] wide:pb-[calc(var(--composer-h,0px)+1.5rem)]` otherwise
  (top padding unchanged); the jump-to-bottom button is
  `bottom-[calc(var(--composer-h,0px)+1rem)]`.
- **`useMessageListScroll.ts`**: the content `ResizeObserver` now observes
  `{ box: 'border-box' }`, so the bottom padding growing with the composer (reply, multi-line
  draft, attachments) fires it and the pinned list stays at the bottom.
- **No tests**: UI-only change, as the spec says.

### Checks run

- `pnpm install --prefer-offline` (from the repo root, before starting):
  `Done in 14.2s using pnpm v10.32.1`.
- Single test files: none — no test file imports `MessageList` or `ChatView`, and the gate
  reports `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm gate` (from the repo root):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **One small deviation from "unchanged"**: the AiStatusLine row inside the dock is now
  `pointer-events-none … *:pointer-events-auto`. Without it the dock's `pointer-events-none`
  would be inherited by the status pill and its "waiting AI" question button would stop
  receiving clicks. Only the pill itself becomes clickable; the gaps around it still pass
  clicks to the message list.
- The AI status pill floats just above the dock (`h-0` block, `bottom-1.5`), so it is not part
  of `--composer-h`. That is how the spec measures it; the pill paints its own
  `bg-surface-raised/95` background, so messages scrolling under it stay readable.
- I did not run the app: no dev server or other background process was started, per the rules.
  The visual acceptance (band gone, messages under the pill, pinning on reply/three lines,
  selection and channel bars) still needs Julio's or your live smoke.
- **Fix round (pre-review nits 1 and 2):** `ComposerDock` now publishes `--composer-h` from
  `useLayoutEffect`, before the first paint, so opening a chat no longer shows one unpadded
  frame. The voice, attachment and action error lines are now solid `bg-panel` chips
  (`mb-1 w-fit self-start rounded-[8px] px-2 py-1 text-[12px] text-danger`); `w-fit` was added
  because their parent is a block, so `self-start` alone would leave the chip full width.

## Review (written by Claude)

Merged on 2026-10-18 at HEAD `b6b453992`.
- **Web mock** (vite on the branch), in the Dev team › General chat:
  - `--composer-h` is set (86px), and the chat background runs to the bottom edge;
  - messages scroll under the floating pill and show below it;
  - the jump button sits above the composer;
  - at the bottom, the newest message ("Tests pass. Merge?") ends at y=724, above the input at y=801.
- **Fix round:** both pre-review nits.
  - `ComposerDock` sets the height in `useLayoutEffect`, so there's no one-frame jump on open.
  - The composer error lines get a solid `bg-panel` chip over the messages.

