---
id: T-0404
title: "Mobile kit: Switch ON state keeps a light thumb so it does not vanish into the dark card"
status: todo
milestone: M5
branch: task/T-0404-mobile-switch-on-colors
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0404: Switch ON colours

## Spec (written by Claude, do not edit)

### Why
QA run 32 (emulator, dark theme, folder editor) found that an ON switch shows a light track with a near-black thumb. On Android the thumb is wider than the track, so it sticks out past the end and blends into the dark card: the switch looks cut in half.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/switch.tsx`:**
  - line 35: `trackColor={{ false: BORDER_STRONG, true: ACCENT[scheme] }}`;
  - line 36: `ios_backgroundColor={BORDER_STRONG}`;
  - line 37: `thumbColor={value ? ACCENT_FOREGROUND[scheme] : undefined}`.
- **`packages/ui-tokens/src/index.ts`:**
  - `borderStrong: '#262626'` (line 17);
  - `mutedForeground: '#a1a1a1'` (line 20);
  - `accent: '#ededed'` (line 23);
  - `accentForeground: '#0a0a0a'` (line 24).
- **`apps/mobile/src/lib/colors.ts`** exports `ACCENT` (line 32) and `MUTED_FOREGROUND` (line 42), both per scheme.
- **`apps/mobile/src/components/ui/switch.test.tsx`** has the Switch tests. None of them asserts colours.

### What to build
1. Set the thumb to `ACCENT[scheme]` (light) in both states, so it always stands out from the card.
2. Set the track to `BORDER_STRONG` when off and `MUTED_FOREGROUND[scheme]` when on, so ON reads as a brighter track with the light thumb on the right. Keep `ios_backgroundColor`.
3. Drop the `ACCENT_FOREGROUND` import if it becomes unused.
4. Add a test in `switch.test.tsx` that reads the native switch's props and checks:
   - the thumb is `ACCENT` for both values;
   - the track is `{ false: BORDER_STRONG, true: MUTED_FOREGROUND }`.

   Follow the file's existing render style.
5. Update the doc comment ("drawn in the accent colour") to match.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/switch.tsx`, `apps/mobile/src/components/ui/switch.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/switch.tsx`, `apps/mobile/src/components/ui/switch.test.tsx`, `work/T-0404-mobile-switch-on-colors.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot switch
pnpm gate
```

### Acceptance
- The ON switch has a light thumb on a grey track.
- The new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
