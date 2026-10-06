---
id: T-0351
title: "Mobile kit migration: the Continue and Skip buttons in sign-in, name and username onboarding use the kit Button"
status: merged
milestone: M5
branch: task/T-0351-mobile-auth-buttons-kit
model: auto
effort: low
depends_on: [T-0350]
estimate: 0.2 day
---

# T-0351: sign-in and onboarding buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0350, for the sign-in and onboarding screens. These are the first screens a new person sees, and they still hand-roll accent pills.

### Verified facts (do not re-derive)
- **The five `Pressable`s to migrate** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/auth/AuthFlow.tsx` | 141 | "Continue" (email step, full width) | `mt-1 items-center rounded-full bg-accent px-4 py-3` | `default`, `lg` | `className="mt-1"` |
| `apps/mobile/src/auth/AuthFlow.tsx` | 175 | "Continue" (code step, inline in a row) | `rounded-full bg-accent px-5 py-2.5` | `default`, `default` | |
| `apps/mobile/src/auth/NameForm.tsx` | 83 | "Continue" | `mt-4 items-center rounded-full bg-accent px-4 py-3` | `default`, `lg` | `className="mt-4"` |
| `apps/mobile/src/app/welcome/handle.tsx` | 172 | "Continue" | `mt-4 items-center rounded-full bg-accent px-4 py-3 … disabled:opacity-60` | `default`, `lg` | `className="mt-4"` |
| `apps/mobile/src/app/welcome/handle.tsx` | 181 | "Skip for now" | `mt-2 items-center rounded-full px-4 py-2` | `ghost`, `default` | `className="mt-2"` |

- **Leave alone:** the text links "Resend code" (`AuthFlow.tsx:189`) and "Use a different email" (`AuthFlow.tsx:199`).
- **The kit `Button`** (`apps/mobile/src/components/ui/button.tsx:41-46`): sizes `default` (h-10), `sm`, `lg` (h-11) and `icon`.
- **Tests that reach these files** (the lead grepped importers one level up):
  - only `apps/mobile/src/auth/AuthFlow.test.tsx` imports one of them (`AuthFlow`, line 6);
  - no test imports `NameForm.tsx`, `app/welcome/handle.tsx`, `app/welcome/name.tsx`, `app/login.tsx` or `app/invite/[code].tsx`;
  - other tests only mention "the AuthFlow.test.tsx pattern" in comments.
- **`AuthFlow.test.tsx`:**
  - mocks `react-native` (line 21) and `@/components/ui/text` (line 31);
  - mocks `react` to force `useState` values in order (line 52).

  So, as in T-0348 (`apps/mobile/src/components/integrations/integrations-screen.test.tsx`), add mocks only: `Platform.select`, the reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports if needed, and `@/components/ui/use-key-press`. The last one stops the extra `useState` from shifting the forced order.

### What to build
1. Replace the five `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text;
   - the layout classes in the last column.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in the three files.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0348-mobile-integrations-requests-buttons-kit.md` (Report: the `use-key-press` mock), `apps/mobile/src/components/ui/button.tsx`, the three files and `apps/mobile/src/auth/AuthFlow.test.tsx`.

### Allowed files
`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/NameForm.tsx`, `apps/mobile/src/app/welcome/handle.tsx`; mocks only: `apps/mobile/src/auth/AuthFlow.test.tsx`; and `work/T-0351-mobile-auth-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot AuthFlow
pnpm gate
```

### Acceptance
- The five `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the five hand-rolled accent-pill `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), following the spec table:
- `apps/mobile/src/auth/AuthFlow.tsx`: email-step "Continue" → `variant="default" size="lg" className="mt-1"`; code-step "Continue" → `variant="default" size="default"`. Left "Resend code" and "Use a different email" `Pressable`s alone, so `Pressable` stays in the import.
- `apps/mobile/src/auth/NameForm.tsx`: "Continue" → `variant="default" size="lg" className="mt-4"`. No `Pressable` remains, dropped it from the import.
- `apps/mobile/src/app/welcome/handle.tsx`: "Continue" → `variant="default" size="lg" className="mt-4"`; "Skip for now" → `variant="ghost" size="default" className="mt-2"`. No `Pressable` remains, dropped it from the import.
- Kept every `accessibilityLabel`, `disabled`, `onPress`, and the visible text. Dropped the old pill classes and the child `Text` colour/size classes (kit `TextClassContext` sets them). Dropped `accessibilityRole="button"` since the kit `Button` sets `role="button"` (T-0348 pattern).
- `apps/mobile/src/auth/AuthFlow.test.tsx` — mocks only: added `Platform.select` to the `react-native` mock, a `react-native-reanimated` `useReducedMotion` mock, `TextClassContext` on the `@/components/ui/text` mock, and an `@/components/ui/use-key-press` mock (stops its extra `useState` shifting the forced `useState` order, the T-0348 finding).

**Files changed**
- `apps/mobile/src/auth/AuthFlow.tsx` — two `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/auth/NameForm.tsx` — one `Pressable` now kit `Button`; `Button` imported, unused `Pressable` import removed.
- `apps/mobile/src/app/welcome/handle.tsx` — two `Pressable`s now kit `Button`s; `Button` imported, unused `Pressable` import removed.
- `apps/mobile/src/auth/AuthFlow.test.tsx` — mocks only (see above).
- `work/T-0351-mobile-auth-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 10.5s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot AuthFlow` — `Test Files 1 passed (1)`, `Tests 3 passed (3)` (only the usual string-mock casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (15.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (8.2s)
  PASS  tests @zilar/mobile  (2.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The five buttons are kit `Button`s with the variant, size and layout class from the table: the full-width Continue buttons are `default` `lg`, the code-step Continue is `default` `default`, and Skip is `ghost`. The lead grep found the labels and `disabled` kept. `AuthFlow.test.tsx` changed mocks only. The worker started on the free Muse and fell back to the paid Muse.
