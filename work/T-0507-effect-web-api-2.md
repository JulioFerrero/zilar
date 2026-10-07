---
id: T-0507
title: "Effect lane D2: web lib/api.ts on Effect Schema, part 2 — sections 'AI memory' through 'Sticker favorites'"
status: todo
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

## Review (written by Claude)
