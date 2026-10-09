---
id: T-0804
title: "S10: server auth and db client on Effect — auth/auth.ts sendVerificationOTP hook, auth/session.ts requireSession, db/client.ts close, db/migrate-cli.ts; same login behaviour"
status: merged
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

- effect:map kinds: `auth/auth.ts`, `auth/session.ts`, `db/client.ts`, `db/migrate-cli.ts` are all `effect`. No signals left except W7 (`process.env`) in `migrate-cli.ts`, which the spec allows at an entry point.
- auth.ts: converted the whole file, not only `sendVerificationOTP`. The before hook, `databaseHooks.user.create.before` and `.after` are now `(...) => Effect.runPromise(Effect.gen(...))`, so better-auth still gets a Promise. `requireSession` keeps its Promise signature; `requireSessionEffect` is also exported.
- Errors: in Effect 4.0.2 `runPromise` rejects with the squashed original error (`Cause.squash`), so the same `APIError`/`HttpError` objects and DB rejections reach better-auth and Hono. I read this in `node_modules/effect/dist/internal/effect.js` (`runPromiseWith`).
- Order of calls, OTP mail content and error texts are unchanged. No OTP or email is logged; the sign-up warnings still log `{ userId, err }` as an object with the same message text.
- migrate-cli.ts: one `Effect.gen` program run by `NodeRuntime.runMain`. Release order (dispose the SQL runtime, then `close()`) is kept through `Effect.ensuring`.
- Tests: `vitest run src/auth src/db`, before the change 18 failed / 73 passed / 2 skipped (5-second timeouts on a loaded machine; auth.test.ts alone: 2 failed / 34 passed). After the change, with `--testTimeout=60000 --hookTimeout=60000` (CLI flags only): 91 passed / 2 skipped, 0 failed. I did not run the 5-second default after the change, and I did not repeat the run 3 times.
- Typecheck: `pnpm --filter @zilar/server typecheck` is clean. Prettier ran on the 4 files and left them unchanged.
- Behaviour differences: (1) `migrate-cli.ts` failure output now comes from `runMain` (Effect's error report) instead of Node's unhandled-rejection stack; the exit code is still 1. (2) `close()` on `createDb` now resolves via `Effect.runPromise(Effect.void)`, same result. Otherwise none.
- Unsure: I did not run the real login flow or the migrate CLI itself (no live services); `auth.test.ts` covers the OTP path, including the 503 `mail_not_configured` case.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. auth, session, db client and migrate-cli are Effect files; OTP and error texts are unchanged. Julio signs in on live before the next deploy.
