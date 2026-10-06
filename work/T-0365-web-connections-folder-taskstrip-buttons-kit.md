---
id: T-0365
title: "Web kit: the Connections remove/cancel buttons, the folder editor footer and the task link editor use the kit Button"
status: merged
milestone: M5
branch: task/T-0365-web-connections-folder-taskstrip-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0365: Connections, folder editor and task link buttons on the kit

## Spec (written by Claude, do not edit)

### Why
These text buttons are still hand-rolled. The `key-primary` ones also slip past the `bg-accent` guard (`apps/web/src/components/ui/no-accent-pill.test.ts`), because they use the key class directly.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default` (= `key-primary`), `outline`, `secondary`, `ghost`, `destructive` (a tinted `bg-danger/10 text-danger`) and `link`;
  - sizes: `default` (h-8), `sm` (h-7), `lg` (h-9), plus the icon sizes.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Text | Look today | Kit variant and size |
| --- | --- | --- | --- | --- |
| `apps/web/src/routes/ConnectionsPage.tsx` | 208 | "Remove" (`onClick={() => void confirmRemove(connection.id)}`) | solid `bg-danger … text-white` | `destructive`, `sm` |
| `apps/web/src/routes/ConnectionsPage.tsx` | 215 | "Cancel" (`cancelRemove`) | plain muted | `ghost`, `sm` |
| `apps/web/src/routes/ConnectionsPage.tsx` | 378 | "Cancel" (form, `disabled={busy}`, `onCancel`), next to a kit `Button size="lg"` Save | plain muted | `ghost`, `lg` |
| `apps/web/src/components/FolderEditorDialog.tsx` | 133 | "Delete folder" (`setConfirmingDelete(true)`) | plain `text-danger` | `destructive`, `lg` |
| `apps/web/src/components/FolderEditorDialog.tsx` | 142 | "Cancel" (`onClose`) | plain muted | `ghost`, `lg` |
| `apps/web/src/components/FolderEditorDialog.tsx` | 149 | "Save" or "Saving…" (`disabled={!canSave \|\| busy}`, `save()`) | `key-primary rounded-full px-4 py-1.5` | `default`, `lg` |
| `apps/web/src/components/TaskStrip.tsx` | 413 | "Cancel" (`setLinkOpen(false)`) | plain muted | `ghost`, `sm` |
| `apps/web/src/components/TaskStrip.tsx` | 420 | "Save" (`saveLink`) | `key-primary rounded-full px-3 py-1.5` | `default`, `sm` |

- **Leave alone:**
  - ConnectionsPage: the icon-only buttons (Test, Remove-connection, Close, show/hide key);
  - TaskStrip: the status, owner and add chips and the `menuitemradio` rows.
- **Tests:**
  - `apps/web/src/routes/ConnectionsPage.test.tsx`;
  - `apps/web/src/components/FolderEditorDialog.test.tsx`;
  - `apps/web/src/components/TaskStrip.test.tsx`.

  They find buttons by role and name. Keep every visible text, `aria-label`, `disabled` and handler, so no test should change.

### What to build
1. Replace the eight buttons with `<Button type="button" variant=… size=…>`, using the table. Keep every text, `aria-label`, `disabled` and `onClick`.
2. Import `Button` where it is missing (`TaskStrip.tsx`, `FolderEditorDialog.tsx`).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the three files around the lines above.

### Allowed files
`apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/components/TaskStrip.test.tsx`, `work/T-0365-web-connections-folder-taskstrip-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage FolderEditorDialog TaskStrip
pnpm gate
```

### Acceptance
- The eight buttons are kit `Button`s.
- No `key-primary` class remains in `TaskStrip.tsx` or `FolderEditorDialog.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced the eight hand-rolled text buttons with kit `Button`s, keeping all text, aria-labels, disabled states and handlers. No tests changed.

Files changed:
- `apps/web/src/routes/ConnectionsPage.tsx`: Remove -> `Button destructive sm`; Cancel (confirm) -> `Button ghost sm`; Cancel (form) -> `Button ghost lg`.
- `apps/web/src/components/FolderEditorDialog.tsx`: added `Button` import; Delete folder -> `Button destructive lg`; Cancel -> `Button ghost lg`; Save/Saving… -> `Button default lg`.
- `apps/web/src/components/TaskStrip.tsx`: added `Button` import; Cancel -> `Button ghost sm`; Save -> `Button default sm`.
- Verified `grep key-primary` finds nothing in TaskStrip.tsx, FolderEditorDialog.tsx or ConnectionsPage.tsx (kit `default` variant supplies `key-primary` internally).

Commands (real results):
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage FolderEditorDialog TaskStrip`: 3 files, 29 tests passed.
- `pnpm gate` (first run): GATE FAIL on format (FolderEditorDialog.tsx prettier); fixed with `prettier --write` on that one allowed file.
- `pnpm gate` (final): PASS install (1.4s→2.2s), PASS format, PASS lint, PASS typecheck, PASS tests @zilar/web; scope: every changed file is inside the Allowed files; GATE PASS.

Security checklist: N/A — pure UI button swap, no routes, secrets, deletes, caps or audit changes.

## Review (written by Claude)

Approved (lead, 2026-10-06). All eight buttons are kit `Button` with the specified variants and sizes; texts, `disabled` and handlers kept; no `key-primary` left in TaskStrip or FolderEditorDialog. Pre-review clean (0 findings).
