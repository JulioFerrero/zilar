---
id: T-0610
title: "Effect Schema: approvals/service.ts zod to Effect Schema (CreateApprovalInputSchema strict with the groupId/topicId refine, worstCase, the note check); same accept/reject, same ApprovalServiceError codes, the refine text kept; error texts never echo input values; tests unchanged"
status: merged
milestone: M5
branch: task/T-0610-approvals-input-schema
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0610: the approval input schema on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. `apps/server/src/approvals/service.ts` is one of the last server files that imports zod.

### Verified facts (do not re-derive; read lines 1-70, 150-170 and 255-270)
**The schemas** (30-65):

| Schema | Rule |
| --- | --- |
| `actionSchema` | a string of 1 to 100 |
| `summarySchema` | 1 to 500 |
| `detailsSchema` | at most 20000, optional |
| `argsHashSchema` | the `ARGS_HASH_PATTERN` regex |
| `noteSchema` | at most 500, optional |
| `requestedBySchema` | 1 to 3071 |
| `groupIdSchema` and `topicIdSchema` | 1 to 128, optional |
| `aiIdSchema` | 1 to 128 |
| `worstCaseSchema` | **strict** `{ currency: 'EUR' \| 'USD', amount: finite ≥ 0 }` |
| `CreateApprovalInputSchema` | a **strict** object with `expiresAt: z.date()`, plus the refine `(groupId === undefined) === (topicId === undefined)` with the message **`groupId and topicId must be set together`** |

**Other facts:**
- **`CreateApprovalInput`** (67) is `z.infer` of the schema, used by `approvals/service.test.ts:28,141` and `actions/gateway.ts:479`. It keeps the same TypeScript shape: optional keys stay optional under `exactOptionalPropertyTypes`, so use `Schema.optional` as `docs/EFFECT_GUIDE.md` says.
- **The parse sites:**
  - `createApproval` (157) throws `ApprovalServiceError('invalid_request', <first message> ?? 'Invalid approval request')`;
  - `decideApproval` (262) throws `ApprovalServiceError('invalid_request', 'Invalid note')`.
- **Where the messages go.** The only caller of `createApproval` is `actions/gateway.ts:479`, and it **discards** the error (512-523: it logs fixed text and answers `denied`). The tests assert `errorCode: 'invalid_request'` only (`approvals/service.test.ts:229,245,259`).
- **The rule for messages:**
  - keep the refine text exactly;
  - for every other failure, the message must **never contain the input value** (Effect's default messages can quote the value). Use `'Invalid approval request'` for any failure that is not the refine.
- **`z.date()`** rejects an invalid `Date` (`new Date(NaN)`). Pick an Effect schema that also rejects it, and probe both a valid and an invalid date.
- **Mappings:**
  - **strict** becomes a strict decode (`onExcessProperty: 'error'`) for both the outer object and `worstCase`;
  - `z.number().finite().nonnegative()` becomes `Schema.Finite` plus `≥ 0`;
  - **length checks** use `Schema.makeFilter` wherever a custom text is needed (Effect 4.0.2 drops `{ message }` on `isMinLength` and `isMaxLength`).
- **Tests (all unchanged):**
  - `apps/server/src/approvals/*.test.ts`;
  - `apps/server/src/actions/*.test.ts`;
  - the authz sweep (`authz-sweep`).

### What to build
1. Convert every schema and both parse sites with the same accept/reject behaviour, the same error codes, the refine text kept, and no value echoed. The file has no zod import.
2. **In the Report,** list probe results for:
   - an extra key;
   - an extra key inside `worstCase`;
   - `amount: -1`;
   - `amount: NaN`;
   - an invalid `Date`;
   - `groupId` without `topicId` (the refine text);
   - a 501-character `summary` (the message must not contain the summary).
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages") and `apps/server/src/approvals/service.ts` (lines 1-300).

### Allowed files
`apps/server/src/approvals/service.ts`, `work/T-0610-approvals-input-schema.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals actions authz-sweep
pnpm gate
```

### Acceptance
- `approvals/service.ts` has no zod; it accepts and rejects the same inputs, and no message echoes a value.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted `apps/server/src/approvals/service.ts` from zod to Effect Schema. The file no longer imports zod (the only remaining `z.` is the text "z.strictObject" inside a comment).

- **Schemas:**
  - Strings use `Schema.String.check(Schema.isMinLength(n), Schema.isMaxLength(m))`; optional fields use `Schema.optional(...)` (per `docs/EFFECT_GUIDE.md`, because of `exactOptionalPropertyTypes`).
  - `argsHash` uses `Schema.isPattern(ARGS_HASH_PATTERN)`; the pattern is anchored (`/^[0-9a-f]{64}$/`), so it matches zod's `.regex`.
  - `worstCase` is a `Schema.Struct` with `Schema.Literals(['EUR','USD'])` and `Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))`.
  - `expiresAt` uses `Schema.Date` (rejects an invalid `Date`, like `z.date()`).
  - `CreateApprovalInputSchema` is strict via the decode option `{ onExcessProperty: 'error' }` (applies to the outer object and the nested `worstCase`), and carries the group/topic refine via `Schema.check(Schema.makeFilter(...))` keeping the exact text `groupId and topicId must be set together`.
- **Parse sites:**
  - `createApproval` calls a new local `parseCreateApprovalInput(input)` that runs `Schema.decodeUnknownResult(CreateApprovalInputSchema, { onExcessProperty: 'error' })`. On failure it keeps the refine text when present and otherwise throws `ApprovalServiceError('invalid_request', 'Invalid approval request')`. Because the message is always one of two constants, no input value can be echoed (Effect's default messages may quote the value).
  - `decideApproval` validates the note with `Schema.decodeUnknownResult(noteSchema)` and still throws `ApprovalServiceError('invalid_request', 'Invalid note')`.
  - `ApprovalServiceError.errorCode` values and all other logic are unchanged.
- `CreateApprovalInput` is now `typeof CreateApprovalInputSchema.Type`; the TypeScript shape is unchanged (optional keys stay optional), so `service.test.ts` and `actions/gateway.ts` compile unchanged.

### Files changed

- `apps/server/src/approvals/service.ts` (conversion)
- `work/T-0610-approvals-input-schema.md` (status + this Report only)

### Probe results

Temporary probe script against the exported schema plus the same message mapping (script removed afterwards):

| Input | Result |
| --- | --- |
| valid input | accepted |
| an extra key | `Invalid approval request` |
| an extra key inside `worstCase` | `Invalid approval request` |
| `amount: -1` | `Invalid approval request` |
| `amount: NaN` | `Invalid approval request` |
| an invalid `Date` (`new Date(NaN)`) | `Invalid approval request` |
| `groupId` without `topicId` | `groupId and topicId must be set together` |
| `topicId` without `groupId` | `groupId and topicId must be set together` |
| a 501-character `summary` | `Invalid approval request` (message did not contain the summary) |

### Commands and real results

- `pnpm install` → `Done in 23.5s` (exit 0).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals actions authz-sweep` → **17 test files passed, 262 tests passed** (342.61s).
- `pnpm gate` (from repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (25.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.0s)
  PASS  tests @zilar/server  (2072.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The test step runs `vitest --changed main` for the server package and is long under the shared machine's load; earlier attempts were killed by environment restarts, not by test failures.)

### Tests

All listed tests are unchanged and green: `approvals/*.test.ts`, `actions/*.test.ts`, and `authz-sweep`.

### Deviations / notes

- None from the spec. `effect` was already a dependency; no dependencies added.
- Every non-refine decode failure maps to the fixed `Invalid approval request` text rather than Effect's default text, which is what keeps values out of messages.

### Blocked / needs a decision

- none

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 2 nits. The packet (18:11) is newer than HEAD 8f7cf309.
- **No test file changed.**
- **Lead check:**
  - there is no zod;
  - the decode is strict for the outer object and `worstCase`;
  - `Schema.Date` rejects an invalid Date, and `Schema.Finite` rejects NaN;
  - every returned message is a fixed string (the refine text or `Invalid approval request`), so no input value is echoed.
- **Follow-ups (nits):**
  - the refine is detected by a substring of the full error text (`service.ts:90`), so an overlong summary that contains that sentence would get the refine text. That is harmless, but a later task should read the issue tree instead;
  - a stale `z.strictObject` comment (`service.ts:80`).
