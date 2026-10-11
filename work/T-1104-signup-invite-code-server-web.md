---
id: T-1104
title: "Sign-up: an unknown email gets 'invite_required' instead of a silent fake success; web sign-in shows an Invite code field (server + web)"
status: todo
milestone: M5
branch: task/T-1104-signup-invite-code-server-web
model: auto
effort: default
depends_on: [T-1103]
estimate: 0.3 day
---

# T-1104: Invite code on sign-up (server and web)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, after trying to sign up a new email on the phone and getting no email and no message: "Thats horrible system! … for new accounts, add an input with invite code".

**What the lead read:**
- **The silent success.** `apps/server/src/auth/auth.ts:146-166` is the `before` hook on the send-OTP path. If the email is unknown and there is no usable invite in the `x-zilar-invite` header (`INVITE_HEADER`, `:15`), it answers `ctx.json({ success: true })` and **sends nothing**. That includes an invite that is invalid, expired or revoked (`findUsableInvite` returns null).
- **Account creation** already requires an invite (`databaseHooks.user.create.before`, `:180-200`).
- **The error shape to copy:** `mailNotConfiguredError` (`:42-46`), `new APIError(503, { code, message })`.
- **Web:**
  - `apps/web/src/components/auth/AuthFlow.tsx` takes an optional `inviteCode` prop (`:41`, `:47`, used at `:86` and `:116`) and maps errors with `errorMessageFor` (`:21`);
  - without an invite it only shows "New here? Open the invite link you were sent first, then sign in." (`:172-176`) and "…you need an invite link…" (`:191-196`);
  - `apps/web/src/lib/auth.ts:15-35` sends the header.
- **Tests:** `apps/server/src/auth/auth.test.ts` already has the invite sign-up tests (a), (b) and (c), from `:125`.

### What to build
1. **Server** (`apps/server/src/auth/auth.ts`, the hook at `:146-166`). Instead of the fake success:
   - **an unknown email with no invite header** fails with `new APIError(403, { code: 'invite_required', message: 'This email has no account yet. Enter your invite code to sign up.' })`;
   - **an unknown email whose invite header is present but unusable** fails with `new APIError(400, { code: 'invite_invalid', message: 'This invite code is invalid, expired or already used.' })`;
   - **a known email,** or an unknown one with a usable invite, works as today;
   - **Update the comment above the hook.** Julio accepted that this tells a caller whether an email has an account.
2. **Tests** (`apps/server/src/auth/auth.test.ts`; this is auth, so tests are wanted):
   - add two cases next to (b) and (c): `invite_required` (403, and `context.mailer` sent nothing), and `invite_invalid` (400, nothing sent);
   - if an existing test pins the old fake success, change it to the new behaviour;
   - run `pnpm --filter @zilar/server exec vitest run src/auth/auth.test.ts --reporter=dot`.
3. **Web** (`apps/web/src/components/auth/AuthFlow.tsx`):
   - **the field:** keep an `inviteCode` state, seeded from the prop. On the email step, show an **"Invite code"** input when the prop is undefined and either (a) the user tapped a small "I have an invite code" link under the email, or (b) the last send failed with `invite_required` or `invite_invalid`. In case (b), the error text shows above the field;
   - **what counts as a code:** a bare code, or a pasted link `…/invite/<code>`, which is reduced to `<code>`;
   - **the request:** `sendSignInCode` and `verifySignInCode` use the state value;
   - **replace the two "open the invite link" hints** with that flow;
   - **`errorMessageFor`** maps `invite_required` and `invite_invalid` to the server messages above.
4. **Proof in the Report:**
   - the auth test output;
   - a short description of the web flow on a local run (`?mock=1` or a local server): an unknown email, then the field appears; a wrong code, then the invalid message; a link pasted, then the code is extracted.
5. **No other files change.** Mobile is T-1105. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/auth/auth.ts`, `apps/server/src/auth/auth.test.ts`, `apps/web/src/components/auth/AuthFlow.tsx`, and `apps/web/src/lib/auth.ts`.

### Allowed files
`apps/server/src/auth/auth.ts`, `apps/server/src/auth/auth.test.ts`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/InviteCodeField.tsx`, `apps/web/src/lib/auth.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `work/T-1104-signup-invite-code-server-web.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth/auth.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 4.

---

## Report (written by the worker when done)

## Review (written by Claude)
