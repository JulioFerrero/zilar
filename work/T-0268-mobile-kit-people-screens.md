---
id: T-0268
title: "Mobile kit migration: Contact requests and Blocked people screens use Card, SectionLabel, ListRow and IconTile"
status: todo
milestone: M5
branch: task/T-0268-mobile-kit-people-screens
model: auto
effort: low
depends_on: [T-0264]
estimate: 0.2 day
---

# T-0268: mobile people screens on the kit

## Spec (written by Claude, do not edit)

### Why
This is the mobile twin of T-0265, using the mobile kit from T-0264 (`apps/mobile/src/components/ui/`: `icon-tile.tsx`, `list-row.tsx`, `card.tsx` with `Card` and `SectionLabel`, `count-badge.tsx`).

### Verified facts (do not re-derive)
- `apps/mobile/src/app/settings/requests.tsx`:
  - sections "Incoming" (an `accessibilityLabel` group at line 162 with a 16/600 heading at 163) and "Sent" (heading at 184);
  - each `RequestRow` (from line 226) is its own bordered box: `rounded-xl border border-border bg-surface px-3 py-2.5` (line 242);
  - a "Blocked people" link at lines 205-214 is also a bordered box with a `Ban` icon and a chevron.
  - Test: `apps/mobile/src/components/contacts/requests-screen.test.tsx`.
- `apps/mobile/src/app/settings/blocked.tsx`: each `BlockedRow` (from line 174) is a bordered box (line 184) with a rounded-full Unblock button (line 199). Test: `apps/mobile/src/components/contacts/blocked-screen.test.tsx`.
- `apps/mobile/src/components/ui/card.tsx` is being edited by T-0267 (it adds `accessibilityRole="header"` to `SectionLabel`). Import from it; do not edit it.

### What to build
1. `requests.tsx`:
   - each section heading becomes `SectionLabel` (keep the section `accessibilityLabel`s);
   - each list becomes one `Card`, with rows inside and no per-row box;
   - the "Blocked people" link becomes a `ListRow` inside its own `Card`, with `icon={<IconTile><Ban …/></IconTile>}`, title "Blocked people" and a chevron, keeping its accessibility label and navigation.
2. `blocked.tsx`: the list becomes one `Card` with no per-row box. Keep the Unblock button and its texts as they are (a kit Button migration is a separate task).
3. Texts, accessibility labels and behaviour are unchanged. Update the two tests only where they relied on removed markup.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/card.tsx`, `apps/mobile/src/components/ui/list-row.tsx`, `apps/mobile/src/components/ui/icon-tile.tsx`, `apps/mobile/src/app/(tabs)/settings.tsx` (how T-0264 uses them), and the two screens.

### Allowed files
`apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/components/contacts/requests-screen.test.tsx`, `apps/mobile/src/components/contacts/blocked-screen.test.tsx`, `work/T-0268-mobile-kit-people-screens.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot requests-screen blocked-screen
pnpm gate
```

### Acceptance
- No `rounded-xl border border-border bg-surface` row boxes remain in the two screens. Behaviour is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

## Review (written by Claude)
