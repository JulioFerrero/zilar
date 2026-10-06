---
id: T-0380
title: "Web kit: the settings Back arrow, the AI panel close and the AI activity refresh use the kit Button and lucide icons; the unused AiPageShell frame is removed"
status: todo
milestone: M5
branch: task/T-0380-web-shell-back-icons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0380: shell and AI panel icon buttons on the kit

## Spec (written by Claude, do not edit)

### Why
- Every settings page's Back arrow is a hand-rolled button with a hand-copied inline SVG of lucide's `ArrowLeft`.
- `AiPageShell` has a second copy of that SVG, but no file renders `<AiPageShell`. Its module is still used for `Button` (a re-export), `FieldError` and `SelectOption`.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:** `ghost` is `hover:bg-surface-raised hover:text-foreground`; sizes `icon` (size-8), `icon-sm` (size-7) and `icon-lg` (size-9); `cn` merges a caller `className`.
- **`apps/web/src/components/SettingsShell.tsx:27`:**
  - `<button type="button" aria-label="Back" title="Back" onClick={onBack} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover">`;
  - it holds an inline `<svg … className="size-5">` with the paths `m12 19-7-7 7-7` and `M19 12H5`, which are lucide `ArrowLeft`;
  - it does not import `Button` or lucide.
  - 11 route pages render `<SettingsShell` (IntegrationsPage, ApprovalsPage, StickersPage, AisPage, ProfilePage, NotificationsPage, RequestsPage, BlockedPage, FoldersPage, ConnectionsPage, MachinesPage).
- **`apps/web/src/components/ais/AiPageShell.tsx`:**
  - lines 4-54 hold `export function AiPageShell(...)`, with the same Back button and SVG at line 24;
  - `grep -rn "<AiPageShell" apps/web/src` finds nothing;
  - the module also exports `SelectOption` (line 56), `FieldError` (line 90) and `export { Button }` (line 98), which many files import. Keep those three.
- **`apps/web/src/components/ais/AiPanel.tsx:510`:**
  - `<button type="button" aria-label="Close AI panel" onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover">` with `<X className="size-5" aria-hidden="true" />`;
  - `Button` comes from `./AiPageShell` (line 27).
- **`apps/web/src/components/ais/AiActivity.tsx:179`:**
  - `<button type="button" aria-label="Refresh activity" onClick={refresh} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover">` with `<RefreshCw className="size-4" aria-hidden="true" />`;
  - `Button` comes from `./AiPageShell` (line 7).
- **Tests:**
  - `apps/web/src/components/SettingsShell.test.tsx`;
  - `apps/web/src/components/ais/AiPanel.test.tsx`;
  - `apps/web/src/components/ais/AiActivity.test.tsx`;
  - pages that click "Back" by name: `apps/web/src/routes/ApprovalsPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx` and `apps/web/src/components/tools/tools.test.tsx`.

  Keep every `aria-label`, `title` and handler.

### What to build
1. **SettingsShell Back** → `<Button type="button" variant="ghost" size="icon" aria-label="Back" title="Back" onClick={onBack} className="shrink-0 rounded-full text-muted-foreground"><ArrowLeft className="size-5" aria-hidden="true" /></Button>`. Import `ArrowLeft` from `lucide-react` and `Button` from `@/components/ui/button`.
2. **AiPageShell:** delete the unused `AiPageShell` function and its doc comment. Drop imports that become unused. Keep `SelectOption`, `FieldError` and the `Button` re-export unchanged.
3. **AiPanel close** → `<Button type="button" variant="ghost" size="icon-lg" … className="shrink-0 rounded-full text-muted-foreground">`, keeping the `X` icon.
4. **AiActivity refresh** → `<Button type="button" variant="ghost" size="icon-sm" … className="rounded-full text-muted-foreground">`, keeping the `RefreshCw` icon.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/ais/AiPageShell.tsx`, `apps/web/src/components/ais/AiPanel.tsx:500-520` and `apps/web/src/components/ais/AiActivity.tsx:170-190`.

### Allowed files
`apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/ais/AiPageShell.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/components/SettingsShell.test.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/components/ais/AiActivity.test.tsx`, `apps/web/src/routes/ApprovalsPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `work/T-0380-web-shell-back-icons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot SettingsShell AiPanel AiActivity ApprovalsPage ConnectionsPage tools
pnpm gate
```

### Acceptance
- No inline `<svg` and no `<button` remain in `SettingsShell.tsx` or `AiPageShell.tsx`.
- AiPanel close and AiActivity refresh are kit `Button`s.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
