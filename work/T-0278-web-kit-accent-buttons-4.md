---
id: T-0278
title: "Web kit migration 11: hand-rolled accent buttons in profile, visibility, pack editor and contact rows become the kit Button"
status: merged
milestone: M5
branch: task/T-0278-web-kit-accent-buttons-4
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0278: accent buttons on the kit Button, batch 4 (sections)

## Spec (written by Claude, do not edit)

### Why
This is batch 4 of removing the flat `bg-accent px-` pill outside the kit (`docs/audit/ui-kit-audit.md` line 437). T-0275 and T-0276 did batches 1 and 2. Copy their approach; their Reports are in `work/T-0275-web-kit-accent-buttons-1.md` and `work/T-0276-web-kit-accent-buttons-2.md`.

The kit primary is `Button` (`apps/web/src/components/ui/button.tsx`):
- the default variant is `key-primary`;
- sizes are `sm`, `default` and `lg`;
- it renders `data-slot="button"`.

### Verified facts (do not re-derive)
All of these are `<button>` elements with `rounded-… bg-accent px-… text-accent-foreground hover:bg-accent/90`.
- `apps/web/src/components/ProfileSettingsSection.tsx`: line 164 (`px-4 py-1.5 text-[14px]`).
- `apps/web/src/components/VisibilitySection.tsx`: line 210 (`px-4 py-1.5 text-[14px]`).
- `apps/web/src/components/PackEditor.tsx`: line 651 (`px-4 py-2 text-[15px]`).
- `apps/web/src/components/ContactProfileRow.tsx`: lines 204, 220 and 242 (`px-3 py-1.5 text-[13px]`).

Each file has a `*.test.tsx` next to it.

### What to build
1. Every button listed above becomes the kit `Button` (`import { Button } from '@/components/ui/button'`):
   - keep `type`, `onClick`, `disabled`, aria attributes, `title`, icons and text;
   - size: `text-[15px]` becomes `size="lg"`, `text-[14px]` becomes `size="default"`, `text-[13px]` becomes `size="sm"`;
   - keep layout-only classes (`w-full`, `shrink-0`, `self-start`, margins) through `className`; drop the colour, padding, radius, font and gap classes.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `data-slot="button"` assertion per file's test.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `work/T-0276-web-kit-accent-buttons-2.md` (Report), and the four files with their tests.

### Allowed files
`apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ProfileSettingsSection.test.tsx`, `apps/web/src/components/VisibilitySection.tsx`, `apps/web/src/components/VisibilitySection.test.tsx`, `apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/PackEditor.test.tsx`, `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/components/ContactProfileRow.test.tsx`, `work/T-0278-web-kit-accent-buttons-4.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ProfileSettingsSection VisibilitySection PackEditor ContactProfileRow
pnpm gate
```

### Acceptance
- None of the four source files contains `bg-accent px-`. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. `pnpm-lock.yaml` must not change.

### Out of scope
- `FolderRail.tsx:124` (a `<span>` badge, not a button);
- every other file with `bg-accent px-`.

---

## Report (written by the worker when done)

### What I did
Replaced every listed hand-rolled `bg-accent px-…` button with the kit `Button`
(`import { Button } from '@/components/ui/button'`), keeping `type`, `onClick`,
`disabled` and all content (text and icons). Size was mapped by font:
`text-[15px]` → `size="lg"`, `text-[14px]` → `size="default"` (the kit default,
so no `size` attribute), `text-[13px]` → `size="sm"`. Colour, padding, radius,
font, hover and disabled classes are gone; only layout-only classes stay through
`className` (`shrink-0`). The kit base already provides `inline-flex`,
`items-center`, `gap` and `disabled:opacity-50`, so the old `flex items-center
gap-1.5` and `disabled:opacity-60` were dropped.

- `apps/web/src/components/ProfileSettingsSection.tsx`: "Save username" is now
  `<Button type="button" onClick={…} disabled={busy || unchanged}>` (default size).
- `apps/web/src/components/VisibilitySection.tsx`: "Save visibility" /
  "Confirm going private" is now `<Button …>` (default size).
- `apps/web/src/components/PackEditor.tsx`: "Create pack" / "Save" is now
  `<Button … size="lg">`.
- `apps/web/src/components/ContactProfileRow.tsx`: "Message" and "Add contact"
  are `<Button … size="sm" className="shrink-0">`; "Accept" is
  `<Button … size="sm">` (no `shrink-0`, matching the original class list).

The muted border buttons next to them (Copy share link, Cancel, Unblock,
Cancel, Decline) and every other file with `bg-accent px-` were left alone
(out of scope).

### Files changed
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/ProfileSettingsSection.test.tsx`
- `apps/web/src/components/VisibilitySection.tsx`
- `apps/web/src/components/VisibilitySection.test.tsx`
- `apps/web/src/components/PackEditor.tsx`
- `apps/web/src/components/PackEditor.test.tsx`
- `apps/web/src/components/ContactProfileRow.tsx`
- `apps/web/src/components/ContactProfileRow.test.tsx`
- `work/T-0278-web-kit-accent-buttons-4.md`

### Tests added
One `data-slot="button"` assertion per test file, using the codebase's existing
`getAttribute('data-slot')` style:
- `ProfileSettingsSection.test.tsx`: on the "Save username" button.
- `VisibilitySection.test.tsx`: on the "Save visibility" button (in the
  "disables Save while unchanged" test).
- `PackEditor.test.tsx`: on the "Create pack" button (in the "keeps Create
  disabled with no stickers" test).
- `ContactProfileRow.test.tsx`: on the "Add contact" button.
Existing queries are by role/name and needed no behavioural change.

### Commands and results
- `pnpm install` — Done in 16s; `git status` confirms `pnpm-lock.yaml` is
  unchanged.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ProfileSettingsSection VisibilitySection PackEditor ContactProfileRow` — `Test Files 4 passed (4)`, `Tests 30 passed (30)`.
- `pnpm gate` (first run) — `GATE FAIL` at `FAIL format (19.4s)` with
  `[warn] apps/web/src/components/ContactProfileRow.tsx`; scope line still
  `every changed file is inside the Allowed files`.
- `pnpm exec prettier --write apps/web/src/components/ContactProfileRow.tsx` —
  reformatted the single migrated Accept button (collapsed onto one line);
  no other file touched.
- `pnpm gate` (second run) — `GATE PASS`:
  - `gate: 9 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (24.2s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (14.9s)`
  - `PASS  tests @zilar/web  (22.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Confirmed by `grep 'bg-accent px-'` that none of the four source files
  contains it.

### Deviations / open questions
- None. Sizes follow the spec's font mapping; only `shrink-0` was kept through
  `className`, and the `data-slot` assertions are the only test additions.

## Review (written by Claude)

Approved. The pre-review was clean with 0 nits and there were no fix rounds. No `bg-accent px-` is left in the four files, and sizes follow the font mapping.
