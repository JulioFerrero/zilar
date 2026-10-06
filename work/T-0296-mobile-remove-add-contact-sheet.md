---
id: T-0296
title: "Mobile cleanup: remove the unused AddContactSheet; resolveContactChat moves to add-contact.ts"
status: todo
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

## Review (written by Claude)
