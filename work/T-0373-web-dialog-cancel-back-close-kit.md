---
id: T-0373
title: "Web kit: Cancel, Back and Close in the group handle, Telegram import and New group dialogs use the kit Button"
status: merged
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

Replaced all six hand-rolled `<button>` elements with the kit `Button`, keeping every
text, `aria-label`/`title`, `disabled` and handler:

- `apps/web/src/routes/GroupHandleRoute.tsx`: both "Close" buttons → `<Button
  type="button" variant="ghost" size="lg" …>`.
- `apps/web/src/components/TelegramImportDialog.tsx`: "Cancel" → ghost/lg (kept
  `disabled={busy}`); the X close icon → `<Button variant="ghost" size="icon-sm"
  className="shrink-0 rounded-full text-muted-foreground">` keeping `aria-label="Close"`,
  `title="Close"`, `disabled={busy}` and the `size-4` icon.
- `apps/web/src/components/NewGroupDialog.tsx`: "Cancel" → ghost/lg; "Back" → ghost/lg
  (kept `setStep('members')` handler).

Files changed: the three files above plus this task file (front matter only).
No test files needed changes. Verified `grep -n "<button"` returns nothing in the three
files.

Commands and real results:
- `pnpm install`: pass (21.1s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute HandleGate TelegramImportDialog NewGroupDialog`: 5 files, 41 tests, all passed.
- `pnpm gate` (first run): GATE FAIL on format only (`NewGroupDialog.tsx` Prettier
  line-wrap on the Back button); fixed the wrapping by hand, did not run format --write.
- `pnpm gate` (final): GATE PASS — PASS install, format, lint, typecheck,
  tests @zilar/web; "scope: every changed file is inside the Allowed files";
  4 changed files against main.

Security checklist: no secrets touched; no data deletes/updates; no new routes;
no permission or audit changes — N/A for this pure UI-button migration.

## Review (written by Claude)

Approved (lead, 2026-10-06). The five Cancel/Back/Close text buttons are kit ghost `lg` matching their `lg` siblings; the Telegram X is ghost `icon-sm`. Texts, labels, disabled and handlers kept. Pre-review clean (0 findings).
