---
id: T-0505
title: "Effect lane D1: web lib/api.ts on Effect Schema, part 1 — response helpers accept Effect Schema (zod kept as a temporary second path), sections up to Pinned messages converted"
status: todo
milestone: M5
branch: task/T-0505-effect-web-api-1
model: auto
effort: low
depends_on: [T-0494]
estimate: 1 day
---

# T-0505: web API client on Effect Schema, part 1 of 3

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod, web included. Plan `docs/audit/effect-everywhere-plan.md` §2.6 and lane D (§4.4). `apps/web/src/lib/api.ts` is 2,624 lines with about 576 zod uses, so it moves in 3 parts, one after another:
- **part 1 (this task):** the helpers, plus the sections from the top through "Pinned messages";
- **part 2:** "AI memory" through "Sticker favorites";
- **part 3:** "Telegram import" to the end, then remove zod from the file.

### Verified facts (do not re-derive)
- **`apps/web/src/lib/api.ts`:**
  - **`request<T>(path, schema: z.ZodType<T>, init)`** (line 219):
    - in mock mode it calls `mockRequest`;
    - otherwise it calls `fetch(API_BASE + path)` with `credentials: 'same-origin'` and an `Accept` header;
    - a network failure becomes `ApiError(0, 'network_error', …)`;
    - a non-OK response becomes `toApiError`;
    - **`schema.safeParse(raw)`**: a failure becomes `ApiError(status, 'invalid_response', 'The server sent an unexpected response')`.
  - **`toApiError`** (from line 257) parses `errorBodySchema`.
  - **`searchRequest<T>(params, schema: z.ZodType<T>, signal)`** (line 1558) is the same idea, with `AbortError` passthrough.
  - **Other direct parses:**
    - `topicSchema.safeParse` (line 122);
    - `chatPrefSchema.parse` (line 897);
    - `stickerSchema.safeParse` (1862);
    - `gifPageSchema.safeParse` (2097);
    - `avatarUrlSchema.safeParse` (2539);
    - `backgroundImageSchema.safeParse` (2607).
  - **Section markers** (`// --- Name (T-XXXX) ---`):
    - Topics 339;
    - Group roles 524;
    - Channels 657;
    - Group invite links 720;
    - Join by link 779;
    - Chat preferences 813;
    - Chat folders 900;
    - Pinned messages 972;
    - **AI memory 1024 (where part 2 starts)**;
    - Telegram import 1897 (where part 3 starts).
  - **Exported types:** about 65 `export type X = z.infer<typeof xSchema>`.
- **zod `z.object` (not strict) strips unknown keys.** Effect Schema's default decode (`onExcessProperty: "ignore"`) does the same. **Do not use the protocol's `decodeOrThrow`/`isValid`**: they decode strictly, and a server that adds a field would then break the web app.
- **`@zilar/protocol`** (after T-0494, merged) exports **`struct(fields)`** (`packages/protocol/src/common.ts:15`), which keeps the fields mutable like zod, and uses `Schema.mutable(Schema.Array(...))` for mutable arrays (`task.ts:22`). Use the same, so the exported web types keep zod's mutable shape.
- **Tests:** `apps/web/src/lib/api.test.ts` (if present) and the web tests that call these functions, including `apps/web/src/mock/api.test.ts` (it imports zod for its own assertions; leave it alone in this task).

### What to build
1. **One private helper in `api.ts`:** `decodeResponse<T>(schema, raw): { ok: true; value: T } | { ok: false }`. It accepts **either** a zod schema **or** an Effect Schema (detect it with `Schema.isSchema`), decodes Effect Schemas with `Schema.decodeUnknownExit(schema)` (the default, non-strict), and is the only place that branches on the kind.
   - **`request` and `searchRequest`** take the union type `ResponseSchema<T>` and call `decodeResponse`. The `invalid_response` behaviour stays the same.
   - **This dual path is temporary.** Part 3 removes zod and the branch; mark it with a `// T-0505..T-0507: zod path removed in part 3` comment.
2. **Convert** every schema, `z.infer` type and direct parse **from the top of the file down to line 1023** (the end of "Pinned messages") to Effect Schema:
   - use `struct(...)` from `@zilar/protocol` for objects and `Schema.mutable(Schema.Array(...))` for arrays;
   - `nullable` becomes `Schema.NullOr`, `optional` becomes `Schema.optionalKey` (or `optional` where `undefined` is a value), and enums become `Schema.Literals`;
   - **`errorBodySchema` and `toApiError`** are converted too: same output, still keeping the extra fields as `detail`.
   - The exported type names stay. Every importer must typecheck unchanged.
3. **Sections after line 1023 stay on zod**, untouched.
4. **Tests:** every web test passes **unchanged**. Add `apps/web/src/lib/api.decode.test.ts` covering:
   - an Effect-schema response with an extra unknown field decodes and the field is dropped;
   - a malformed response gives `invalid_response`;
   - a zod-schema response still works through `decodeResponse`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5 and §2.6, `packages/protocol/src/common.ts`, `apps/web/src/lib/api.ts:1-340` and `:1550-1600`, then each section you convert.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api.decode.test.ts`, `work/T-0505-effect-web-api-1.md`.

If `apps/web/package.json` lacks `effect`, add it (`^4.0.0`), add `apps/web/package.json` and `pnpm-lock.yaml` to these Allowed files, and say so in the Report.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib src/mock
pnpm gate
```

### Acceptance
- `request` and `searchRequest` decode Effect Schemas (non-strict) with the same errors.
- Every section through "Pinned messages" is on Effect Schema, with the same exported types.
- The web tests are unchanged and green, and the new decode test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
