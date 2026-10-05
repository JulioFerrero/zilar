---
id: T-0251
title: "Mobile: Settings and My AIs tab lists scroll clear of the floating tab bar; shorter Blocked people subtitle"
status: merged
milestone: M5
branch: task/T-0251-mobile-tab-shell-bottom-space
model: auto
effort: low
depends_on: [T-0247]
estimate: 0.1 day
---

# T-0251: tab lists scroll clear of the floating bar

## Spec (written by Claude, do not edit)

### Why
QA run 6 (2026-10-06) found that on the Settings tab the scroll stops while the last card (Server, Integrations) is still under the floating tab bar, so Integrations cannot be tapped. The Blocked people subtitle is also cut off with an ellipsis.

### Verified facts (do not re-derive)
- `apps/mobile/src/components/settings/screen-shell.tsx` line 55: the ScrollView uses `contentContainerStyle={{ paddingBottom: 32 }}` for every screen. The hub (`apps/mobile/src/app/(tabs)/settings.tsx`) renders it with no `onBack`, and the settings sub-pages pass `onBack`.
- `apps/mobile/src/components/ais/screen-shell.tsx` line 62: the same `paddingBottom: 32` in the `scroll` branch. `apps/mobile/src/app/(tabs)/ais.tsx` line 157 uses it with `scroll` and no back button. The file already imports `useSafeAreaInsets` (line 36).
- `apps/mobile/src/components/nav/floating-tab-bar.tsx` lines 18-19 export `TAB_BAR_HEIGHT = 64` and `TAB_BAR_BOTTOM_GAP = 12`. `apps/mobile/src/app/(tabs)/profile.tsx` line 155 already clears the bar with `paddingBottom: 64 + 12 + insets.bottom + 16`.
- `apps/mobile/src/app/settings/blocked.tsx` line 100 holds the subtitle "They are not told. Their contact requests do not reach you." with `numberOfLines={1}` (line 99).
- The shell test is `apps/mobile/src/components/settings/screen-shell.test.tsx` (from T-0247; it covers both shells).

### What to build
1. Both shells: when `onBack === undefined` (a tab screen), the ScrollView's bottom padding becomes `TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom + 16`, using the exported constants and `useSafeAreaInsets()`. With a back button it stays 32. Put the rule in one small exported helper (for example `tabScreenBottomPadding(hasBack, insetBottom)` in `floating-tab-bar.tsx`) that both shells call.
2. `blocked.tsx` line 100: the subtitle becomes "They are not told." (it fits on one line).
3. Tests: a helper test with both cases, and the shell test checks that a shell with no `onBack` gets the larger padding.

### Read first
`AGENTS.md`, the two shells, `apps/mobile/src/components/nav/floating-tab-bar.tsx` (lines 1-40), `apps/mobile/src/components/settings/screen-shell.test.tsx`.

### Allowed files
`apps/mobile/src/components/settings/screen-shell.tsx`, `apps/mobile/src/components/settings/screen-shell.test.tsx`, `apps/mobile/src/components/ais/screen-shell.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `work/T-0251-mobile-tab-shell-bottom-space.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot screen-shell floating-tab-bar
pnpm gate
```

### Acceptance
- On the Settings tab and the My AIs tab, the last row scrolls fully above the floating bar. Settings sub-pages keep their 32 px.
- The Blocked people subtitle shows in full.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The Chats list (it has its own padding at `(tabs)/index.tsx` line 368), and any restyle.

---

## Report (written by the worker when done)

Done and ready for review.

### What changed
- `floating-tab-bar.tsx`: added exported `tabScreenBottomPadding(hasBack, insetBottom)`. It returns `32` when a back key is shown and `TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insetBottom + 16` otherwise, using the exported constants.
- `settings/screen-shell.tsx` and `ais/screen-shell.tsx`: the scroll body's `contentContainerStyle.paddingBottom` now calls the helper with `onBack !== undefined` and `insets.bottom`. The settings shell imports `useSafeAreaInsets`; the ais shell already had it.
- `app/settings/blocked.tsx`: subtitle shortened to "They are not told." so it fits on one line.
- `floating-tab-bar.test.tsx`: helper test with and without a back key (including a non-zero inset).
- `screen-shell.test.tsx`: renders both shells and asserts a shell with no `onBack` gets the tab-bar padding, and with `onBack` stays at 32.

### Files changed (all inside Allowed files)
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/settings/screen-shell.test.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `work/T-0251-mobile-tab-shell-bottom-space.md`

### Commands and real results
- `pnpm install` — ok. It rewrote `pnpm-lock.yaml` (added `bufferutil`/`utf-8-validate` snapshot metadata); restored with `git checkout -- pnpm-lock.yaml`, so the final diff has no lockfile change.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot screen-shell floating-tab-bar` — Test Files 2 passed (2); Tests 13 passed (13).
- `pnpm gate` — summary lines:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / notes
- `screen-shell.test.tsx` now stubs `expo-router/ui`, `@zilar/chat-core`, `@/lib/auth` and `@/components/settings/profile-logic`, because the shells now import `floating-tab-bar` and that module pulls those in. Without the stubs the suite failed to transform (`SyntaxError: Unexpected token 'typeof'`). Stubs follow the `floating-tab-bar.test.tsx` pattern.
- The mocked `ScrollView` serializes `contentContainerStyle.paddingBottom` to a `data-padding-bottom` attribute so the test can assert the numeric padding; `renderToStaticMarkup` otherwise prints the style object as `[object Object]`.
- Prettier reformatted the two test files once (`pnpm exec prettier --write`), then the gate passed.

### Open questions
None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (1 test nit).
- `tabScreenBottomPadding` matches the `profile.tsx` precedent (64 + 12 + inset + 16), and both shells use it.
- Sub-pages keep 32.
- The subtitle is shortened.
- Accepted nit: the absolute number is pinned in the helper test.

An emulator look at the Settings list end goes into the next QA run.
