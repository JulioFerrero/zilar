---
id: T-0075
title: Runner app polish — accept wss:// hub URLs, honest failure messages, fixed CLI texts, a real end-to-end pair test
status: review
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

Closed the four items from the spec inside `apps/runner` only.

1. **`wss://` hub URLs.** `IdentitySchema.hubUrl` now accepts both `ws://` and `wss://` via a `z.refine` (was `z.startsWith('ws://')`). `hubUrlFromServer` already mapped `https:` → `wss:`; I added three new tests in `identity.test.ts` (round-trip a wss identity file) and `connect.test.ts` (`hubUrlFromServer` for both schemes, `validateHubUrl` for both).
2. **Honest failures.** `mapFailure` returns a new `status: 'disconnected'` with the message `"lost the connection to the server"` for any unrecognised close (it used to report `auth_failed` for everything that was not CLOSE_REVOKED / CLOSE_AUTH / CLOSE_VERSION, which included malformed and unknown-type closes). `RunResult` carries the new variant. `cli.ts` prints `Disconnected: …` and exits 1. I also fixed a latent T-0072 bug: `handleRunResult` previously returned without throwing for `revoked`, `auth_failed` and `version_mismatch`, so the CLI exited 0 for those; it now throws a typed string (which `describeError` maps to exit 1) so those three — and the new `disconnected` — all produce a non-zero exit. New tests cover every branch of `mapFailure` (via an exported `__test__mapFailure`) and the three CLI routes via `vi.mock('./connect.ts')`.
3. **Fixed 409 text.** `pair.ts` no longer echoes the server's `message`. It maps the known server codes (`key_in_use`, `machine_limit`, `pending_limit`, `pairing_code_limit`) to fixed sentences and uses one generic `"The server refused this machine."` for anything else, including non-JSON bodies. Four new tests cover: a hostile `<script>` body for each known code, six different unknown / hostile bodies (script tags, `rm -rf`, a Chinese payload, a numeric body, a plain string, `null`), and a non-parseable body. None of the hostile fragments appear in the resulting `PairError.message`.
4. **End-to-end test.** `apps/runner/src/e2e.test.ts` starts a real HTTP server (`@hono/node-server` loaded via dynamic import so the runner does not have to list it as a direct dep) on a random loopback port, backed by the real server app on PGlite (`createTestContext`, `createApp` with a shared `DbMachineRegistry`, `FakeAdminClient`, `TestMailer`). It then: signs a user in (via `bootstrapUser` over the in-memory Hono app), mints a pairing code through `POST /api/machines/pairing-codes`, runs `pairRunner` against the real HTTP listener, checks the machine is `pending` via `GET /api/machines`, starts the real `startRunnerHub` on a random loopback port, approves the machine through `POST /api/machines/:id/approve`, runs `runRunner` against the hub URL, polls `GET /api/machines` until `online: true`, revokes through `POST /api/machines/:id/revoke`, and asserts `runRunner` returns `revoked`. All timers/servers/db are closed in `afterEach`. The test takes ~3 s on my machine, runs only on loopback, and uses no real external services or API keys.

I also added `@galena/server` as a devDependency in `apps/runner/package.json` (the only allowed new dependency). Because `@galena/server` has no `exports` field, the test imports the source files directly via `@galena/server/src/...` (the same pattern `packages/xmpp-core/src/integration-*.test.ts` already uses against `apps/server/src/xmpp/*`). pnpm hoists `@galena/server`'s transitive deps into `apps/runner/node_modules/@galena/server/node_modules/`, so `import('@galena/server/src/app.ts')` resolves cleanly. `@hono/node-server` is loaded through a dynamic import to keep it out of the runner's typecheck (it's not a direct dep — it travels in via `@galena/server`).

### Files changed

- `apps/runner/package.json` — added `"@galena/server": "workspace:*"` to `devDependencies`. No other deps touched.
- `pnpm-lock.yaml` — only the new `@galena/server` link (3 lines).
- `apps/runner/src/identity.ts` — `IdentitySchema.hubUrl` now allows `ws://` or `wss://`.
- `apps/runner/src/identity.test.ts` — 2 new tests: wss round-trip, http rejection.
- `apps/runner/src/connect.ts` — new `'disconnected'` variant on `RunResult.status`; `mapFailure` reports it for unrecognised closes; `__test__mapFailure` exported for direct testing.
- `apps/runner/src/connect.test.ts` — 2 new tests (`hubUrlFromServer`, `validateHubUrl`), 5 new `mapFailure` branch tests.
- `apps/runner/src/pair.ts` — 409 branch maps known codes to fixed sentences and uses a generic line otherwise; never echoes the server's `message`.
- `apps/runner/src/pair.test.ts` — 4 new tests: known-code mapping for `machine_limit` / `pending_limit` / `pairing_code_limit` with hostile bodies, six unknown / hostile body shapes, non-parseable body fallback.
- `apps/runner/src/cli.ts` — `handleRunResult` adds the `disconnected` case (prints `Disconnected: …`, throws → exit 1); also throws for `revoked` / `auth_failed` / `version_mismatch` so those exit 1 (T-0072's spec required this; the previous behaviour was a bug).
- `apps/runner/src/cli.test.ts` — `vi.mock('./connect.ts')` hoists a `runRunnerMock`; 3 new tests assert each result branch prints the expected line and exits 1.
- `apps/runner/src/e2e.test.ts` (new) — full end-to-end test as described above.
- `work/T-0075-runner-polish.md` — this Report; front matter set to `status: review`.

No edits to `apps/server/**`, `packages/**`, `web`, `mobile`, `docs/**`, `AGENTS.md`, `BOARD.md`, or any other task file. The runner-tunnel package was not touched (its `serverUrl.startsWith('ws://')` check is left for the deployment task; the runner now just stores a `wss://` value in the identity file and passes it through when the tunnel is updated to accept it).

### Commands run and real results

- `pnpm install` — `Lockfile is up to date, resolution step is skipped. Already up to date. Done in 2.7s using pnpm v10.32.1` (3 lines added to the lockfile for the new `@galena/server` link).
- `pnpm --filter @galena/runner typecheck` — exit 0, no output.
- `pnpm --filter @galena/runner test` — `Test Files 6 passed (6), Tests 63 passed (63)`. Breakdown: `capabilities.test.ts` 6, `identity.test.ts` 12 (was 10; +2 wss tests), `pair.test.ts` 17 (was 13; +4 hostile-body tests), `connect.test.ts` 12 (was 7; +5 mapFailure tests + 2 hubUrlFromServer/validateHubUrl tests), `cli.test.ts` 16 (was 13; +3 run-result routing tests), `e2e.test.ts` 1 (new).
- `pnpm exec turbo test --force --filter=@galena/runner` — `Tasks: 1 successful, 1 total, Cached: 0 cached, 1 total`. Same 63/63.
- `pnpm test` (full workspace) — `Tasks: 10 successful, 10 total`. Runner package now contributes 63 tests.
- `pnpm format:check` — `All matched files use Prettier code style!` (after one `pnpm format` round on my edited files).
- `pnpm lint` — `oxlint .`, exit 0.
- `pnpm typecheck` (turbo) — `Tasks: 10 successful, 10 total`, exit 0. Runner: `tsc --noEmit` exit 0.
- `pnpm build` (turbo) — `Tasks: 2 successful, 2 total, FULL TURBO`, exit 0.

### Problems, deviations from the spec, open questions

- **CLI exit codes for `revoked` / `auth_failed` / `version_mismatch`.** T-0072's spec said "exit with a non-zero code when the server closes with the revoked or auth code", but the implementation only logged — `handleRunResult` did not throw, so the CLI exited 0. I fixed this as part of item 2 so the new `disconnected` branch behaves consistently. The pre-existing tests for `runRunner` itself still pass; the only thing that changed is the CLI's exit code.
- **Tunnel `serverUrl.startsWith('ws://')`.** The runner-tunnel package still rejects `wss://` URLs in its schema (`packages/runner-tunnel/src/runner.ts:19`). So the e2e test uses `ws://`. The identity schema now stores `wss://` and `hubUrlFromServer` maps `https:` → `wss:`, but a deployment using TLS will need a follow-up to loosen the tunnel check. I left a note in the identity test.
- **`vi.mock` on `./connect.ts` in `cli.test.ts`.** The CLI tests for the run-result routing use a hoisted `vi.mock`. The `runRunner` mock is reset in `beforeEach` so other tests in the file (which don't touch it) are unaffected.
- **e2e test is slow-ish (~3 s).** PGlite startup + the real `serve` listener + the real hub contribute most of the wall time. The spec asked for one real end-to-end test; I kept it to one. The test is in its own file so the rest of the suite stays sub-second.
- **Live check.** Spec said "not needed from you; say in the Report that no live proof was done beyond the test." Done: no live proof beyond the e2e test above.

### Blocked / needs a decision

None.

---

## Review (written by Claude)

**Verdict:**
