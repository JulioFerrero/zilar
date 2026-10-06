---
id: T-0421
title: "Mobile: the Machines 'Revoked (n)' disclosure shows a chevron and reports its expanded state, like web"
status: todo
milestone: M5
branch: task/T-0421-mobile-revoked-chevron
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0421: chevron on the Revoked disclosure (mobile)

## Spec (written by Claude, do not edit)

### Why
QA run 34 (emulator, `qa34/16.png`, seen by the lead) found that "Revoked (1)" on Settings → Machines is plain bold text with nothing that shows it can be tapped. On web it has a chevron (`apps/web/src/routes/MachinesPage.tsx:388-400`: a `ChevronDown` that rotates 180° when open, and `aria-expanded`).

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/settings/machines.tsx:426-436`:**
  - `<Button variant="ghost" size="sm" className="self-start px-0" accessibilityLabel={showRevoked ? 'Hide revoked machines' : 'Show revoked machines'} onPress={() => setShowRevoked((value) => !value)}>`;
  - inside it, `<Text className="text-[15px] font-semibold text-foreground">Revoked ({revoked.length})</Text>`.
- **Imports:**
  - line 3 imports `Check, ChevronLeft, Copy, Plus, Server` from `lucide-react-native`;
  - the file uses `ICON[scheme]` for icon colours elsewhere.
- **Test:** `apps/mobile/src/components/machines/machines-screen.test.tsx`.

### What to build
1. **Chevron:** inside the Button, before the Text, add `ChevronDown` (when closed) or `ChevronUp` (when open), `size={16}`, `color={ICON[scheme]}`. Use two icons rather than a rotation.
2. **Expanded state:** add `accessibilityState={{ expanded: showRevoked }}` to the Button.
3. **Spacing:** change the class to `self-start gap-1 px-0`.
4. **Test mocks:** add `ChevronDown`/`ChevronUp` to the test's lucide mock if it lists icons.
5. **Test:** add a test that the button reports `expanded` false and then true after a press. Use the test's existing pattern for pressing; if it has none, check the rendered `accessibilityState` prop for both values of the state the test can set.

### Read first
`AGENTS.md`, `apps/mobile/src/app/settings/machines.tsx:415-445`, and `apps/mobile/src/components/machines/machines-screen.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0421-mobile-revoked-chevron.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen
pnpm gate
```

### Acceptance
- "Revoked (n)" shows a down or up chevron and reports `expanded`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
