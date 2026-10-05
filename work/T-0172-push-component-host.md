---
id: T-0172
title: The push component dials the ejabberd service, not 127.0.0.1 (push never connects in a compose install)
status: merged
milestone: M5
branch: task/T-0172-push-component-host
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0172: The push component dials the ejabberd service, not 127.0.0.1

## Spec (written by Claude, do not edit)

### Why
The fresh-install rehearsal (T-0159) found that `apps/server/src/push/component.ts:38` connects to `xmpp://127.0.0.1:${port}`. In a compose install the server and ejabberd are different containers, so 127.0.0.1 is the server container itself, where nothing listens. The server logs `push component error / connect ECONNREFUSED 127.0.0.1:5347` every second, `./zilar doctor` reports "ejabberd shows no accepted push component handshake", and push notifications cannot work. Dev works only because `infra` publishes 5347 on the host loopback. The live install has push disabled, so nobody noticed.

### What to build
1. A new optional setting `PUSH_COMPONENT_HOST` in `apps/server/src/push/config.ts` (zod, default `127.0.0.1` so dev keeps working), passed to `startPushComponent` from `apps/server/src/index.ts`, used to build the `xmpp://HOST:PORT` service URL. Validate it as a plain hostname (letters, digits, dots, hyphens, no scheme, no port, no slash); an invalid value fails startup with a fixed message.
2. Both compose files set `PUSH_COMPONENT_HOST: ejabberd` on the server service (the Coolify file too); `deploy/.env.example` documents the variable in a comment.
3. Tests (Vitest): the config accepts a hostname and rejects `a:1`, `http://x`, `x/y`, empty; `startPushComponent` builds the URL from host and port (use the injected `createComponent` factory, no network). A deploy test under `deploy/tests/` asserts both compose files set `PUSH_COMPONENT_HOST` for the server service.
4. Docs, two sentences in `docs/INSTALL_DOCKER.md`: the invite header for the OTP curl example is `x-zilar-invite` (not `x-invite-code`, which the server silently ignores), and the XEP-0363 upload slot request goes to the `upload.` subhost, not the bare domain.
5. Do NOT run docker or build images (lead note 2026-10-05: the machine is busy with emulator builds); the lead runs the compose rehearsal later. Say in the Report which commands would prove it.

### Read first
`work/T-0159-install-rehearsal.md` (Report, Problems section 3), `apps/server/src/push/component.ts`, `apps/server/src/push/config.ts`, `apps/server/src/index.ts` (around line 300), `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example`.

### Allowed files
`apps/server/src/push/**`, `apps/server/src/index.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example` (comments only), `deploy/tests/**`, `docs/INSTALL_DOCKER.md`, `work/T-0172-push-component-host.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push src/startup.test.ts
sh deploy/tests/push-deploy.test.sh
pnpm gate
```

### Acceptance
- In a compose install the push component connects to ejabberd (no ECONNREFUSED loop, doctor green on that check).
- Dev (`infra` with 5347 published on loopback) still works with no new variable.
- An invalid `PUSH_COMPONENT_HOST` fails startup with a fixed message that does not echo secrets.
- Both compose files set the variable; a test fails if either loses it.

### Out of scope
Turning push on in the live install (needs VAPID keys, Julio's decision), changing the XEP-0357 protocol handling, the cosmetic ejabberd `mod_client_state` warning.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/push/config.ts`: new optional `PUSH_COMPONENT_HOST` (zod, default `127.0.0.1`, regex `^[A-Za-z0-9.-]+$` so scheme/port/slash fail). Empty value counts as unset (Compose `${VAR:-}` rule). New `loadPushConfigOrExit`: only a host error exits with the fixed message `Invalid push configuration: PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)` (value never echoed); any other parse error rethrows.
- `apps/server/src/push/component.ts`: new required `host` option; service URL is now `xmpp://HOST:PORT` instead of hardcoded `127.0.0.1`.
- `apps/server/src/index.ts`: loads push env via `loadPushConfigOrExit` (before `createApp`, like `loadServerConfigOrExit`) and passes `host: push.PUSH_COMPONENT_HOST` to `startPushComponent`.
- `deploy/docker-compose.yml` + `deploy/coolify/docker-compose.yml`: server service sets `PUSH_COMPONENT_HOST: ejabberd`.
- `deploy/.env.example`: documents the variable in a comment (stays commented; dev keeps the loopback default).
- Tests: `config.test.ts` (default loopback, empty-as-unset, accepts `ejabberd`/dotted/hyphenated, rejects `a:1`, `http://x`, `x/y`, `host name`, `host:5347`); `component.test.ts` first test asserts the injected factory receives `xmpp://ejabberd:5347`; new `deploy/tests/push-component-host.test.sh` (docker-free grep of both compose files' `server:` blocks, asserts exactly `ejabberd`, not 127.0.0.1).
- `docs/INSTALL_DOCKER.md`: two sentences added — `x-zilar-invite` header on the OTP send-code curl (`x-invite-code` is silently ignored, fake `{"success":true}`), and the XEP-0363 slot request goes to the `upload.` subhost (bare domain answers `service-unavailable`).

### Files changed
`apps/server/src/push/config.ts`, `apps/server/src/push/component.ts`, `apps/server/src/index.ts`, `apps/server/src/push/config.test.ts`, `apps/server/src/push/component.test.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example` (comments only), `deploy/tests/push-component-host.test.sh` (new), `docs/INSTALL_DOCKER.md`.

### Commands and real results
- `pnpm install`: pass (Done in 11.7s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/config.test.ts`: 6 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/component.test.ts`: 3 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/startup.test.ts`: 11 passed.
- `sh deploy/tests/push-component-host.test.sh`: pass=2 fail=0.
- tsx probe of `loadPushConfig`: rejects `a:1`, `http://x`, `x/y`; empty parses as unset; default is `127.0.0.1`.
- `pnpm gate` (foreground): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- NOT run: `sh deploy/tests/push-deploy.test.sh` — it shells out to `docker compose config`, and the lead forbade docker on this machine (busy with emulator builds). The new `push-component-host.test.sh` covers the spec's compose assertion without docker.

### Docker commands the lead should run (proof)
1. `sh deploy/tests/push-deploy.test.sh` — full push deploy suite (compose renders, secrets agree, doctor checks).
2. Fresh compose rehearsal per T-0159, then: server log shows no `push component error / connect ECONNREFUSED 127.0.0.1:5347` loop, and `./zilar doctor` is green on `ejabberd shows no accepted push component handshake`.
3. Dev regression: `infra` stack with no `PUSH_COMPONENT_HOST` set — push component still connects via 127.0.0.1.
4. Negative: `PUSH_COMPONENT_HOST='http://x' ./... ` — server exits 1 with `Invalid push configuration: PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)` and no value echoed.

### Problems / deviations
- My first awk range in the deploy test matched its own start line and found no block; fixed to exit at the next two-space key.
- `docs/INSTALL_DOCKER.md` contains multibyte em-dashes, so `edit` oldStrings failed to match; used a python3 replace with exact-occurrence asserts instead. No content reworded.
- Spec Check line says `sh deploy/tests/push-deploy.test.sh`; not runnable here per the lead's no-docker order — stated above, with the lead-run commands listed.

### Security checklist
- Fixed startup message names the variable, never the value (a secret pasted into the host var cannot leak).
- No secrets read, printed or committed; no `.env` touched. No routes, caps, audit, deletes or updates touched. `startPushComponent` callers: only `index.ts` (test fakes pass their own host).

### Round 2 (fix round, PREREVIEW should-fix 1)
- Anchored the deploy-test grep: `_host_line` extraction now uses `grep -E "^[[:space:]]+PUSH_COMPONENT_HOST:"` and the value check `grep -q "^[[:space:]]*PUSH_COMPONENT_HOST: ejabberd"`, so a commented-out line (`# PUSH_COMPONENT_HOST: ejabberd`) no longer passes. Verified: real files give `pass=2 fail=0`; a temp copy with the line commented out yields no match (correct fail).
- Behaviour test added for the fix: the commented-out scenario above serves as the negative case (the finding named no exact test; this is the direct regression check).
- Nits 2 (hostname regex tightness) and 3 (awk service-name pattern) left as-is per instructions (not on a changed line; both fail safe / fine for current files).
- Gate (round 2): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- Single tests run this round: `sh deploy/tests/push-component-host.test.sh` → `pass=2 fail=0` (plus the commented-out negative probe).

## Review (written by Claude)

**Verdict:** Approved after one auto round. Read the diff: `PUSH_COMPONENT_HOST` (default `127.0.0.1`, plain-hostname regex, empty treated as unset) builds `xmpp://host:port`; an invalid value exits with a fixed message that never echoes the value; both compose files set `ejabberd`. Docker was not run (lead's order, emulator builds); the lead runs `sh deploy/tests/push-deploy.test.sh` after the merge and the compose rehearsal later. Push stays off on the live install (VAPID keys are Julio's decision).
