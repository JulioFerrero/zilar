---
id: T-0145
title: Push in the production deploy (ejabberd component, compose, wizard, docs)
status: todo
milestone: M5
branch: task/T-0145-deploy-push
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0119, T-0127]
estimate: 1 day
---

# T-0145: Push in the production deploy

## Spec (written by Claude, do not edit)

### Why
Web push (T-0119) works on the dev stack (`infra/`), but the production files under `deploy/` (Docker Compose, Coolify, bare metal, the install wizard) have no push component at all. On a real install push stays off, and turning it on by hand would hit the same traps the lead hit in dev. Facts learned live on 2026-10-01 (read them, do not rediscover them):
- ejabberd does NOT expand macros in map keys, so the `ejabberd_service` host must be written literally (`push.<domain>`), and the key must equal `PUSH_COMPONENT_JID` in the server env. Everything else (the secret) can use a macro.
- The component listener must listen on all container interfaces (`0.0.0.0`) and the host/compose network must expose it only where the server can reach it: in Docker Compose the server and ejabberd share a network, so no host port is needed there; in dev it is published on `127.0.0.1` only.
- The server needs `PUSH_ENABLED=true`, a VAPID key pair, `PUSH_VAPID_SUBJECT`, `PUSH_COMPONENT_JID`, `PUSH_COMPONENT_SECRET` (equal to the ejabberd macro `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`), `PUSH_STORAGE_KEY`, and `XMPP_ARCHIVE_DATABASE_URL`. See `docs/SERVER_CONFIG.md` "Push" and `infra/` for the working dev wiring.
- Web Push needs HTTPS (the Caddy setup already gives that) and a stable public origin.

### What to build
1. `deploy/ejabberd/ejabberd.yml`: the component listener (literal host derived at image build or startup from the install domain; if the file cannot expand the host, generate that one line in the entrypoint like `jwt-entrypoint.sh` does for the JWT key, never ship a wrong host), the secret macro, `mod_push` + the push keepalive module the dev config uses.
2. `deploy/docker-compose.yml` and `deploy/coolify/docker-compose.yml`: pass the new env to ejabberd and the server; no host port for 5347.
3. The install wizard (`deploy/galena`, `./galena init`): generate the VAPID keys, the component secret and the storage key (secrets never printed except the one-time admin info already shown; never committed), write them to the deploy env file with the same permissions as the other secrets, ask for `PUSH_VAPID_SUBJECT` (default `mailto:` of the admin email), and offer push as on by default. `./galena doctor` checks the pieces (component reachable, keys present) and says what is wrong in plain words. Backup/restore must include `PUSH_STORAGE_KEY` (losing it orphans every device) and the docs say so.
4. Bare-metal guide and `docs/SERVER_CONFIG.md`: the same wiring for a non-Docker install, including the literal-host rule.
5. Tests: the wizard's generated env (keys valid shape, secrets not logged, file mode), the compose files parse with the new variables, ejabberd.yml parses (use the existing deploy tests' approach). A short smoke script or doc step that proves the component handshake ("Accepted external component handshake" in the ejabberd log).
6. Out of scope: any change to server push code, web, mobile native push.

### Read first
`AGENTS.md`, `work/T-0119-pwa-web-push.md` (Review), `work/T-0127-install-wizard-backup-baremetal.md`, `work/T-0126-*.md`, `infra/ejabberd/ejabberd.yml`, `infra/docker-compose.dev.yml`, `deploy/**`, `docs/SERVER_CONFIG.md`.

### Allowed files
`deploy/**`, `infra/ejabberd/ejabberd.yml` (comments only), `docs/**` (install and server config docs), the wizard's tests, `work/T-0145-deploy-push.md`. Not allowed: `apps/**`, packages, schema, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --maxWorkers=2 <the deploy/wizard test files you touched>
```
Do NOT run `docker compose up` against the lead's running dev stack, and never read `.env` files.

## Report (written by the worker)

## Review (written by Claude)
