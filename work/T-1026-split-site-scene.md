---
id: T-1026
title: "Size split T80: apps/site/src/scene.ts (515 lines) into scene/{config,textures,geometry,backdrop,mark,post,loop}.ts; one pointsGeometry"
status: todo
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

## Review (written by Claude)
