---
id: T-0366
title: "Web kit: the contact profile row's Unblock, Cancel request, Decline and block buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0366-web-contact-row-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0366: contact profile row buttons on the kit

## Spec (written by Claude, do not edit)

### Why
`ContactProfileRow` mixes kit `Button`s (Message, Add contact, Accept) with six hand-rolled ones next to them.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default` (`key-primary`), `outline`, `ghost`, `destructive` (tinted red) and `link`;
  - sizes include `sm` (h-7).
  - The file already imports `Button` (line 17), and its kit Buttons use `size="sm"` with a lucide icon `className="size-3.5"`.
- **The six hand-rolled buttons in `apps/web/src/components/ContactProfileRow.tsx`** (the line is the `<button`):

| Line | Text | Look today | Kit variant and size | Keep |
| --- | --- | --- | --- | --- |
| 192 | "Unblock" or "Unblocking…" (`disabled={busy}`) | `rounded-full border border-border` | `outline`, `sm` | `className="shrink-0"` |
| 225 | `UserMinus` icon + "Cancel" or "Cancelling…" (`disabled={busy}`) | `rounded-full border border-border` | `outline`, `sm` | `className="shrink-0"` |
| 240 | `UserX` icon + "Decline" (`disabled={busy}`) | `rounded-full border border-border` | `outline`, `sm` | |
| 263 | `Ban` icon + "Block" or "Blocking…" (`aria-label="Confirm block"`, `disabled={busy}`) | solid `bg-danger … text-white` | `destructive`, `sm` | |
| 273 | "Cancel" (`setConfirmingBlock(false)`, `disabled={busy}`) | `rounded-full border border-border` | `outline`, `sm` | |
| 285 | `Ban` icon + "Block" (opens the confirm) | plain text link | `ghost`, `sm` | `className="self-start"` |

- **Tests:** `apps/web/src/components/ContactProfileRow.test.tsx` and `apps/web/src/components/PeopleSearchResult.test.tsx` find these buttons by role and name. Keep every text and `aria-label`, so no test should change.

### What to build
1. Replace the six buttons with `<Button type="button" variant=… size="sm">`, using the table. Keep:
   - every icon (`className="size-3.5" aria-hidden`);
   - every text, `aria-label`, `disabled` and `onClick`;
   - the layout classes in the last column.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and `apps/web/src/components/ContactProfileRow.tsx:180-300`.

### Allowed files
`apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/components/ContactProfileRow.test.tsx`, `apps/web/src/components/PeopleSearchResult.test.tsx`, `work/T-0366-web-contact-row-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ContactProfileRow PeopleSearchResult
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in `ContactProfileRow.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
