---
id: T-1973
title: "Deploy downtime: Caddy waits forever for open WebSockets on stop (30 s force-kill per deploy); set grace_period 2s in every Caddyfile that proxies XMPP"
status: merged
milestone: M5
branch: task/T-1973-caddy-grace-period
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-1973: Caddy shutdown grace period

## Spec (written by Claude, do not edit)

### Why
Julio wants "only fast stop for everyone" (2026-10-18). The lead measured the live deploy of `2423e7206` (2026-10-18 13:05 UTC) from the VPS Docker daemon log:
- Coolify stops the old containers **one at a time**.
- The first one, which is web in Compose's reverse dependency order, ignored SIGTERM. The daemon logged `Container failed to exit within 30s of signal 15 - using the force` at 15:05:40 local time.
- The next container took 11 s, and the other four took about 0.5 s each. That's the 44 s "removing old containers".

**Why web hangs:**
- web's PID 1 is `caddy run` (`apps/web/Dockerfile:50`).
- `apps/web/Caddyfile` proxies the XMPP WebSocket (`:58-64`).
- Its global block (`:10-12`) has no `grace_period`.
- Caddy's default shutdown grace is unlimited: it waits for active connections, and an open WebSocket never ends by itself.

### Facts (read by the lead on 2026-10-18)
- **`apps/web/Caddyfile`:** the global options are `{ admin off }` at `:10-12`; the WebSocket proxy is at `:58-64`.
- **`deploy/caddy/Caddyfile`:** the global options are `{ admin off  email {$ACME_EMAIL} }` at `:9-12`, and it proxies `xmpp-ws` to ejabberd.
- **`deploy/baremetal/Caddyfile`:** the global options are at `:12-15`, and it proxies `xmpp-ws` too.
- **`apps/site/Caddyfile`:** the landing page. It has no WebSocket, so leave it alone.

### Steps
1. Add `grace_period 2s` to the global options block of all three Caddyfiles that proxy XMPP, each with a one-line comment:
   ```
   # On stop, close open WebSockets after 2 s instead of waiting forever (deploys were force-killed at 30 s).
   grace_period 2s
   ```
   The clients already reconnect on a dropped socket.
2. Change nothing else. No tests: this is config.

### Allowed files
- `apps/web/Caddyfile`
- `deploy/caddy/Caddyfile`
- `deploy/baremetal/Caddyfile`
- `work/T-1973-caddy-grace-period.md`

### Checks
```bash
docker run --rm -v "$PWD/apps/web/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
pnpm gate
```
If Docker isn't available to you, say so in the Report; the lead validates.

### Acceptance
- The gate passes.
- On the next live deploy, the lead captures `docker events` and finds no "failed to exit within 30s" line, with the old containers stopped in a few seconds.

---

## Report (written by the worker when done)

### What I did

- Added `grace_period 2s` with the spec's one-line comment to the global options block of all three Caddyfiles that proxy XMPP:
  - `apps/web/Caddyfile` (after `admin off`)
  - `deploy/caddy/Caddyfile` (after `admin off` and `email {$ACME_EMAIL}`)
  - `deploy/baremetal/Caddyfile` (after `admin off` and `email your@email.example`)
- Changed nothing else. No tests added (config-only change, as the spec says).

### Checks run

- `pnpm install`: completed successfully.
- `docker run --rm -v "$PWD/apps/web/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate ...`: **could not run**. The Docker daemon is not running on this machine (`failed to connect to the docker API at unix:///Users/julio/.docker/run/docker.sock ... no such file or directory`), and there is no local `caddy` binary. Per the spec, the lead validates.
- `pnpm gate` (repo root, run twice: after the Caddyfile changes and again after this Report was written; both GATE PASS). Second run's summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (5.0s)
  PASS  format  (2.8s)
  PASS  lint  (2.4s)
  PASS  typecheck  (2.0s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run (the spec says no tests for this config change; the gate skipped tests as expected).

### Notes for the lead

- Docker was unavailable, so `caddy validate` still needs to run on your side.
- I placed `grace_period` inside the existing global options block in each file; no other lines were touched.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean.
- **Validation:** the lead validated all three Caddyfiles with the live web container's Caddy 2.10 binary: `caddy adapt --config /dev/stdin --validate`, reading from stdin and writing nothing, returned exit 0 for each. Local Docker isn't running.
- **The diff:** each file gains one comment and `grace_period 2s` in its global block. The landing page's `apps/site/Caddyfile` has no WebSocket and is unchanged.
- **Still to measure:** the next live deploy, with `docker events` (lifecycle events only) captured from before the push.
