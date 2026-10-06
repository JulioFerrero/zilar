---
id: T-0390
title: "Web kit: the Machines \"Revoked (n)\" and New AI \"More options\" disclosure toggles use the kit Button"
status: todo
milestone: M5
branch: task/T-0390-web-disclosure-toggles-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0390: disclosure toggles on the kit

## Spec (written by Claude, do not edit)

### Why
Two expand/collapse toggles with a rotating chevron are hand-rolled.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants `ghost` and `link` (`text-primary underline-offset-4 hover:underline`);
  - size `sm` (h-7);
  - `cn` merges a caller `className`.
- **`apps/web/src/routes/MachinesPage.tsx:386`:**
  - `<button type="button" aria-expanded={showRevoked} title={showRevoked ? 'Hide revoked machines' : 'Show revoked machines'} onClick={() => setShowRevoked((value) => !value)} className="flex items-center gap-1 self-start text-[15px] font-semibold hover:text-foreground">` with a `ChevronDown` (`rotate-180` when open) and the text `Revoked ({revokedMachines.length})`;
  - `Button` is already used in the file (line ~399).
- **`apps/web/src/components/ais/NewAiDialog.tsx:266`:**
  - `<button type="button" aria-expanded={moreOptionsOpen} onClick={…toggle} className="flex items-center gap-1 self-start text-[14px] font-medium text-accent">`, with "More options" and a `ChevronDown` via `cn(... moreOptionsOpen && 'rotate-180')`;
  - `Button` is imported from `./AiPageShell` (a re-export of the kit Button).
- **Tests:**
  - `apps/web/src/components/ais/NewAiDialog.test.tsx` clicks `getByRole('button', { name: 'More options' })` (lines 146-206);
  - `apps/web/src/routes/MachinesPage.test.tsx`.

### What to build
1. **Revoked** → `<Button type="button" variant="ghost" size="sm" aria-expanded=… title=… onClick=… className="self-start px-1 text-[15px] font-semibold">` with the same chevron and text.
2. **More options** → `<Button type="button" variant="ghost" size="sm" aria-expanded=… onClick=… className="self-start px-1 text-[14px] font-medium text-accent hover:text-accent">` with the same text and chevron.
3. Keep every aria attribute, `title`, handler and the rotate logic.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/MachinesPage.tsx:380-410` and `apps/web/src/components/ais/NewAiDialog.tsx:260-280`.

### Allowed files
`apps/web/src/routes/MachinesPage.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `work/T-0390-web-disclosure-toggles-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot MachinesPage NewAiDialog
pnpm gate
```

### Acceptance
- `MachinesPage.tsx` has no hand-rolled `<button`.
- `NewAiDialog.tsx` keeps only the template radio chips as raw buttons.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
