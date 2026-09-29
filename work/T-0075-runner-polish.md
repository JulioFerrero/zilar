---
id: T-0075
title: Runner app polish — accept wss:// hub URLs, honest failure messages, fixed CLI texts, a real end-to-end pair test
status: todo
milestone: M3
branch: task/T-0075-runner-polish
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0072, T-0071]
estimate: 0.5 day
---

# T-0075: Runner polish

## Spec (written by Claude, do not edit)

### Goal

The lead's review of T-0072 left three small follow-ups, and there is one gap: nothing yet proves the runner CLI and the real server routes fit together. This task closes them, in `apps/runner` only.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0072-runner-app.md` (its Review section lists the follow-ups)
- `apps/runner/src/identity.ts`, `connect.ts`, `pair.ts`, `cli.ts`, `cli.test.ts`, `pair.test.ts`
- `packages/runner-tunnel/src/runner.ts` (`RunnerClient`: what exactly the `failed` event carries and when it fires; how reconnects work) and `protocol.ts` (close codes)
- For the end-to-end test only: `apps/server/src/machines/routes.ts`, `hub.ts`, and `apps/server/src/machines/hub.test.ts` (how it builds an app with PGlite and a real hub)

### Allowed files
- `apps/runner/**` (source, tests, README, `package.json` — dependencies: only `@galena/server` as a **devDependency** with `workspace:*` if the end-to-end test needs it; no others)
- `pnpm-lock.yaml` for that link
- `work/T-0075-runner-polish.md`

**Not allowed:** `apps/server/**`, `packages/**`, web, mobile, `docs/**`. If the server's test helpers are not importable from the runner package without touching the server, do **not** touch it: build the end-to-end test from public pieces (`createApp`, `createDb` on PGlite as the server tests do) or, if that is impossible, skip item 4 and say why in the Report.

### What to build
1. **wss hub URLs.** `IdentitySchema.hubUrl` accepts `ws://` **or** `wss://` (still validated with `validateHubUrl`). `hubUrlFromServer` already maps `https:` to `wss:`; add a test.
2. **Honest failures.** `mapFailure` in `connect.ts` reports an unrecognised close (network drop, server gone) as something other than `auth_failed`: a new `status: 'disconnected'` with a message like "lost the connection to the server". `cli.ts` treats it as a runtime failure (exit 1) with that message. Only a real `CLOSE_AUTH` is `auth_failed`. Tests for each mapping.
3. **Fixed 409 text.** In `pair.ts` the 409 branch must never echo the server's `message`; map the known codes to fixed sentences and use one generic sentence otherwise. Test that a hostile message body never reaches the output.
4. **End-to-end test (`apps/runner/src/e2e.test.ts`).** In one process: start the real server app on PGlite (a helper like the T-0068 tests use), sign a user in, mint a pairing code through `POST /api/machines/pairing-codes`, run `pairRunner` against that app served on a random loopback port, check the machine is `pending` in `GET /api/machines`, approve it through the route, start the real hub (`startRunnerHub`) and run `runRunner` against it, wait until `GET /api/machines` says `online: true`, revoke through the route, and assert `runRunner` returns `revoked`. Tests must close every server/timer; no network beyond loopback.

### Tests
As listed above; all Vitest, no real external services.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done beyond the test.

### Acceptance criteria
- [ ] `wss://` hub URLs are accepted and round-trip through the identity file.
- [ ] A dropped connection is never reported as an auth failure.
- [ ] The CLI never prints server-provided text from a 409.
- [ ] The end-to-end test passes, or the Report explains precisely why it could not be written within the allowed files.
- [ ] No `any`, no `@ts-ignore`; no dependency other than the one allowed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/runner
pnpm build
```

### Out of scope
- Desks, running commands, installers/packaging, service files, TLS deployment.

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
-

---

## Review (written by Claude)

**Verdict:**
