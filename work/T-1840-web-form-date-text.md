---
id: T-1840
title: "Web form card: a date field the AI pre-filled with display text ('Fri 17 Oct', as the guide asks) shows that text in a text well instead of an empty native date input; empty or YYYY-MM-DD date fields keep the native picker"
status: merged
milestone: M5
branch: task/T-1840-web-form-date-text
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1840: The web form keeps the AI's date text

## Spec (written by Claude, do not edit)

### Why
**The card guide tells the AI** that every value is a final display string, e.g. `Fri 17 Oct` (`apps/server/src/message-blocks/guide.ts:76`; the meta example is at `:52`). The boards draw the Day well as "Fri 17 Oct" (`docs/design/mockups/blocks/WebChoices.dc.html:131`).

**The web form doesn't follow that:**
- It puts every `date` field in `<input type="date">` (`apps/web/src/components/message/blocks/FormBlock.tsx:142-143`).
- The browser's value sanitizing empties any value that isn't `YYYY-MM-DD`, so a pre-filled "Fri 17 Oct" shows as an empty "dd/mm/yyyy" and is sent as `''`.
- The phone uses a text well for dates (`apps/mobile/src/components/chat/blocks/form-block.tsx:193`), so it shows the text.

### Facts (read by the lead on 2026-10-17)
- **`FormBlock.tsx`** (213 lines):
  - `values` starts from `valuesOf(block)` (`:58`);
  - `control(field)` renders the text/date `<input>` with `type={field.kind === 'date' ? 'date' : 'text'}` (`:141-152`).
- **The protocol field:** `{ id, label, kind: 'text'|'number'|'date', value? }` (`packages/protocol/src/blocks-choices.ts:107-112`).

### Steps
1. **In `FormBlock.tsx`,** a date field uses the native date input only when the block's own `field.value` is missing or matches `/^\d{4}-\d{2}-\d{2}$/`. Otherwise it is a text input showing the value, with the same well style.
   - Decide from `field.value` (the block), not from the edited value, so the input type never flips while typing.
2. **No tests** (UI).

### Allowed files
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `work/T-1840-web-form-date-text.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A form whose date field has `value: "Fri 17 Oct"`** shows "Fri 17 Oct" in the well, and Send sends it.
- **A date field with no value** still opens the native picker.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `usesNativeDate(field)` in `apps/web/src/components/message/blocks/FormBlock.tsx`: a `date` field renders `<input type="date">` only when the block's own `field.value` is missing or matches `/^\d{4}-\d{2}-\d{2}$/`.
- Otherwise the same input renders as `type="text"` with the existing well style, so an AI pre-filled "Fri 17 Oct" is visible and is sent unchanged by Send.
- The decision reads `field.value` from the block, never the edited `values` state, so the input type cannot flip while the user types.
- No tests added, as the spec says (UI change).

### Checks run
- `pnpm install`: Done in 16s using pnpm v10.32.1.
- `pnpm gate` (from repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.5s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files run: the change is UI-only and the package has no nearby tests.

### Round 2
- Applied the lead's fix: `usesNativeDate` now also treats `value: ''` as "no value", so an empty-string date field keeps the native picker (`field.value === undefined || field.value === '' || ISO_DATE.test(field.value)`).
- `pnpm gate`: `GATE PASS` — PASS install (frozen) 1.0s, format 1.1s, lint 0.9s, typecheck 2.6s, effect 0.3s; `SKIP tests @zilar/web (no nearby test files)`; scope check clean (2 changed files, both Allowed).

### Notes for the lead
- Behaviour matches the acceptance: `value: "Fri 17 Oct"` shows the text in the well and Send sends it; no value still opens the native picker; a `YYYY-MM-DD` value keeps the native picker. I did not run the web app by hand.
- Only the two Allowed files changed (`FormBlock.tsx` and this task file). No deviations from the spec.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `0ff9e20a0`.
- **The native picker** shows only when the block's own value is missing, empty or `YYYY-MM-DD`; any other value goes in a text well.
- **The input type** is decided from the block, so it never flips while typing.
- **Round 2** fixed the empty-string nit.
