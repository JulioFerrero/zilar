---
id: T-0506
title: "Effect lane E pilot: mobile pins-api.ts on Effect Schema + an Effect request pipeline, same API and errors; Expo export proves the Hermes bundle"
status: merged
milestone: M5
branch: task/T-0506-effect-mobile-pins-api
model: auto
effort: low
depends_on: [T-0494]
estimate: 0.5 day
---

# T-0506: mobile pins API on Effect (pilot)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included; he accepted the bundle size. Plan `docs/audit/effect-everywhere-plan.md` §2.7 and pilot P3 (§4.3).

**The 25 `apps/mobile/src/lib/*-api.ts` files validate with hand-written type guards.** This pilot sets the recipe on `pins-api.ts`; the other 24 follow it.

### Verified facts (do not re-derive)
- **`apps/mobile/src/lib/pins-api.ts`** (211 lines):
  - **types:** the `Pin`, `PinMessageInput` and `PinsApi` interfaces, and `class PinsApiError(status, code, message)`;
  - **`parsePinKind(value)`** (line 63) returns the value when it is `text`/`image`/`file`/`voice`/`card`, **otherwise `'text'`**. An unknown kind never fails;
  - **`parsePin(value)`** (line 77) returns `null` unless all 7 string fields are strings, and the kind goes through `parsePinKind`;
  - **`request(...)`** (line 109):
    - a fetch with `accept` and `authorization: Bearer` headers;
    - a throw becomes `PinsApiError(0, 'network_error', 'Could not reach the server')`;
    - a non-OK response takes the code and message from `body.error`, with the fallbacks `request_failed` and `Request failed (<status>)`.
  - **`createPinsApi(getToken, fetchImpl = fetch, apiUrl)`** (line 143):
    - no token gives `PinsApiError(401, 'unauthorized', 'No session')`;
    - a parse that returns null gives `PinsApiError(200, 'invalid_response', 'The server sent an unexpected response')`;
    - **`listPins` fails the whole response if any row is malformed** (it does not drop rows, despite the comment on `parsePin`);
    - `pinMessage` posts JSON; `unpinMessage` sends DELETE with an encoded id.
  - **Re-exports from `./pin-snapshot`** are at lines 210-211.
- **Tests:** `apps/mobile/src/lib/pins-api.test.ts`.
- **The other modules:** `@zilar/protocol` (after T-0494, merged) exports `struct` (`packages/protocol/src/common.ts:15`). After T-0494, `apps/mobile/package.json` depends on `effect`; check it.
- **Hermes:**
  - Effect core and Schema need no new globals (plan §2.7);
  - `crypto.subtle` does not exist on Hermes (`AGENTS.md`), so do not import `effect/http-api` or workflow modules;
  - the bundle check from the plan §3.2: `pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir <dir>`.

### What to build
1. **Schemas in `pins-api.ts`:**
   - a `PinSchema`: the 7 strings, plus `kind` decoded **leniently**. Any value outside the 5 kinds decodes to `'text'`; use a Schema transformation, or decode `kind` as `Unknown` and map it with `parsePinKind`;
   - a `PinsListSchema` (`{ pins: Array<Pin> }`, failing on any bad row, as today);
   - an error-body schema for `{ error: { code?, message? } }`.
   
   Unknown extra keys are dropped (the default, non-strict decode).
2. **`parsePinKind` and `parsePin`** keep their exports and behaviour (other code may import them); `parsePin` becomes a thin wrapper over the schema.
3. **The request pipeline:** an `Effect` built from `Effect.tryPromise` (network, then `network_error`), the JSON body, the error mapping and the decode, typed with a tagged error per case. Run it at the edge of each `PinsApi` method with `Effect.runPromise` and map it back to the **same `PinsApiError` instances, statuses, codes and messages**. Keep the `PinsApi` interface and `createPinsApi` signature unchanged.
4. **Tests:** `pins-api.test.ts` passes **unchanged**. Add `apps/mobile/src/lib/pins-api.effect.test.ts` covering:
   - an unknown kind decodes to `text`;
   - an extra field is dropped;
   - one bad row fails `listPins` with `invalid_response`;
   - a network throw gives `network_error`.
5. **The Hermes bundle check:** run the Expo export command above into a folder **inside your worktree** (for example `tmp-export/`; delete it afterwards and never commit it). Report the bundle file name and its size from `ls -l`.
6. **Report:** write a "Recipe" section for the next 24 files: the schema patterns for lenient fields, the request pipeline shape and the error mapping.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.7 and §3.2, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.test.ts`, `packages/protocol/src/common.ts`.

### Allowed files
`apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.effect.test.ts`, `work/T-0506-effect-mobile-pins-api.md`.

If `apps/mobile/package.json` lacks `effect`, stop and report BLOCKED.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot src/lib/pins-api
pnpm gate
```

### Acceptance
- `pins-api.ts` validates with Effect Schema and requests through an Effect pipeline, with the same API, errors and leniency.
- The existing test is untouched and green, and the new test passes.
- The Expo export succeeds, with its size reported.
- A recipe is in the Report.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review.

### What I did

- Rewrote `apps/mobile/src/lib/pins-api.ts` on Effect Schema (lenient `kind`, list, error
  envelope) with an Effect request pipeline; the public `PinsApi` interface, `createPinsApi`
  signature, `PinsApiError` instances/statuses/codes/messages, the `parsePinKind`/`parsePin`
  exports and the `pin-snapshot` re-exports are unchanged. `parsePin` is now a thin wrapper
  over `PinSchema`.
- Added `apps/mobile/src/lib/pins-api.effect.test.ts` (4 tests: unknown kind to `text`, extra
  field dropped, one bad row fails `listPins` with `invalid_response`, network throw gives
  `network_error`).
- Ran the Expo iOS export to prove the Hermes bundle.

### Files changed

- `apps/mobile/src/lib/pins-api.ts`
- `apps/mobile/src/lib/pins-api.effect.test.ts` (new)
- `work/T-0506-effect-mobile-pins-api.md`

### Commands and real results

- `pnpm install`: done in 27.5s; only a pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/pins-api`:
  2 test files, **11 passed** (the 7 existing + 4 new), existing `pins-api.test.ts` untouched.
- `pnpm --filter @zilar/mobile exec expo export --platform ios --output-dir tmp-export`:
  succeeded, 1 iOS bundle:
  `apps/mobile/tmp-export/_expo/static/js/ios/entry-74327be7a88da11ac98e6c75ca180c0a.hbc`,
  **12191811 bytes** from `ls -l` (~12 MB). The `tmp-export/` folder was deleted afterwards
  and never committed. (Plan §3.2 measured 12,180,112 bytes with Effect+Schema.)
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (21.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.7s)
  PASS  tests @zilar/mobile  (10.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed `format` on the new test file; I fixed it with
  `node_modules/.bin/prettier --write apps/mobile/src/lib/pins-api.effect.test.ts` and the
  run above is the final green run over the committed tree.

### Deviations / notes

- `ErrorBodySchema` replaces the old `isRecord`/`isString` error-body checks (both helpers were
  removed as dead code). Difference: if `body.error` exists but `code` is not a string, the
  whole envelope fails to decode, so **both** code and message fall back
  (`request_failed` / `Request failed (<status>)`); the old code fell back per field. No test
  or caller depends on this, and this is the schema shape the spec asked for.
- `Effect.tryPromise` hands its `AbortSignal` to `fetch`, per `docs/EFFECT_GUIDE.md`; the
  `fetchImpl` seam is unchanged.
- Only `effect` core is imported (no `effect/http-api`, workflow or eventlog modules), so
  nothing on the Hermes-unsafe `crypto.subtle` path is touched.

### Recipe (for the next 24 `*-api.ts` files)

**Lenient enum field** (unknown value must not fail the row):

```ts
const KindSchema = Schema.Literals(['text', 'image', 'file', 'voice', 'card']);
const LenientKindSchema = Schema.Unknown.pipe(
  Schema.decodeTo(KindSchema, {
    decode: SchemaGetter.transform((value) => parseKind(value)),
    encode: SchemaGetter.transform((kind) => kind),
  }),
);
```

**Structs**: use `struct()` from `@zilar/protocol` (it wraps every field in `Schema.mutableKey`,
so the decoded type keeps the mutable fields the old interfaces had). Unknown extra keys are
dropped by the default non-strict decode — that replaces the old "build a fresh object" guard.
For repeated fields use `Schema.mutable(Schema.Array(RowSchema))`. Optional error envelope:

```ts
const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});
```

**Decode without throwing** and keep the old `T | null` contract:

```ts
const decoded = Schema.decodeUnknownExit(RowSchema)(value);
return Exit.isSuccess(decoded) ? decoded.value : null;
```

**Request pipeline shape**: one `Data.TaggedError` per case (`NetworkError`,
`RequestError{status,code,message}`, `Unauthorized`, `InvalidResponse`); a module-level
`Effect.fnUntraced(function* (...) : EffectType.fn.Return<unknown, NetworkError | RequestError>)`
that does `Effect.tryPromise({ try: (signal) => fetchImpl(...), catch: () => new NetworkError() })`,
reads the body with `Effect.promise(() => response.json().catch(() => null))`, and fails
`RequestError` on `!response.ok`. A per-client `withToken` effect gets the token with
`Effect.promise(() => getToken())`, fails `Unauthorized` when undefined, runs the request, and
fails `InvalidResponse` when the decode returns `null`. Cut to a Promise once per method:

```ts
Effect.runPromise(
  withTokenEffect(path, init, parse).pipe(
    Effect.catchTags({
      Unauthorized: () => Effect.fail(new ApiError(401, 'unauthorized', 'No session')),
      NetworkError: () => Effect.fail(new ApiError(0, 'network_error', 'Could not reach the server')),
      RequestError: (e) => Effect.fail(new ApiError(e.status, e.code, e.message)),
      InvalidResponse: () =>
        Effect.fail(new ApiError(200, 'invalid_response', 'The server sent an unexpected response')),
    }),
  ),
);
```

**Gotchas**: keep the explicit `EffectType.fn.Return<A, E>` annotation (without it the error
channel widens and `catchTags` stops typechecking) — import `type Effect as EffectType` like
`apps/server/src/gifs/giphy.ts`. Do not import `effect/http-api`, workflow or eventlog on
mobile (Hermes has no `crypto.subtle`). `pnpm gate` checks formatting, so run prettier on new
files before it.

## Review (written by Claude)

Approved (lead, 2026-10-08). The mobile pins-api.ts is on Effect Schema with an Effect request pipeline, cut to a Promise at the edge. The public API and errors are unchanged, and the lenient kind is decoded with Schema.decodeTo. The Expo iOS export succeeded (12.2 MB hbc). phone:smoke passed on the galena AVD (chat list with live data). Pre-review clean; the nit (the error envelope decodes whole-or-nothing) is accepted. This is the recipe for the other mobile *-api.ts files.
