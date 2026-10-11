---
id: T-1105
title: "Mobile sign-in: Invite code field for new accounts (shows on invite_required / invite_invalid, accepts a code or a pasted invite link)"
status: todo
milestone: M5
branch: task/T-1105-signup-invite-code-mobile
model: auto
effort: default
depends_on: [T-1104]
estimate: 0.2 day
---

# T-1105: Invite code on mobile sign-in

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: "for new accounts, add an input with invite code". T-1104 makes the server answer the send-code request for an unknown email with:
- 403 and code `invite_required`, message "This email has no account yet. Enter your invite code to sign up.";
- or, with an unusable invite header, 400 and code `invite_invalid`, message "This invite code is invalid, expired or already used.".

**Mobile today:**
- `apps/mobile/src/auth/AuthFlow.tsx` takes an optional `inviteCode` prop (`:27`, `:31`, used at `:61` and `:78`);
- without one it only shows "New here? Open the invite link you were sent first, then sign in." (`:147-151`) and "…you need an invite link…" (`:173-178`);
- `apps/mobile/src/auth/errors.ts:4-13` maps only the rate-limit and wrong-code errors;
- `apps/mobile/src/lib/auth.ts:66-87` sends the `x-zilar-invite` header.

### What to build
Do the same as web T-1104, step 3:
1. **In `AuthFlow.tsx`:**
   - **the field:** keep an `inviteCode` state, seeded from the prop. On the email step, show an **"Invite code"** input (the existing kit `Input`, with `autoCapitalize="none"`) when the prop is undefined and either (a) the user taps a small "I have an invite code" text button under the email, or (b) the last send failed with `invite_required` or `invite_invalid`. The error text shows above the field;
   - **what counts as a code:** a bare code, or a pasted `…/invite/<code>` link, reduced to `<code>`;
   - **the request:** `requestSignInCode` and `signIn` use the state value;
   - **replace the two "open the invite link" hints** with this flow.
2. **In `errors.ts`,** map `invite_required` and `invite_invalid` to the server messages above.
3. **The Report:** describe what each case does. The lead runs the phone check: an unknown email shows the field, a wrong code shows the invalid message, and a pasted link fills the code.
4. **No tests** (UI). Every file stays at most 400 lines. If `AuthFlow.tsx` would pass 400, move the field into `apps/mobile/src/auth/InviteCodeField.tsx`.

### Read first
`AGENTS.md`, `apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/errors.ts`, `apps/mobile/src/lib/auth.ts`, and the merged web version in `apps/web/src/components/auth/AuthFlow.tsx` (T-1104).

### Allowed files
`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/errors.ts`, `apps/mobile/src/auth/InviteCodeField.tsx`, `apps/mobile/src/lib/auth.ts`, `work/T-1105-signup-invite-code-mobile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The lead's phone check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
