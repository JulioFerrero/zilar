---
id: T-0804
title: "S10: server auth and db client on Effect — auth/auth.ts sendVerificationOTP hook, auth/session.ts requireSession, db/client.ts close, db/migrate-cli.ts; same login behaviour"
status: todo
milestone: M5
branch: task/T-0804-server-auth-db
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0804: S10: server auth and db client on Effect — auth/auth.ts sendVerificationOTP hook, auth/session.ts requireSession, db/client.ts close, db/migrate-cli.ts; same login behaviour

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row S10, line 349. The plan flags "Julio: login risk": Julio signs in on live before the next deploy.

### Verified facts (do not re-derive)
- **`apps/server/src/auth/auth.ts`** (188 lines, H1 W4), tested in `auth.test.ts`. The first hit is line 79, `async sendVerificationOTP({ email, otp, type }) {` (better-auth's email OTP hook; it sends the mail). better-auth calls it and awaits a Promise, so it stays a Promise-returning function whose body is an Effect.
- **`apps/server/src/auth/session.ts`** (13 lines). `export async function requireSession(auth, headers)` is at line 6; it throws `HttpError(401, 'unauthorized', 'Authentication required')` when there is no session. Its callers await it (`git grep -n requireSession apps/server/src`), so keep the Promise signature.
- **`apps/server/src/db/client.ts`** (26 lines): line 23 is `close: async () => {}`. A no-op becomes `close: () => Promise.resolve()` with no Effect needed, or `Effect.runPromise(Effect.void)`; pick the simplest that clears H1.
- **`apps/server/src/db/migrate-cli.ts`** (23 lines, H1 W4 W7): the migrate entry; line 7 is `const config = loadServerConfigOrExit(process.env)`. It is a CLI entry, so write it as one `Effect.gen` program run with `NodeRuntime.runMain` from `@effect/platform-node` (already a server dependency), keeping the same output and exit codes. Keep the env read; W7 at an entry point is allowed (plan line 82).
- **Never log the OTP or the email address in text,** as now.

### What to build
Convert the four files. Keep the OTP mail content, the order of calls and every error text identical.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the four files, `apps/server/src/auth/auth.test.ts`, `apps/server/src/effect/runtime.ts`, and how `apps/server/src/index.ts` runs the migrator.

### Allowed files
`apps/server/src/auth/auth.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/migrate-cli.ts`, `work/T-0804-server-auth-db.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/auth src/db
pnpm --filter @zilar/server typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
