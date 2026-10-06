---
id: T-0368
title: "Web kit: the machine cards' Rename, Revoke, Delete, Deny and confirm buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0368-web-machine-cards-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0368: machine card buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The three machine cards on the Machines page hand-roll ten buttons. T-0365 already moved the same "solid red confirm + Cancel" pair on the Connections page to the kit; this task makes the cards match it.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default` (`key-primary`), `outline`, `ghost` (`hover:bg-surface-raised hover:text-foreground`), `destructive` (`bg-danger/10 text-danger hover:bg-danger/20`) and `link`;
  - sizes: `default` (h-8), `sm` (h-7), `lg`, `icon` (size-8), `icon-sm` (size-7) and `icon-lg`;
  - `cn` merges a caller `className`.
- `apps/web/src/components/machines/PendingMachineCard.tsx:4` already imports `Button` and uses it for Approve (line 107, default size). The other two cards do not import it.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Kit |
| --- | --- | --- | --- |
| `apps/web/src/components/machines/ApprovedMachineCard.tsx` | 111 | `Pencil` icon, `aria-label` "Rename …", `title`, `disabled={renaming \|\| revoking}` | `variant="ghost" size="icon-sm"`, with `className="text-muted-foreground"` |
| same | 185 | "Revoke" confirm (solid `bg-danger … text-white`, `disabled={renaming}`) | `variant="destructive" size="sm"` |
| same | 193 | "Cancel" (`onCancelRevoke`, `disabled={renaming}`) | `variant="ghost" size="sm"` |
| same | 207 | `PowerOff` icon + "Revoke" (`aria-label` "Revoke …", `text-danger hover:bg-danger/10`) | `variant="ghost"`, default size, `className="text-danger hover:bg-danger/10 hover:text-danger"` |
| `apps/web/src/components/machines/RevokedMachineCard.tsx` | 46 | "Delete" confirm (solid red, `disabled={deleting}`) | `variant="destructive" size="sm"` |
| same | 54 | "Cancel" (`onCancelDelete`) | `variant="ghost" size="sm"` |
| same | 66 | `Trash2` icon + "Delete" (`aria-label` "Delete …", `text-danger`) | `variant="ghost"`, default size, `className="text-danger hover:bg-danger/10 hover:text-danger"` |
| `apps/web/src/components/machines/PendingMachineCard.tsx` | 85 | "Deny" confirm (solid red, `disabled={denying}`) | `variant="destructive" size="sm"` |
| same | 93 | "Cancel" (`onCancelDeny`) | `variant="ghost" size="sm"` |
| same | 116 | `X` icon + "Deny" (`aria-label` "Deny …", `text-danger`) | `variant="ghost"`, default size, `className="text-danger hover:bg-danger/10 hover:text-danger"` |

- **Tests:** `apps/web/src/components/machines/RevokedMachineCard.test.tsx` and `apps/web/src/routes/MachinesPage.test.tsx` find the buttons by role and name. Keep every text, `aria-label`, `title`, `disabled` and handler, so no test should change.

### What to build
1. Replace the ten buttons with `<Button type="button" …>`, using the table. Keep icons (`className="size-4" aria-hidden="true"`), texts, labels, `title`, `disabled` and `onClick`.
2. Import `Button` from `@/components/ui/button` in `ApprovedMachineCard.tsx` and `RevokedMachineCard.tsx`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the three card files.

### Allowed files
`apps/web/src/components/machines/ApprovedMachineCard.tsx`, `apps/web/src/components/machines/RevokedMachineCard.tsx`, `apps/web/src/components/machines/PendingMachineCard.tsx`, `apps/web/src/components/machines/RevokedMachineCard.test.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`, `work/T-0368-web-machine-cards-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot RevokedMachineCard MachinesPage
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in the three card files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
