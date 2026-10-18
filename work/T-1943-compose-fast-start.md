---
id: T-1943
title: "Faster restarts on deploy: the Coolify template's health checks get start_interval 1s, and web waits only for the server to start, not to be healthy"
status: merged
milestone: M5
branch: task/T-1943-compose-fast-start
model: deepseek/deepseek-flash
effort: default
depends_on: []
estimate: 20 min
---

# T-1943: Compose fast start

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-18) chose "only fast stop for everyone": every Zilar install, not only chat.zilar.app, should be down as briefly as possible on an update.

**What the lead measured on 2026-10-18** on a throwaway Coolify Service built from `deploy/coolify/docker-compose.yml` (no AI computers), with requests every 0.3 s during a forced redeploy:
- **As the template is today:** down 23 s, twice.
  - Stopping took about 5 s.
  - Each start then waited about 5.6 s for the previous service's health check: postgres → ejabberd → server → web.
- **With `start_interval: 1s` on the four health checks and web waiting only for `service_started` on server:** down 7 s.
  - postgres was healthy 1.1 s after it started and ejabberd after 2.4 s.
  - Web started 0.2 s after the server and was healthy 1 s later, before the server was.

### Facts (read by the lead on 2026-10-18)
- **`deploy/coolify/docker-compose.yml`** has no `start_interval` on four health checks:
  - postgres (`interval: 5s`, `:65`);
  - ejabberd (`interval: 10s`, `:121`);
  - server (`interval: 10s`, `:241`);
  - web (`interval: 15s`, `:277`).

  desk-agent (`:333`) and desk-egress (`:367`) already have `start_interval: 2s`.
- **`deploy/coolify/docker-compose.app.yml`** (the live compose) and **`deploy/docker-compose.yml`** already have `start_interval` on every health check.
- **web waits for `server: condition: service_healthy`** in all three files:
  - `deploy/coolify/docker-compose.yml:266-268`;
  - `deploy/coolify/docker-compose.app.yml:278-280`;
  - `deploy/docker-compose.yml:260-262`.

  The web container serves the static app and forwards `/api`, `/xmpp-ws` and `/upload` (comment at `deploy/coolify/docker-compose.yml:270-271`). Until the server answers, those requests fail for a moment, and the clients already retry.

### Steps
1. **`deploy/coolify/docker-compose.yml`:** add `start_interval: 1s` right after the `interval:` line of the postgres, ejabberd, server and web health checks. Use the same placement as `deploy/coolify/docker-compose.app.yml`.
2. **web depends on server with `condition: service_started`** in all three compose files.
   - Keep any other `depends_on` entries as they are.
   - Add a one-line comment: the web container serves the app on its own and only forwards `/api`, so it starts with the server instead of waiting for it to be healthy (T-1943).
3. **Nothing else changes.** No other service, no image and no code.
4. **No tests.** Make sure each file still renders:
   ```bash
   SERVICE_FQDN_WEB=x.test SERVICE_URL_WEB=https://x.test docker compose -f deploy/coolify/docker-compose.yml config --quiet
   ```
   Run the same for the other two files.

   If Docker isn't running on the machine, say so in the report instead of skipping the check silently. In that case check the YAML with `pnpm exec prettier --check` on the three files.

### Allowed files
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/docker-compose.yml`
- `work/T-1943-compose-fast-start.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Every health check in `deploy/coolify/docker-compose.yml` has a `start_interval`.
- In all three compose files, web's `depends_on` names server with `condition: service_started`.
- The diff touches only those lines plus the comment.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `deploy/coolify/docker-compose.yml`:
  - Added `start_interval: 1s` right after the `interval:` line of the postgres, ejabberd, server and web health checks.
  - Changed web's `depends_on` on server from `condition: service_healthy` to `condition: service_started`, with a one-line comment explaining it (T-1943).
- `deploy/coolify/docker-compose.app.yml` and `deploy/docker-compose.yml`: same web `depends_on` change and comment; no other lines touched.

### Checks run

- `SERVICE_FQDN_WEB=x.test SERVICE_URL_WEB=https://x.test docker compose -f deploy/coolify/docker-compose.yml config --quiet`: exit 0.
- Same command on `deploy/coolify/docker-compose.app.yml`: exit 0.
- `deploy/docker-compose.yml` also needs its required variables to interpolate, so I ran it with placeholders (`ZILAR_DOMAIN=x.test`, all passwords/secrets `CHANGE_ME`): `docker compose -f deploy/docker-compose.yml config --quiet`, exit 0.
- No unit tests run: the spec says no tests, and no package source changed.
- `pnpm gate` summary:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.6s)
PASS  lint  (1.0s)
PASS  typecheck  (1.4s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The diff is limited to the four `start_interval: 1s` lines, the three `condition: service_started` lines and the three comments.
- Docker was running locally; the compose render checks are real, not a YAML-only fallback.
- I did not redeploy or measure timings; the numbers in the spec come from your throwaway service.

## Review (written by Claude)

**Approved and merged.**
- The diff is exactly the spec: 4 `start_interval: 1s` lines in the template, and web → server `service_started` in all 3 compose files.
- The pre-review was clean, with 0 findings.
- The three compose files render.

**What the change does:**
- The 23 s → 7 s gain was measured on 2026-10-18 on a throwaway Coolify Service with these exact settings.
- In `deploy/docker-compose.yml`, caddy still waits for the server to be healthy, so the plain-Docker path gains little there. Harmless.

**What it doesn't fix:** the live app (`docker-compose.app.yml`) already had `start_interval` and starts in 8.4 s. Its 44 s "Removing old containers" phase is still unexplained. It will be measured per container with `docker events` on the next live deploy.

