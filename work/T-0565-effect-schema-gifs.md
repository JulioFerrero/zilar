---
id: T-0565
title: "Effect Schema, server batch 2: gifs/provider.ts and gifs/giphy.ts drop zod for Effect Schema; GifItem/GifPage types identical; Giphy response parsing drops the same bad items; tests unchanged"
status: merged
milestone: M5
branch: task/T-0565-effect-schema-gifs
model: auto
effort: low
depends_on: [T-0562]
estimate: 0.5 day
---

# T-0565: gifs provider and Giphy parser on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod everywhere. `gifs/provider.ts` and `gifs/giphy.ts` use zod only between themselves, so they move together.

The idioms to copy: `Schema.decodeUnknownExit` with `Exit.isSuccess` for a `safeParse`, and `Schema.decodeUnknownSync` for a `parse`. `isUrl` in `packages/protocol/src/common.ts:141` matches zod v4's `z.url()` (any scheme that `new URL()` accepts); T-0543 relied on this.

### Verified facts (do not re-derive)
- **`apps/server/src/gifs/provider.ts`** (43 lines):
  - `gifItemSchema` (line 7): `{ id: 1..128, title: max 100, previewUrl: url max 2048, mp4Url?: url max 2048, gifUrl?: url max 2048, width: int 1..20000, height: int 1..20000, sizeBytes?: int 0..100 MiB }`;
  - `gifPageSchema` (25): `{ items: GifItem[], nextPos?: max 128 }`;
  - `type GifItem` and `type GifPage` come from `z.infer`, so **write them out explicitly or derive them from the Effect Schema, with an identical shape**;
  - `GifSearchOptions` and `GifProvider` are plain interfaces.
  
  `gifItemSchema` and `gifPageSchema` are imported only by `apps/server/src/gifs/giphy.ts:8`. Check that with grep.
- **`apps/server/src/gifs/giphy.ts`** (407 lines). Its internal zod schemas:
  - `renditionSchema` (around 32): all optional strings, non-strict;
  - `gifObjectSchema` (around 45): `id?`, `title?`, `images?: record<string, unknown>`;
  - `giphyResponseSchema` (around 53): `data: unknown[]` plus an optional pagination block with optional numbers;
  - an inline item validator (around 148-162) that repeats the `gifItemSchema` rules with `safeParse`.
  
  Behaviour:
  - a failed item `safeParse` **drops that item** (`return undefined`);
  - a failed response `safeParse` gives `{ items: [] }`;
  - `gifPageSchema.parse(parseGiphyResponse(body))` (around 330) throws on a bad page.
  
  Keep every branch.
- **Tests (all unchanged):** `apps/server/src/gifs/gifs.test.ts`, `apps/server/src/gifs/giphy.effect.test.ts` and `apps/server/src/gifs/routes.test.ts`. None of them imports a gifs schema.

### What to build
1. **Replace zod with Effect Schema in both files:**
   - the same rules (url, lengths, int ranges, optional);
   - the same drop-item, empty-page and throw branches;
   - no `zod` import left in either file.
   
   `gifs/routes.ts` still uses zod for its query parsing; **leave `routes.ts` alone.**
2. **`GifItem` and `GifPage` stay the same TypeScript shapes.** `apps/server/src/gifs/routes.ts` and `apps/server/src/app.ts:200` use them, and typecheck proves it.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/gifs/provider.ts`, `apps/server/src/gifs/giphy.ts` (all of it), and `packages/protocol/src/common.ts` (around `isUrl`).

### Allowed files
`apps/server/src/gifs/provider.ts`, `apps/server/src/gifs/giphy.ts`, `work/T-0565-effect-schema-gifs.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs
pnpm gate
```

### Acceptance
- The gifs provider and Giphy parser use Effect Schema with the same behaviour, the same types and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Outcome:** done.

**What I did**
- Replaced zod with Effect Schema in `apps/server/src/gifs/provider.ts` and `apps/server/src/gifs/giphy.ts`. No `zod` import remains in either file (`routes.ts` and `token.ts` still use zod and were left untouched, as instructed).
- `provider.ts`: `gifItemSchema` / `gifPageSchema` are now `struct(...)` from `@zilar/protocol` (mutable fields, the same shape as `z.infer`). Same rules: `id` 1..128, `title` max 100, URLs validated with `isUrl` (any scheme `new URL()` accepts, matching `z.url()`) and max 2048, optional `mp4Url`/`gifUrl`, `width`/`height` int 1..20000, optional `sizeBytes` int 0..100 MiB, page `nextPos` max 128. `GifItem` / `GifPage` are derived from the schemas (`typeof schema.Type`); `GifSearchOptions` and `GifProvider` are unchanged.
- `giphy.ts`: `renditionSchema`, `gifObjectSchema` and `giphyResponseSchema` are Effect schemas; the old `.loose()` behaviour is kept with `Schema.StructWithRest(..., [Schema.Record(Schema.String, Schema.Unknown)])`. `safeParse` became `Schema.decodeUnknownExit` + `Exit.isSuccess`; `gifPageSchema.parse(...)` became `Schema.decodeUnknownSync(gifPageSchema)(...)`.
- Every branch is preserved: a failed item decode drops that item (`return undefined`), a failed response decode returns `{ items: [] }`, and the final page decode still throws on a bad page. The inline item validator now decodes through the shared `gifItemSchema` (identical rules) instead of repeating them.

**Files changed**
- `apps/server/src/gifs/provider.ts`
- `apps/server/src/gifs/giphy.ts`
- `work/T-0565-effect-schema-gifs.md`

**Commands and results**
- `pnpm install` — completed (peer-dependency warnings only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs` — 3 test files passed, 27 tests passed.
- `pnpm gate` (final run) summary lines:
  - `PASS  install (frozen)  (6.0s)`
  - `PASS  format  (109.3s)`
  - `PASS  lint  (1.9s)`
  - `PASS  typecheck  (1.8s)`
  - `PASS  tests @zilar/server  (1258.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Notes: an earlier gate run failed on `format` (prettier wanted to reflow `GifDimensionSchema` in `provider.ts`); fixed with `prettier --write` on the two files only. The long `tests @zilar/server` step is load from other workers' gates running in parallel on the shared machine, not a hang — the same package tests pass in ~50s when run alone.

**Tests**
- `apps/server/src/gifs/gifs.test.ts`, `apps/server/src/gifs/giphy.effect.test.ts` and `apps/server/src/gifs/routes.test.ts` are unchanged and green.
- No test imports a gifs schema, so no test needed an edit.

**Deviations / notes**
- The inline item validator in `giphy.ts` now reuses the exported `gifItemSchema` rather than duplicating the rules; behaviour is identical (same rules, item dropped on failure).
- Two code comments still mention zod where they explain the equivalent old behaviour (matching repo style, e.g. `apps/server/src/push/api.ts`); there is no `zod` import left.

**Open questions**
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 0 findings. The packet (07:18) is newer than HEAD d7569e84 (07:14).
- **No test file changed.**
- **Lead check:** the lead read the whole diff.
  - The rules are the same: url, lengths and int ranges.
  - `isInt` rejects the `NaN` a bad width could produce, as zod did.
  - The loose Giphy objects stay loose through `StructWithRest`.
  - The drop-item, empty-page and throw branches are kept.
  - The inline item validator now reuses `gifItemSchema`, which has the same rules.
