---
id: T-0598
title: "Tool args T-D: web-tools/adapters.ts five arg schemas + two Wikipedia response schemas zod to Effect Schema through the T-0594 seam; same accept/reject; the test helper decodes through decodeActionArgs; no zod left in web-tools/adapters.ts or its test"
status: todo
milestone: M5
branch: task/T-0598-web-tools-args-effect
model: auto
effort: low
depends_on: [T-0594]
estimate: 0.5 day
---

# T-0598: the web tool args on Effect Schema (plan task T-D)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md`, §1.5 and §4 T-D. T-0594 added the seam (`apps/server/src/actions/registry.ts:8-27`):
- `ArgsSchema<Args>` accepts an Effect `Schema.Codec<Args, unknown, never>`;
- `decodeActionArgs(schema, raw)` decodes Effect schemas with `onExcessProperty: 'error'`.

### Verified facts (do not re-derive)
**`apps/server/src/web-tools/adapters.ts`** (zod import at line 12). Every one of the five arg schemas is `.strict()`:
- **`webFetchArgsSchema` (167-172):** `url` (a string of 1 to `MAX_FETCH_URL_CHARS`), `maxChars?` (an int from 1 to `MAX_FETCH_CHARS`). Cast at 179.
- **`webWikipediaArgsSchema` (223-231):**
  - `query`: trimmed, 1 to 200;
  - `lang?`: matches `/^[a-zA-Z]{2,3}$/`, with the message **"lang must be 2-3 letters"**. Keep that text with `makeFilter` or the message option, and probe that it survives (Effect 4.0.2 can drop `{ message }`; see the guide).
  
  Cast at 313.
- **`webPriceArgsSchema` (375-379):** `symbols` is an array of `PRICE_SYMBOL_PATTERN` strings, with 1 to `MAX_PRICE_SYMBOLS` items. Cast at 386.
- **`webFeedArgsSchema` (464-469):** `url` (1 to `MAX_FETCH_URL_CHARS`), `limit?` (an int from 1 to `MAX_FEED_LIMIT`). Cast at 490.
- **`webSearchArgsSchema` (532-536):** `query` (trimmed, 1 to `MAX_SEARCH_QUERY_CHARS`). Cast at 544.
- **`wikipediaSearchSchema` (237-242) and `wikipediaExtractSchema` (243-256)** are **not strict** (extra keys stripped; keep Effect's default). `parseWikipediaSearch` (264-276) and `parseWikipediaExtract` (278-...) decode them with `.parse` inside `try`, and any failure gives `null`. Keep that.
  - `pageid` is an int;
  - `pages` is a `Record<string, {...}>`;
  - `missing` is `unknown`, optional.
- **Numbers:** `z.number()` rejects `NaN` and `Infinity`, so use `Schema.Finite` with `isInt` and the min/max checks (`docs/EFFECT_GUIDE.md`, "Effect 4 facts").
- **The test helper.** `apps/server/src/web-tools/adapters.test.ts:103` reads `(adapter.argsSchema as z.ZodType<unknown>).safeParse(args)`, and line 16 imports zod. Change it to `decodeActionArgs(adapter.argsSchema, args)` (from `../actions/registry`), with `.ok` and `.value` in place of `.success` and `.data`. **This is the only test change.**

### What to build
1. **`adapters.ts`:**
   - convert the seven schemas;
   - the five adapter casts become the Effect type (`ArgsSchema<unknown>` from `../actions/registry`, or `Schema.Codec<unknown, unknown, never>`);
   - the two parse helpers keep returning `null` on any failure;
   - remove the zod import.
2. **`adapters.test.ts`:** only the helper (around line 103) and its imports change.
3. **Tests:** every other test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), `docs/audit/tool-args-schema-plan.md` (§1.5 and §4 T-D), `apps/server/src/actions/registry.ts` (lines 1-30), `apps/server/src/web-tools/adapters.ts` and `apps/server/src/web-tools/adapters.test.ts` (lines 1-20 and 95-110).

### Allowed files
`apps/server/src/web-tools/adapters.ts`, `apps/server/src/web-tools/adapters.test.ts`, `work/T-0598-web-tools-args-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot web-tools actions
pnpm gate
```

### Acceptance
- The five web tool arg schemas and the two Wikipedia response schemas are on Effect Schema with the same accept/reject behaviour.
- There is no zod in either file.
- Only the test helper changed in the test file.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
