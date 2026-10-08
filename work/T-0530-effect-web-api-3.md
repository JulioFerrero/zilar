---
id: T-0530
title: "Effect lane D3: web lib/api.ts part 3 — Telegram import to the end on Effect Schema, drop the zod path from decodeResponse, and remove zod from apps/web"
status: merged
milestone: M5
branch: task/T-0530-effect-web-api-3
model: auto
effort: low
depends_on: [T-0507]
estimate: 1 day
---

# T-0530: web API client on Effect Schema, part 3 of 3 (zod leaves web)

## Spec (written by Claude, do not edit)

### Why
This continues T-0505 and T-0507 (both merged). After this task, web has no zod: Julio, 2026-10-07, "Effect Schema replaces zod". Read the Reports of `work/T-0505-effect-web-api-1.md` and `work/T-0507-effect-web-api-2.md`, and the "Web API client" section of `docs/EFFECT_GUIDE.md`.

### Verified facts (do not re-derive)
- **`apps/web/src/lib/api.ts`** (about 2,690 lines after T-0507):
  - `type ResponseSchema<T> = z.ZodType<T> | Schema.Codec<T, unknown>` (around line 26);
  - `decodeResponse` (around line 37) branches on zod versus Effect;
  - callers: `request` (around 279), the error body (around 294), and the raw-fetch upload paths (around 1657 and 1928).
- **Your range** runs from the marker `// --- Telegram import (T-0123) ---` to the end of the file. The sections are:
  - Telegram import, Integrations settings, Voice transcripts, GIFs, Audit log;
  - First-run setup, @usernames and contact requests, Blocked people;
  - Public groups and channels, Avatars, Chat background images.
  
  T-0507 already converted `telegramImportResultSchema`.
- **zod outside `api.ts` in web:**
  - `apps/web/src/shots.test.ts` (an import at line 2 and a comment at line 11);
  - `apps/web/src/mock/api.test.ts`, which builds its own zod schemas around lines 268-272, 296 and 403 to check mock response bodies.
  
  `apps/web/package.json` has `"zod": "^4.6.5"`.

### What to build
1. **Convert** every schema, `z.infer` type and direct parse in your range to Effect Schema, with the same exported type names. Every importer must typecheck unchanged, and the raw-fetch upload paths keep their status codes, `invalid_response` and abort handling.
2. **Drop zod from `decodeResponse`:**
   - `ResponseSchema<T>` becomes the Effect codec only;
   - remove the zod branch and the `zod` import from `api.ts`;
   - check that no schema anywhere in `api.ts` is still zod (grep `z\.`).
3. **Tests that use zod themselves:** in `apps/web/src/shots.test.ts` and `apps/web/src/mock/api.test.ts`, replace only their zod schemas and parse calls with Effect Schema equivalents (`Schema.decodeUnknownSync`). **No assertion changes.**
4. **Remove `zod` from `apps/web/package.json`** once nothing under `apps/web` imports it (grep, tests included). Run `pnpm install` and commit the lockfile.
5. **Tests:** every other web test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `work/T-0507-effect-web-api-2.md` (its Report), `apps/web/src/lib/api.ts` (the helpers at the top, then your range), `apps/web/src/shots.test.ts`, `apps/web/src/mock/api.test.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/shots.test.ts`, `apps/web/src/mock/api.test.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `work/T-0530-effect-web-api-3.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib src/mock src/store shots
pnpm gate
```

### Acceptance
- All of `api.ts` is on Effect Schema, and `decodeResponse` has no zod branch.
- zod is gone from `apps/web`, including `package.json`.
- The web tests are green, with only the listed parse-call changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done. `pnpm gate` ends with `GATE PASS` and all changed files are inside the Allowed files.**

### What I did
- Converted every schema, `z.infer` type and direct parse in my range (`// --- Telegram import (T-0123) ---` to the end of `apps/web/src/lib/api.ts`) to Effect Schema, keeping the exported type names (now `typeof xSchema.Type`) and the function signatures: Integrations settings, Voice transcripts, GIFs, Audit log, First-run setup, @usernames and contact requests, Blocked people, Public groups and channels, Avatars, Chat background images. `telegramImportResultSchema` was already Effect from T-0507.
- Used the T-0505/T-0507 patterns: `struct(...)` from `@zilar/protocol`, `Schema.mutable(Schema.Array(...))`, `Schema.NullOr`, `Schema.optional` (not `optionalKey`, for `exactOptionalPropertyTypes`), `Schema.Literals`, `Schema.Record(Schema.String, Schema.Unknown)` for `z.record`, and `Schema.Null` for `z.null()`.
- The raw-fetch upload paths keep their behaviour: `gifRequest`, `uploadAvatarBytes` and `uploadBackground` now decode with the existing private `decodeResponse(schema, raw)` instead of `.safeParse`; status codes, `invalid_response`, the mock branch and abort handling are unchanged.
- Dropped zod from the helpers: `type ResponseSchema<T> = Schema.Codec<T, unknown>` (only the Effect codec), deleted `isEffectSchema` and the zod branch of `decodeResponse`, and removed `import { z } from 'zod'`. `grep -nE '\bz\.' apps/web/src/lib/api.ts` returns nothing. The only remaining occurrence of the word "zod" is the historical comment at the top of the Approvals section ("we don't have to think about zod's string-to-Date coercion in tests"), which is a comment, not a schema, and sits in T-0507's range.
- `apps/web/src/mock/api.test.ts`: swapped the zod import for `Schema` and replaced every `z.object(...).parse(...)` with `Schema.decodeUnknownSync(...)`, adding two local constants (`errorCodeSchema`, `errorCodeMessageSchema`) so the eight identical error-body parses stay readable. No assertion changed.
- `apps/web/src/shots.test.ts`: `scripts/shots.ts` takes an injected lib by design (it must not import anything) and is outside the Allowed files, so instead of editing it I added a small Effect-backed adapter (`effectLib`) that implements its exported `ZodLib`, where `.parse` is `Schema.decodeUnknownSync` on a mutable array. Updated the one comment that called the setup field a "zod enum" to "literal-union schema". No assertion changed.
- Removed `zod` from `apps/web/package.json`, ran `pnpm install`, and committed the lockfile change (3 lines removed). `grep -rn "from 'zod'" apps/web` is empty.

### Files changed
- `apps/web/src/lib/api.ts` — all conversions in range, the simplified helpers, the removed zod import, and the raw-fetch parses now via `decodeResponse`.
- `apps/web/src/mock/api.test.ts` — `Schema` import, two shared error schemas, parse calls only.
- `apps/web/src/shots.test.ts` — the Effect-backed `ZodLib` adapter and one comment.
- `apps/web/package.json` — `zod` dependency removed.
- `pnpm-lock.yaml` — the prune of web's zod entry.
- `work/T-0530-effect-web-api-3.md` — this report and status.

### Commands run (real results)
- `pnpm install` → exit 0, `Done in 6.5s using pnpm v10.32.1`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/shots.test.ts src/mock/api.test.ts` → `Test Files 2 passed (2)`, `Tests 50 passed (50)`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib src/mock src/store shots` → `Test Files 47 passed (47)`, `Tests 613 passed (613)`. (Two pre-existing `vi.fn()` warnings from `voice.test.ts`, no failures.)
- `pnpm exec prettier --write apps/web/src/lib/api.ts apps/web/src/mock/api.test.ts apps/web/src/shots.test.ts apps/web/package.json` → all four unchanged.
- `pnpm gate` (from the repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (28.5s)
  PASS  lint  (1.2s)
  PASS  typecheck  (15.2s)
  PASS  tests @zilar/web  (77.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open question / risk: `scripts/screenshots.ts` resolves zod through `apps/web`
`scripts/screenshots.ts:29-31` builds `createRequire(join(root, 'apps', 'web', 'package.json'))` and calls `requireFromWeb('zod')`; `scripts/tsconfig.json` also maps `"zod": ["../apps/web/node_modules/zod"]`. Removing zod from `apps/web/package.json` removes `apps/web/node_modules/zod`, so `pnpm screenshots` (the root script) would fail to resolve zod in a clean checkout. I did **not** edit `scripts/` because it is outside the Allowed files. (In this shell the resolution still succeeds, but only because an inherited `NODE_PATH` points at another worktree's `.pnpm/node_modules` — not a real fix.) This needs a decision: migrate `scripts/shots.ts` + `scripts/screenshots.ts` (and their `ZodLib`) to Effect Schema in a follow-up task, or give the scripts their own zod dependency. Neither `pnpm gate` nor the task's Checks exercise `pnpm screenshots`, so this does not affect GATE PASS.

### Deviations from the spec
1. The `shots.test.ts` adapter is the only way the file stops importing zod without editing `scripts/shots.ts` (outside the Allowed files). It changes no assertion.
2. Everything else follows the spec exactly.

## Review (written by Claude)

Approved (lead, 2026-10-08). All of web api.ts is on Effect Schema, decodeResponse has no zod branch, and zod is gone from apps/web (package.json and lockfile). shots.test.ts and mock/api.test.ts changed only their own schemas, with no assertion changes. Pre-review clean. Follow-up (lead task): scripts/screenshots.ts and scripts/shots.ts resolve zod through apps/web, so pnpm screenshots needs them moved to Effect Schema.
