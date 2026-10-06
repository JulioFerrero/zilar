---
id: T-0348
title: "Mobile kit migration: the text pill buttons on the Integrations and Requests screens use the kit Button"
status: merged
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

**Status:** done, ready for review.

**What I did**
Replaced all seven text pill `Pressable`s named in the spec with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), size `sm` for every one:

`apps/mobile/src/app/settings/integrations.tsx`
- "Retry loading integrations" (was line 114) → `variant="outline"`; kept `onPress={reload}` and the `RefreshCw` icon at `ICON[scheme]`.
- The `SaveButton` helper body (was 227) → `variant="default"`; kept `accessibilityLabel={label}`, `disabled={busy}`, `onPress={onPress}` and the busy text `busy ? busyLabel : label`. Migrates every Save on the screen.
- The `RemoveButton` helper body (was 251) → `variant="outline"`; kept `accessibilityLabel={label}`, `disabled={busy}`, `onPress={onPress}` and the label. Migrates every Remove.
- Left the icon-only show/hide `Pressable` in `SecretField` alone, so `Pressable` stays in the `react-native` import.

`apps/mobile/src/app/settings/requests.tsx`
- "Retry loading requests" (was 143) → `variant="outline"`; kept `onPress={reload}` and the `RefreshCw` icon at `ICON[scheme]`.
- `Cancel the request to ${request.other.name}` (was 263) → `variant="outline"`; kept `disabled={busy}`, `onPress={onCancel}`.
- `Accept ${request.other.name}` (was 274) → `variant="default"`; kept `disabled={busy}`, `onPress={onAccept}`.
- `Decline ${request.other.name}` (was 283) → `variant="outline"`; kept `disabled={busy}`, `onPress={onDecline}`.
- No `Pressable` remains, so I dropped it from the `react-native` import.

For every button I dropped the old pill classes and the child `Text` colour/size classes; the kit `TextClassContext` now sets them. I dropped `accessibilityRole="button"` because the kit `Button` sets `role="button"` on its own `Pressable` (the T-0345/T-0346/T-0347 pattern). No icon sits inside a `default` button on either screen, so `ACCENT_FOREGROUND` was not needed. Added `import { Button } from '@/components/ui/button';` to both screens.

**Files changed**
- `apps/mobile/src/app/settings/integrations.tsx` — three `Pressable`s (Retry + the two helpers) now kit `Button`s; `Button` imported.
- `apps/mobile/src/app/settings/requests.tsx` — four `Pressable`s now kit `Button`s; `Button` imported, unused `Pressable` import removed.
- `apps/mobile/src/components/integrations/integrations-screen.test.tsx` — mocks only: added `Platform.select`, `react-native-reanimated` `useReducedMotion`, `TextClassContext` on the `@/components/ui/text` mock, and `@/components/ui/use-key-press`.
- `apps/mobile/src/components/contacts/requests-screen.test.tsx` — mocks only: added `Platform.select`, `react-native-reanimated` `useReducedMotion`, `TextClassContext`.
- `work/T-0348-mobile-integrations-requests-buttons-kit.md` — status and this Report.

**Why the extra mocks**
- `Platform.select`, `useReducedMotion` and `TextClassContext` are the imports the kit `Button` chain pulls in (`button.tsx`, `use-key-press.ts`, `@/components/ui/text`), exactly as the spec listed. The tests previously did not mock them.
- The `@/components/ui/use-key-press` mock is needed **only in `integrations-screen.test.tsx`**: that test forces booleans with a global cursor (`forcedBooleans`/`booleanCursor`), and the two card helpers' own booleans (`showKey`/`busy`/`saved`/`confirming`/`removing`) interleave with the buttons rendered inside each card. The real `useKeyPress` adds one `useState(false)` per button, which shifted the cursor and broke two cases (`shows the saved lines after a save`, `shows Email without Remove, and Remove on the other two when configured`). Mocking the hook (the existing pattern in `composer-gifs.test.tsx` and `voice-message.test.tsx`) keeps the screen's boolean order intact. The requests test does not force booleans, so it only needed the three `Button`-dependency mocks.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 11.3s`, only pre-existing peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations-screen requests-screen` — first run (without the `use-key-press` mock) failed 2/10 in the integrations file (`Remove the Telegram token?` and the saved-lines case) because of the boolean-cursor shift described above; after adding that one mock: `Test Files 2 passed (2)`, `Tests 22 passed (22)` (only the usual React DOM casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (11.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (6.4s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none in the source changes. The only addition beyond the spec's literal mock list is the `@/components/ui/use-key-press` mock in the integrations test, which is required for that test's boolean-forcing mock to keep working (see above); it is a mock-only change inside an Allowed file and has precedent in the repo.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). All seven pills are kit `Button`s with the variants from the tables, and the lead grep found the labels kept. Because the shared `SaveButton` and `RemoveButton` helpers changed, every Save and Remove on the Integrations screen moves together. The test changes are mocks only.
