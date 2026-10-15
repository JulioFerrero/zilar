---
id: T-1298
title: "Mobile batch 3: auth screens avoid the keyboard on small phones (MUX-20); fixed heights don't clip at the largest font size (MUX-18); predictive back is enabled (MUX-24); literal hex colours move to tokens (MUX-31)"
status: dropped
milestone: M5
branch: task/T-1298-mobile-layout-batch
model: auto
effort: default
depends_on: [T-1289]
estimate: 0.3 day
---

# T-1298: Mobile batch 3

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-20** (P2, `:53`, suspected): the login, name and handle cards are centered in a `SafeAreaView` with no keyboard avoidance, so on a small phone the keyboard covers the field or the button.
- **MUX-18** (P2, `:107`, suspected): fixed heights with `numberOfLines={1}` (chat rows `h-[76px]`, the header `h-16`, and others listed there) clip at the "Largest" font size.
- **MUX-24** (P3, `:73`): `apps/mobile/app.json` sets `predictiveBackGestureEnabled: false`. The audit says to enable it once MUX-6 is in, and MUX-6 is merged (T-1173).
- **MUX-31** (P3, `:115`): many literal hex colours remain in components.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-20:** wrap the auth cards in `KeyboardAvoidingView` (behavior `padding` on iOS, `height` on Android) plus a `ScrollView` with `keyboardShouldPersistTaps="handled"`, so the active field and the primary button stay visible.
2. **MUX-18:** replace fixed `h-…` with `min-h-…` on the rows and headers the audit lists, so they grow with the font size; keep `numberOfLines` where truncation is intended.
3. **MUX-24:** set `predictiveBackGestureEnabled: true`. Check that the hardware or gesture back still works on the chat screen opened from a notification (the MUX-6 path, cite it) by reading the code; the lead checks it on the emulator.
4. **MUX-31:** replace literal hex colours in `apps/mobile/src/components/**` with the existing tokens or `@/lib/colors` constants (cite the mapping for each colour). No visual change intended.
5. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:53`, `:73`, `:107`, `:115`), `apps/mobile/app.json`, `apps/mobile/src/lib/colors.ts` and the auth screens (find them).

### Allowed files
`apps/mobile/app.json`, `apps/mobile/src/auth/**/*.tsx`, `apps/mobile/src/app/**/*.tsx`, `apps/mobile/src/components/**/*.tsx`, `apps/mobile/src/lib/colors.ts`, `work/T-1298-mobile-layout-batch.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:** with the font at Largest, the chat rows aren't clipped; the login field stays visible with the keyboard open.

---

## Report (written by the worker when done)

## Review (written by Claude)
Lead, 2026-10-15: dropped. It was never launched, and its items are covered elsewhere:
- MUX-18 and MUX-20 shipped in T-1436.
- MUX-24 (predictive back) waits for a native build test and is on NOW.md's list.
- MUX-31 is not actionable per the findings sweep (dark only, D24).
