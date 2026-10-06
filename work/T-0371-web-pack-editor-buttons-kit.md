---
id: T-0371
title: "Web kit: the sticker pack editor's move, retry, remove and Cancel buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0371-web-pack-editor-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0371: pack editor buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The sticker pack editor hand-rolls its per-sticker controls and its footer Cancel next to a kit Save.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default`, `outline`, `ghost` (`hover:bg-surface-raised hover:text-foreground`), `destructive` and `link`;
  - sizes: `default`, `sm` (h-7), `lg` (h-9), `icon`, `icon-sm` (size-7 rounded-md) and `icon-lg`;
  - `cn` merges a caller `className`.
- `apps/web/src/components/PackEditor.tsx:13` imports `Button`. The footer Save is `<Button … size="lg">` at line 641.
- **The buttons to migrate** (the line is the `<button`):

| Line | Content | Kit |
| --- | --- | --- |
| 586 | `ChevronUp` icon, `aria-label` "Move … up", `disabled={index === 0 \|\| busy}` | `variant="ghost" size="icon-sm"`, `className="text-muted-foreground"` |
| 595 | `ChevronDown` icon, "Move … down" | the same |
| 605 | "Retry" (`retryItem`, `disabled={busy}`) | `variant="ghost" size="sm"`, `className="text-muted-foreground"` |
| 614 | `X` icon, "Remove …" (hover `bg-danger/10 text-danger`) | `variant="ghost" size="icon-sm"`, `className="text-muted-foreground hover:bg-danger/10 hover:text-danger"` |
| 651 | "Cancel" (`onCancel`, `disabled={busy}`) | `variant="ghost" size="lg"` |

- **Tests:** `apps/web/src/components/PackEditor.test.tsx`. `apps/web/src/routes/StickersPage.tsx` renders the editor, so `apps/web/src/routes/StickersPage.test.tsx` may reach it too. Keep every text, `aria-label`, `disabled` and handler.

### What to build
1. Replace the five buttons with `<Button type="button" …>`, using the table. Keep icons (`className="size-4" aria-hidden="true"`).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and `apps/web/src/components/PackEditor.tsx:575-660`.

### Allowed files
`apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/PackEditor.test.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `work/T-0371-web-pack-editor-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PackEditor StickersPage
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in `PackEditor.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
