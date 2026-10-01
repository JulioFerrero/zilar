---
id: T-0145
title: Push in the production deploy (ejabberd component, compose, wizard, docs)
status: merged
milestone: M5
branch: task/T-0145-deploy-push
model: meta/muse-spark-1.3-contributor
effort: high
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

### What I did
- `deploy/ejabberd/ejabberd.yml`: added the `ejabberd_service` listener (port 5347, all container interfaces, no host port published — the server is on the same Compose network) with the host key generated at container start (literal, never a macro: ejabberd does not expand macros in map keys), the `PUSH_COMPONENT_SECRET` macro, and `mod_push` (`include_sender`/`include_body` off) + `mod_push_keepalive` (same values as the dev config).
- `deploy/ejabberd/push-entrypoint.sh` (new): writes the literal host (`push.<GALENA_DOMAIN>`) into the config by replacing the `# GALENA_PUSH_COMPONENT_HOST` marker line; refuses to start when the marker is missing (never ships a wrong host). Called from `jwt-entrypoint.sh` (which now also requires `GALENA_DOMAIN`); `Dockerfile` copies the new script.
- `deploy/docker-compose.yml` + `deploy/coolify/docker-compose.yml`: pass `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` (+ `GALENA_DOMAIN` for the entrypoint; Coolify derives it from `XMPP_DOMAIN`) to ejabberd and the seven `PUSH_*` variables to the server (`PUSH_COMPONENT_JID` derived as `push.<domain>` on both). No host port for 5347 anywhere. Missing push lines = push off; empty values are never written (the server schema rejects empty strings).
- `deploy/galena` (`init`): push on by default — generates the VAPID pair with openssl only (`_gen_vapid_keys`: P-256 via `ecparam`+`pkcs8`, fixed-offset DER extraction, base64url; verified `web-push setVapidDetails` accepts the pair), the component secret (`rand -base64 32`), the storage key (`rand -base64 48`), asks `PUSH_VAPID_SUBJECT` (default `mailto:<admin email>`), `--push-subject`/`--no-push` flags. Secrets never printed (dry-run verified). File stays 0600. `doctor`: new push section (keys present with right shape, JID equals `push.<domain>`, no `$`, plus the component-handshake grep in the ejabberd log when running). Backup/restore already carry `.env`, so `PUSH_STORAGE_KEY` survives — documented, not re-implemented.
- Bare metal: `deploy/baremetal/ejabberd.yml` gains the loopback-only 5347 listener with a literal `push.chat.example.com` host + secret (replace both by hand), `mod_push` off/off + keepalive; `.env.example` gains commented `PUSH_*` lines; guide §3/§4/§7 cover the literal-host rule, the required archive URL, and the storage-key backup warning.
- Docs: `docs/INSTALL_DOCKER.md` gains a "Push notifications" section (what it is, the three-sides agreement, doctor, backup, handshake proof step) + Coolify push variables; `docs/SERVER_CONFIG.md` "Push" gains the literal-host rule and per-path wiring (dev/Docker/Coolify/bare metal).
- Tests: `deploy/tests/push-deploy.test.sh` (new, shell-only, 15 checks, all passing): 0600 mode, wizard env parses in the real `loadPushConfig` + `web-push` accepts the VAPID pair, `--no-push` writes no secrets/empties, both compose files render with secrets agreeing and no 5347 port, entrypoint writes/refuses, doctor green on good env + names tampered values, no secrets in dry-run/doctor output.
- `infra/ejabberd/ejabberd.yml`: comments only (points at the production entrypoint + literal-host rule).

### Files changed
- `deploy/ejabberd/ejabberd.yml`, `deploy/ejabberd/push-entrypoint.sh` (new), `deploy/ejabberd/jwt-entrypoint.sh`, `deploy/ejabberd/Dockerfile`
- `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example`
- `deploy/galena` (init push generation + doctor push checks), `deploy/tests/push-deploy.test.sh` (new)
- `deploy/baremetal/ejabberd.yml`, `deploy/baremetal/.env.example`
- `docs/INSTALL_DOCKER.md`, `docs/INSTALL_BARE_METAL.md`, `docs/SERVER_CONFIG.md`
- `infra/ejabberd/ejabberd.yml` (comments only), this task file (Report + status)

### Commands run and real results
- `pnpm install`: pass (Done in 6.4s).
- `sh deploy/tests/push-deploy.test.sh`: **15 pass, 0 fail** (wizard env 0600; push env parses + web-push accepts VAPID; --no-push clean; plain compose renders, secrets agree, no 5347 port; coolify renders syntax-only with push.<domain> on both sides; entrypoint writes literal host + refuses without marker; doctor green on good env, names tampered values; no secrets in dry-run/doctor output).
- Ad-hoc verifications: `push-entrypoint.sh` against copies of the yml (`push.chat.example.com` + `push.localhost` written correctly, missing marker exits 1); wizard VAPID pair accepted by the repo's own `web-push` lib (pub 87 / priv 43 chars); wizard env parses in `loadPushConfig` with `pushConfigError() === null` both on and off; `docker compose config` renders for both compose files; only `caddy` publishes host ports.
- `pnpm format:check`: pass ("All matched files use Prettier code style!"). Caught one real bug on the way: my first baremetal edit put the 5347 listener inside `modules:` (prettier's YAML parse failed) — moved it under `listen:`.
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (10 tasks successful, cached — no app code touched).
- `shellcheck`: NOT installed on this machine (reported per T-0127 precedent); scripts are POSIX (`set -eu`, quoted expansions) and pass `sh -n`.
- Vitest: no app/package test files touched (Allowed files are deploy/docs/infra-comments only), so per AGENTS.md I ran the directly-touching test (`push-deploy.test.sh`, 15/15) instead of an unrelated package suite.

### Problems, deviations from the spec, open questions
- **Live handshake not proven here.** The spec asks for a smoke step proving "Accepted external component handshake" in the ejabberd log. I did NOT run `docker compose up` (task forbids touching the lead's dev stack/ports, and a scratch-stack `up` was beyond what parallel workers allow). Instead: `doctor` greps the live ejabberd log for the handshake when the stack runs, and `docs/INSTALL_DOCKER.md` documents the proof step (enable notifications, `logs ejabberd` must show the component accepted for `push.<domain>`). The exact log line is uncertain — ejabberd 26.07's wording was not verified against a live server, so doctor matches several phrasings (`external component.*handshake|component.*authenticated|...`) rather than one asserted string. The lead's live check should confirm the wording and tighten the grep.
- **VAPID without the `web-push` CLI.** The spec's "Read first" + SERVER_CONFIG say `web-push generate-vapid-keys`; the wizard cannot depend on node/npm packages (shell-only rule from T-0127). My openssl-only generator produces the same bytes (P-256, base64url 87/43) and the repo's own `web-push@3.6.7` accepts the pair — verified by execution, not by assumption. One fragility: the DER offsets (priv at byte 36, pub = last 65 bytes, 138-byte PKCS#8) are verified against openssl 3.x output; a future openssl layout change would make `_gen_vapid_keys` fail loudly (length check) rather than write a bad key.
- **No empty-string push values, ever.** The server's push schema rejects empty strings, and Compose renders missing vars as `""`. So `--no-push` omits the secret lines entirely, and `.env.example`/baremetal example comment the lines out. Deleting (not blanking) is the documented fix for a leftover empty value. `PUSH_COMPONENT_JID=push.<domain>` is always written (not a secret, needed for the derivation comment).
- **`PUSH_COMPONENT_PORT` not exposed in compose.** The server supports it (default 5347) but every deploy file uses 5347 literally (yml listener + component dial). Exposing it would add a fourth agreement point for no benefit; left at the default, noted in SERVER_CONFIG ("port 5347 (`PUSH_COMPONENT_PORT`)").
- **Coolify validated by `config` only** (same precedent as T-0126/T-0129): no live Coolify exists here. Coolify env UI + `config` both confirmed; the `SERVICE_PASSWORD_PUSH_COMPONENT` shared-secret convention mirrors the existing `SERVICE_PASSWORD_*` pattern.
- **Bare metal unverified on a real machine** (same standing caveat as T-0127 §8): the yml parses (prettier), the listener placement/ACL reasoning mirrors the proven Docker values, but no `ejabberdctl`, no systemd, no real boot here.
- **Security checklist:** no secrets read/committed (only throwaway wizard outputs in /tmp, deleted); no request logging touched; no deletes/updates; no caps changed (device cap untouched); permission checks untouched (no routes added); no audit entries; component secret agreed on both sides with placeholder default failing closed.

### Blocked / needs a decision
- None blocking. Lead follow-ups: (1) confirm the exact ejabberd 26.07 handshake log line on a live stack and tighten doctor's grep if needed; (2) live proof per `docs/INSTALL_DOCKER.md` "Push notifications" (up → enable → handshake line → notification → mute → remove); (3) `caddy validate` on the unchanged Caddyfiles was not re-run (no Caddy change in this task).

### Round 2 — lead prereview findings (PREREVIEW.md at e813328, untracked, not committed)
- **Finding 1 (must, wizard VAPID mismatch):** `_gen_vapid_keys` took `tail -c 103 | head -c 32` (one `0x20` length byte + 31 scalar bytes). Fixed to `tail -c 102 | head -c 32` (scalar bytes 36–67). Verified by execution: ECDH-derived pubkey from the new extraction equals the public key (old extraction does not), and a fresh wizard `init` pair matches via ECDH.
- **Finding 2 (must, entrypoint not restart-safe):** rerun after the marker was stripped exited 1 (config persists in the container layer → crash-loop on stop/start). Now exits 0 when the literal `push.$GALENA_DOMAIN:` line is already present; still fails loudly on a truly unexpected file (no marker, no literal line). Test runs it twice on the same file.
- **Finding 3 (must, empty PUSH_* crashes server):** NOT touched — fixed by the lead on main (empty `PUSH_*` means unset in `apps/server/src/push/config.ts`), outside Allowed files. The rebase will bring it in.
- **Finding 4 (should, VAPID check):** the probe now ECDH-derives the public point from the private scalar with node:crypto and compares it byte for byte (shape-only `setVapidDetails` accepted the broken pair). Proved it fails on the old extraction: a fixture pair from the pre-fix code exits 1 with `VAPID pair mismatch` (probe run ad-hoc in `apps/server/`, fixture + probe deleted afterwards — no `apps/` files committed).
- **Finding 5 (should, dollar guard):** `*"$"*` (expands to PID) → `*'$'*`.
- **Finding 6 (should, misleading comment):** push-entrypoint.sh no longer claims a temp-copy path; says the config is baked in, edited in place, persists across restarts (which is why idempotency matters).
- **Finding 7 (nit, bare-metal wording):** "VAPID pair from `openssl rand`" → points at the `_gen_vapid_keys` recipe (a real P-256 pair, not random bytes).
- **Finding 8 (nit, probe cleanup):** probe staging/removal wrapped in `trap ... EXIT INT TERM`.
- Checks re-run: `push-deploy.test.sh` **16 pass, 0 fail** (new: rerun no-op check; VAPID check now ECDH); `format:check` pass except the lead's untracked PREREVIEW.md (not mine, untouched); `lint` pass; `typecheck` pass (10/10, cached, no app code touched); `shellcheck` still NOT installed. `git status apps/` clean — no probe leftovers.

### Round 3 — lead round-2 findings (finding 1 resolved by the rebase, not touched)
- **Finding 2 (both compose files render with --no-push):** the test now renders `deploy/docker-compose.yml` with the `--no-push` wizard env AND `deploy/coolify/docker-compose.yml` with a Coolify-style no-push env (the wizard writes plain-stack vars, not `SERVICE_PASSWORD_*`, so the test carries a small Coolify no-push fixture), and asserts the rendered server env carries `PUSH_ENABLED=false` in both. Both render; the empty `PUSH_*` lines are safe because the lead's server fix (in via rebase) treats empty as unset.
- **Finding 3 (BSD sed backup + comment):** `sed -i ''` probing replaced with `sed -i.bak ...; rm -f .bak` (the form the test already uses); comment now claims only that. Verified on busybox sed (the image's sed): first run writes the host, rerun exits 0, no `.bak` left behind. (The earlier `docker run` probe failed only because the bind-mounted file itself was mounted read-only — a mount artifact, not the script; rerun against a writable copy inside the container passed.)
- **Finding 4 (placeholder secret):** `doctor` flags `PUSH_COMPONENT_SECRET` still `CHANGE_ME_PUSH_COMPONENT_SECRET` (or empty) when push is on, in plain words with an `openssl rand -base64 32` fix hint. Test tampers the secret to the placeholder and asserts the line. Both compose comments softened: the placeholder no longer "fails closed" — it fails the component handshake (wrong secret) and leaves push non-functional until a real secret is set; `doctor` flags it.
- Checks re-run: `push-deploy.test.sh` **20 pass, 0 fail**; `format:check` pass (all files); `lint` pass (oxlint, no findings, re-run this round); `typecheck` not re-run (cached 10/10 last round, no app code touched); `shellcheck` still NOT installed. `git status apps/` clean.

## Review (written by Claude)

**Verdict:** approved and merged.

### Findings
- Lead fixes: ejabberd.yml placeholder comment corrected (public placeholder, doctor fails on it); env file now written under `umask 077`. Deploy test: 20 pass, 0 fail.

### Follow-ups
- Nits 3–5 deferred: `--no-push` still writes `PUSH_COMPONENT_JID`; entrypoint sed pattern is loose; domain validation accepts a `:port` (pre-existing).
- Live handshake on a real production deploy is untested (needs a real domain).
