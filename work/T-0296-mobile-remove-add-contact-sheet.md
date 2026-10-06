---
id: T-0296
title: "Mobile cleanup: remove the unused AddContactSheet; resolveContactChat moves to add-contact.ts"
status: merged
milestone: M5
branch: task/T-0296-mobile-remove-add-contact-sheet
model: auto
effort: low
depends_on: [T-0294]
estimate: 0.1 day
---

# T-0296: remove the dead AddContactSheet

## Spec (written by Claude, do not edit)

### Why
QA run 12 could not reach the mobile "Add contact" sheet. T-0193 (commit `9bae13c1`, "remove Add contact menu entry") replaced it with the `@handle` people search in the chat-list search bar, and nothing renders the sheet now.

`grep -rn AddContactSheet apps/mobile/src` finds only its definition, at `apps/mobile/src/components/contacts/add-contact-sheet.tsx:35`. The 303-line file is dead code, apart from one exported helper.

### Verified facts (do not re-derive)
- `apps/mobile/src/components/contacts/add-contact-sheet.tsx`:
  - exports `AddContactSheet` (line 35, unused);
  - exports `resolveContactChat(chats, contactUserId, domain)` (lines 280-297). It uses `contactChatId` from `../../lib/contacts-api`.
- `resolveContactChat` is imported by:
  - `apps/mobile/src/components/contacts/use-people-search.ts:5`;
  - `apps/mobile/src/components/contacts/contacts.test.tsx:16`, which tests it from line 341.
- `apps/mobile/src/components/contacts/add-contact.ts` already holds the add-contact helpers: `actOnProfileRequest` and `addContactSendFailure`, imported at `use-people-search.ts:4`.
- `contacts.test.tsx` mocks `nativewind`. T-0294 added that mock only because of the sheet's `TextField` import.

### What to build
1. Move `resolveContactChat`, with its doc comment, into `apps/mobile/src/components/contacts/add-contact.ts`, and import `contactChatId` there.
2. Update the two importers to import it from `./add-contact`.
3. Delete `apps/mobile/src/components/contacts/add-contact-sheet.tsx`.
4. In `contacts.test.tsx`:
   - remove the `nativewind` mock if nothing needs it any more;
   - keep every other assertion.
5. Check with `grep -rn "add-contact-sheet" apps/mobile` that nothing references the file any more, and note it in the Report.

### Read first
`AGENTS.md`, the three files above, and `apps/mobile/src/components/contacts/add-contact.ts`.

### Allowed files
`apps/mobile/src/components/contacts/add-contact-sheet.tsx`, `apps/mobile/src/components/contacts/add-contact.ts`, `apps/mobile/src/components/contacts/use-people-search.ts`, `apps/mobile/src/components/contacts/contacts.test.tsx`, `work/T-0296-mobile-remove-add-contact-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts people-search
pnpm gate
```

### Acceptance
- The sheet file is gone, and `resolveContactChat` lives in `add-contact.ts` with its tests passing.
- No behaviour changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
1. Moved `resolveContactChat` (with its doc comment, unchanged) from `add-contact-sheet.tsx` into `add-contact.ts`; added `contactChatId` to that file's `../../lib/contacts-api` import.
2. Updated the two importers to pull it from `./add-contact`:
   - `use-people-search.ts`: merged into the existing `./add-contact` import.
   - `contacts.test.tsx`: moved `resolveContactChat` into the existing `./add-contact` import and dropped the now-unused `./add-contact-sheet` import.
3. Deleted `apps/mobile/src/components/contacts/add-contact-sheet.tsx` (dead code apart from the helper).
4. Removed the `nativewind` mock from `contacts.test.tsx`; no remaining import in that file needs it (the only rendered component, `ProfileCard`, imports no `nativewind` path). Every other assertion was kept.

### Files changed
- `apps/mobile/src/components/contacts/add-contact.ts` — added `contactChatId` import and `resolveContactChat`.
- `apps/mobile/src/components/contacts/use-people-search.ts` — import from `./add-contact`.
- `apps/mobile/src/components/contacts/contacts.test.tsx` — import from `./add-contact`; removed `nativewind` mock.
- `apps/mobile/src/components/contacts/add-contact-sheet.tsx` — deleted.
- `work/T-0296-mobile-remove-add-contact-sheet.md` — status + this Report.

### Commands and real results
- `pnpm install` — `Done in 11.5s using pnpm v10.32.1`.
- `grep -rn "add-contact-sheet" apps/mobile` — no matches (exit 1); nothing references the deleted file.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts.test.tsx people-search` — `Test Files 2 passed (2)`, `Tests 48 passed (48)`.
- `pnpm gate` (repo root) summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (15.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.0s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 4 files are the four code files above (the task file was edited after the gate ran; it is inside the Allowed files).

### Deviations / problems
- None. No behaviour change: the helper body and doc comment were moved verbatim; only import paths changed.

### Open questions
- None.

## Review (written by Claude)

**Approved.** The pre-review was clean (0 nits) and there were no fix rounds.
- The dead 303-line sheet is gone.
- `resolveContactChat` now lives in `add-contact.ts`, and its tests still pass.
- Nothing references the sheet any more (checked with the lead's grep).
