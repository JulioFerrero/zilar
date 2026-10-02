---
id: T-0161
title: First-run setup screen (Resend key, first admin) with no manual environment setup
status: planned
milestone: M5
branch: task/T-0161-first-run-setup
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: []
estimate: 2 days
---

# T-0161: First-run setup screen (Resend key, first admin) with no manual environment setup

## Spec (written by Claude, do not edit)

### Why
Installing on Coolify (or anywhere) today needs an operator to hand-fill mail settings and mint an invite with a CLI inside the container. The Coolify test on 2026-10-02 showed the cost: sign-in codes need SMTP, the first account needs an invite, and an unknown email gets no code. Target: deploy the compose file, open the URL, finish setup in the browser. No mail variables in the compose file and no terminal.

### What to build

**1. Instance settings (server).**
- New table `instance_settings(key text primary key, value text not null, updated_at)` (Drizzle migration, one new migration only). Secret values are stored encrypted (AES-256-GCM, random nonce per value) with a key from `ZILAR_KEY_ENCRYPTION_KEY` when set, otherwise derived with HKDF-SHA256 from `BETTER_AUTH_SECRET` (label `zilar-instance-settings`). Never store the Resend key in clear text.
- Keys: `mail.resend_api_key` (encrypted), `mail.from` (plain).

**2. Mail from settings.**
- Resend is used through its SMTP endpoint with the existing SMTP mailer: host `smtp.resend.com`, port 465, secure, user `resend`, password = the key. No new dependency.
- Mail transport resolution order: explicit `MAIL_TRANSPORT`/`SMTP_*` env (unchanged behaviour) wins; else stored Resend settings; else "unconfigured".
- In production the server must now START when mail is unconfigured (today it refuses). While unconfigured, sending a code fails with a clear logged error (no secret in it) and the sign-in API answers 503 with `mail_not_configured`.
- Saving the settings swaps the live mailer without a restart.

**3. Setup gate.**
- "Setup needed" means: no user with the admin role exists.
- On boot while setup is needed, the server generates a random one-time setup token (32 bytes, base64url), keeps only its SHA-256 in memory, and logs ONE line: `Zilar setup: open <PUBLIC_URL>/setup#<token>`. This is the single deliberate exception to the rule that bearer tokens never reach logs: it proves the caller can read the server log. The token goes in the URL fragment so no proxy or access log ever sees it. Add a test that the token is logged exactly once, only while setup is needed, and never appears in request logs or errors.
- `GET /api/setup/status` (public): `{ needsSetup: boolean, mailConfigured: boolean }`. Nothing else.
- `POST /api/setup` (public but token-gated): body `{ token, resendApiKey, from, adminEmail }` (zod). Compare the token hash with `timingSafeEqual`. In ONE transaction under an advisory lock: re-check that setup is still needed, store the settings, create the first-admin invite for `adminEmail`. Then send a test sign-in code to `adminEmail` through the new mailer; if sending fails, roll back the settings and answer 422 `mail_send_failed` with no provider detail. Success answers 200 `{ ok: true }`.
- Once an admin exists, both routes answer the same 404 as an unknown route and the token is discarded. Wrong token and "setup already done" are indistinguishable from outside except the status route.
- Rate limit `POST /api/setup`: 5 per 10 minutes per IP. Audit entry `setup.completed` with ids only (no email, no key).

**4. Web.**
- Route `/setup`: if `needsSetup` is false, redirect to `/login`. Otherwise a three-field form (setup token prefilled from the URL fragment and then removed from the address bar, Resend API key as a password input, from address) plus the admin email. Plain explanation of where to get a Resend key and that the from-domain must be verified in Resend. On success go to the normal sign-up screen with the email prefilled and the code step shown.
- The login screen checks `needsSetup` first and shows a "Finish setting up this server" link to `/setup` instead of an unusable form.
- Match the existing auth screens' components and style. Tests with Vitest + Testing Library: redirect when not needed, token prefill and fragment removal, error states (wrong token, mail failed), success path.

**5. Deploy files.**
- `deploy/coolify/docker-compose.yml`: remove the mail variables and `MAIL_ALLOW_CONSOLE_IN_PRODUCTION`; keep optional SMTP overrides out of the required set. Remove the manual-key instructions that no longer apply.
- `docs/INSTALL_DOCKER.md`: rewrite the Coolify section as: paste the compose file, set the domain, deploy, open the log, open the setup link. Say what a Resend key is and that the setup link is in the server log.

### Read first
`AGENTS.md` (security checklist, all of it), `apps/server/src/auth/` (`mailer.ts`, `invites.ts`, `invite-cli.ts`, `routes.ts`, `auth.ts`), `apps/server/src/config.ts` (mail validation and the `EMPTY_MEANS_UNSET_KEYS` list), `apps/web/src/auth/`, `deploy/coolify/docker-compose.yml`, `docs/INSTALL_DOCKER.md`.

### Allowed files
`apps/server/src/setup/**` (new), `apps/server/src/auth/mailer.ts`, `apps/server/src/auth/mailer.test.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/db/**` (schema + the one migration), `apps/server/src/app.ts` or the file that registers routes, `apps/web/src/auth/**`, `apps/web/src/routes/**` (setup route only), `apps/web/src/lib/**` (api client additions), `deploy/coolify/docker-compose.yml`, `deploy/docker-compose.yml` (only if mail variables must change), `docs/INSTALL_DOCKER.md`, `work/T-0161-first-run-setup.md`. Not allowed: new dependencies, mobile app, other tasks' files.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/setup src/auth src/config.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/auth src/routes
```

### Acceptance
- A fresh database with no mail variables set boots in production; the log shows the setup line once.
- `/setup` with the right token and a working Resend key stores encrypted settings, creates the first-admin invite, and the admin can complete sign-in with a code sent by email.
- Wrong token, repeated attempts, and any call after setup is done are covered by tests (401-sweep style: same 404 once done; rate limit hit).
- The key never appears in logs, audit detail, errors, or API responses (test with a sentinel value).
- Existing env-based SMTP installs behave exactly as before.

### Out of scope
- Other mail providers in the UI, changing mail settings after setup (a later settings screen), mobile, the Resend HTTP API (SMTP only).

---

## Report (written by the worker when done)

## Review (written by Claude)
