---
id: T-1112
title: "Sign-in: email first; only an email with no account gets the Invite code input (pre-filled from an invite link); no upfront invite check or link (web + mobile)"
status: merged
milestone: M5
branch: task/T-1112-signup-email-first-invite-step
model: auto
effort: default
depends_on: [T-1105]
estimate: 0.25 day
---

# T-1112: Email first, then the invite step

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, after seeing T-1104 and T-1105: "first the email, if account, continue like normal, if no account, show the invite input, if comes from url, fill the input, if not leave empty".

**Today** (read by the lead):
- **Web,** `apps/web/src/components/auth/AuthFlow.tsx`:
  - `inviteCode` state, seeded from the prop (`:69`); `inviteFieldTapped` (`:70`); `errorCode` (`:72`);
  - the field shows only when the prop is undefined (`:81-83`);
  - an "I have an invite code" link (`:201-209`);
  - the send passes `inviteCode` every time (`:103`), and so does the verify (`:137`).
- **Mobile,** `apps/mobile/src/auth/AuthFlow.tsx`: the same at `:42-52`, `:72`, `:90` and `:164-175`.
- **The invite pages** check the code before showing anything, and show an "Invite not valid" card for a bad one:
  - `apps/web/src/routes/InvitePage.tsx` (`checkInvite`, `:13-17`; the card, `:40-51`; `AuthFlow inviteCode={code}`, `:53`);
  - `apps/mobile/src/app/invite/[code].tsx` (`:26-48`).
- **The server is unchanged** (T-1104):
  - an unknown email without the `x-zilar-invite` header gets 403 `invite_required`;
  - with an unusable code, 400 `invite_invalid`;
  - a known email signs in with or without the header.

### What to build
The same flow on web and mobile.
1. **The `AuthFlow` email step** (both apps):
   - **One state, `inviteStep`** (boolean, starts `false`). Remove `inviteFieldTapped`, the "I have an invite code" link and `inviteFieldVisible`.
   - **While `inviteStep` is false,** Continue sends the code request **without** an invite (pass `undefined`). A known email goes on to the code step exactly as today.
   - **When the send fails with `invite_required`:** set `inviteStep = true` and show the **Invite code** field (`InviteCodeField`) under the email. Its value starts as the `inviteCode` prop (from an invite link) or empty. Above it, show the server message as a plain muted hint, not in the error colour.
   - **While `inviteStep` is true,** Continue sends with the field's value (trimmed; an empty field sends `undefined`).
     - On `invite_invalid`, show that message as an error and keep the field.
     - On success, go to the code step.
   - **Editing the email** sets `inviteStep` back to false and clears the error. The field's value is kept.
2. **The code step:** verify passes the invite only when `inviteStep` is true (`undefined` otherwise).
3. **The invite pages** (`apps/web/src/routes/InvitePage.tsx`, `apps/mobile/src/app/invite/[code].tsx`):
   - drop the up-front check and the "Invite not valid" / "Checking your invite…" states;
   - render `AuthFlow` with `inviteCode={code}` (a missing code becomes `undefined`) and the heading "You're invited to Zilar";
   - a bad code now shows up as `invite_invalid` at the invite step.
   - Remove the imports that become unused. Keep `getInvite` (web) and `checkInvite` (mobile) in their lib files; do not delete them.
4. **No server or test changes.** No UI tests. Every file stays at most 400 lines.
5. **The Report** describes, for each app:
   - a known email → the code (no invite sent);
   - an unknown email → the field, empty on `/login` and pre-filled on `/invite/<code>`;
   - a wrong code → the invalid message.

   The lead runs the live and phone checks.

### Read first
`AGENTS.md`, both `AuthFlow.tsx` files, both `InviteCodeField.tsx` files, both invite pages, `apps/web/src/lib/auth.ts`, and `apps/mobile/src/lib/auth.ts`.

### Allowed files
`apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/InviteCodeField.tsx`, `apps/web/src/routes/InvitePage.tsx`, `apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/InviteCodeField.tsx`, `apps/mobile/src/app/invite/[code].tsx`, `work/T-1112-signup-email-first-invite-step.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The lead's live check (web) and phone check (mobile) pass.

---

## Report (written by the worker when done)

### What I did

Email-first sign-in on web and mobile: the invite field now appears only when
the server says the email has no account, and an invite from a link only
pre-fills that field.

Web `apps/web/src/components/auth/AuthFlow.tsx` and mobile
`apps/mobile/src/auth/AuthFlow.tsx`:

- Removed `inviteFieldTapped`, the "I have an invite code" link and
  `inviteFieldVisible` (and the now-unused `errorCode` state).
- Added `inviteStep` (starts `false`) and `inviteHint`. The invite field renders
  only while `inviteStep`, with the muted hint above it.
- The email **Continue** sends no invite before the invite step; on a send that
  fails with `invite_required` it sets `inviteStep = true`, fills the muted hint
  with that message, and shows `InviteCodeField` (seeded from the `inviteCode`
  prop, i.e. empty on `/login` and the link's code on `/invite/<code>`).
- While `inviteStep`, **Continue** sends the trimmed field value (an empty field
  sends `undefined`). `invite_invalid` shows the red error and keeps the field;
  success moves to the code step.
- Editing the email resets `inviteStep` and clears the error/hint (the field
  value is kept).
- The code step's verify (and Resend) carry the invite through one
  `requestInvite()` helper: the field value once `inviteStep`, otherwise
  `undefined` — see the setup deviation below.
- `InviteCodeField.tsx` was not changed on either app.

The invite pages dropped the up-front check and the "Checking your invite…" /
"Invite not valid" cards, and now just render
`<AuthFlow inviteCode={code} heading="You're invited to Zilar" />` (a missing
code is `undefined`, so the field starts empty). `getInvite` (web, `lib/api`)
and `checkInvite` (mobile, `lib/auth-api`) are untouched. Unused imports removed.

### Behaviour per app

Web (`/login` = `LoginPage`, `/invite/<code>` = `InvitePage`):

- **Known email → the code.** Continue sends with no invite; the known email
  passes the server check, so the code step shows and no invite is ever needed.
- **Unknown email → the field.** The send answers `invite_required`; the
  "Invite code" field appears under the email with the muted hint "This email
  has no account yet. Enter your invite code to sign up." It is **empty on
  `/login`** and **pre-filled with the URL code on `/invite/<code>`**.
- **Wrong code → the invalid message.** Continue at the invite step with a bad
  code answers `invite_invalid` and shows "This invite code is invalid, expired
  or already used." in the error colour, keeping the field.

Mobile (`login.tsx`, `invite/[code].tsx`): identical flow and messages.

### Deviation from the spec (first-run setup)

The spec says the code step verifies with the invite `undefined` unless
`inviteStep`. On web, `SetupPage` renders this same `AuthFlow` **starting at the
code step** with the setup's invite (`initialStep="code"`), and the server
requires the `x-zilar-invite` header when it creates that first account
(`apps/server/src/auth/auth.ts` `databaseHooks.user.create.before`, and
`sendSetupTestCode` only issues the OTP). So sending `undefined` there would
break first-run setup with "An invite is required to create an account."

To keep setup working without touching any non-Allowed file, the web helper is
`inviteStep ? field : initialStep === 'code' ? inviteCodeProp : undefined`, i.e.
the code-start flow (only setup) keeps its invite, while every email-first page
follows the spec exactly. Mobile has no code-start flow, so its helper is the
plain `inviteStep ? trimmedField : undefined`. Flagging this as the one
deliberate deviation; if you would rather keep setup's invite in the prop only,
say so and I will adjust.

### Files changed

`apps/web/src/components/auth/AuthFlow.tsx` (273 lines),
`apps/web/src/routes/InvitePage.tsx` (8),
`apps/mobile/src/auth/AuthFlow.tsx` (258),
`apps/mobile/src/app/invite/[code].tsx` (10), and this task file. All are in the
Allowed files; every file is under 400 lines. No server, test or dependency
changes.

### Commands

- `pnpm install`: done, no errors (1 deprecation warning on a transitive `uuid`).
- `pnpm gate` (repo root), after the install:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.9s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file was run: this is UI code with no nearby tests (web SKIP;
  the mobile suite is the one the gate ran). The lead's live (web) and phone
  (mobile) checks cover the flows.

### Problems / open questions

- The setup deviation above is the only deviation; no other problems.
- I did not run the live/phone checks (the lead does those).

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **Julio's flow, on web and mobile:**
  - the email goes first, sent **without** an invite;
  - a known email goes to the code step;
  - `invite_required` sets `inviteStep`, shows the server text as a muted hint, and shows `InviteCodeField`, pre-filled from the `inviteCode` prop (the invite link) or empty;
  - from then on the trimmed field value rides on the send and the verify;
  - editing the email resets the step.
  - The "I have an invite code" link is gone.
- **Invite pages:** no up-front check and no "Invite not valid" card. Both render `AuthFlow inviteCode={code}`.
- **Web keeps the setup page's code-first start,** where `initialStep === 'code'` uses the given invite. The lead read every changed line in both `AuthFlow`s.
- **The gate passed.** The lead's phone check comes with the next APK.
