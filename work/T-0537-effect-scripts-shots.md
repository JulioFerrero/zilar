---
id: T-0537
title: "Effect: scripts/shots.ts + scripts/screenshots.ts take Effect Schema instead of an injected zod lib, so `pnpm screenshots` works after zod left apps/web; shots.test.ts drops its zod-shaped adapter"
status: merged
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

## Report

### What I did
Swapped the screenshot scripts from zod to Effect Schema, keeping `scripts/shots.ts` import-free.

- **`scripts/shots.ts`**: removed the injected `ZodLib` and replaced it with an injected structural `SchemaModule` (the `String`/`Number`/`Struct`/`Literals`/`Array`/`mutable`/`decodeUnknownSync` members used). No `effect` reference at all, so the file stays import-free and still compiles under both tsconfigs. `parseShots(schema, shots)` now builds the schema with `schema.Struct(...)` + `schema.Literals(SHOT_SETUPS)` and decodes via `schema.decodeUnknownSync(schema.mutable(schema.Array(shot)))`. Updated the header comment and the `ShotDef.setup` comment.
- **`scripts/screenshots.ts`**: `requireFromWeb('effect')` instead of `'zod'`, injecting `Schema` into `shotTable(Schema)`; updated the comment.
- **`scripts/tsconfig.json`**: path mapping `"effect": ["../apps/web/node_modules/effect"]` replaces the zod mapping.
- **`apps/web/src/shots.test.ts`**: dropped the `effectLib`/`LibSchema` adapter and `ZodLib` import; passes the real `Schema` directly to `shotTable`/`parseShots`. The three assertions are unchanged.

### Files changed (all inside Allowed files)
`scripts/shots.ts`, `scripts/screenshots.ts`, `scripts/tsconfig.json`, `apps/web/src/shots.test.ts`, `work/T-0537-effect-scripts-shots.md`.

No zod reference is left under `scripts/` (checked with a grep for `zod|Zod`: no matches).

### Note on the structural type (deviation from the first option)
The spec allowed `typeof import('effect').Schema` "if both tsconfigs accept it". It does **not**: `@zilar/web`'s `tsconfig.json` resolves bare specifiers from `apps/web/node_modules` starting at the importing file, so `effect` is not visible from `scripts/`, and `pnpm gate` failed with `TS2307: Cannot find module 'effect'` on that line. I therefore used the spec's first option, a structural type. The first gate run failed on this; the fix is the structural `SchemaModule`.

### Commands I ran (real results)
- `pnpm install` -> done in 20.3s (after the worktree was freshly checked out).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot shots` -> `Test Files 1 passed (1)`, `Tests 3 passed (3)`. Run twice (before and after the structural-type change); same result.
- Runtime proof (spec item 5), against the final code:
  `node --experimental-strip-types --input-type=module -e "...requireFromWeb('effect')... shotTable(Schema)..."`
  -> `effect resolved via requireFromWeb; shotTable -> 17 shots; first: signin-desktop.png`.
- `pnpm gate` (final run) -> GATE PASS:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (17.2s)
  PASS  lint  (1.3s)
  PASS  typecheck  (10.5s)
  PASS  tests @zilar/web  (2.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

I did not run the full `pnpm screenshots` capture (needs a browser and the dev server), as the spec instructed.

### Problems / open questions
None outstanding. The only wrinkle was the module-resolution issue above, resolved within scope.

## Review (written by Claude)

Approved (lead, 2026-10-08). The screenshot scripts take an injected Effect Schema module (Literals for the setup enum), screenshots.ts loads effect through apps/web, and the tsconfig maps effect. shots.test.ts lost its adapter and keeps its three assertions. No zod is left under scripts/. Pre-review clean, 0 nits.
