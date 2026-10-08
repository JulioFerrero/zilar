---
id: T-0598
title: "Tool args T-D: web-tools/adapters.ts five arg schemas + two Wikipedia response schemas zod to Effect Schema through the T-0594 seam; same accept/reject; the test helper decodes through decodeActionArgs; no zod left in web-tools/adapters.ts or its test"
status: merged
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

### What I did

Converted the seven schemas in `apps/server/src/web-tools/adapters.ts` from zod to
Effect Schema, and pointed the five adapter `argsSchema` fields at the T-0594 seam.

- Removed `import { z } from 'zod'`; added `import { Schema } from 'effect'` and the
  `ArgsSchema` type import from `../actions/registry`.
- `webFetchArgsSchema`: `Schema.Struct` with `url` (`isMinLength(1)`,
  `isMaxLength(MAX_FETCH_URL_CHARS)`) and optional `maxChars` (`Schema.Number` with
  `isInt()`, `isGreaterThanOrEqualTo(1)`, `isLessThanOrEqualTo(MAX_FETCH_CHARS)`).
  This is `z.number().int().min(1).max(...)`; `isInt()` rejects `NaN` and `Infinity`
  like the old `z.number().int()`. Cast at line 185.
- `webWikipediaArgsSchema`: `query` = `Schema.Trim.check(isMinLength(1), isMaxLength(200))`
  (trim before the length checks, like `.trim().min().max()`). `lang` optional, checked
  with `Schema.makeFilter` returning the byte-identical text `lang must be 2-3 letters`
  for anything not matching `/^[a-zA-Z]{2,3}$/`. I used `makeFilter` rather than a
  `{ message }` option because `docs/EFFECT_GUIDE.md` ("Effect 4 facts") warns that
  `{ message }` on some checks does not reach the issue annotations; `makeFilter` is the
  documented carrier. Cast at line 318.
- `webPriceArgsSchema`: `symbols` = `Schema.Array(Schema.String.check(Schema.isPattern(PRICE_SYMBOL_PATTERN)))`
  with array-level `isMinLength(1)` / `isMaxLength(MAX_PRICE_SYMBOLS)`. Cast at line 389.
- `webFeedArgsSchema`: same shape as `web.fetch` with `limit` bounded by `MAX_FEED_LIMIT`.
  Cast at line 490.
- `webSearchArgsSchema`: `query` = `Schema.Trim.check(isMinLength(1), isMaxLength(MAX_SEARCH_QUERY_CHARS))`.
  Cast at line 540.
- `wikipediaSearchSchema` / `wikipediaExtractSchema`: `Schema.Struct`/`Schema.Record`
  equivalents (not strict, so unknown keys strip by default, matching the old plain
  `z.object`). `pageid` = `Schema.Int`; `missing` = `Schema.optional(Schema.Unknown)`.
- `parseWikipediaSearch` / `parseWikipediaExtract`: now `typeof schema.Type` and
  `Schema.decodeUnknownSync(schema)(JSON.parse(body))` inside the existing `try`; any
  failure still returns `null`. The public signatures and the `WikipediaArticle` shape
  are unchanged.
- `apps/server/src/web-tools/adapters.test.ts`: only the helper (line ~102) and its
  imports changed. Dropped `import { z } from 'zod'`, added `decodeActionArgs` to the
  existing `../actions/registry` import, and the helper now calls
  `decodeActionArgs(adapter.argsSchema, args)` and uses `.ok` / `.value`.

All other files are untouched. No dependency was added.

### Commands run (real results)

- `pnpm install` — Done, exited 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot web-tools actions`
  — `Test Files 16 passed (16)`, `Tests 203 passed (203)`, exited 0.
- Inline probe of the lang check (no file written):
  `node --input-type=module -e '...'` in `apps/server` — `accept en: Success`,
  `reject abcd first line: lang must be 2-3 letters`. The message survives byte-identical.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (43.2s)
  PASS  lint  (2.8s)
  PASS  typecheck  (67.4s)
  PASS  tests @zilar/server  (11.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed

- `apps/server/src/web-tools/adapters.ts` (seven schemas, imports, five casts, two parse helpers)
- `apps/server/src/web-tools/adapters.test.ts` (imports + the `run` helper only)
- `work/T-0598-web-tools-args-effect.md` (status + this Report)

### Deviations / decisions

- `lang` uses `Schema.makeFilter` instead of `isPattern(..., { message })`; the spec
  allowed either, and I chose the guide's documented carrier and probed it. The text is
  discarded at the seam anyway (`decodeActionArgs` returns only `ok`/`false`), so no
  behaviour depends on it.
- `Schema.Number.pipe(Schema.check(Schema.isInt(), ...))` is used instead of `Schema.Int`
  for the bounded integers, matching the nearby web-tools style
  (`web-tools/prices.ts:62`); it rejects `NaN`/`Infinity` like `z.number().int()`.
- The word "zod" still appears in one pre-existing explanatory comment in the test
  (`adapters.test.ts:218`); it is prose, not an import or call, and the spec says only
  the helper and imports change, so I left it.

### Blocked / needs a decision

None.

### Security checklist

No boundary, route, delete/update scope, permission, audit or secret handling changed:
this task only swaps the validation library behind the existing `argsSchema` seam, and
accept/reject behaviour is covered by the unchanged tests (203 passed).

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet (13:59) is newer than HEAD 8b11d540.
- **Lead check:**
  - grep finds no zod import in `web-tools/adapters.ts` or its test;
  - the five arg schemas and the two Wikipedia response schemas are converted;
  - in the test file, only the helper changed.
- **Follow-up (nit):** a comment at `adapters.test.ts:218` still says "the zod schema".
