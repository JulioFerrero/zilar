---
id: T-0276
title: "Web kit migration 9: hand-rolled accent buttons in the machines, Telegram import and invite links UI become the kit Button"
status: merged
milestone: M5
branch: task/T-0276-web-kit-accent-buttons-2
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0276: accent buttons on the kit Button, batch 2

## Spec (written by Claude, do not edit)

### Why
This is batch 2 of removing the flat `bg-accent px-` pill outside the kit (`docs/audit/ui-kit-audit.md` line 437). The kit primary is `Button` in `apps/web/src/components/ui/button.tsx`:
- the default variant is `key-primary`;
- sizes are `sm`, `default` and `lg`;
- other variants are `outline` and `ghost`.

T-0265 already used it, for example `<Button type="button" size="sm">Accept</Button>`. T-0275 does batch 1 on three route pages at the same time, so do not touch those pages.

### Verified facts (do not re-derive)
All of the following are `<button type="button">` elements with `bg-accent px-… text-accent-foreground hover:bg-accent/90`.
- `apps/web/src/components/machines/AddMachineDialog.tsx`:
  - lines 114 ("Try again"), 125 ("New code") and 133 ("Done") are `rounded-full px-4 py-1.5 text-[15px]` pills in the Dialog `actions`;
  - line 185 is the copy button (`aria-label="Copy pairing code"`, `rounded-md px-2.5 py-1 text-[13px]`, with an icon).
- `apps/web/src/components/machines/PendingMachineCard.tsx` line 111: the Approve button (`aria-label={`Approve ${machine.name}`}`, `px-3 py-1.5 text-[14px]`, with an icon). It is covered by `apps/web/src/routes/MachinesPage.test.tsx`.
- `apps/web/src/components/TelegramImportDialog.tsx` lines 125, 164, 207 and 259: `px-4 py-1.5 text-[15px]` pills in Dialog `actions`.
- `apps/web/src/components/InviteLinksSection.tsx`:
  - line 125: `rounded-md px-2.5 py-1 text-[13px]` with an icon and `shrink-0`;
  - line 187: `self-start … px-4 py-1.5 text-[14px]`.
- Tests: `apps/web/src/components/machines/AddMachineDialog.test.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`.

### What to build
1. Every button listed above becomes the kit `Button` (`import { Button } from '@/components/ui/button'`):
   - keep `type`, `onClick`, `disabled`, `aria-label`, `title`, the icons and the text;
   - size: `text-[15px]` pills become `size="lg"`; `text-[14px]` becomes `size="default"`; `text-[13px]` becomes `size="sm"`;
   - keep layout-only classes (`shrink-0`, `self-start`) through `className`, and drop the colour, padding, radius, font and gap classes.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one assertion per file group that a migrated button renders with `data-slot="button"`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `work/T-0265-web-kit-people-pages.md` (Report), and the four files with their tests.

### Allowed files
`apps/web/src/components/machines/AddMachineDialog.tsx`, `apps/web/src/components/machines/AddMachineDialog.test.tsx`, `apps/web/src/components/machines/PendingMachineCard.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/InviteLinksSection.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `work/T-0276-web-kit-accent-buttons-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AddMachineDialog MachinesPage TelegramImportDialog InviteLinksSection
pnpm gate
```

### Acceptance
- None of the four source files contains `bg-accent px-`. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
- the muted Close / Cancel pills next to them;
- every other file with `bg-accent px-`.

---

## Report (written by the worker when done)

### What I did
Replaced every listed hand-rolled `bg-accent px-…` button with the kit `Button`
(`import { Button } from '@/components/ui/button'`), keeping `type`, `onClick`,
`disabled`, `aria-label`, `title`, the icons and the text, and mapping size by
font: `text-[15px]` → `size="lg"`, `text-[14px]` → `size="default"`,
`text-[13px]` → `size="sm"`. Colour, padding, radius, font and gap classes are
gone; only layout-only classes stay via `className`.

- `apps/web/src/components/machines/AddMachineDialog.tsx`: "Try again", "New code"
  and "Done" are `Button size="lg"`; the copy button (`aria-label="Copy pairing
  code"`) is `Button size="sm"` with the same title, disabled and `onClick`.
- `apps/web/src/components/machines/PendingMachineCard.tsx`: the Approve button is
  `Button` (default size) with the same `aria-label`, disabled and `onClick`.
- `apps/web/src/components/TelegramImportDialog.tsx`: the two "Close" actions, the
  "Done" action and the "Import" action are `Button size="lg"` (Import keeps
  `disabled={busy}`).
- `apps/web/src/components/InviteLinksSection.tsx`: the "Copy invite link" button is
  `Button size="sm"` with `className="shrink-0"`; the "Create invite link" submit is
  `Button` (default size) with `className="self-start"`.
- Muted Close/Cancel pills, the ✕ close button, the Deny/Revoke buttons and every
  other file with `bg-accent px-` were left alone (out of scope).

### Files changed
- `apps/web/src/components/machines/AddMachineDialog.tsx`
- `apps/web/src/components/machines/AddMachineDialog.test.tsx`
- `apps/web/src/components/machines/PendingMachineCard.tsx`
- `apps/web/src/routes/MachinesPage.test.tsx`
- `apps/web/src/components/TelegramImportDialog.tsx`
- `apps/web/src/components/TelegramImportDialog.test.tsx`
- `apps/web/src/components/InviteLinksSection.tsx`
- `apps/web/src/components/InviteLinksSection.test.tsx`
- `work/T-0276-web-kit-accent-buttons-2.md`

### Tests added
One `data-slot="button"` assertion per test file group: the copy button in
`AddMachineDialog.test.tsx`, the Approve button in `MachinesPage.test.tsx`, the
Import button in `TelegramImportDialog.test.tsx`, and the Create invite link
button in `InviteLinksSection.test.tsx`. Existing queries are by role/text and
needed no change.

### Commands and results
- `pnpm install` — Done (it modified `pnpm-lock.yaml`; I reverted that file with
  `git checkout -- pnpm-lock.yaml`, since it is not in my Allowed files and the spec
  says not to touch it).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AddMachineDialog MachinesPage TelegramImportDialog InviteLinksSection` — `Test Files 4 passed (4)`, `Tests 37 passed (37)`.
- `pnpm gate` — `GATE PASS`:
  - `gate: 9 changed file(s) against main`
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (23.4s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (20.0s)`
  - `PASS  tests @zilar/web  (48.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Also confirmed by search that none of the four source files contains `bg-accent px-`.

### Deviations / open questions
- None. Sizes follow the spec's font mapping; only layout-only classes
  (`shrink-0`, `self-start`) were kept through `className`.

## Review (written by Claude)

Approved: clean pre-review with 0 nits and no fix rounds. All buttons in the four files are now the kit `Button`, with aria labels, icons and texts kept. Each file group has one `data-slot` assertion.
