---
id: T-1112
title: "Sign-in: email first; only an email with no account gets the Invite code input (pre-filled from an invite link); no upfront invite check or link (web + mobile)"
status: todo
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

## Review (written by Claude)
