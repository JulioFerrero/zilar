---
id: T-0506
title: "Effect lane E pilot: mobile pins-api.ts on Effect Schema + an Effect request pipeline, same API and errors; Expo export proves the Hermes bundle"
status: todo
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

## Review (written by Claude)
