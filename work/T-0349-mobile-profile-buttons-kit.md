---
id: T-0349
title: "Mobile kit migration: the pill buttons on the Profile settings screen, the avatar control and the handle field use the kit Button"
status: merged
milestone: M5
branch: task/T-0349-mobile-profile-buttons-kit
model: auto
effort: low
depends_on: [T-0348]
estimate: 0.2 day
---

# T-0349: Profile settings buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 and T-0345 to T-0348, for the Profile settings screen and its two field components.

### Verified facts (do not re-derive)
- **The six text pill `Pressable`s** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/app/settings/profile.tsx` | 320 | "Retry" | `rounded-full border border-border-strong bg-surface` | `outline` | |
| `apps/mobile/src/app/settings/profile.tsx` | 365 | "Save name" | `mt-1 self-start rounded-full bg-accent` | `default` | `className="mt-1 self-start"` |
| `apps/mobile/src/components/settings/avatar-control.tsx` | 67 | `currentUrl === undefined ? 'Add picture' : 'Change picture'` | `rounded-full bg-accent` | `default` | |
| `apps/mobile/src/components/settings/avatar-control.tsx` | 79 | "Remove picture" | `rounded-full border border-border-strong bg-surface` | `outline` | |
| `apps/mobile/src/components/settings/avatar-control.tsx` | 107 | "Save picture" | `self-start rounded-full bg-accent` | `default` | `className="self-start"` |
| `apps/mobile/src/components/settings/handle-field.tsx` | 70 | "Save username" | `mt-1 self-start rounded-full bg-accent` | `default` | `className="mt-1 self-start"` |

- **Tests that reach these files** (the lead grepped importers one level up):
  - `apps/mobile/src/components/settings/settings-ui.test.tsx` imports `AvatarControl`, `AvatarPicture` and `HandleField` (lines 5-6);
  - it mocks `react-native`, `expo-image`, `nativewind` and `@/components/ui/text` (lines 12-27), and has no `Platform.select`, reanimated or `TextClassContext` mocks;
  - no test imports `apps/mobile/src/app/settings/profile.tsx`;
  - `app/(tabs)/profile.tsx` and `app/(tabs)/settings.tsx` only push the route.

  Copy the mocks-only additions from T-0348 (`apps/mobile/src/components/contacts/requests-screen.test.tsx`): `Platform.select`, the reanimated `useReducedMotion` and `TextClassContext`. If a test forces `useState` values in order, the extra `useKeyPress` state can shift them; T-0348 solved that by mocking `@/components/ui/use-key-press`.
- **The kit `Button`** (`apps/mobile/src/components/ui/button.tsx`): variants `default` and `outline`, size `sm`. Use size `default` if `sm` makes the full-width avatar pair look cramped; say which in the Report.

### What to build
1. Replace the six `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, busy text, and the layout classes in the last column.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in the three files.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0348-mobile-integrations-requests-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, the three files and `apps/mobile/src/components/settings/settings-ui.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/avatar-control.tsx`, `apps/mobile/src/components/settings/handle-field.tsx`; mocks only: `apps/mobile/src/components/settings/settings-ui.test.tsx`; and `work/T-0349-mobile-profile-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-ui
pnpm gate
```

### Acceptance
- The six `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced all six text pill `Pressable`s named in the spec with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), size `sm` for every one — the spec's default. The avatar pair sits in a `flex-row flex-wrap` so it wraps instead of cramping, and `sm` keeps the two pills on one row for longer than `default` would; no `size="default"` was needed.

`apps/mobile/src/app/settings/profile.tsx`
- "Retry" (was line 320) → `variant="outline" size="sm"`; kept `accessibilityLabel="Retry"` and `onPress={reload}`.
- "Save name" (was 365) → `variant="default" size="sm"` with `className="mt-1 self-start"`; kept `accessibilityLabel="Save name"`, `disabled={nameBusy || nameUnchanged}`, `onPress={saveName}` and the busy text `{nameBusy ? 'Saving…' : 'Save name'}`.
- No `Pressable` remains, so I dropped it from the `react-native` import.

`apps/mobile/src/components/settings/avatar-control.tsx`
- "Add picture"/"Change picture" (was 67) → `variant="default" size="sm"`; kept the `accessibilityLabel` ternary, `disabled={uploading}`, `onPress={onPick}` and the label ternary.
- "Remove picture" (was 79) → `variant="outline" size="sm"`; kept `accessibilityLabel`, `disabled`, `onPress={onRemove}` and the busy text `{phase.name === 'uploading' ? 'Working…' : 'Remove'}`.
- "Save picture" (was 107) → `variant="default" size="sm"` with `className="self-start"`; kept `accessibilityLabel`, `disabled`, `onPress={onSavePicked}`.
- No `Pressable` remains, so I dropped it from the `react-native` import; `Text` is still used elsewhere in the file and stays.

`apps/mobile/src/components/settings/handle-field.tsx`
- "Save username" (was 70) → `variant="default" size="sm"` with `className="mt-1 self-start"`; kept `accessibilityLabel`, `disabled={busy || saveDisabled}`, `onPress={onSave}` and the busy text `{busy ? 'Saving…' : 'Save username'}`.
- No `Pressable` remains, so I dropped it from the `react-native` import; `Text` stays.

For every button I dropped the old pill classes and the child `Text` colour/size classes; the kit `TextClassContext` now sets them. I also dropped `accessibilityRole="button"` because the kit `Button` sets `role="button"` on its own `Pressable` (the T-0345–T-0348 pattern). Added `import { Button } from '@/components/ui/button';` to all three files.

**Files changed**
- `apps/mobile/src/app/settings/profile.tsx` — two `Pressable`s now kit `Button`s; `Button` imported; unused `Pressable` import removed.
- `apps/mobile/src/components/settings/avatar-control.tsx` — three `Pressable`s now kit `Button`s; `Button` imported; unused `Pressable` import removed.
- `apps/mobile/src/components/settings/handle-field.tsx` — one `Pressable` now a kit `Button`; `Button` imported; unused `Pressable` import removed.
- `apps/mobile/src/components/settings/settings-ui.test.tsx` — mocks only: added `Platform.select`, `react-native-reanimated` `useReducedMotion`, and `TextClassContext` on the `@/components/ui/text` mock.
- `work/T-0349-mobile-profile-buttons-kit.md` — status and this Report.

**Why the extra mocks**
`Platform.select`, `useReducedMotion` and `TextClassContext` are the imports the kit `Button` chain pulls in (`button.tsx` → `use-key-press.ts`, `button.tsx` `Platform.select`, and `TextClassContext` from `@/components/ui/text`), exactly as the spec listed. The test previously did not mock them. No `@/components/ui/use-key-press` mock was needed: `settings-ui.test.tsx` has no forced/ordered `useState` mock (it only calls `renderToStaticMarkup`, which never runs effects), so the extra `useKeyPress` `useState` does not shift a cursor.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 11.3s`; only pre-existing peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-ui` — `Test Files 1 passed (1)`, `Tests 11 passed (11)` (only the usual React DOM casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.7s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). All six pills are kit `Button`s with the variants from the table, and the layout classes are kept (`mt-1 self-start` on Save name and Save username, `self-start` on Save picture). The lead grep found the labels kept. The test changes are mocks only.
