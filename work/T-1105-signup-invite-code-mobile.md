---
id: T-1105
title: "Mobile sign-in: Invite code field for new accounts (shows on invite_required / invite_invalid, accepts a code or a pasted invite link)"
status: merged
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

### What I did

Mirrored web T-1104 step 3 on mobile.

- `apps/mobile/src/auth/InviteCodeField.tsx` (new): the kit `TextField` labelled
  "Invite code", with `autoCapitalize="none"`, `autoComplete="off"`, and a
  `parseInviteCode` that reduces a pasted `…/invite/<code>` link to `<code>`
  (anything else is trimmed and kept). Same shape as the web `InviteCodeField`.
- `apps/mobile/src/auth/errors.ts`: `errorMessageFor` now maps `invite_required`
  and `invite_invalid` to the two server sentences, before the rate-limit and
  wrong-code checks (same order as web).
- `apps/mobile/src/auth/AuthFlow.tsx`:
  - the prop is renamed to `inviteCodeProp`; an `inviteCode` state is seeded from
    it (`useState(inviteCodeProp ?? '')`). Both `requestSignInCode(...)` and
    `signIn({...})` now send the state value, so a revealed/typed code travels on
    the send-code and verify calls.
  - added `inviteFieldTapped` and `errorCode` state. The field shows on the email
    step only when the prop is `undefined` and either the user tapped
    "I have an invite code" or the last send failed with `invite_required` /
    `invite_invalid`.
  - the error text now sits above the field (and above the reveal link), matching
    web.
  - removed both "open the invite link" hints.

### Behaviour per case

- Invite screen (`invite/[code].tsx`, prop defined): no field, no reveal link;
  the code from the link is used for send and verify, exactly as before.
- Login screen, unknown email: the server answers `invite_required`, the message
  "This email has no account yet. Enter your invite code to sign up." shows above
  the field, and the field appears automatically so the user can enter a code.
- Login screen, user taps "I have an invite code": the field shows immediately.
- Wrong/unusable code: the server answers `invite_invalid` and the message
  "This invite code is invalid, expired or already used." shows above the field.
- A pasted `…/invite/<code>` link fills the field with just `<code>`.

### Files changed

`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/errors.ts`,
`apps/mobile/src/auth/InviteCodeField.tsx` (new), and this task file. All are in
the Allowed files.

### Commands

- `pnpm install`: done, no errors (1 deprecation warning on a transitive dep).
- `pnpm gate` (repo root), after install:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/mobile  (2.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test files were run: this is UI code, which gets no tests per
  AGENTS.md, and the gate ran the `@zilar/mobile` tests.

### Problems / deviations

None. `AuthFlow.tsx` stays at 252 lines, under the 400 limit; I still put the
field in `InviteCodeField.tsx` to mirror web and keep `AuthFlow` small.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (`autoCorrect`, optional).**
- **The change:** `AuthFlow` holds the invite code in state (seeded from the prop). A new `InviteCodeField` (the kit `TextField`, `autoCapitalize="none"`) shows after "I have an invite code" or after `invite_required`/`invite_invalid`, and reduces a pasted `…/invite/<code>` link to the code. `errors.ts` maps both codes to the server's messages, and the two old "open the invite link" hints are gone.
- **The lead's checks:** the server code reaches `errorCode` (`session-store.ts:63` keeps `error.code`), and an empty code sends no header (`lib/auth.ts:69`).
- **The gate passed.** The lead's phone check runs on the next APK, together with T-1106.
