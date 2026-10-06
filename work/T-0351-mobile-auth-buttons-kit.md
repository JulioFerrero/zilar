---
id: T-0351
title: "Mobile kit migration: the Continue and Skip buttons in sign-in, name and username onboarding use the kit Button"
status: todo
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

## Review (written by Claude)
