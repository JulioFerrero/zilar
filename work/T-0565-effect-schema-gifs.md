---
id: T-0565
title: "Effect Schema, server batch 2: gifs/provider.ts and gifs/giphy.ts drop zod for Effect Schema; GifItem/GifPage types identical; Giphy response parsing drops the same bad items; tests unchanged"
status: todo
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

## Review (written by Claude)
