---
id: T-0507
title: "Effect lane D2: web lib/api.ts on Effect Schema, part 2 — sections 'AI memory' through 'Sticker favorites'"
status: merged
milestone: M5
branch: task/T-0507-effect-web-api-2
model: auto
effort: low
depends_on: [T-0505]
estimate: 1 day
---

# T-0507: web API client on Effect Schema, part 2 of 3

## Spec (written by Claude, do not edit)

### Why
This continues T-0505 (merged). The plan is in `docs/audit/effect-everywhere-plan.md` §2.6 and lane D.

### Verified facts (do not re-derive)
- **After T-0505,** `apps/web/src/lib/api.ts` has a private `decodeResponse(schema, raw)` that accepts a zod schema **or** an Effect Schema. `request` and `searchRequest` take `ResponseSchema<T>`. Read T-0505's Report for the exact names and patterns.
- **Your range** is the section markers from `// --- AI memory (T-0443) ---` through the end of `// --- Sticker favorites (T-0121) ---` (it stops right before `// --- Telegram import (T-0123) ---`). That covers:
  - AI memory, Media gallery, AIs, Machines, Approvals, Approval rules, Message search, Stickers, Push notifications, Sticker favorites;
  - the direct parse `stickerSchema.safeParse` in the Stickers upload path;
  - the `searchRequest` callers in Message search.
- **The patterns to copy** are the sections T-0505 converted: `struct(...)` from `@zilar/protocol`, `Schema.mutable(Schema.Array(...))`, `Schema.NullOr`, `Schema.optional` (T-0505 used it, not `optionalKey`, because of `exactOptionalPropertyTypes`), `Schema.Literals`, `Schema.StructWithRest` for a zod `.catchall`, and the non-strict decode.

### What to build
1. **Convert** every schema, `z.infer` type and direct parse in your range to Effect Schema, with the same exported type names. Every importer must typecheck unchanged.
2. **Keep the raw-fetch upload paths' behaviour** (status codes, `invalid_response`, abort handling) exactly as today; only the parse changes.
3. **Leave the sections outside your range untouched.**
4. **Tests:** every web test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `work/T-0505-effect-web-api-1.md` (its Report), `apps/web/src/lib/api.ts` (the helpers, then your range).

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `work/T-0507-effect-web-api-2.md`.

`apps/web/src/lib/api.test.ts` calls zod `.parse` and `.safeParse` on `machineSchema` (lines 70 and 93), `publicApprovalSchema` (412-560) and `approvalRuleSchema` (565). Effect schemas have no `.parse`, so change **only** those calls, as T-0505 did:
- `.parse(x)` becomes `Schema.decodeUnknownSync(schema)(x)`;
- `.safeParse(x).success` becomes `Exit.isSuccess(Schema.decodeUnknownExit(schema)(x))`.

**No assertion changes.**

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib src/mock src/store
pnpm gate
```

### Acceptance
- "AI memory" through "Sticker favorites" are on Effect Schema, with the same exported types and behaviour.
- The web tests are unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done. `pnpm gate` ends with `GATE PASS` and every changed file is inside the Allowed files.**

### What I did
- Converted every schema, `z.infer` type and direct parse in my range ("AI memory" through the end of "Sticker favorites") to Effect Schema, keeping the exported type names (now `typeof xSchema.Type`): AI memory, Media gallery, AIs, Machines, Approvals, Approval rules, Message search, Stickers, Push notifications, Sticker favorites. Used `struct(...)` from `@zilar/protocol`, `Schema.mutable(Schema.Array(...))`, `Schema.mutable(Schema.Tuple(...))`, `Schema.NullOr`, `Schema.optional` (per T-0505), `Schema.Literals`, `Schema.Literal`, `Schema.Null`, `Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))` and `Schema.String.pipe(Schema.check(Schema.isMinLength(1)))`.
- `uploadStickerFile`'s direct `stickerSchema.safeParse(raw)` now goes through the existing private `decodeResponse(stickerSchema, raw)`; the status codes, `invalid_response` and abort handling are unchanged.
- `publicApprovalSchema`'s `z.boolean().default(false)` and `z.array(z.string()).default([])` became `Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false)))` and `Schema.mutable(Schema.Array(Schema.String)).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([])))`, so a missing key still decodes to `false` / `[]` and the exported type stays required (`ExactOptionalPropertyTypes` shapes unchanged).
- Updated `apps/web/src/lib/api.test.ts`: added `import { Exit, Schema } from 'effect'` and changed only the schema `.parse` / `.safeParse` calls on `machineSchema`, `publicApprovalSchema` and `approvalRuleSchema` to `Schema.decodeUnknownSync(...)` / `Exit.isSuccess(Schema.decodeUnknownExit(...))`. No assertion changed.
- Sections after "Sticker favorites" (Integrations, Voice, GIFs, Audit, …) stay on zod, except the two forced boundary changes below.

### Files changed
- `apps/web/src/lib/api.ts` — conversions in range + the forced boundary fixes below + the `ResponseSchema` fix below.
- `apps/web/src/lib/api.test.ts` — only the parse calls above plus the `effect` import.
- `work/T-0507-effect-web-api-2.md` — this report and status.

### Forced changes outside the section range (all inside the Allowed file)
1. **`ResponseSchema<T>` in the helper now uses `Schema.Codec<T, unknown>` instead of `Schema.Codec<T>`.** `Codec<T>` defaults its encoded type to `T`, so a field whose decoded type differs from its encoded type (any decoding default) made `request<T>` infer a `T` with that field optional. With `Codec<T, unknown>` only the decoded type drives inference; the runtime and the `invalid_response` path are unchanged. This is required by any conversion of zod `.default` and will disappear in part 3 when the union does.
2. **`telegramImportResultSchema` (first schema of the part-3 "Telegram import" section) was converted too, because it embeds `stickerPackSchema`.** A zod `z.object` cannot hold an Effect Schema field, so leaving it would break the file and the `importTelegramStickers` test. Only its own fields were converted; the rest of part 3 is untouched.
3. **`export type TopicApprovalRule` (Group roles section) changed from `z.infer<typeof approvalRuleSchema>` to `typeof approvalRuleSchema.Type`.** T-0505's report explicitly left this alias on zod because `approvalRuleSchema` was still zod then; now that my range converts `approvalRuleSchema`, `z.infer` of an Effect schema no longer typechecks. No behavior change.

### Commands run (real results)
- `pnpm install` → exit 0, `Done in 15.4s using pnpm v10.32.1`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api.test.ts` → `Test Files 1 passed (1)`, `Tests 96 passed (96)` (first run surfaced the missing part-3 dependent schema; fixed, then green).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib src/mock src/store` → `Test Files 45 passed (45)`, `Tests 602 passed (602)`.
- `pnpm exec prettier --write apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts` (format only, as T-0505 did).
- `pnpm gate` (from the repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (48.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (14.5s)
  PASS  tests @zilar/web  (104.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec (all deliberate)
1. The three forced boundary changes above; without them the web app cannot typecheck or the Telegram import test cannot pass.
2. `Schema.optional` for every zod `.optional()` (T-0505's choice, for `ExactOptionalPropertyTypes`).
3. `Schema.mutable(Schema.Tuple(...))` for `z.tuple` and `Schema.mutable(Schema.Array(...))` for `z.array` to keep the mutable shapes; `Schema.withDecodingDefaultTypeKey` for `.default(...)`.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). Web api.ts sections AI memory through Sticker favorites are on Effect Schema, with the same exported types and the same invalid_response paths. api.test.ts changed only its parse calls. Forced boundary changes are disclosed and checked: ResponseSchema as Schema.Codec, telegramImportResultSchema (it embeds stickerPackSchema), and the TopicApprovalRule alias. Pre-review clean, 0 nits. Part 3 (Telegram import to the end) is next.
