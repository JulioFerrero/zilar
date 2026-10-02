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
- "Setup needed" means: no user with the admin role exists. Like other self-hosted apps, whoever opens the new server first sets it up; there is no setup token.
- `GET /api/setup/status` (public): `{ needsSetup: boolean, mailConfigured: boolean }`. Nothing else.
- `POST /api/setup` (public): body `{ resendApiKey, from, adminEmail }` (zod). In ONE transaction under an advisory lock: re-check that setup is still needed, store the settings, create the first-admin invite for `adminEmail`. Then send a test sign-in code to `adminEmail` through the new mailer; if sending fails, roll back the settings and answer 422 `mail_send_failed` with no provider detail. Success answers 200 `{ ok: true, inviteCode }`. The invite code is for the web client only: it keeps it in memory (never in storage, URL or logs) and sends it with the sign-up request itself. The admin never sees or types an invite code and never touches a terminal or a log.
- Once an admin exists, `POST /api/setup` answers the same 404 as an unknown route. The first admin is created only when its email completes the sign-in code, so a visitor who sets a wrong email cannot take the server over without access to that inbox, and the setup stays open for a retry until an admin exists.
- Rate limit `POST /api/setup`: 5 per 10 minutes per IP. Audit entry `setup.completed` with ids only (no email, no key).

**4. Web.**
- Route `/setup`: if `needsSetup` is false, redirect to `/login`. Otherwise a form (Resend API key as a password input, from address) plus the admin email. Plain explanation of where to get a Resend key and that the from-domain must be verified in Resend. On success go straight to the sign-in code step for that email (the code was already emailed by the setup call), with the invite header added by the client automatically. The admin only types the 6-digit code from their inbox.
- The login screen checks `needsSetup` first and shows a "Finish setting up this server" link to `/setup` instead of an unusable form.
- Match the existing auth screens' components and style. Tests with Vitest + Testing Library: redirect when not needed, error states (mail failed), success path.

**5. Deploy files.**
- `deploy/coolify/docker-compose.yml`: remove the mail variables and `MAIL_ALLOW_CONSOLE_IN_PRODUCTION`; keep optional SMTP overrides out of the required set. Remove the manual-key instructions that no longer apply.
- `docs/INSTALL_DOCKER.md`: rewrite the Coolify section as: paste the compose file, set the domain, deploy, open the URL, finish the setup screen. Say what a Resend key is.

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
- A fresh database with no mail variables set boots in production.
- `/setup` with a working Resend key stores encrypted settings, creates the first-admin invite, and the admin can complete sign-in with a code sent by email.
- Repeated attempts and any call after setup is done are covered by tests (same 404 once done; rate limit hit).
- The key never appears in logs, audit detail, errors, or API responses (test with a sentinel value).
- Existing env-based SMTP installs behave exactly as before.

### Out of scope
- Other mail providers in the UI, changing mail settings after setup (a later settings screen), mobile, the Resend HTTP API (SMTP only).

---

## Report (written by the worker when done)

## Review (written by Claude)
