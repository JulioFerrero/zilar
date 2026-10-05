---
id: T-0271
title: "Mobile kit migration: Connections and Machines list sections use SectionLabel and Card (no per-row boxes)"
status: todo
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

## Review (written by Claude)
