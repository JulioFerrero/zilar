---
id: T-0601
title: "Effect Schema: ai/litellm-client.ts zod to Effect Schema (input checks that throw before any request, LiteLLM response shapes behind parseResponse); same throws, same 'unexpected response shape' error that never echoes the body, same defaults (spend 0) and nullish fields; tests unchanged"
status: todo
milestone: M5
branch: task/T-0601-litellm-client-schema
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0601: the LiteLLM admin client on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. `apps/server/src/ai/litellm-client.ts` is the largest zod client left (plan §5.4, `docs/audit/tool-args-schema-plan.md`).

### Verified facts (do not re-derive; read every site)
**Input schemas** (118-138):
- `KeySchema`: a string of 1 to 4096;
- `ModelsSchema`: an array of 1+ strings, each 1 to 256;
- `BudgetSchema`: a finite number ≥ 0;
- `SpendSchema`: a finite number;
- `LimitSchema`: an int > 0;
- `DurationSchema`: 1 to 64;
- `AliasSchema`: 1 to 256;
- `ModelNameSchema`: a regex, with the message `must be 1-64 characters ...`;
- `ProviderModelSchema`: a regex, with the message `must look like "provider/model"`;
- `ApiKeySchema`: 1 to 4096;
- `ModelIdSchema`: 1 to 512.

They are used with a **throwing** `.parse(...)` at 375-389, 404, 427-445, 457, 478-481 and 503, always before any request.

**Response schemas** (140-215 and on):
- **`GeneratedKeySchema`:**
  - `key` (`KeySchema`);
  - `token_id`, `token`, `key_alias` and `max_budget`: each nullish;
  - `spend` and `models`: optional;
  - a refine that requires `token_id ?? token`.
- **`KeyInfoSchema`** and **`UpdateResponseSchema`:** `spend: z.number().default(0)` (**a missing `spend` decodes to 0**), and the other fields nullish or optional.
- `KeyInfoResponseSchema`.
- `DeleteResponseSchema`.
- **`NewModelResponseSchema`:** `model_id?` or `model_info.id?`.
- `DeleteModelResponseSchema`.
- **`ModelListResponseSchema`:** read it all; entries without an id or a name are skipped.

**How responses are decoded.** `parseResponse(operation, schema, value)` (272-279) throws `new LitellmApiError(operation, 200, 'unexpected response shape')` on any failure. **The message never echoes the body**, and that is security-relevant; keep it exactly. Its `schema: z.ZodType<T>` parameter becomes the Effect type.

**Mappings:**
- zod `.nullish()` becomes `Schema.optional(Schema.NullOr(X))`;
- `.default(0)` becomes a decoding default, which must produce `0` in the decoded value when the key is missing;
- these zod objects are not strict, so keep Effect's default (extra keys ignored);
- `z.number()` rejects `NaN`/`Infinity`, so use `Schema.Finite` where zod had `z.number()`.

**Tests** (`apps/server/src/ai/litellm-client.test.ts`):
- 235-244 and 437-443: invalid inputs throw before any request;
- 294 and 381: unexpected shapes are rejected **without echoing** the body;
- the `LitellmApiError` cases at 198, 231, 279 and 422.

### What to build
1. Convert every schema and parse site:
   - a throwing `.parse` becomes a sync decode that throws an `Error`;
   - `parseResponse` decodes with Effect and keeps its exact error.
2. Every exported type and function keeps its signature, and the file has no zod import.
3. **Tests:** every listed test passes **unchanged**:
   - `apps/server/src/ai/*.test.ts`;
   - `apps/server/src/ais/*.test.ts`;
   - `apps/server/src/agents/reply.test.ts`;
   - `apps/server/src/connections/*.test.ts`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), `apps/server/src/ai/litellm-client.ts` (all of it), and `apps/server/src/ai/litellm-client.test.ts` (lines 180-450).

### Allowed files
`apps/server/src/ai/litellm-client.ts`, `work/T-0601-litellm-client-schema.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot ai/ ais agents/reply connections
pnpm gate
```

### Acceptance
- There is no zod in `litellm-client.ts`, with the same throws, the same never-echo response error, and the same defaults.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
