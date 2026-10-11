---
id: T-1091
title: "Ball avatars: a zero-dependency @zilar/ball-avatar package (glossy 3D ball SVG from a seed) replaces dither-avatar in chat-core, web and mobile"
status: merged
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
1. **A new package `packages/ball-avatar/`** (`package.json` with the name `@zilar/ball-avatar`, private, `type: module`, the same scripts as ui-tokens, no dependencies, `"exports": { ".": "./index.ts" }`; `tsconfig.json` with `"include": ["index.ts"]`; and `index.ts` at the package root, under 150 lines. The root, not `src/`, keeps the Allowed paths inside one new folder). It exports `ballAvatarSvg(seed: string): string`, a deterministic SVG with `viewBox="0 0 100 100"` and no `width` or `height`, so it scales to any box. The algorithm is the lead's preview, which Julio approved:
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
`packages/ball-avatar/package.json`, `packages/ball-avatar/tsconfig.json`, `packages/ball-avatar/index.ts`, `packages/chat-core/package.json`, `packages/chat-core/src/avatar.ts`, `pnpm-lock.yaml`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/components/profile/profile-view.tsx`, `docs/design/ui-style.md`, `work/T-1091-ball-avatar-package.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 5.

---

## Report (written by the worker when done)

### What I did
- **New package `packages/ball-avatar/`** (`@zilar/ball-avatar`, private, `type: module`, no dependencies, `exports: { ".": "./index.ts" }`, the ui-tokens scripts, `tsconfig.json` with `"include": ["index.ts"]`). `index.ts` (80 lines) exports `ballAvatarSvg(seed: string): string`: FNV-1a 32-bit hash of the seed ▸ xorshift32 PRNG; draws `hue = r()*360`, `hue2 = (hue + 30 + r()*120) % 360`, `ang = r()*2π`, `dist = 0.18 + r()*0.14`; light point `lx/ly = 50 ± cos/sin(ang)*dist*100`, back side `sx/sy = 50 ∓ cos/sin(ang)*28`; three `<circle cx=50 cy=50 r=50>` layers over `radialGradient`s whose ids are `b<base36 seed hash>-body|-rim|-gloss` (body `r=75%`, rim `r=55%`, gloss `r=18%`); colours are whole-number `hsl(H S% L%)` via `stop-color`/`stop-opacity`. `viewBox="0 0 100 100"`, no `width`/`height`, no `<style>`/text/filters.
- **`packages/chat-core`**: replaced `dither-avatar` with `"@zilar/ball-avatar": "workspace:*"` in `package.json`; in `src/avatar.ts` renamed `ditherAvatarSvg` → `avatarSvg` (now returns `ballAvatarSvg(seed)`, viewBox rewrite dropped) and `ditherAvatarDataUri` → `avatarDataUri` (same `data:image/svg+xml,` + `encodeURIComponent` wrapper). `src/index.ts` already re-exports `./avatar`, so no other change.
- **Four callers**: `apps/web/src/components/Avatar.tsx` (now `avatarDataUri(id)`); `apps/mobile/src/components/chat/avatar.tsx`, `.../nav/floating-tab-bar.tsx`, `.../profile/profile-view.tsx` (now `avatarSvg(...)`). Only the import and the call changed.
- **`docs/design/ui-style.md`** (`:75-76`): the Avatars line now says a glossy 3D ball from `@zilar/ball-avatar` seeded by the id (Julio, 2026-10-11, T-1091), and the helpers are `avatarSvg` / `avatarDataUri`.
- No tests (per spec); every touched file is well under 400 lines.

### Proof (step 5)
First 160 characters of `ballAvatarSvg('u-ana')`:
```
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="b14zxf-body" cx="39.68%" cy="27.69%" r="75%"><stop offset="0" stop-color
```
Same seed, identical strings: `ballAvatarSvg('u-ana') === ballAvatarSvg('u-ana')` → `true`.
Different seeds differ: `ballAvatarSvg('u-ana') !== ballAvatarSvg('u-luis')` → `true`.

Full `ballAvatarSvg('u-ana')` (884 chars) for the reviewer:
```
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="b14zxf-body" cx="39.68%" cy="27.69%" r="75%"><stop offset="0" stop-color="hsl(38 85% 72%)"/><stop offset="0.55" stop-color="hsl(38 75% 46%)"/><stop offset="1" stop-color="hsl(38 80% 16%)"/></radialGradient><radialGradient id="b14zxf-rim" cx="61.75%" cy="75.41%" r="55%"><stop offset="0.6" stop-color="hsl(84 90% 70%)" stop-opacity="0"/><stop offset="1" stop-color="hsl(84 90% 70%)" stop-opacity="0.55"/></radialGradient><radialGradient id="b14zxf-gloss" cx="39.68%" cy="27.69%" r="18%"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#b14zxf-body)"/><circle cx="50" cy="50" r="50" fill="url(#b14zxf-rim)"/><circle cx="50" cy="50" r="50" fill="url(#b14zxf-gloss)"/></svg>
```

### Commands and results
- `pnpm install` → done (10.6s first run, 2.5s after the ball-avatar dependency edit); lockfile now resolves `@zilar/ball-avatar` in place of `dither-avatar@1.0.0`.
- No single test files to run: the spec says "No tests" and the change adds no test file.
- `pnpm gate` (from the repo root):
```
gate: 12 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (4.6s)
PASS  effect  (0.7s)
SKIP tests @zilar/ball-avatar (no nearby test files)
PASS  tests @zilar/chat-core  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Files changed
`packages/ball-avatar/package.json`, `packages/ball-avatar/tsconfig.json`, `packages/ball-avatar/index.ts` (new), `packages/chat-core/package.json`, `packages/chat-core/src/avatar.ts`, `pnpm-lock.yaml`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/components/profile/profile-view.tsx`, `docs/design/ui-style.md`, `work/T-1091-ball-avatar-package.md`.

### Deviations / decisions
- The four callers still carry their old doc comments that say "dither" (e.g. `/** The dither avatar circle and the online dot. */`). The spec says "Nothing else in them changes", so I changed only the import and the call. Say the word if you want those comment words switched to "ball".

### Open questions
None.


## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits.**
- **The change:**
  - a new zero-dependency `@zilar/ball-avatar` (`packages/ball-avatar/index.ts`, 83 lines): a glossy ball SVG built with the preview's algorithm, which Julio picked (style A);
  - `@zilar/chat-core` swaps `dither-avatar` for it, with the helpers renamed to `avatarSvg` and `avatarDataUri`;
  - the four callers and `ui-style.md` are updated.
- **The lead's web check** (`?mock=1`): glossy balls in the chat list, the chat header and message avatars, AIs included.
- **The lead's phone smoke** (mock):
  - **Chats:** Dev AI, Dev team, Marta, Familia, QA squad, Acme, Luis and Marketing AI each show their own ball, with a highlight and a rim light;
  - **Profile:** the 104 px ball and the tab face;
  - **AIs** passes.
- **The nits:**
  - stale "dither" wording in comments in the callers;
  - the gradient ids use a 5-character hash prefix. This is harmless here, because each avatar is its own SVG document (an `<img>` data URI, or one `SvgXml`).
- **Check:** the gate passed, including the `@zilar/chat-core` tests.
