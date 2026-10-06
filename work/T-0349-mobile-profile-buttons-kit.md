---
id: T-0349
title: "Mobile kit migration: the pill buttons on the Profile settings screen, the avatar control and the handle field use the kit Button"
status: todo
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

## Review (written by Claude)
