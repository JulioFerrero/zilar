---
id: T-0421
title: "Mobile: the Machines 'Revoked (n)' disclosure shows a chevron and reports its expanded state, like web"
status: merged
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

**Status:** review

### What I did
- `apps/mobile/src/app/settings/machines.tsx`:
  - Imported `ChevronDown` and `ChevronUp` from `lucide-react-native`.
  - Inside the "Revoked (n)" `Button`: added a `ChevronDown` when collapsed / `ChevronUp` when open (`size={16}`, `color={ICON[scheme]}`), added `accessibilityState={{ expanded: showRevoked }}`, and changed the class from `self-start px-0` to `self-start gap-1 px-0`.
- `apps/mobile/src/components/machines/machines-screen.test.tsx`:
  - Added `ChevronDown`/`ChevronUp` to the `lucide-react-native` mock.
  - Added the repo's existing boolean-forcing pattern (`forcedBooleans` + `booleanCursor`, as in `integrations-screen.test.tsx`) to the `react` `useState` mock, and a `booleans` input on `renderScreen`.
  - Added a test: the disclosure button reports `accessibilityState` `{ expanded: false }` and shows `ChevronDown` while collapsed, then `{ expanded: true }` and `ChevronUp` when the state is forced open.
- `work/T-0421-mobile-revoked-chevron.md`: status/report (this file).

### Deviations / notes
- The spec's test step allows: "Use the test's existing pattern for pressing; if it has none, check the rendered `accessibilityState` prop for both values of the state the test can set." This file renders with `renderToStaticMarkup` and has no press/event pattern, so I used the fallback and forced the state.
- `renderToStaticMarkup` serialises object props on custom elements to `[object Object]`, so `accessibilityState` cannot be read from the HTML. To read the actual prop I changed the test's mock of `react-native`'s `Pressable` from the host string `'Pressable'` to a small function that records its props (and renders its children). This is test-only, inside the Allowed test file, and existing assertions still pass.
- Did not add dependencies.

### Commands run
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen` → Test Files 1 passed (1); Tests 7 passed (7).
- `pnpm gate` (from repo root) summary:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. "Revoked (n)" now shows ChevronDown or ChevronUp and reports `expanded`, and the test covers both states.
