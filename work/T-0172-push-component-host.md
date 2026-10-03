---
id: T-0172
title: The push component dials the ejabberd service, not 127.0.0.1 (push never connects in a compose install)
status: planned
milestone: M5
branch: task/T-0172-push-component-host
model: meta/muse-spark-1.3-contributor
effort: medium
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
5. Prove it: build the images locally if the machine is free (see T-0159's Report for the recipe: scratch copy, own project name `zilar-rehearsal`, ports 18080/18443, remove everything afterwards) and show that after `up` the server log has no ECONNREFUSED for the push component and `./zilar doctor` no longer FAILs the handshake check. If you cannot run docker, say so in the Report.

### Read first
`work/T-0159-install-rehearsal.md` (Report, Problems section 3), `apps/server/src/push/component.ts`, `apps/server/src/push/config.ts`, `apps/server/src/index.ts` (around line 300), `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example`.

### Allowed files
`apps/server/src/push/**`, `apps/server/src/index.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example` (comments only), `deploy/tests/**`, `docs/INSTALL_DOCKER.md`, `work/T-0172-push-component-host.md`.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/push src/startup.test.ts
sh deploy/tests/push-deploy.test.sh
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

## Review (written by Claude)
