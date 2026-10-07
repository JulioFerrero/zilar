---
id: T-0487
title: "Effect convert: SMTP mailer send with timeout in Effect, Mailer API unchanged"
status: todo
milestone: M5
branch: task/T-0487-effect-mailer
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.2 day
---

# T-0487: the mailer send in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md`:
- Effect inside, plain `Promise` methods at the edge;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/auth/mailer.ts` (311 lines).
- **Exports:**
  - `OtpPurpose`, `Mailer`;
  - the error classes `MailerConfigurationError` (line 13), `MailerDeliveryError` (line 20) and `MailNotConfiguredError` (line 32);
  - `SmtpTransportFactory`, `SmtpMailerOptions`;
  - the classes `SmtpMailer` (line 95), `ConsoleMailer` (line 189), `NotConfiguredMailer` (line 221) and `CurrentMailer` (line 244);
  - `isTransportConfigured`, `RESEND_SMTP`, `createResendMailer`, `createMailer`.
- **The only async logic** is `SmtpMailer.sendOtp` (lines 145-170):
  1. a non-digit code throws `MailerDeliveryError`;
  2. `sendMail` races a `setTimeout` (`#sendTimeoutMs`, `unref`) that rejects with `MailerDeliveryError`;
  3. on a timeout it logs `{ purpose }` "sign-in email delivery timed out" and rethrows;
  4. any other failure logs `{ purpose, smtpCode }` "sign-in email failed" and throws a fresh `MailerDeliveryError`.
  
  **Today the timer is never cleared after a successful send.**
- **Importers:** `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/auth/auth.ts`, `apps/server/src/setup/routes.ts`, `apps/server/src/auth/cli-config.ts`, `apps/server/src/integrations/routes.ts`. **Tests:** `apps/server/src/auth/mailer.test.ts`.

### What to build
1. **`sendOtp` internals** become `Effect.tryPromise(sendMail)` piped through `Effect.timeoutOrElse`, with typed internal errors for the timeout and the send failure. Map them at the edge to the same logs and the same `MailerDeliveryError` throws.
   - **The timer is released when the send finishes.** That is the one allowed internal improvement; it is not visible to callers.
   - **Keep the digit check first.**
2. **Exports:** every class, method signature and export stays the same. Only `sendOtp`'s body changes, plus small private helpers.
3. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/auth/mailer.effect.test.ts`, for example: a timeout gives `MailerDeliveryError` and the timeout log; a send rejection gives the smtpCode log.
4. **Report:** give the line counts before and after.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/auth/mailer.ts`, `apps/server/src/auth/mailer.test.ts`.

### Allowed files
`apps/server/src/auth/mailer.ts`, `apps/server/src/auth/mailer.effect.test.ts`, `work/T-0487-effect-mailer.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot auth/mailer
pnpm gate
```

### Acceptance
- `SmtpMailer.sendOtp` runs on Effect inside, with the same API, errors and logs.
- The timer no longer outlives a successful send.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
