---
id: T-1507
title: "Mobile stickers move (approved Stickers canvas): render every sticker with expo-image instead of React Native Image, so animated WebP stickers play and loop"
status: merged
milestone: M5
branch: task/T-1507-mobile-stickers-expo-image
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1507: Mobile stickers render with expo-image

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15 (`docs/design/mockups/stickers/README.md`, "Rules the design set"): "The phone renders stickers with `expo-image`, so animated stickers move."

The server now stores GIF and video stickers as animated WebP (T-1496, T-1502). React Native's `Image` on Android shows only the first frame of an animated WebP.

### Facts (the lead read them on main, 2026-10-15)
- **`expo-image` is already a dependency** (`apps/mobile/package.json:41`) and already used for chat photos (`apps/mobile/src/components/chat/album-grid.tsx:2,160-168`, with `contentFit`).
- **Sticker images still use React Native's `Image`:**
  - `apps/mobile/src/components/chat/sticker-message.tsx:5`, `:70-76` (`resizeMode="contain"`, `onError`);
  - `apps/mobile/src/components/chat/sticker-panel.tsx:3`, `:305-310`;
  - `apps/mobile/src/components/stickers/favorites-tab.tsx:2`, `:45-50`;
  - `apps/mobile/src/components/stickers/pack-card.tsx:2`, `:55-59`;
  - `apps/mobile/src/components/stickers/pack-saved-grid.tsx:2` (`RNImage`), `:58-62`.
- **The source:** `stickerImageSource` (`apps/mobile/src/lib/stickers.ts:112-122`) returns `{ uri, headers? }`, which `expo-image` accepts as is.
- `apps/mobile/src/components/stickers/pack-fresh-list.tsx:44` previews a freshly picked local file. Leave it as it is.

### Steps
1. In each of the five files above, render the sticker with `Image` from `expo-image` instead of React Native's `Image`:
   - `resizeMode="contain"` becomes `contentFit="contain"`;
   - keep the same `source`, `style`, `accessibilityLabel` and `onError`;
   - remove `Image`/`RNImage` from the `react-native` import where nothing else uses it.
2. Animation is `expo-image`'s default (`autoplay`). Do not turn it off.

### Not in scope
- the sticker editor's pick and upload flow;
- the link page;
- web.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/mobile/src/components/chat/sticker-message.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/components/stickers/favorites-tab.tsx`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/components/stickers/pack-saved-grid.tsx`
- `work/T-1507-mobile-stickers-expo-image.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Stickers in chat, the sticker panel, favorites and the pack screens render through `expo-image`, the same size as before.
- An animated WebP sticker plays and loops.
- No React Native `Image` is left in those five files.

---

## Report (written by the worker when done)

### What I did

Switched every sticker render in the five Allowed files from React Native's `Image` to
`expo-image`'s `Image`:

- `apps/mobile/src/components/chat/sticker-message.tsx` (chat sticker);
- `apps/mobile/src/components/chat/sticker-panel.tsx` (panel tile);
- `apps/mobile/src/components/stickers/favorites-tab.tsx`;
- `apps/mobile/src/components/stickers/pack-card.tsx`;
- `apps/mobile/src/components/stickers/pack-saved-grid.tsx` (was `Image as RNImage`).

Each keeps the same `source` (`stickerImageSource(...)`), `style`, `accessibilityLabel`
and `onError`; `resizeMode="contain"` became `contentFit="contain"`. `Image` (or
`RNImage`) was removed from the `react-native` import, and `import { Image } from
'expo-image'` was added. Animation is left at `expo-image`'s default (`autoplay`), not
disabled. `pack-fresh-list.tsx` was left untouched, as the spec says.

Files changed: the five Allowed source files plus this task file.

### Checks run

- `pnpm install` → `Done in 11.7s` (peer-dependency warning only).
- `pnpm gate` (from the repo root):

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.8s)
PASS  lint  (0.9s)
PASS  typecheck  (4.4s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the task says "Tests: None (UI)"; `pnpm gate` ran the
nearest tests of `@zilar/mobile` (passed).

### Notes for the lead

- I did not verify animated WebP playback on a device or emulator (no device access
  here). The render path now goes through `expo-image` with its default autoplay, so the
  "plays and loops" acceptance item still needs a phone smoke test.
- `stickerImageSource` returns `{ uri, headers? }`, which `expo-image` accepts as is, so
  no change was needed there.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `f2fea721e`.
- **The diff** is the five planned swaps: `contentFit="contain"`, the same source, style and `onError`, and no React Native `Image` left.
- **Phone smoke on the emulator:**
  - the real build passed `/` and `/settings/stickers`, but the emulator was signed out, so it showed the sign-in screen, and the lead did not sign in;
  - the mock build passed both, and the Stickers screen renders the pack cards with no crash. Mock images are blank by design.
- **Not yet seen:** an animated sticker actually playing. Check it on Julio's next phone build.
- **Lead side note:** the first smoke failed in `:app:packageRelease` on stale incremental state in the build worktree; clearing `intermediates/incremental/packageRelease` fixed it.
