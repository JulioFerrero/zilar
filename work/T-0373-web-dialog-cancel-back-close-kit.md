---
id: T-0373
title: "Web kit: Cancel, Back and Close in the group handle, Telegram import and New group dialogs use the kit Button"
status: todo
milestone: M5
branch: task/T-0373-web-dialog-cancel-back-close-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0373: dialog Cancel, Back and Close on the kit

## Spec (written by Claude, do not edit)

### Why
Three dialogs pair a kit `Button size="lg"` with a hand-rolled muted text button.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:** `ghost` is `hover:bg-surface-raised hover:text-foreground`, and `lg` is h-9. All three files already import `Button`.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Sibling kit Button |
| --- | --- | --- | --- |
| `apps/web/src/routes/GroupHandleRoute.tsx` | 127 | "Close" (`close`) | line 117, `size="lg"` |
| same | 219 | "Close" (`onClose`) | line 203, `size="lg"` |
| `apps/web/src/components/TelegramImportDialog.tsx` | 242 | "Cancel" (`onClose`, `disabled={busy}`) | line 250, `size="lg"` |
| same | 104 | `X` icon, `aria-label="Close"`, `disabled={busy}`, `rounded-full p-1` | none |
| `apps/web/src/components/NewGroupDialog.tsx` | 140 | "Cancel" (`onClose`) | line 147, `size="lg"` |
| same | 158 | "Back" (`setStep('members')`) | line 165, `size="lg"` |

- **Kit mapping:**
  - the text buttons → `variant="ghost" size="lg"`;
  - the Telegram X → `variant="ghost" size="icon-sm"` with `className="shrink-0 rounded-full text-muted-foreground"`, keeping the icon at `size-4`.
- **Tests:**
  - `apps/web/src/routes/GroupHandleRoute.test.tsx`;
  - `apps/web/src/routes/HandleGate.test.tsx`;
  - `apps/web/src/components/TelegramImportDialog.test.tsx`;
  - `apps/web/src/components/NewGroupDialog.test.tsx`.

  Keep every text, `aria-label`, `disabled` and handler.

### What to build
1. Replace the six buttons with `<Button type="button" …>`, using the mapping.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the three files around the lines above.

### Allowed files
`apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `apps/web/src/routes/HandleGate.test.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `work/T-0373-web-dialog-cancel-back-close-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute HandleGate TelegramImportDialog NewGroupDialog
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in the three files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
