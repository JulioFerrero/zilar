---
id: T-0487
title: "Effect convert: SMTP mailer send with timeout in Effect, Mailer API unchanged"
status: merged
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

### What I did

Converted the internals of `SmtpMailer.sendOtp` to Effect, keeping the plain
`Promise`/throw API at the edge:

- `Effect.tryPromise(() => send, catch)` wraps the `sendMail` promise; the
  rejection maps to a private `MailerSendFailed` tagged error that carries only
  the `smtpCode` (a number or `'unknown'`) used by the log line.
- `Effect.timeoutOrElse({ duration, orElse })` adds the `#sendTimeoutMs`
  timeout; expiry fails with a private `MailerSendTimedOut` tagged error.
- `Effect.catchTags` maps both at the edge to the same logs and the same
  `MailerDeliveryError` throws as before:
  - timeout → `{ purpose }` "sign-in email delivery timed out";
  - send failure → `{ purpose, smtpCode }` "sign-in email failed".
- The digit check stays first and throws `MailerDeliveryError` before any Effect.
- The manual `setTimeout`/`Promise.race` is gone. `Effect.timeoutOrElse`
  interrupts the timer fiber when the send completes, so the timer no longer
  outlives a successful send. This is the only internal change; no caller sees
  it.
- No export, class or method signature changed. The two new errors are
  module-private and not exported.

### Files and line counts (before → after)

- `apps/server/src/auth/mailer.ts`: **311 → 329** lines (+18).
- `apps/server/src/auth/mailer.effect.test.ts`: **new, 85** lines.
- `work/T-0487-effect-mailer.md`: Report filled, status set to review.

`apps/server/src/auth/mailer.test.ts` was **not touched**.

### Commands I ran (real results)

- `pnpm install`: done in 30.4s (setup).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot auth/mailer`:
  `Test Files 2 passed (2)`, `Tests 20 passed (20)`, duration 4.34s. (The 18
  existing mailer tests plus the 2 new Effect tests.)
- `pnpm gate` (from the repo root): **GATE PASS**. Summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (4.4s)
PASS  format  (41.6s)
PASS  lint  (1.1s)
PASS  typecheck  (1.5s)
PASS  tests @zilar/server  (1250.7s)
scope: every changed file is inside the Allowed files
GATE PASS
EXIT:0
```

The `tests @zilar/server` step took ~21 minutes because the machine was shared
with several other worktrees running their own gates; it passed.

### New tests

`apps/server/src/auth/mailer.effect.test.ts`, over the json transport (no
network): a hanging transport fails with `MailerDeliveryError` and logs
"sign-in email delivery timed out"; a rejecting transport fails with
`MailerDeliveryError` and logs the `smtpCode` (`"smtpCode":550`) without leaking
the provider message or the code.

### Deviations / notes

- None from the spec. The existing tests are unchanged and green.
- The old timeout branch rethrew the same `MailerDeliveryError` instance; the
  new code always throws a fresh instance. Both are `MailerDeliveryError` and
  the tests assert `instanceof`, so this is not observable. Called out for
  transparency.

## Review (written by Claude)

Approved (lead, 2026-10-07). SmtpMailer.sendOtp runs on Effect: tryPromise(sendMail) with timeoutOrElse, and typed timeout and send errors mapped to the same logs and the same MailerDeliveryError. The digit check comes first, and the timer no longer outlives a successful send. The existing tests are untouched. Pre-review clean.
