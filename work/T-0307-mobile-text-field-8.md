---
id: T-0307
title: "Mobile kit migration: sign-in email, name and username fields use the kit TextField"
status: merged
milestone: M5
branch: task/T-0307-mobile-text-field-8
model: auto
effort: low
depends_on: [T-0305]
estimate: 0.1 day
---

# T-0307: mobile TextField, batch 8

## Spec (written by Claude, do not edit)

### Why
This is batch 8 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`), this time on the sign-in and onboarding screens. They still use the old `border-input bg-background` look and a hard-coded `#a1a1a1` placeholder. Read `work/T-0306-mobile-text-field-7.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`.
- **`apps/mobile/src/auth/AuthFlow.tsx`:**
  - line 117: the "Email" `TextInput`, with `placeholderTextColor="#a1a1a1"`;
  - its class is `rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground`;
  - line 5 imports `TextInput`.
- **`apps/mobile/src/auth/NameForm.tsx`:**
  - line 67: the "Name" `TextInput`, with `#a1a1a1`;
  - its class is `mt-1 rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground`;
  - line 5 imports `TextInput`.
- **`apps/mobile/src/app/welcome/handle.tsx`:**
  - line 139: the "Username" `TextInput`, with `placeholderTextColor={MUTED_FOREGROUND[scheme]}`;
  - its class is `mt-1 rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground`;
  - `scheme` is also used at line 125 (`CHAT_BACKGROUND[scheme]`), so keep `scheme`. Drop `MUTED_FOREGROUND` from the line 13 import only.
- **Tests:** `apps/mobile/src/auth/AuthFlow.test.tsx` already mocks `nativewind`. No test imports `NameForm.tsx` or `welcome/handle.tsx`.

### What to build
1. Each of the three fields becomes `TextField`:
   - keep every prop except `placeholderTextColor` and the look classes;
   - keep the margin (`mt-1`) as `className` where it was there;
   - remove `TextInput` from the `react-native` imports when it is no longer used.
2. **Tests:** existing tests keep passing. Change `AuthFlow.test.tsx` only if a mock is needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0306-mobile-text-field-7.md` (Report), the three files and `AuthFlow.test.tsx`.

### Allowed files
`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/NameForm.tsx`, `apps/mobile/src/app/welcome/handle.tsx`, `apps/mobile/src/auth/AuthFlow.test.tsx` (mocks only), `work/T-0307-mobile-text-field-8.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot AuthFlow
pnpm gate
```

### Acceptance
- The three fields render through `TextField`, and none of the three files has a raw `<TextInput`, `#a1a1a1` or field `placeholderTextColor` left.
- Sign-in, name and username behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`apps/mobile/src/auth/OtpInput.tsx` (its digit boxes are a custom control).

---

## Report (written by the worker when done)

### Status: ready for review

The three sign-in/onboarding fields now render through the kit `TextField`. No raw `<TextInput`, `#a1a1a1`, or field `placeholderTextColor` remains in the three files.

### What I did

- **`apps/mobile/src/auth/AuthFlow.tsx`** — the "Email" field is now `TextField`. Kept all props except `placeholderTextColor` and the look classes (no `className` needed). Removed `TextInput` from the `react-native` import, added the `TextField` import.
- **`apps/mobile/src/auth/NameForm.tsx`** — the "Name" field is now `TextField` with `className="mt-1"`. Dropped `placeholderTextColor="#a1a1a1"` and the look classes. Removed `TextInput` from the import, added `TextField`.
- **`apps/mobile/src/app/welcome/handle.tsx`** — the "Username" field is now `TextField` with `className="mt-1"`. Dropped `placeholderTextColor={MUTED_FOREGROUND[scheme]}` (TextField defaults to it). Removed `TextInput` from the import, dropped `MUTED_FOREGROUND` from the colors import (`scheme` stays for `CHAT_BACKGROUND`), added `TextField`.
- **Tests (no changes needed):** `AuthFlow.test.tsx` already mocks `nativewind` (which `TextField` pulls in via `useColorScheme`), so no mock edits were required. The stale `TextInput: 'TextInput'` mock key is harmless string noise.

### Security checklist

- No secrets, tokens or keys in logs, errors or URLs; only input components changed, no logic touched.
- No new routes, deletes, caps or audit entries. No permission logic touched.

### Files changed

`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/NameForm.tsx`, `apps/mobile/src/app/welcome/handle.tsx`, `work/T-0307-mobile-text-field-8.md`.

### Commands run (real results)

- `pnpm install` → done, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot AuthFlow` → **1 file passed, 3 tests passed** (the casing lines are pre-existing string-mock noise). No test changes needed.
- `pnpm gate` (final run):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (16.6s)
  PASS  lint  (2.1s)
  PASS  typecheck  (10.2s)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open questions

None.

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), no fix rounds (Muse, peak).
- The Email, Name and Username fields are on `TextField`.
- No `#a1a1a1`, no field `placeholderTextColor` and no raw `<TextInput` is left in the three files (checked with the lead's grep).
- No test changes were needed.
