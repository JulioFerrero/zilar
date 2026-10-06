---
id: T-0271
title: "Mobile kit migration: Connections and Machines list sections use SectionLabel and Card (no per-row boxes)"
status: merged
milestone: M5
branch: task/T-0271-mobile-kit-connections-machines
model: auto
effort: low
depends_on: [T-0264, T-0267]
estimate: 0.2 day
---

# T-0271: Connections and Machines on the kit

## Spec (written by Claude, do not edit)

### Why
This continues the mobile kit migration (T-0264, T-0268). The kit `Card` puts dividers between its children itself, and `SectionLabel` is an uppercase label with `accessibilityRole="header"` (both in `apps/mobile/src/components/ui/card.tsx`).

### Verified facts (do not re-derive)
- `apps/mobile/src/app/settings/connections.tsx`:
  - a "Connections" heading at line 230 (`text-[16px] font-semibold`);
  - list rows that are each a bordered box: `rounded-xl border border-border bg-surface px-3 py-2.5` at lines 236 and 275;
  - a "New connection" form card at lines 399-401.
  - Test: `apps/mobile/src/components/connections/connections-screen.test.tsx`.
- `apps/mobile/src/app/settings/machines.tsx`:
  - headings "Waiting for approval" (lines 315-318) and "Your machines" (line 359);
  - list rows: a box at line 365, and the `MachineCard`-style row at line 556 (`gap-1 rounded-xl border border-border bg-surface px-3 py-2.5`);
  - headings at lines 496 and 617 belong to the add/confirm panels.
  - Test: `apps/mobile/src/components/machines/machines-screen.test.tsx`.

### What to build
1. For the list sections only ("Connections"; "Waiting for approval" and "Your machines"):
   - the heading becomes `SectionLabel`, keeping any `accessibilityLabel` on the section;
   - the rows sit inside one `Card` with no per-row box (keep each row's inner padding).
2. The "New connection" form card and the machines add/confirm panels stay as they are.
3. Texts, accessibility labels and behaviour are unchanged. Update the two screen tests only where they relied on removed markup.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/card.tsx`, `apps/mobile/src/app/settings/requests.tsx` (the T-0268 pattern), and the two screens.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0271-mobile-kit-connections-machines.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen machines-screen
pnpm gate
```

### Acceptance
- The list rows in both screens sit in one card per section, with SectionLabel headings. Behaviour is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
Moved the Connections and Machines list sections onto the mobile kit (`Card` + `SectionLabel`), with no behaviour change. The add/confirm panels were left alone.

`apps/mobile/src/app/settings/connections.tsx`
- The "Connections" 16/600 heading is now `SectionLabel`. The section had no `accessibilityLabel`, so there was none to keep.
- The `connections.map` rows are now direct children of one `Card`. Both branches lost the per-row box (`rounded-xl border border-border bg-surface`) and keep their inner padding:
  - remove-confirm view: `gap-2 px-3 py-2.5`;
  - normal row: `flex-row items-center gap-3 px-3 py-2.5`.
- The "New connection" form card (`AddConnectionForm`) is untouched.
- Added `import { Card, SectionLabel } from '@/components/ui/card';`.

`apps/mobile/src/app/settings/machines.tsx`
- "Waiting for approval" and "Your machines" are now `SectionLabel`; the section `accessibilityLabel`s ("Waiting for approval", "Your machines") are unchanged.
- Pending and approved are each one `Card` with the rows as direct children; the rename view lost its box (keeps `gap-2 px-3 py-2.5`).
- `MachineCard` lost its per-row box (`gap-1 rounded-xl border border-border bg-surface px-3 py-2.5` → `gap-1 px-3 py-2.5`).
- Added the card import.

### Files changed
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `work/T-0271-mobile-kit-connections-machines.md` (this file)
`pnpm-lock.yaml` was not modified by `pnpm install` this time (`git status` clean for it).

### Deviations / notes
- I also wrapped the revoked list in a `Card` (inside the `showRevoked` branch). The spec names only "Waiting for approval" and "Your machines", but `MachineCard` is shared by the revoked list and the spec explicitly lists its box (line 556) among the per-row boxes to remove; without a `Card` the revoked rows would have no surface or dividers. The `Revoked (N)` toggle heading is unchanged.
- The two test files were **not changed**: their assertions only match rendered text, so none relied on the removed row boxes. They pass against the real `@/components/ui/card` module (the tests render it for real, exactly like the T-0268 tests).
- The `format` step passed, so no manual formatting was needed.

### Commands and results
- `pnpm install` → done in 35s, exit 0 (`pnpm-lock.yaml` unchanged).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen machines-screen` → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.
- `pnpm gate` (from repo root) →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (35.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (13.9s)
  PASS  tests @zilar/mobile  (3.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance check
- List rows in both screens sit in one card per section, with `SectionLabel` headings; no `rounded-xl border border-border bg-surface` row boxes remain (only the untouched `AddConnectionForm` card matches that string in `connections.tsx`).
- Texts, accessibility labels and behaviour unchanged.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Open questions
- None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (2 nits, accepted).
- The list sections use `SectionLabel` and `Card`.
- Wrapping the revoked list too is right, because `MachineCard` lost its own box.
- The emulator look goes into the next QA run.
