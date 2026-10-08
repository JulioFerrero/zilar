---
id: T-0537
title: "Effect: scripts/shots.ts + scripts/screenshots.ts take Effect Schema instead of an injected zod lib, so `pnpm screenshots` works after zod left apps/web; shots.test.ts drops its zod-shaped adapter"
status: todo
milestone: M5
branch: task/T-0537-effect-scripts-shots
model: auto
effort: low
depends_on: [T-0530]
estimate: 0.25 day
---

# T-0537: screenshot scripts on Effect Schema

## Spec (written by Claude, do not edit)

### Why
T-0530 removed zod from `apps/web`. Its pre-review found that `pnpm screenshots` still loads zod **through** `apps/web`, so it breaks on a clean checkout. Julio, 2026-10-07: Effect Schema replaces zod.

### Verified facts (do not re-derive)
- **`scripts/shots.ts`** (127 lines) has no imports on purpose; its header comment explains why it is typechecked under two tsconfigs.
  - It defines a structural `ZodLib` type (around line 31).
  - `parseShots(zod: ZodLib, shots)` (line 114) builds `zod.object({ name, path, viewport: { width, height }, setup: zod.enum(SHOT_SETUPS) })` and parses an array.
  - `shotTable(zod)` (line 125).
- **`scripts/screenshots.ts`** (198 lines):
  - `requireFromWeb = createRequire(<root>/apps/web/package.json)` (line 29);
  - it loads `playwright` (line 30) and **`zod` (line 31)** through it;
  - it calls `shotTable(zod)` (line 161).
- **`scripts/tsconfig.json`** line 9 maps `"zod": ["../apps/web/node_modules/zod"]`.
- **`apps/web/src/shots.test.ts`** (after T-0530) builds an `effectLib: ZodLib` adapter over Effect Schema and calls `shotTable(effectLib)` and `parseShots(effectLib, …)`. Its assertions: 17 shots, a setup typo throws, and the setups equal `SHOT_SETUPS`.
- **The root script:** `"screenshots": "node --experimental-strip-types scripts/screenshots.ts"` (root `package.json` line 25). `apps/web` has `effect` ^4.0.2.

### What to build
1. **`scripts/shots.ts`:** replace the injected `ZodLib` with an injected Effect `Schema` module (a structural type for the few members used, or `typeof import('effect').Schema` through a type-only import if both tsconfigs accept it). The file must stay **side-effect free and free of runtime imports.**
   - `parseShots(schema, shots)` decodes with `Schema.decodeUnknownSync`;
   - the `setup` field is `Schema.Literals(SHOT_SETUPS)`, so a typo still throws before the browser starts;
   - update the header comment.
2. **`scripts/screenshots.ts`:** load `effect` instead of `zod` through `requireFromWeb`, and pass its `Schema`.
3. **`scripts/tsconfig.json`:** replace the zod path mapping with one for `effect` (`../apps/web/node_modules/effect`).
4. **`apps/web/src/shots.test.ts`:** drop the `effectLib` adapter and pass `Schema` directly. **The three assertions stay identical.**
5. **Proof:** `pnpm --filter @zilar/web test --reporter=dot shots` passes, and `node --experimental-strip-types -e` (or a dry import) shows that `scripts/screenshots.ts` resolves `effect`. Do **not** run the full screenshot run; it needs a browser and the dev server. Report what you ran.

### Read first
`AGENTS.md`, `scripts/shots.ts`, `scripts/screenshots.ts`, `scripts/tsconfig.json`, `apps/web/src/shots.test.ts`.

### Allowed files
`scripts/shots.ts`, `scripts/screenshots.ts`, `scripts/tsconfig.json`, `apps/web/src/shots.test.ts`, `work/T-0537-effect-scripts-shots.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot shots
pnpm gate
```

### Acceptance
- The screenshot scripts use Effect Schema, and no zod reference is left under `scripts/`.
- The shots test passes with the same three assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
