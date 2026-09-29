---
id: T-0128
title: Real email for sign-in codes: an SMTP mailer (production installs cannot start without one today)
status: planned
milestone: M6
branch: task/T-0128-smtp-mailer
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 1 day
---

# T-0128: SMTP mailer for sign-in codes

## Spec (written by Claude, do not edit)

### Why
Found while building the production install (T-0126, 2026-09-30): Galena signs people in **only with an email one-time code** (Better Auth `emailOTP`; password login is off) and new people need an invite. The only mailer, `ConsoleMailer` in `apps/server/src/auth/mailer.ts`, **throws in production** ("No email provider is configured"), so a production server cannot start, and nobody but a developer reading logs can ever sign in. Every real install (self-hosted, family and friends, the hosted service) needs real email. This task adds it, and nothing else.

### What to build
- **Dependencies (the only ones allowed, versions current at the time, pinned by the lockfile):** `nodemailer` and `@types/nodemailer` in `apps/server`.
- `apps/server/src/auth/mailer.ts`: keep the `Mailer` interface and `ConsoleMailer` (development only, unchanged behaviour, still refuses production by default). Add `SmtpMailer implements Mailer` using `nodemailer.createTransport`. `createMailer(config, logger)` picks by config.
- **Config (zod, in `config.ts`, all optional unless SMTP is chosen), documented in `docs/SERVER_CONFIG.md`:**
  - `MAIL_TRANSPORT`: `console` | `smtp`. Default: `console` when `NODE_ENV !== 'production'`, otherwise **unset means the server refuses to start with the same clear error as today**, now pointing at these variables.
  - `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` = implicit TLS, normally port 465; `false` = **STARTTLS required**: set `requireTLS: true`, never fall back to plaintext), `SMTP_USER`, `SMTP_PASSWORD` (both optional together: no auth if both absent, error if only one), `MAIL_FROM` (required with smtp, e.g. `Galena <no-reply@example.com>`; validated as a mailbox), `MAIL_REPLY_TO` optional.
  - `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` (boolean, default false): an explicit opt-in that lets a **single-admin private install** run with `MAIL_TRANSPORT=console` in production; the server then logs a loud startup warning ("sign-in codes are written to the server log") and the codes appear in the log at `warn` level with the email address. Off by default and documented as unsuitable for anyone but the operator.
  - Validation errors are precise (`SMTP_HOST is required when MAIL_TRANSPORT=smtp`) and **never echo `SMTP_PASSWORD`**. The password is redacted wherever config is logged (check the existing redaction list and add the new secret names).
- **Message:** plain text and a minimal HTML alternative, English, subject by purpose (`Your Galena sign-in code`, `Verify your email`, `Reset your Galena sign-in`, `Confirm your new email`), body: the code, how long it is valid (`OTP_EXPIRES_IN_SECONDS` from `auth.ts`, expressed in minutes), a line "If you did not ask for this, ignore this email.", and nothing else (no links, no tracking, no images). The HTML is generated from escaped text (no interpolation of untrusted strings into markup: the code and purpose are the only variables, and the code is validated as digits before use).
- **Safety rules:** the OTP and the SMTP password are never logged, never put in an error message, never returned by an endpoint. On failure `sendOtp` throws a generic `MailerDeliveryError` (log only the error class and SMTP response code, not the response text, which can echo the address); the auth route must answer the same way it does today for a mailer failure (read `auth.ts` and the tests; do not change the API shape). Add a connection timeout (10 s) and a send timeout (20 s) so a dead SMTP server cannot hang sign-in. **Do not weaken the existing per-email and per-IP rate limits on sending codes**; verify they still apply.
- **Startup check:** with `MAIL_TRANSPORT=smtp`, the server verifies the SMTP connection at startup (`transporter.verify()`) and **logs a warning, does not crash**, if it fails (a temporary mail outage must not take the chat down); it retries on the next send.
- **No new endpoint, no UI, no schema change.**

### Read first
- `AGENTS.md`; `apps/server/src/auth/{mailer.ts,mailer.test.ts,auth.ts}` and their tests; `apps/server/src/{config.ts,index.ts,logger.ts}`; `docs/SERVER_CONFIG.md`

### Allowed files
- `apps/server/src/auth/mailer.ts` (+ tests), `apps/server/src/config.ts` (+ tests), `apps/server/src/index.ts` (mailer construction only), `apps/server/src/logger.ts` (redaction names only)
- `apps/server/package.json`, `pnpm-lock.yaml`, `docs/SERVER_CONFIG.md`, `work/T-0128-smtp-mailer.md`

**Not allowed:** other dependencies, changes to auth flows/routes, schema, web/mobile, reading `infra/.env`, sending real emails from tests.

### Tests (no network, no real SMTP)
- Use nodemailer's in-memory `jsonTransport` (or an injected transport) so a test can read the composed message: subject per purpose, recipient, from, plain and HTML parts contain the code and the validity in minutes, no links, HTML escapes hostile input (an email address with `<script>` in the display name path is not interpolated).
- Config: every validation branch (missing host/from, only user without password, bad port, both TLS flags), defaults per `NODE_ENV`, production refuses without a transport, the opt-in console mode warns loudly, secrets absent from `JSON.stringify(config)`-style logs and from thrown messages.
- Failure: a transport that rejects makes `sendOtp` throw `MailerDeliveryError`, logs no code and no password; a hanging transport times out.
- STARTTLS: with `SMTP_SECURE=false` the transport options have `requireTLS: true`; with `true`, `secure: true`.
- Existing mailer and auth tests still pass unchanged.

### Checks (one full server suite at the end, alone, exactly this form)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm build
```

### Acceptance criteria
- [ ] `NODE_ENV=production MAIL_TRANSPORT=smtp` (with valid SMTP variables) starts and sends the code through SMTP; `MAIL_TRANSPORT` unset in production still refuses, with a message that names the variables.
- [ ] The code and the SMTP password never appear in logs, errors or responses.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Out of scope
- Password login, magic links, email templates in other languages, HTML branding, bounce handling, provider-specific HTTP APIs (SES/Resend HTTP: their SMTP endpoints work through this), usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
