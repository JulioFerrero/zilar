---
id: T-0610
title: "Effect Schema: approvals/service.ts zod to Effect Schema (CreateApprovalInputSchema strict with the groupId/topicId refine, worstCase, the note check); same accept/reject, same ApprovalServiceError codes, the refine text kept; error texts never echo input values; tests unchanged"
status: todo
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

## Review (written by Claude)
