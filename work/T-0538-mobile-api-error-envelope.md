---
id: T-0538
title: "Mobile polish after lane E: one shared lenient error-envelope schema for every Effect API client (restores per-field fallback), the search abort-vs-error race, and the zilar-whistle README"
status: merged
milestone: M5
branch: task/T-0538-mobile-api-error-envelope
model: auto
effort: low
depends_on: [T-0532]
estimate: 0.5 day
---

# T-0538: mobile API error envelope, one shared lenient schema

## Spec (written by Claude, do not edit)

### Why
The lane E pre-reviews (T-0506, T-0524, T-0527, T-0532) found the same small regression several times.

**Before Effect,** each mobile client read the server error envelope `{ error: { code, message } }` **per field**: a valid `message` was kept even when `code` had the wrong type. Some converted clients now decode the envelope **whole or nothing**, so one bad field drops both, giving `request_failed` / `Request failed (N)`. Others use a lenient per-field schema (`LenientErrorStringSchema`).

This task moves every client onto **one** shared lenient schema. It also fixes the search abort race that T-0524's pre-review found, and a stale README line.

### Verified facts (do not re-derive)
- **Per-field lenient already** (the pattern to share): `apps/mobile/src/lib/audit-api.ts:96-106`, `apps/mobile/src/lib/chat-prefs-api.ts:72-82`, `apps/mobile/src/lib/invites-api.ts:51-61` and `apps/mobile/src/lib/search-api.ts:83-93`. Each has `LenientErrorStringSchema = Schema.Unknown.pipe(Schema.decodeTo(...))` and `ErrorBodySchema = struct({ error: … code/message: Schema.optional(LenientErrorStringSchema) … })`. `apps/mobile/src/lib/integrations-api.ts` (T-0532) has its own lenient copy too.
- **Whole-or-nothing** (a strict string `code`/`message` inside `ErrorBodySchema`): `pins-api.ts:104`, `ai-memory-api.ts:63`, `connections-api.ts:90`, `roles-api.ts:68`, `gifs-api.ts:67`, plus `media-api.ts` and `groups-api.ts` (T-0532; find `ErrorBodySchema` by name).
- **The search abort race** (T-0524 pre-review): `apps/mobile/src/lib/search-api.ts` reads and decodes the error body inside the request effect. The post-fetch abort re-check (around lines 203-207, `SearchAborted`) runs only on the success path. **Before T-0524,** the code checked `input.signal?.aborted` right after `fetch` resolved and **before** reading any body, so a user who cancels while a 4xx/5xx arrives got a silent `AbortError`. Now they get a `SearchApiError`.
- **`apps/mobile/modules/zilar-whistle/README.md:18`** still says "zod-validated". Since T-0532 the result is decoded with Effect Schema.

### What to build
1. **Create `apps/mobile/src/lib/api-error-body.ts`** exporting the lenient envelope schema and a small helper, e.g. `errorFieldsOf(body): { code?: string; message?: string }`. A non-string `code` or `message` becomes `undefined` **on its own**, and a missing or non-object `error` gives both `undefined`.
2. **Use it in all twelve clients** listed above, deleting each local copy. Each client keeps its own fallback texts and error class: **only the decode of the envelope changes.**
3. **Search:** check the abort signal right after `fetch` resolves and **before** reading the body, on every path, as before T-0524. A cancel always wins.
4. **README:** change "zod-validated" to "Effect Schema-validated". No other README edits.
5. **Tests:**
   - add `apps/mobile/src/lib/api-error-body.test.ts`, covering a valid envelope, a bad `code` with a valid `message` (message kept), a missing `error`, and a non-JSON or `null` body;
   - add one search test for an abort racing an error response, which expects the `AbortError`;
   - every existing test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/audit-api.ts` (the lenient pattern), `apps/mobile/src/lib/search-api.ts`, then each client's error mapping.

### Allowed files
- `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/api-error-body.test.ts`;
- the twelve clients: `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/connections-api.ts`, `apps/mobile/src/lib/roles-api.ts`, `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/audit-api.ts`, `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/lib/invites-api.ts`, `apps/mobile/src/lib/search-api.ts` and `apps/mobile/src/lib/integrations-api.ts`;
- `apps/mobile/src/lib/search-api.effect.test.ts`;
- `apps/mobile/modules/zilar-whistle/README.md`;
- `work/T-0538-mobile-api-error-envelope.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot src/lib
pnpm gate
```

### Acceptance
- One shared lenient envelope schema is used by all twelve clients, with per-field fallback restored.
- A search cancel always wins over an error response.
- The README is fixed.
- The new tests pass, and every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/lib/api-error-body.ts`: one shared lenient envelope schema (`ErrorBodySchema`) and `errorFieldsOf(body): { code?; message? }`. A non-string `code` or `message` becomes `undefined` on its own; a missing or non-object `error` gives both `undefined`.
- Switched all twelve clients to it and deleted each local copy: `pins-api.ts`, `ai-memory-api.ts`, `connections-api.ts`, `roles-api.ts`, `gifs-api.ts`, `media-api.ts`, `groups-api.ts`, `audit-api.ts`, `chat-prefs-api.ts`, `invites-api.ts`, `search-api.ts`, `integrations-api.ts`. Each keeps its own fallback texts and error class/status/code; only the envelope decode changed. Removed `SchemaGetter` from the five clients that imported it only for that schema (audit, search, invites, chat-prefs, integrations) and kept it in `pins`, `media`, `connections`, which use it for other lenient fields.
- `search-api.ts`: added an abort check right after `fetch` resolves and before reading the body, so a cancel always wins over a 4xx/5xx. The existing pre-fetch and post-parse checks stay.
- `apps/mobile/modules/zilar-whistle/README.md`: changed "zod-validated" to "Effect Schema-validated"; no other README edits.
- Tests: new `api-error-body.test.ts` (valid envelope; bad `code` keeps message; bad `message` keeps code; missing `error`; non-object `error`; `null`/non-JSON body) and a new case in `search-api.effect.test.ts` for a cancel racing a 400, expecting `AbortError`. Existing tests are unchanged.

### Files changed
- `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/api-error-body.test.ts` (new)
- the twelve clients listed above
- `apps/mobile/src/lib/search-api.effect.test.ts`
- `apps/mobile/modules/zilar-whistle/README.md`
- `work/T-0538-mobile-api-error-envelope.md`

### Commands (real results)
- `pnpm install` → done, 1173 packages added, only the pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/api-error-body.test.ts src/lib/search-api.effect.test.ts` → 2 files, 11 tests passed.
- First `pnpm gate` → **GATE FAIL** on `format`: `apps/mobile/src/lib/invites-api.ts: SyntaxError: ':' expected (45:10)`. The edit that deleted the local schema had also dropped the `InviteSchema` fields; I restored them.
- Second `pnpm gate` → **GATE PASS**:
  ```
  PASS  install (frozen)  (3.1s)
  PASS  format  (60.1s)
  PASS  lint  (1.5s)
  PASS  typecheck  (22.3s)
  PASS  tests @zilar/mobile  (35.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  I did not run the task's `pnpm --filter @zilar/mobile test --reporter=dot src/lib` as a separate command; gate's `tests @zilar/mobile` runs the same mobile suite.

### Deviations / notes
- The suggested helper return type `{ code?: string; message?: string }` is built with conditional spreads, because `exactOptionalPropertyTypes` rejects an explicit `code: undefined`; absent fields are omitted instead.
- No security-relevant surface changed: no secrets, logging, routes or data access; only the error-envelope decode, one abort check and a README line.

### Open questions
- None.


Approved (lead, 2026-10-08). One shared lenient envelope (api-error-body.ts) now serves all twelve mobile clients, restoring per-field fallback. Search checks abort right after fetch, before reading the body, and a new test pins it. README fixed. phone:smoke passed on the galena AVD. Nit accepted: a cancel during json() on an error response still loses (millisecond window, pre-existing).
