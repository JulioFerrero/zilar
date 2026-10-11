---
id: T-1114
title: "Invite step polish: no autocorrect/spellcheck on the invite code field; the email-step error shows under the invite field when the invite step is open (web + mobile)"
status: todo
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

## Review (written by Claude)
