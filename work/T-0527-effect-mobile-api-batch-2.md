---
id: T-0527
title: "Effect lane E, batch 2: mobile roles-api, gifs-api, ai-memory-api and connections-api onto Effect Schema + the T-0506 request pipeline; same exports, same errors, tests unchanged"
status: merged
milestone: M5
branch: task/T-0527-effect-mobile-api-batch-2
model: auto
effort: low
depends_on: [T-0506]
estimate: 0.5 day
---

# T-0527: mobile API clients batch 2 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included. T-0506 converted `apps/mobile/src/lib/pins-api.ts` as the recipe; `docs/EFFECT_GUIDE.md` section "Moving a mobile API client onto Effect" sums it up. T-0524 (batch 1) runs in parallel on other files.

### Verified facts (do not re-derive)
Mobile validates these boundaries by hand today (no zod). The files, with their exports, which **all stay the same**:
- **`apps/mobile/src/lib/roles-api.ts`** (193 lines): `RoleHolder`, `CustomGroupRole`, `RolesApi`, `RolesApiError`, **`parseCustomGroupRole(value): CustomGroupRole | null`** (line 62) and `createRolesApi`.
- **`apps/mobile/src/lib/gifs-api.ts`** (198 lines): `GifsApiError`, **`parseGifItem(value, apiUrl): GifItem | null`** (line 42), **`gifMediaUrl(mediaToken, apiUrl)`** (line 88), `GifPage`, `TokenProvider`, `GifsApi` and `createGifsApi`.
- **`apps/mobile/src/lib/ai-memory-api.ts`** (179 lines): `AiMemoryFact`, `AiMemory`, `AiMemoryApi`, `AiMemoryApiError` and `createAiMemoryApi`.
- **`apps/mobile/src/lib/connections-api.ts`** (197 lines): `ProviderConnection`, `CreateConnectionInput`, `ConnectionTestResult`, `ConnectionsApi`, `ConnectionsApiError`, **`buildCreateConnectionBody(input)`** (line 85, a request builder that stays as it is) and `createConnectionsApi`.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{roles,gifs,ai-memory,connections}-api.test.ts` and `apps/mobile/src/lib/roles.test.ts`;
  - `apps/mobile/src/store/real-store.roles.test.ts`;
  - `apps/mobile/src/components/chat/{group-roles-sheet,gif-panel,composer-gifs,emoji-sheet}.test.tsx`;
  - `apps/mobile/src/components/ais/{ai-memory-section,ai-memory-sheet}.test.tsx`;
  - `apps/mobile/src/components/connections/{connections-screen.test.tsx,errors.test.ts,save-connection.test.ts}`.
- **Connections carry provider API keys in requests.** Never log a request body, and keep error messages free of the key, exactly as today.

### What to build
1. **Convert the four files with the T-0506 recipe:**
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   `parseCustomGroupRole` and `parseGifItem` become thin wrappers over the schemas.
2. **Tests:** every existing test passes **unchanged**. You may add one new test file per client for a lenient-field or whole-list case the old tests miss.
3. **No new dependencies.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.effect.test.ts`, then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/roles-api.ts`, `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/connections-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/roles-api.effect.test.ts`, `apps/mobile/src/lib/gifs-api.effect.test.ts`, `apps/mobile/src/lib/ai-memory-api.effect.test.ts` and `apps/mobile/src/lib/connections-api.effect.test.ts`;
- `work/T-0527-effect-mobile-api-batch-2.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot roles gifs gif-panel composer-gifs emoji-sheet ai-memory connections
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and run their requests as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the four mobile API clients onto Effect Schema + the T-0506 request
pipeline, following `apps/mobile/src/lib/pins-api.ts` as the recipe.

- `apps/mobile/src/lib/roles-api.ts`: schemas for `RoleHolder`/`CustomGroupRole`
  (mutable member array) and the `{ roles: [...] }` list envelope; exported
  `parseCustomGroupRole` is now a thin `Schema.decodeUnknownExit` wrapper. The
  DELETE 204 path keeps its `(value) => (value === null ? true : null)` check.
- `apps/mobile/src/lib/gifs-api.ts`: schema for a GIF row with the exact old
  bounds (id 1..128, title <=100, mediaToken 1..2048, kind image|video, width /
  height integer 1..4096, optional non-negative integer `sizeBytes`); exported
  `parseGifItem` stays a thin wrapper that rebuilds `url` via `gifMediaUrl`. The
  page envelope keeps `unknown` items so one malformed row is still dropped and
  a non-string `nextPos` is ignored. Abort stays an `AbortError`: the
  pre-aborted and mid-fetch cases fail a `GifsAborted` tag that the `Promise`
  edge re-raises as `Effect.die(new DOMException('Aborted', 'AbortError'))`.
- `apps/mobile/src/lib/ai-memory-api.ts`: schemas for fact/memory (mutable
  `facts` and `lines` arrays) and the error envelope; `getMemory` parses,
  `forgetFact`/`clear` skip parsing exactly as before.
- `apps/mobile/src/lib/connections-api.ts`: connection schema with a lenient
  `label` (`Schema.withDecodingDefault(Effect.succeed(null))` +
  `decodeTo(Schema.NullOr(Schema.String))`, so a missing/`undefined`/non-string
  label becomes `null`); test-result schema with `Schema.optional(message)`;
  list is a bare mutable array. `buildCreateConnectionBody` is unchanged.

All four use the same internal tagged errors and the same fixed mapping to the
existing error class (`status`, `code`, `message` unchanged): unauthorized 401,
network 0, request status/code/message from the server envelope (falling back to
`request_failed` / `Request failed (<status>)`), invalid_response 200. Requests
run as `Effect.fnUntraced` pipelines cut back to `Promise` at the edge with
`Effect.runPromise`. Exported names, types and signatures are unchanged.

### Files changed (all inside Allowed files)
- `apps/mobile/src/lib/roles-api.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `apps/mobile/src/lib/ai-memory-api.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `apps/mobile/src/lib/roles-api.effect.test.ts` (new)
- `apps/mobile/src/lib/gifs-api.effect.test.ts` (new)
- `apps/mobile/src/lib/ai-memory-api.effect.test.ts` (new)
- `apps/mobile/src/lib/connections-api.effect.test.ts` (new)
- `work/T-0527-effect-mobile-api-batch-2.md`

No existing test file was touched. No dependency was added.

### Commands run (real results)
- `pnpm install`: done (1172 packages added), no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/roles-api.test.ts src/lib/gifs-api.test.ts src/lib/ai-memory-api.test.ts src/lib/connections-api.test.ts src/lib/roles.test.ts`: 5 files, 51 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot <the four new *.effect.test.ts>`: 4 files, 9 passed.
- `pnpm --filter @zilar/mobile test --reporter=dot roles gifs gif-panel composer-gifs emoji-sheet ai-memory connections` (the task Checks command): 25 files, 171 passed, exit 0.
- `pnpm gate` (first run): GATE FAIL — format flagged `gifs-api.ts` and `roles-api.ts`; scope line said "every changed file is inside the Allowed files".
- `pnpm exec prettier --write apps/mobile/src/lib/gifs-api.ts apps/mobile/src/lib/roles-api.ts`: rewrote the two files (formatting only).
- `pnpm gate` (final): exit 0 —
  - `PASS install (frozen) (3.8s)`
  - `PASS format (54.3s)`
  - `PASS lint (1.2s)`
  - `PASS typecheck (15.3s)`
  - `PASS tests @zilar/mobile (11.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### New tests added
One per client, covering a case the old tests miss: roles — unknown extra field
dropped + whole list fails `invalid_response` on one malformed row + network
mapping; gifs — extra field dropped + non-string `nextPos` ignored; ai-memory —
extra fields dropped + non-string `lines` entry fails; connections — missing and
non-string `label` decode to `null` + whole list fails on one malformed row.

### Problems / deviations
- My first connections lenient-label test failed: a missing `label` key made the
  strict struct decode fail, because the plain `Schema.Unknown` field is
  required. Fixed with `Schema.withDecodingDefault(Effect.succeed(null))` so the
  schema matches the old guard (missing/non-string -> `null`). No production
  behavior change beyond that fix.
- Only deviation from "one new test file per client": each new file has 2-3
  cases rather than a single case; it still lives in the one file per client the
  spec allows for.
- `gifs-api.effect.test.ts` sets `nextPos: 25` (a number), which the old code
  ignored; the new envelope schema keeps that tolerance.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). The mobile roles, gifs, ai-memory and connections clients are on Effect Schema with the T-0506 pipeline, with the same exports, errors and parse wrappers, and the provider key stays only in the POST body. phone:smoke passed on the galena AVD. Pre-review clean, 0 nits.
