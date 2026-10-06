---
id: T-0348
title: "Mobile kit migration: the text pill buttons on the Integrations and Requests screens use the kit Button"
status: todo
milestone: M5
branch: task/T-0348-mobile-integrations-requests-buttons-kit
model: auto
effort: low
depends_on: [T-0347]
estimate: 0.2 day
---

# T-0348: Integrations and Requests buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343, T-0345, T-0346 and T-0347, for two more Settings screens.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/settings/integrations.tsx`:**

| Line | What | Look today | Kit variant |
| --- | --- | --- | --- |
| 114 | "Retry loading integrations" (icon) | `rounded-full border border-border-strong` | `outline` |
| 227 | the `Pressable` inside the shared `SaveButton` helper (props `busy`, `busyLabel`, `label`, `onPress`; text `busy ? busyLabel : label`) | `rounded-full bg-accent px-4 py-2` | `default` |
| 251 | the `Pressable` inside the shared `RemoveButton` helper (props `busy`, `label`, `onPress`) | `rounded-full border border-border-strong px-4 py-2` | `outline` |

  Leave the icon-only show/hide `Pressable` at line 198 alone. Changing the two helpers migrates every Save and Remove button on the screen.
- **`apps/mobile/src/app/settings/requests.tsx`:**

| Line | Label | Look today | Kit variant |
| --- | --- | --- | --- |
| 143 | "Retry loading requests" (icon) | `rounded-full border border-border-strong` | `outline` |
| 263 | `Cancel the request to ${request.other.name}` | `rounded-full border border-border-strong px-3 py-1` | `outline` |
| 274 | `Accept ${request.other.name}` | `rounded-full bg-accent px-3 py-1` | `default` |
| 283 | `Decline ${request.other.name}` | `rounded-full border border-border-strong px-3 py-1` | `outline` |

- **Tests that reach these files (the lead ran the grep, including one level up):**
  - `apps/mobile/src/components/integrations/integrations-screen.test.tsx`;
  - `apps/mobile/src/components/contacts/requests-screen.test.tsx`.

  Other hits only name the routes as strings. `contacts.test.tsx` imports `components/contacts/requests`, a different module.

  Neither test mocks `Platform.select`, `react-native-reanimated` or `TextClassContext` today. Copy the mocks-only additions from T-0346 and T-0347:
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`: `Platform.select`, the reanimated `useReducedMotion`, `TextClassContext`, and `primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW` and `pressStyle` if `@/lib/depth` is mocked;
  - `ACCENT_FOREGROUND` in the colors mock if you use it.

### What to build
1. Replace the seven `Pressable`s above (two of them inside the helpers) with `<Button variant=… size="sm">`. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, busy text, icons and their colours (`ACCENT_FOREGROUND[scheme]` on a `default` button).

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in both screens.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0347-mobile-sticker-pack-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, both screens and both tests.

### Allowed files
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/requests.tsx`; mocks only: `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `apps/mobile/src/components/contacts/requests-screen.test.tsx`; and `work/T-0348-mobile-integrations-requests-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations-screen requests-screen
pnpm gate
```

### Acceptance
- The seven `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
