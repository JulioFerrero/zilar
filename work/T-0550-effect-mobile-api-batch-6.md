---
id: T-0550
title: "Effect lane E, batch 6: mobile contacts-api and stickers-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged"
status: merged
milestone: M5
branch: task/T-0550-effect-mobile-api-batch-6
model: auto
effort: low
depends_on: [T-0547]
estimate: 1 day
---

# T-0550: mobile API clients batch 6 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase moves to Effect 4, mobile included.
- **Recipe:** `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect".
- **Recent examples:** `apps/mobile/src/lib/profile-api.ts` (T-0541) and `apps/mobile/src/lib/ais-api.ts` (T-0547).
- **Shared lenient error envelope:** `apps/mobile/src/lib/api-error-body.ts`. Use it; never write a local `ErrorBodySchema`.

### Verified facts (do not re-derive)
These files validate by hand today. **Every export stays the same.**
- **`apps/mobile/src/lib/contacts-api.ts`** (418 lines) exports `ContactsApiError` (line 82) and `createContactsApi` (326), plus the exported types. These pure helpers stay as they are:
  - `normalizeHandleInput` (99);
  - `domainOfJid` (304);
  - `contactChatId` (321).
- **`apps/mobile/src/lib/stickers-api.ts`** (459 lines) exports `StickersApiError` (16) and `createStickersApi` (229).
  - These three parsers are exported and **stay exported with the same signatures**, as thin wrappers over a schema decode:
    - `parseStickerItem(value, packId): StickerItem | null` (41);
    - `parseStickerPack(value): StickerPack | null` (80);
    - `parseTelegramImportResult(value): TelegramImportResult | null` (121).
  - Sticker uploads send bytes: keep every request body, header and path exactly as they are. Only the response decode changes.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{contacts-api,blocked-users,stickers-api,stickers-storage}.test.ts`;
  - `apps/mobile/src/components/contacts/*.test.{ts,tsx}`;
  - `apps/mobile/src/components/stickers/*.test.{ts,tsx}`;
  - `apps/mobile/src/components/chat/sticker-panel.test.tsx`;
  - `apps/mobile/src/store/*.test.ts` (they run the real store with these clients).

### What to build
1. **Convert both files with the recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way. One bad item in a list is dropped, or fails the call, exactly as today;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
2. **Tests:** every existing test passes **unchanged**. You may add one new `*.effect.test.ts` per client.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/profile-api.ts`, then both files and their tests.

### Allowed files
- `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/stickers-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/contacts-api.effect.test.ts`, `apps/mobile/src/lib/stickers-api.effect.test.ts`;
- `work/T-0550-effect-mobile-api-batch-6.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot contacts blocked stickers sticker-panel telegram-import pack-editor src/store
pnpm gate
```

### Acceptance
- Both clients decode with Effect Schema and the shared envelope, and run as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Converted `apps/mobile/src/lib/contacts-api.ts` and `apps/mobile/src/lib/stickers-api.ts`
to the T-0506 Effect recipe (Effect Schema decode + `Effect.fnUntraced` request pipeline
with `Effect.runPromise` at the edge), using the shared `errorFieldsOf` envelope from
`api-error-body.ts`. No local `ErrorBodySchema` written.

What changed:
- `contacts-api.ts`: strict `struct` schemas for profile/person/view/row/block shapes;
  lenient fields via `Schema.Unknown.pipe(Schema.decodeTo(...))` — nullable
  `image`/`handle`/`jid` decode to `null`, `decidedAt` to `undefined` (key omitted),
  `incoming` to `=== true`. List decodes (`incoming`/`outgoing`, `blocked`) fail the
  whole call on one bad row, exactly as the hand validator did. `normalizeHandleInput`,
  `domainOfJid`, `contactChatId`, all method paths/bodies/headers, `ContactsApiError`
  (status/code/message) unchanged.
- `stickers-api.ts`: strict row schemas with Effect 4 `Schema.check` filters
  (`isMinLength`/`isMaxLength`/`isInt`/`isGreaterThanOrEqualTo`/`isLessThanOrEqualTo`,
  same pattern as `gifs-api.ts`); first attempt with v3-style `Schema.minLength` failed
  at import (`Schema.minLength is not a function`) and was fixed. `parseStickerItem`,
  `parseStickerPack`, `parseTelegramImportResult` stay exported with the same signatures
  as thin wrappers over schema decodes (emoji: non-string fails the row, null/'' -> null,
  else `slice(0, 8)`; `partial` defaults to false; editor metadata picked leniently).
  Pack/favorite/discover lists drop one bad row and keep the rest. Upload keeps the exact
  bytes path, headers (`content-type`, `x-emoji` percent-encoded) and URL; a rejected
  `binaryUpload.upload` still propagates raw via `Effect.promise`. Error envelope via
  shared `errorFieldsOf`, so a non-string code/message falls back per field.
- No existing test touched; no new `*.effect.test.ts` added (existing coverage sufficed).

Files changed: `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/stickers-api.ts`
(plus this task file).

Commands and real results:
- `pnpm install`: ok (43.5s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/contacts-api.test.ts src/lib/stickers-api.test.ts`: 2 files, 47 tests passed.
- Task Checks `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts
  blocked stickers sticker-panel telegram-import pack-editor src/store`: 547 passed,
  1 skipped.
- `pnpm gate` (final): PASS install (8.6s), PASS format (137.8s), PASS lint (2.4s),
  PASS typecheck (50.6s), PASS tests @zilar/mobile (25.8s); scope: every changed file is
  inside the Allowed files; GATE PASS.

Problems: format gate failed once (my two files needed prettier); lint gate failed once
(two dead helpers `parseRequestPerson`/`parseRequestRow` left from the rewrite, removed).
Both fixed, gate re-run to PASS.

Security checklist: bearer tokens only in `authorization` headers, never logged; error
envelope carries server code/message into the fixed error classes only; no new routes,
no deletes/updates beyond the existing scoped API calls; no secrets in code.

## Review (written by Claude)

Approved (lead, 2026-10-08). The contacts and stickers mobile clients are on Effect Schema plus the T-0506 pipeline and the shared envelope, with the same exports, parse wrappers, list-failure granularity and upload requests. phone:smoke with ZILAR_ROUTES covering /, /settings/requests, /settings/blocked and /settings/stickers: all passed, and the screens render. Nit accepted: an invalid decidedAt now omits the key instead of setting it to undefined (not observable through toEqual or JSON).
