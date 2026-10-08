---
id: T-0550
title: "Effect lane E, batch 6: mobile contacts-api and stickers-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged"
status: todo
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

## Review (written by Claude)
