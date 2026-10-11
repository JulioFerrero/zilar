---
id: T-1104
title: "Sign-up: an unknown email gets 'invite_required' instead of a silent fake success; web sign-in shows an Invite code field (server + web)"
status: merged
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

Status: done, `status: review`.

### What I did

**Server** — `apps/server/src/auth/auth.ts`, the send-OTP `before` hook:
- an unknown email with no `x-zilar-invite` header now fails
  `403 { code: 'invite_required', message: 'This email has no account yet. Enter your invite code to sign up.' }`
  instead of the old fake `{ success: true }`;
- an unknown email whose invite header is present but unusable (invalid, expired,
  revoked or used up) now fails
  `400 { code: 'invite_invalid', message: 'This invite code is invalid, expired or already used.' }`;
- a known email, or an unknown one with a usable invite, sends the code as before;
- the hook comment was updated. No other behaviour changed.

**Server tests** — `apps/server/src/auth/auth.test.ts`:
- rewrote the old `does not send a code to an unknown email without an invite`
  test (it pinned the fake success) into
  `rejects an unknown email without an invite with invite_required and sends nothing`
  (403, `context.mailer.sent` empty);
- added `rejects an unknown email with an unusable invite with invite_invalid and sends nothing`
  (400, nothing sent, while a usable invite in the same test still sends);
- fixed `trusts only WEB_ORIGINS in Better Auth origin checks`: its trusted-origin
  request now carries a usable invite so it still reaches the handler (it used to
  pass on the old fake success).

**Web** — `apps/web/src/components/auth/AuthFlow.tsx` and the new
`apps/web/src/components/auth/InviteCodeField.tsx`:
- an `inviteCode` state is seeded from the prop, and `sendSignInCode` /
  `verifySignInCode` send it;
- on the email step the "Invite code" field appears when the prop is undefined and
  either the user taps a small "I have an invite code" link or the last send failed
  with `invite_required` / `invite_invalid` (the error shows above the field);
- `InviteCodeField` accepts a bare code, or a pasted `…/invite/<code>` link, reduced
  to the code;
- both old "open the invite link" hints were replaced by this flow;
- `errorMessageFor` maps `invite_required` and `invite_invalid` to the fixed
  sentences above.

### Files changed
- `apps/server/src/auth/auth.ts`
- `apps/server/src/auth/auth.test.ts`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/InviteCodeField.tsx` (new)
- `work/T-1104-signup-invite-code-server-web.md` (this report)

### Commands and real results
- `pnpm --filter @zilar/server exec vitest run src/auth/auth.test.ts --reporter=dot`
  → `Test Files 1 passed (1)`, `Tests 36 passed (36)`.
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Web flow proof (step 4)
A live `?mock=1` run cannot reach the new server error: the shared mock backend serves
no `/api/auth/*` path, and a real browser session needs a long-running dev server, which
the worker rules disallow. I therefore verified the flow with a temporary component test
(`apps/web/src/components/auth/__tmp_authflow.test.tsx`) that renders `AuthFlow` with
`sendSignInCode` mocked. It passed `Test Files 1 passed (1)`, `Tests 5 passed (5)` and was
deleted before commit, so the change set stays inside the Allowed files. It verified:
- an unknown email → `invite_required` → the "Invite code" field appears, with the
  "…no account yet…" message above it;
- a wrong code → `invite_invalid` → the "…invalid, expired or already used." message, and
  the request carries the entered code;
- a pasted `https://…/invite/CODE-1` is reduced to `CODE-1` before sending;
- with the `inviteCode` prop set (InvitePage) neither the field nor the link shows.

I did **not** run the app in a live browser or `?mock=1` session.

### Deviations / notes
- The spec said "next to (b) and (c)". I placed the two new send-OTP tests next to the
  other send-OTP tests and named them descriptively, to avoid colliding with the existing
  sign-up `(b)` / `(c)` labels.
- `InviteCodeField` is a plain component (no Effect import). The Effect ratchet first
  failed it for a `try`/`catch`, so `parseInviteCode` no longer URL-decodes the code
  (invite codes are URL-safe).

### Open questions / blocked
None.

### Round (fix round 1)

Fixed PREREVIEW finding 1 (should-fix; finding 2 is a nit outside any changed line, left alone):
- `apps/server/src/auth/auth.test.ts` — the untrusted-origin request in
  `trusts only WEB_ORIGINS in Better Auth origin checks` now sends
  `[INVITE_HEADER]: invite.code`, so the new `invite_required` hook cannot be the
  source of its 403; only the origin check can reject it.
- Test added/adjusted: that same test (the finding named it).
- Single test: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts`
  → `Test Files 1 passed (1)`, `Tests 36 passed (36)`.
- `pnpm gate` summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean after 1 auto round, with 3 nits.**
- **The server change, as the lead read it:**
  - in the send-code hook, an unknown email with no `x-zilar-invite` header now fails with 403 `invite_required`;
  - with an unusable invite it fails with 400 `invite_invalid`;
  - a known email, or a usable invite, sends as before.
  - The silent fake success is gone. Julio accepted that the endpoint now tells whether an email has an account.
- **Web:** `AuthFlow` holds the invite code in state, and a new `InviteCodeField` opens from "I have an invite code" or after either error. A pasted `…/invite/<code>` link is reduced to the code.
- **Tests:** the lead ran `src/auth/auth.test.ts` on the branch: 36 green, including the two new cases. The gate passed.
- **The nits, accepted:**
  - the invite state is seeded from the prop once (`InvitePage` remounts per code);
  - the web proof was a throwaway component test;
  - `auth.test.ts` is 851 lines (tests are exempt).
- **The lead checks the field on the live site after the deploy,** with a made-up email: it creates no account and sends no mail.
