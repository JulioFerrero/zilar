---
id: T-0508
title: "Effect lane D4: web lib/drafts.ts, lib/tools.ts and store/chatListCache.ts from zod to Effect Schema; same behaviour, tests unchanged"
status: merged
milestone: M5
branch: task/T-0508-effect-web-drafts-tools-cache
model: auto
effort: low
depends_on: [T-0494]
estimate: 0.5 day
---

# T-0508: three small web zod files on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` lane D lists the 4 web zod files. `lib/api.ts` is split across T-0505, T-0507 and a third part; **this task does the other three.** They share no code with `api.ts` except importing `ApiError`.

### Verified facts (do not re-derive)
- **`apps/web/src/lib/drafts.ts`** (95 lines):
  - `draftEventSchema` (line 13) is `{ type: 'draft', chatJid: min 1, turnId: z.string().uuid(), text }`;
  - `endEventSchema` (line 20) has `outcome` as `'sent' | 'failed'`;
  - the exported `DraftEvent` and `DraftEndEvent` are `z.infer` types (lines 27-28);
  - **`parseEvent(schema, data)`** (line 49) returns `undefined` for a non-string, bad JSON or a failed parse. **Invalid events are dropped silently and nothing throws.**
  
  Test: `apps/web/src/lib/drafts.test.ts`.
- **`apps/web/src/lib/tools.ts`** (253 lines):
  - imports zod, `ApiError` from `@/lib/api` and `mockRequest`;
  - **the exported schemas**, each with a `z.infer` type: `toolListItemSchema` (line 13, with `nullable` and an optional `approvedHosts`), `toolDetailSchema` (an `.extend` of it, line 32), `toolVersionSchema` (38), `toolVersionDetailSchema` (an `.extend`, 51) and `toolRunSchema` (57). **Nothing outside `tools.ts` imports these schemas**; only the types are used;
  - `toolRunResultSchema` is a `z.discriminatedUnion('ok', …)` (around line 72);
  - **its own request helper** (from about line 98) parses `errorBodySchema` for `code` and `message` (with the fallbacks `request_failed` and `Request failed (<status>)`) and `schema.safeParse` gives `invalid_response`.
  
  Test: `apps/web/src/lib/tools.test.ts`.
- **`apps/web/src/store/chatListCache.ts`** (116 lines):
  - `lastMessageSchema` and `cachedChatSchema` are `z.object(...).passthrough()`, so **unknown keys are kept**;
  - `cacheSchema` is `{ version: literal CACHE_VERSION, userId, chats: array }`;
  - `readChatListCache` (line 44) uses `safeParse(JSON.parse(raw))`.
  
  Test: `apps/web/src/store/chatListCache.test.ts`.
- **zod `z.object` strips unknown keys,** and Effect's default decode does the same. **`.passthrough()` keeps them;** in Effect 4 use `Schema.StructWithRest(Struct, [Schema.Record(Schema.String, Schema.Unknown)])` (`effect/dist/Schema.d.ts:3379`) or an equivalent, and prove it with a test.
- **`@zilar/protocol`** (after T-0494) exports `struct(...)`, which keeps the fields mutable like zod (`packages/protocol/src/common.ts:15`). Arrays use `Schema.mutable(Schema.Array(...))`. A UUID check uses `Schema.isUUID` or an `isPattern`; check the `.d.ts`.

### What to build
1. **Convert the three files to Effect Schema** with the same exported names: the schemas keep their exported names even though only the types are imported. Keep the same bounds, the UUID check, the enums, the discriminated union on `ok`, and the passthrough on the two cache schemas.
2. **The same runtime behaviour:**
   - `parseEvent` drops invalid events silently;
   - the tools request helper gives the same `ApiError`s;
   - `readChatListCache` behaves the same on bad or old data.
3. **Remove `zod` from these three files.** Do not remove it from `apps/web/package.json`; `api.ts` still uses it.
4. **Tests:** the three existing tests pass **unchanged**. Add `apps/web/src/store/chatListCache.schema.test.ts`: an unknown key on a cached chat and on its `lastMessage` survives a write and read round trip.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, the three files and their tests, `packages/protocol/src/common.ts`.

### Allowed files
`apps/web/src/lib/drafts.ts`, `apps/web/src/lib/tools.ts`, `apps/web/src/store/chatListCache.ts`, `apps/web/src/store/chatListCache.schema.test.ts`, `work/T-0508-effect-web-drafts-tools-cache.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib/drafts src/lib/tools src/store/chatListCache
pnpm gate
```

### Acceptance
- The three files have no zod, with the same behaviour, including passthrough and silent drops.
- The tests are unchanged and green, and the round-trip test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the three web files from zod to Effect Schema with the same exported
names, bounds, enums and runtime behaviour.

- `apps/web/src/lib/drafts.ts`: `draftEventSchema` / `endEventSchema` now use
  `struct(...)` from `@zilar/protocol`, `Schema.Literal`, `Schema.Literals`
  and `Schema.check(Schema.isMinLength(1))` / `Schema.check(Schema.isUUID())`.
  `parseEvent` decodes with `Schema.decodeUnknownResult` and returns
  `undefined` (silent drop) on a non-string, bad JSON or a failed decode.
- `apps/web/src/lib/tools.ts`: all schemas on `struct(...)`; `.extend` became a
  field spread (`struct({ ...base.fields, source: Schema.String })`);
  `z.array` became `Schema.mutable(Schema.Array(...))`; `z.null()` became
  `Schema.Null`; the `ok` discriminated union became a `Schema.Union` of structs
  with boolean literals. The local request helper now takes
  `Schema.ConstraintDecoder<T>` and maps a failed decode of `errorBodySchema` to
  the same `request_failed` / `Request failed (<status>)` fallbacks, and a
  failed body decode to `invalid_response`.
- `apps/web/src/store/chatListCache.ts`: `lastMessageSchema` and
  `cachedChatSchema` use `Schema.StructWithRest(struct({...}),
  [Schema.Record(Schema.String, Schema.Unknown)])`, so unknown keys survive
  (the `.passthrough()` behaviour). `readChatListCache` decodes with
  `Schema.decodeUnknownResult`. `zod` is gone from all three files;
  `apps/web/package.json` is untouched so `api.ts` keeps zod.
- Added `apps/web/src/store/chatListCache.schema.test.ts`: an unknown key on a
  cached chat and on its `lastMessage` survives a write/read round trip.

No exported name changed and no existing test was edited.

### Files changed (all inside Allowed files)
- `apps/web/src/lib/drafts.ts`
- `apps/web/src/lib/tools.ts`
- `apps/web/src/store/chatListCache.ts`
- `apps/web/src/store/chatListCache.schema.test.ts` (new)
- `work/T-0508-effect-web-drafts-tools-cache.md`

### Commands and results
`pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/drafts src/lib/tools src/store/chatListCache`
→ Test Files 4 passed (4); Tests 21 passed (21) (the three existing suites plus
the new round-trip test).

`pnpm gate` (from the repo root):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (8.5s)
PASS  format  (50.7s)
PASS  lint  (1.9s)
PASS  typecheck  (21.6s)
PASS  tests @zilar/web  (55.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran `pnpm exec prettier --write` on the four source files before the gate
(`format:check` is part of the gate); the other gate steps were only run by the
gate itself.

### Problems / deviations
None.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). drafts.ts, tools.ts and chatListCache.ts moved from zod to Effect Schema, with no zod imports left. The cache passthrough uses StructWithRest, and a new round-trip test proves extra keys survive. Existing web tests unchanged and green. Pre-review clean.
