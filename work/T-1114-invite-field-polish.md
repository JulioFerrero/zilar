---
id: T-1114
title: "Invite step polish: no autocorrect/spellcheck on the invite code field; the email-step error shows under the invite field when the invite step is open (web + mobile)"
status: merged
milestone: M5
branch: task/T-1114-invite-field-polish
model: auto
effort: default
depends_on: [T-1112]
estimate: 0.05 day
---

# T-1114: Invite field polish

## Spec (written by Claude, do not edit)

### Why
The lead's emulator check of T-1112 (APK `97525fa2`, 2026-10-11) found two problems:
- typing `WRONGCODE` into the Invite code field became `WRONG CODE`, because the Android keyboard autocorrected it;
- the red "This invite code is invalid…" error shows **above** the grey hint and the field, which reads backwards.

**What the lead read:**
- **Mobile:** `apps/mobile/src/auth/InviteCodeField.tsx:25-26` sets `autoCapitalize="none"` and `autoComplete="off"`, but no `autoCorrect` or `spellCheck`.
- **Web:** `apps/web/src/components/auth/InviteCodeField.tsx:26` sets `autoComplete="off"` only.
- **Mobile email-step order** (`apps/mobile/src/auth/AuthFlow.tsx`): the error at `:176-180`, then the hint at `:181-183`, then the field at `:184`.
- **Web email-step order** (`apps/web/src/components/auth/AuthFlow.tsx`): the error at `:207-211`, then the hint at `:212-214`, then the field at `:215`.

### What to build
1. **Mobile `InviteCodeField`:** add `autoCorrect={false}` and `spellCheck={false}`.
2. **Web `InviteCodeField`:** add `autoCorrect="off"`, `autoCapitalize="none"` and `spellCheck={false}` to the input. Check how the kit `Input` passes props through.
3. **Both `AuthFlow`s, email step:** when `inviteStep` is true, render in this order:
   - the hint;
   - the field;
   - the error.

   When `inviteStep` is false, the error stays where it is now, under the email. Keep the same error element, classes and `role`/`accessibilityRole`; only its position changes.
4. **No other changes.** No tests (UI).

### Read first
`AGENTS.md`, and the four files above.

### Allowed files
`apps/mobile/src/auth/InviteCodeField.tsx`, `apps/mobile/src/auth/AuthFlow.tsx`, `apps/web/src/components/auth/InviteCodeField.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `work/T-1114-invite-field-polish.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The lead's emulator check passes.

---

## Report (written by the worker when done)

### What I did
- **Mobile `InviteCodeField`** (`apps/mobile/src/auth/InviteCodeField.tsx`): added `autoCorrect={false}` and `spellCheck={false}` to the `TextField`, so Android/iOS no longer autocorrect codes like `WRONGCODE` to `WRONG CODE`.
- **Web `InviteCodeField`** (`apps/web/src/components/auth/InviteCodeField.tsx`): added `autoCorrect="off"`, `autoCapitalize="none"` and `spellCheck={false}` to the `TextInput`. Checked `apps/web/src/components/ui/text-input.tsx:56-87`: the kit `TextInput` destructures its own props and spreads `...props` onto the native `<input>`, so these three reach the DOM element. `spellCheck={false}` is valid on `ComponentProps<'input'>`.
- **Both `AuthFlow`s, email step** (`apps/mobile/src/auth/AuthFlow.tsx:176-189`, `apps/web/src/components/auth/AuthFlow.tsx:207-220`): reordered so that when `inviteStep` is true the order is hint → field → error; when `inviteStep === false` the error keeps its old position directly under the email field. The error element (`<Text>`/`<p>`), its classes and `accessibilityRole="alert"`/`role="alert"` are unchanged; only its position changed. `inviteStep` is a `boolean` (`useState(false)`), so the `inviteStep === false` guard is type-safe and exclusive with the `inviteStep` branch.

No other changes. No tests: UI-only change, per AGENTS.md "UI code gets no tests".

### Files changed
- `apps/mobile/src/auth/InviteCodeField.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/InviteCodeField.tsx`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `work/T-1114-invite-field-polish.md`

### Commands run
- `pnpm install`: Done in 10.8s.
- `pnpm gate` (from the repo root), real output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.7s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (2.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- I ran no single test file on its own: the change is UI-only with no near test files, so there was nothing to run besides the gate.

### Problems / deviations
- None.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The invite code fields:**
  - mobile gets `autoCorrect={false}` and `spellCheck={false}`;
  - web gets `autoCorrect="off"`, `autoCapitalize="none"` and `spellCheck={false}`.
- **The error position:** in both `AuthFlow`s, the email-step error renders under the invite field while `inviteStep` is true, and under the email otherwise. It keeps the same element, classes and alert role. The lead read every changed line.
- **The gate passed.** The lead checks this on the APK built from this merge.
