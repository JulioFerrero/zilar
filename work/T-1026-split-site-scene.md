---
id: T-1026
title: "Size split T80: apps/site/src/scene.ts (515 lines) into scene/{config,textures,geometry,backdrop,mark,post,loop}.ts; one pointsGeometry"
status: merged
milestone: M5
branch: task/T-1026-split-site-scene
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1026: Split the site's `scene.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/site/src/scene.ts` is 515 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #76 (task T80). The new files go in a new `apps/site/src/scene/` folder:
- `config.ts`;
- `textures.ts`;
- `geometry.ts`;
- `backdrop.ts`;
- `mark.ts`;
- `post.ts`;
- `loop.ts`.

`apps/site/src/scene.ts` stays the entry: `apps/site/src/main.ts:17` loads it with `import('./scene')`. It keeps `startScene` as the orchestrator and every export it has today.

- **In scope:** the in-file Dedup. One `pointsGeometry(spec, count)` replaces the BufferGeometry setup that `starGeometry` and `dustGeometry` both repeat.
- **Same output:** the scene looks the same. The star and dust counts, sizes and colours keep their values.

The lead checks the site in Chrome with `pnpm --filter @zilar/site dev`.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #76, and `apps/site/src/scene.ts`.

### Allowed files
`apps/site/src/scene.ts`, `apps/site/src/scene/config.ts`, `apps/site/src/scene/textures.ts`, `apps/site/src/scene/geometry.ts`, `apps/site/src/scene/backdrop.ts`, `apps/site/src/scene/mark.ts`, `apps/site/src/scene/post.ts`, `apps/site/src/scene/loop.ts`, `work/T-1026-split-site-scene.md`.

### Checks
```bash
pnpm --filter @zilar/site build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/site/src/scene.ts` (515 lines) into seven modules under `apps/site/src/scene/` plus the entry. `apps/site/src/scene.ts` stays the entry and still defines `startScene`, which now orchestrates the factory functions. The scene is otherwise unchanged: the same passes, the same counts, sizes and colours. `apps/site/src/main.ts` is untouched (`import('./scene')` still resolves to `scene.ts`).

Each original block was a run of statements inside `startScene` that read its locals, so each moved into a factory function in the file the plan names; only the shared state crossing module boundaries became function arguments/a return value. No importer changed and nothing outside the task's files was edited.

### Files and line counts

| file | lines |
| --- | --- |
| `apps/site/src/scene.ts` (entry + orchestrator; was 515) | 59 |
| `apps/site/src/scene/config.ts` | 18 |
| `apps/site/src/scene/textures.ts` | 63 |
| `apps/site/src/scene/geometry.ts` | 98 |
| `apps/site/src/scene/backdrop.ts` | 76 |
| `apps/site/src/scene/mark.ts` | 115 |
| `apps/site/src/scene/post.ts` | 58 |
| `apps/site/src/scene/loop.ts` | 188 |

Every file is at most 400 lines, so no `max-lines` warning can appear. `startScene` (renderer/scene/camera/env → factories) is 59 lines; `loop.ts` holds the layout/input/animation loop and is the largest at 188.

### Dedup (plan item)

One `pointsGeometry(spec, count)` in `geometry.ts` replaces the duplicated `new BufferGeometry()` + `setAttribute` construction that `starGeometry` and `dustGeometry` each had, reusing `floats`. `spec` carries the seed, an optional position builder and an ordered `attributes` map. Random draws happen in the same order as before (position first, then attributes in insertion order, `spread` drawing three values per call), so the seeds produce byte-identical buffers: stars 420/900, dust 1100/2600, same sizes.

### Export diff (before → after)

`grep -E "^export"` on `main:apps/site/src/scene.ts` against the barrel plus the new files:

- Before (public surface): `export type SceneOptions`, `export async function startScene` — 2 names.
- After: the barrel `scene.ts` re-exports `SceneOptions` (type) and defines `startScene` (value) — **same 2 names, same kinds. MISSING: none, EXTRA: none.**
- The new files additionally export internal names the barrel does not re-export (the public surface is unchanged): `config.ts` (11 constants), `textures.ts` (`glowTexture`, `Maps`, `withRepeat`, `loadSilver`, `easeOutCubic`), `geometry.ts` (`seeded`, `floats`, `additive`, `starGeometry`, `dustGeometry`; `pointsGeometry` stays private), `backdrop.ts` (`Backdrop`, `Stars`, `createBackdrop`, `createStars`), `mark.ts` (`Mark`, `createMark`), `post.ts` (`FinishUniforms`, `Post`, `createPost`), `loop.ts` (`SceneOptions`, `LoopContext`, `startLoop`).

`SceneOptions` is declared in `loop.ts` (the module that reads `options`) and re-exported by the barrel, so there is no `scene.ts` → `loop.ts` → `scene.ts` cycle.

### Effect ratchet (split-rules item 6)

`apps/site/**` is an exempt path in the effect map (`packages/devtools/src/effect-map/generate.ts:48`, decision D2), so no `// effect-plain:` marker was added. The gate's `effect` step passed.

### Commands run

- `pnpm install` — done (`resolved 1262, reused 1172`, done in 31.1s).
- `pnpm --filter @zilar/site build` — **built in 264ms** (`dist/assets/scene-*.js` 580.10 kB; only the pre-existing three.js chunk size).
- `pnpm --filter @zilar/site test --maxWorkers=2 --reporter=dot src/cap.test.ts src/demo.test.ts` — **2 files, 17 tests passed**. The site's tests do not touch `scene.ts`; the barrel keeps the import path working.
- `pnpm gate` (first run) — **GATE FAIL**: `FAIL format` (`apps/site/src/scene/{geometry,loop,textures}.ts` were not Prettier-formatted); scope was already clean. Fixed with `pnpm exec prettier --write` on those three files only.
- `pnpm gate` (final run), from the repo root:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.5s)
PASS  lint  (0.9s)
PASS  typecheck  (4.2s)
PASS  effect  (4.4s)
PASS  tests @zilar/site  (2.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 9 changed files are the barrel, the 7 new modules and `work/T-1026-split-site-scene.md` — all inside the Allowed files.

### Deviations from the spec / notes

- **Statement blocks became factory functions.** The plan's ranges are runs of statements inside `startScene`; they cannot be moved unchanged as module-level code without functions. `createBackdrop`/`createStars`, `createMark`, `createPost` return the handles the loop needs, and `startLoop` takes a `LoopContext`. Values (`pixelRatio`, `narrowAtStart`, `options`) and the created objects are passed in; `pixelRatio` is now `const` in `scene.ts` because the only reassignment (`adapt`) runs in `loop.ts`.
- **`easeOutCubic` sits in `textures.ts`** because the plan range `70–130` covers it; it is a math helper, not a texture.
- `SceneOptions` moved to `loop.ts` (re-exported by the barrel) to keep the import graph acyclic.
- Comments moved verbatim; one short line was added above each new factory, and the file-header comment moved to `config.ts` (inside the plan's `51–68` range).
- I did not run the site in a browser; the visual check is the lead's (`pnpm --filter @zilar/site dev`). I verified the code paths preserve order, counts, sizes and colours by reading the moved code, and the build bundles cleanly.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `scene.ts` (515 lines) stays the 59-line entry with `startScene`, plus `scene/{config,textures,geometry,backdrop,mark,post,loop}`. The largest is `loop.ts` at 188. One `pointsGeometry` builds both stars and dust.
- **The nit:** a parameter name shadows another. That is harmless.
- **The lead's check:** headless Chromium (Playwright with SwiftShader WebGL), at 1300×850, branch against main.
  - Both reach `stage-ready` with no page errors.
  - The screenshots show the same planet, orbit, gold moon, stars and dust; only the animation frame differs.
  - The lead's Chrome tab could not be used, because it was `hidden` and animation frames never ran, on main too.
- **Check:** the gate passed, and so did the site build.
