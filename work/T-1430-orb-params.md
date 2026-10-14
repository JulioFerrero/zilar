---
id: T-1430
title: "Orb params: ball-avatar exposes ballParams(seed) and ballSvg(params); chat-core exports orbParamsFor/orbSvg; output for every seed stays byte-identical"
status: merged
milestone: M5
branch: task/T-1430-orb-params
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1430: Orb params

## Spec (written by Claude, do not edit)

### Why
The approved design adds an orb picker (canvas https://claude.ai/artifact/WMbGfFmbgAHeuEKKHvBg2k, boards "3 · Orb" and "Phone 3 · Orb"): the user picks a color, a light color, and drags the light. The picker must draw the same orb as `ballAvatarSvg`, from explicit params instead of a seed. Web and mobile UI tasks build on this.

### Facts (the lead read them on main)
- `packages/ball-avatar/index.ts` (83 lines): `ballAvatarSvg(seed)` at `:39-83`.
  - It draws `hue` (`:43`), `hue2` (the rim light, `:44`), `angle` (`:45`) and `distance` (`:46`) from a seeded PRNG.
  - It then derives `lightX/lightY` (`:48-49`), `backX/backY` (`:50-51`), the gradient id `b<hash36>` (`:53`) and the colors (`:56-59`).
- `packages/chat-core/src/avatar.ts:64-71`: `avatarSvg(seed)` and `avatarDataUri(seed)` wrap it with `normalizeJid`. They are exported through `packages/chat-core/src/index.ts:4`.

### What to build
1. **`packages/ball-avatar/index.ts`:**
   - Export `interface BallParams { hue: number; rim: number; angle: number; distance: number }`, all in the same units as today: degrees, degrees, radians, and 0–1.
   - Export `ballParams(seed: string): BallParams`, with the same PRNG draws in the same order.
   - Export `ballSvg(params: BallParams, idSeed: string): string`, which renders exactly the current markup; `idSeed` gives the gradient id hash.
   - `ballAvatarSvg(seed)` becomes `ballSvg(ballParams(seed), seed)`, and its output must be **byte-identical** for every seed.
   - Clamp params: `hue` and `rim` modulo 360, `distance` to 0–0.4.
2. **`packages/chat-core/src/avatar.ts`:** export `orbParamsFor(seed)` (normalizes like `avatarSvg`), `orbSvg(params, idSeed)` and `orbDataUri(params, idSeed)`.
3. **No UI.** Keep both files at 400 lines or fewer.

### Tests
None (UI). Before committing, confirm byte-identical output for 5 seeds with a throwaway script, not committed, and say so in the Report.

### Allowed files
`packages/ball-avatar/index.ts`, `packages/chat-core/src/avatar.ts`, `work/T-1430-orb-params.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `ballAvatarSvg` output is unchanged (confirmed in the Report).
- The new exports are typed.

---

## Report (written by the worker when done)

### What I did

- `packages/ball-avatar/index.ts`
  - Added `export interface BallParams { hue: number; rim: number; angle: number; distance: number }` (degrees, degrees, radians, 0–1).
  - Added `export function ballParams(seed: string): BallParams`, extracting the four PRNG draws in the original order (`hue`, `rim`, `angle`, `distance`).
  - Added `export function ballSvg(params: BallParams, idSeed: string): string`, which owns the original markup; the gradient id is `b` + `hashSeed(idSeed).toString(36).slice(0, 5)`. It clamps with `wrapHue` (`((x % 360) + 360) % 360`) for `hue`/`rim` and `clampDistance` (`Math.min(0.4, Math.max(0, x))`) for `distance`.
  - `ballAvatarSvg(seed)` is now `ballSvg(ballParams(seed), seed)`; no other behaviour changed.
- `packages/chat-core/src/avatar.ts`
  - Imports `ballParams`, `ballSvg` and the `BallParams` type.
  - Added `orbParamsFor(seed)` (`ballParams(normalizeJid(seed))`), `orbSvg(params, idSeed)` (`ballSvg(params, normalizeJid(idSeed))`) and `orbDataUri(params, idSeed)` (SVG `data:` URI of `orbSvg`), all exported via `src/index.ts`'s existing `export * from './avatar'`.

### Files changed

- `packages/ball-avatar/index.ts` (122 lines)
- `packages/chat-core/src/avatar.ts` (86 lines)
- `work/T-1430-orb-params.md` (this task file)

Both source files stay under the 400-line limit. No new dependencies.

### Byte-identical confirmation

Spec asks to confirm byte-identical output for 5 seeds with a throwaway script, not committed. I did: I copied the old `ball-avatar/index.ts` from `HEAD` into a temporary in-package module and ran a temporary vitest file comparing old vs new `ballAvatarSvg` for the seeds `a`, `b`, `user@example.com`, `Zilar Bot 42`, `🎉 party`.

`pnpm --filter @zilar/ball-avatar test --maxWorkers=2 --reporter=dot __cmp_tmp.test.ts` → `Test Files 1 passed (1)`, `Tests 5 passed (5)`. Both temporary files (`__old_tmp.ts`, `__cmp_tmp.test.ts`) were deleted before running the gate and are not in the commit.

Reason it is identical: `hue` is drawn in `[0, 360)` so `wrapHue` is the identity; `rim` is already `% 360`; `distance` is `0.18–0.32`, inside `0–0.4`; the id uses `hashSeed(seed)` exactly as before.

`avatarSvg(seed)` and `orbSvg(orbParamsFor(seed), seed)` also resolve to the same params and id seed, since both normalize the seed with `normalizeJid` (not separately asserted by a committed test).

### Commands run

- `pnpm install` → `Done in 13.7s`.
- `pnpm --filter @zilar/ball-avatar test --maxWorkers=2 --reporter=dot __cmp_tmp.test.ts` → 5 passed (temporary comparison above, since removed).
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (4.0s)
  PASS  format  (0.9s)
  PASS  lint  (1.1s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/ball-avatar (no nearby test files)
  PASS  tests @zilar/chat-core  (1.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations and questions

- None. The spec's test note ("None (UI)") was followed: no test was committed.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1. The lead compared ballAvatarSvg on this branch with main for 506 seeds (including empty, long and JID seeds): 506/506 byte-identical.
