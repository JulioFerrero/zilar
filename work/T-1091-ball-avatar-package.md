---
id: T-1091
title: "Ball avatars: a zero-dependency @zilar/ball-avatar package (glossy 3D ball SVG from a seed) replaces dither-avatar in chat-core, web and mobile"
status: todo
milestone: M5
branch: task/T-1091-ball-avatar-package
model: auto
effort: default
depends_on: [T-1090]
estimate: 0.3 day
---

# T-1091: Glossy 3D ball avatars

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11:
- he asked for "a similar library but like a render of a 3d ball, with different colors and light direction to replace the dithering avatars";
- from the lead's preview he picked **style A, glossy**: one hue per seed, the light direction from the seed, a white highlight where the light hits, and a soft rim light on the back side.

**Where dither-avatar is used today (T-1075)**, as the lead read it on main:
- **chat-core:** `packages/chat-core/src/avatar.ts:1` imports `generateDitherAvatar` and `SIZE` from `dither-avatar` (`packages/chat-core/package.json:15`). `ditherAvatarSvg` is at `:66` and `ditherAvatarDataUri` at `:71-72`.
- **web:** `apps/web/src/components/Avatar.tsx:1`, `:23`, as an `<img src={ditherAvatarDataUri(id)}>`.
- **mobile:** `<SvgXml xml={ditherAvatarSvg(…)}>` at:
  - `apps/mobile/src/components/chat/avatar.tsx:1`, `:30`;
  - `apps/mobile/src/components/nav/floating-tab-bar.tsx:1`, `:93`;
  - `apps/mobile/src/components/profile/profile-view.tsx:1`, `:113`.

**The package layout to copy:** `packages/ui-tokens/` (`package.json` with `"exports": { ".": "./src/index.ts" }`, and a `tsconfig.json` that extends `../../tsconfig.base.json`).

### What to build
1. **A new package `packages/ball-avatar/`** (`package.json` with the name `@zilar/ball-avatar`, private, `type: module`, the same scripts as ui-tokens, no dependencies; `tsconfig.json`; `src/index.ts`, under 150 lines). It exports `ballAvatarSvg(seed: string): string`, a deterministic SVG with `viewBox="0 0 100 100"` and no `width` or `height`, so it scales to any box. The algorithm is the lead's preview, which Julio approved:
   - **The PRNG:** FNV-1a 32-bit hash the seed, then use it to seed a xorshift32 PRNG. Draw in this order:
     - `hue = r()*360`;
     - `hue2 = (hue + 30 + r()*120) % 360`;
     - `ang = r()*2π`;
     - `dist = 0.18 + r()*0.14`.
   - **The light point:** `lx = 50 + cos(ang)*dist*100`, `ly = 50 + sin(ang)*dist*100`, in percent. **The back side:** `sx = 50 − cos(ang)*28`, `sy = 50 − sin(ang)*28`.
   - **The layers:** three `<circle cx=50 cy=50 r=50>` layers, each filled with a `radialGradient` (the ids are prefixed with a short seed hash, so two inline SVGs never clash):
     1. **body:** centre (`lx%`, `ly%`), `r=75%`, stops `0: hsl(hue 85% 72%)`, `0.55: hsl(hue 75% 46%)` and `1: hsl(hue 80% 16%)`;
     2. **rim:** centre (`sx%`, `sy%`), `r=55%`, stops `0.6: hsl(hue2 90% 70%)` at opacity 0 and `1:` the same colour at opacity 0.55;
     3. **highlight:** centre (`lx%`, `ly%`), `r=18%`, stops `0: #fff` at opacity 0.95 and `1: #fff` at opacity 0.

     Use `stop-color` and `stop-opacity` attributes, which react-native-svg supports, and write the colours as `hsl(H S% L%)` with whole numbers.
   - **No other output.** No `<style>`, no text, no filters.
2. **chat-core:**
   - replace the `dither-avatar` dependency with `"@zilar/ball-avatar": "workspace:*"`, and run `pnpm install` so the lockfile updates;
   - in `avatar.ts`, rename the helpers to `avatarSvg(seed)` (it returns `ballAvatarSvg(seed)`) and `avatarDataUri(seed)` (the same `data:image/svg+xml,` + `encodeURIComponent` wrapper);
   - drop the `viewBox` rewrite, because the new SVG already has one.
3. **Update the four callers** (web `Avatar.tsx`, and mobile `avatar.tsx`, `floating-tab-bar.tsx` and `profile-view.tsx`) to the new names. Nothing else in them changes.
4. **Update `docs/design/ui-style.md`'s Avatars line** (`:75-77`): avatars without a picture are a glossy 3D ball from `@zilar/ball-avatar`, seeded by the id (Julio, 2026-10-11, T-1091).
5. **Proof in the Report:**
   - the first 160 characters of `ballAvatarSvg('u-ana')`;
   - proof that two calls with the same seed give identical strings;
   - proof that `'u-ana'` and `'u-luis'` give different strings.
6. **No tests.** Every file stays under 400 lines, and no other files change.

The lead checks:
- **web (`?mock=1`):** the chat list, a chat header, the message avatars and Settings › Profile;
- **phone (mock):** Chats, the Profile tab face, the profile page and AIs.

### Read first
`AGENTS.md`, `packages/ui-tokens/`, `packages/chat-core/src/avatar.ts`, `packages/chat-core/package.json`, the four caller files, and `docs/design/ui-style.md`.

### Allowed files
`packages/ball-avatar/package.json`, `packages/ball-avatar/tsconfig.json`, `packages/ball-avatar/src/index.ts`, `packages/chat-core/package.json`, `packages/chat-core/src/avatar.ts`, `pnpm-lock.yaml`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/components/profile/profile-view.tsx`, `docs/design/ui-style.md`, `work/T-1091-ball-avatar-package.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 5.

---

## Report (written by the worker when done)

## Review (written by Claude)
