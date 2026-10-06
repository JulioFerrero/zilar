---
id: T-0369
title: "Web kit: the AIs page row buttons and the Integrations page Remove buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0369-web-ais-integrations-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0369: AIs and Integrations page buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The AIs page rows hand-roll their confirm pair and three icon buttons. The Integrations page puts a hand-rolled outline "Remove" next to a kit "Save".

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default`, `outline` (`border-border-strong bg-surface … hover:bg-surface-raised`), `ghost`, `destructive` (tinted red) and `link`;
  - sizes: `default` (h-8), `sm` (h-7), `lg`, `icon` (size-8), `icon-sm` and `icon-lg`;
  - `cn` merges a caller `className`.
- `apps/web/src/routes/AisPage.tsx` does not import `Button`. `apps/web/src/routes/IntegrationsPage.tsx:5` does.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Kit |
| --- | --- | --- | --- |
| `apps/web/src/routes/AisPage.tsx` | 226 | "Remove" confirm (solid `bg-danger … text-white`, `disabled={deleting}`, `onConfirmDelete`) | `variant="destructive" size="sm"` |
| same | 234 | "Cancel" (`onCancelDelete`, `disabled={deleting}`) | `variant="ghost" size="sm"` |
| same | 245 | `MessageSquare` icon, `aria-label`/`title` "Open chat with …" | `variant="ghost" size="icon"`, `className="text-muted-foreground"` |
| same | 254 | `Pencil` icon, "Edit …" | `variant="ghost" size="icon"`, `className="text-muted-foreground"` |
| same | 263 | `Trash2` icon, "Delete …" (hover `bg-danger/10 text-danger`) | `variant="ghost" size="icon"`, `className="text-muted-foreground hover:bg-danger/10 hover:text-danger"` |
| `apps/web/src/routes/IntegrationsPage.tsx` | 433 | "Remove" (voice transcription, `disabled={busy}`), next to `<Button size="default">` Save | `variant="outline"`, default size |
| same | 563 | "Remove" (Telegram import), same pattern | `variant="outline"`, default size |

- **Leave alone:** the three show/hide key toggles in `IntegrationsPage.tsx` (lines 250, 407 and 541). They sit absolutely inside an input.
- **Tests:** `apps/web/src/components/ais/AisPage.test.tsx` (it imports `@/routes/AisPage`) and `apps/web/src/routes/IntegrationsPage.test.tsx`. They find buttons by role and name. Keep every text, `aria-label`, `title`, `disabled` and handler.

### What to build
1. Replace the seven buttons with `<Button type="button" …>`, using the table. Keep icons (`className="size-4" aria-hidden="true"`), texts, labels and handlers.
2. Import `Button` from `@/components/ui/button` in `AisPage.tsx`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/AisPage.tsx:215-275` and `apps/web/src/routes/IntegrationsPage.tsx:425-445` and `:555-575`.

### Allowed files
`apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/components/ais/AisPage.test.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `work/T-0369-web-ais-integrations-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AisPage IntegrationsPage
pnpm gate
```

### Acceptance
- `AisPage.tsx` has no hand-rolled `<button`.
- `IntegrationsPage.tsx` has only the three key toggles.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
