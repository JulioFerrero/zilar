---
id: T-2007
title: "Bare-metal parity: load mod_block_strangers like the compose stacks (contacts-only DMs, blocks hold over XMPP), default TRUSTED_PROXY_HOPS=1 behind the bundled Caddy/nginx, and fix the stale TRUSTED_PROXY_HOPS comment"
status: merged
milestone: M5
branch: task/T-2007-baremetal-parity
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2007: Bare-metal parity

## Spec (written by Claude, do not edit)

### Why
The lead's private security reviews of 2026-10-18 (T-1987, T-1983 follow-ups) found three gaps in the bare-metal install.
- **DMs from anyone.** Its ejabberd config doesn't load `mod_block_strangers`, so anyone can DM anyone, and blocks don't stop DMs over XMPP.
- **No client IP.** The server never gets `TRUSTED_PROXY_HOPS`, so every per-IP limit on bare metal is one bucket.
- **Stale comment.** The config comment still says only the join limiter reads the value.

### Facts (read by the lead on 2026-10-18)
- **The ejabberd module.** `deploy/ejabberd/ejabberd.yml:302-307` loads `mod_block_strangers` with `drop: true`, `log: false`, `allow_local_users: false`, `allow_transports: false`, `captcha: false`. `deploy/baremetal/ejabberd.yml`'s `modules:` (`:191-…`) has no `mod_block_strangers`; its plain modules run from `mod_carboncopy` (`:257`) to `mod_vcard` (`:272`).
- **The service unit.** `deploy/baremetal/zilar-server.service` loads `EnvironmentFile=/etc/zilar/zilar.env` (`:16`). In systemd, values from an environment file override `Environment=`.
- **The proxy.** On bare metal, Caddy or nginx (`deploy/baremetal/Caddyfile`, `deploy/baremetal/nginx-zilar.conf`) is the only proxy in front of the server, so one hop is right.
- **The stale comment.** `apps/server/src/config/server-schema.ts:80-84` says "Only the join limiter reads it". Since T-1983, the edge also reads it for Better Auth and for every per-IP limiter.
- **Overlap.** T-2002 edits `deploy/baremetal/ejabberd.yml` too. This task runs after T-2002 merges.

### Steps
1. Add the same `mod_block_strangers` block to `deploy/baremetal/ejabberd.yml`, next to the other plain modules.
2. Add `Environment=TRUSTED_PROXY_HOPS=1` to `zilar-server.service`, before `EnvironmentFile=`, with a one-line comment that the env file can override it.
3. Update the comment at `server-schema.ts:80-84` to list today's readers: the edge for Better Auth, and the per-IP limiters.
4. If a bare-metal setup doc lists the env variables (grep `docs/` for `zilar.env`), add `TRUSTED_PROXY_HOPS=1` there too. Don't add tests.

### Allowed files
- `deploy/baremetal/ejabberd.yml`
- `deploy/baremetal/zilar-server.service`
- `apps/server/src/config/server-schema.ts`
- `docs/INSTALL_BARE_METAL.md`
- `work/T-2007-baremetal-parity.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The gate passes.

---

## Report (written by the worker when done)

### What I did
- `deploy/baremetal/ejabberd.yml`: added `mod_block_strangers` right after
  `mod_blocking`, with the same options as the Docker config (`drop: true`,
  `log: false`, `allow_local_users: false`, `allow_transports: false`,
  `captcha: false`), plus a short comment pointing at the Docker config.
- `deploy/baremetal/zilar-server.service`: added
  `Environment=TRUSTED_PROXY_HOPS=1` with a one-line comment saying the env
  file can override it, placed before `EnvironmentFile=` (so the env file
  wins, as systemd overrides `Environment=` with environment-file values).
- `apps/server/src/config/server-schema.ts`: rewrote the stale comment. It now
  says the edge reads the value for Better Auth (rate limits and stored
  session IP) and that every per-IP limiter reads it too.
- `docs/INSTALL_BARE_METAL.md`: added a note in §4 that the unit sets
  `TRUSTED_PROXY_HOPS=1` because the bundled Caddy/nginx (§6) is the only
  proxy, and that `/etc/zilar/zilar.env` overrides it.

### Checks run
- `pnpm install`: done in 36.8s, no errors.
- `pnpm gate` (from repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (1.5s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.9s)
  PASS  effect  (2.3s)
  PASS  tests @zilar/server  (9.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the change touches config, unit files and
  comments only, and the spec says not to add tests. `pnpm gate` ran the
  `@zilar/server` tests.

### Notes for the lead
- `deploy/baremetal/.env.example` was not changed because it is outside the
  Allowed files; the unit's default covers a fresh install and the env file
  can still override it. If you want the variable documented there as a
  comment, that is a follow-up in that file.
- The YAML was not validated with `ejabberdctl` (not available on this
  machine); the block is copied verbatim from `deploy/ejabberd/ejabberd.yml`
  and its indentation follows the surrounding plain modules.
- No deviations from the spec.

## Review (written by Claude)

Approved: a clean pre-review.
- **`mod_block_strangers`:** bare metal now loads it, matching the compose config.
- **`TRUSTED_PROXY_HOPS=1`:** the unit sets it, and the env file still overrides it, as systemd always lets `EnvironmentFile` beat `Environment`.
- **Docs:** the comment and the install doc are updated.
