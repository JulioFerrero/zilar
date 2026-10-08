---
id: T-0530
title: "Effect lane D3: web lib/api.ts part 3 — Telegram import to the end on Effect Schema, drop the zod path from decodeResponse, and remove zod from apps/web"
status: todo
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

## Review (written by Claude)
