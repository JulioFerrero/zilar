---
id: T-1592
title: "Coolify one-click template (Julio's decision 2026-10-15): deploy/coolify/docker-compose.yml becomes a Coolify catalog template — the template header, published images, magic variables only, AI computer services behind the desks profile from published images, and a logo; docs/INSTALL_DOCKER.md's Coolify path rewritten for the template"
status: merged
milestone: M5
branch: task/T-1592-coolify-template
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1592: The Coolify template

## Spec (written by Claude, do not edit)

### Why
Julio asked how other open-source projects ship on Coolify. The usual way is a **one-click template** in Coolify's catalog: one compose file under `templates/compose/<name>.yaml` in `coollabsio/coolify`, using Coolify's magic variables. The user picks "Zilar", sets a domain and deploys, with no token and no script.

**His decision (2026-10-15):** Zilar ships as such a template. AI computers are off by default and are turned on with one host command (a separate task) plus four variables in Coolify. See `docs/deploy/one-line-install-plan.md`, "Change of course".

### Facts (the lead read them on main, 2026-10-15)
- **The template format** (from `coollabsio/coolify` `v4.x` `templates/compose/umami.yaml`):
  - header comments `# documentation: <url>`, `# slogan: <one line>`, `# category: <word>`, `# tags: a, b, c`, `# logo: svgs/<name>.svg`, `# port: <web port>`;
  - then `services:` with published images;
  - magic variables in `environment`, e.g. `SERVICE_URL_UMAMI_3000`, `$SERVICE_USER_POSTGRES`, `$SERVICE_PASSWORD_POSTGRES`, `$SERVICE_PASSWORD_64_UMAMI`;
  - health checks in compose.
- **`deploy/coolify/docker-compose.yml` (242 lines)** is already a Service compose on published images (`ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-*:${IMAGE_TAG:-latest}`), using:
  - `SERVICE_PASSWORD_{POSTGRES,ZILARDB,EJABBERDDB,ARCHIVEDB,BETTERAUTH,EJABBERDADMIN,KEYENCRYPTION,PUSHCOMPONENT,XMPPJWT}`;
  - `SERVICE_FQDN_WEB` and `SERVICE_URL_WEB`;
  - web's `SERVICE_URL_WEB_80: /` (`:216-233`).
  - **Services:** `postgres`, `ejabberd`, `server`, `web` (`:35`, `:54`, `:105`, `:216`).
  - **Volumes:** `postgres-data`, `ejabberd-database`, `ejabberd-uploads`, `sticker-data`, `avatar-data` (`:235-242`).
  - **It has no desk services.**
  - Its header (`:1-33`) explains the conventions and the one-domain routing through web's Caddy.
- **The AI computer services exist** in `deploy/coolify/docker-compose.app.yml`: `desk-agent` (`:281`), `desk-egress` (`:329`), networks `desk-net` and `desk-out` (`:374-379`), volumes `desk-socket` and `desk-egress-socket`.
  - Both services run behind `profiles: ['desks']` with a guard that exits 0 unless `DESKS_ENABLED=true`.
  - The server gets `DESK_AGENT_SOCKET` and the `desk-socket` mount.
  - **Images:** T-1582 publishes `ghcr.io/<owner>/zilar-desk-agent` (both desk services) and the jail `ghcr.io/<owner>/zilar-desk`, pinned by digest in `DESK_IMAGE` (`packages/desk/src/agent/config.ts:84`).
- **The brand icon** is `apps/site/public/favicon.svg`.
- **`docs/INSTALL_DOCKER.md` › "The Coolify path"** (`:125`) describes pasting the file into "Docker Compose Empty".

### Steps
1. **`deploy/coolify/docker-compose.yml` becomes the template:**
   - **The header first, in Coolify's format:**
     - `# documentation: https://github.com/JulioFerrero/zilar`;
     - a slogan ("Self-hosted chat where people and AIs work together", or similar, one line);
     - `# category: messaging`;
     - tags (`chat, xmpp, ai, messaging`);
     - `# logo: svgs/zilar.svg`;
     - `# port: 80`.
   - Keep a short version of today's notes below it.
   - **Add `desk-agent` and `desk-egress`** from `docker-compose.app.yml`, with `image: ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk-agent:${IMAGE_TAG:-latest}` and no `build:`. Keep the `desks` profile, the guards, the networks and the volumes.
   - **The server** gets `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}` and the `desk-socket` mount, as in `docker-compose.app.yml`.
   - **AI computers stay off** unless the user sets `DESKS_ENABLED=true`, `COMPOSE_PROFILES=desks`, `DESK_IMAGE=<…@sha256:…>` and `DESK_AGENT_SOCKET=/run/zilar/desk.sock`. **Use exactly these four names;** the host command task prints them.
   - **Every other value is a magic variable or has a default,** so a fresh deploy needs only the domain. List any variable that still needs the user in the Report.
2. **New `deploy/coolify/zilar.svg`:** the brand icon from `apps/site/public/favicon.svg`, for the catalog's `svgs/` folder.
3. **`docs/INSTALL_DOCKER.md` › "The Coolify path":**
   1. today: New Resource → "Docker Compose Empty" → paste the file;
   2. once the template is in Coolify's catalog: New Resource → search "Zilar";
   3. set the domain on `web`, then deploy;
   4. **AI computers:** run the host command (written by the next task: `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`), then set the four variables it prints, then redeploy.
4. **Leave alone:**
   - `docker-compose.app.yml`, `zilar-core.yml` and `LAYOUT.md` (live only);
   - `deploy/install.sh` and `deploy/lib/*` (another task).

### Tests
None.

### Allowed files
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/zilar.svg` (new)
- `docs/INSTALL_DOCKER.md`
- `work/T-1592-coolify-template.md`

### Checks
```bash
docker compose -f deploy/coolify/docker-compose.yml config --quiet
docker compose -f deploy/coolify/docker-compose.yml --profile desks config --quiet
pnpm gate
```
Run them with dummy values for the `SERVICE_*` variables in the shell, and say so.

### Acceptance
- **Both `config` runs pass.**
- **The Report lists:**
  - every variable a user must set by hand (ideally none besides the domain);
  - the four AI computer variables.

---

## Report (written by the worker when done)

### What I did

- **`deploy/coolify/docker-compose.yml` is now the Coolify template.** Its first
  six lines are Coolify's header (`# documentation:`, the slogan "Self-hosted
  chat where people and AIs work together.", `# category: messaging`,
  `# tags: chat, xmpp, ai, messaging`, `# logo: svgs/zilar.svg`, `# port: 80`),
  followed by a short version of the previous explanatory notes.
- **Added the AI-computer services** `desk-agent` and `desk-egress` (copied from
  `docker-compose.app.yml`), but on the published image
  `ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk-agent:${IMAGE_TAG:-latest}`
  with **no `build:`**. The `profiles: ['desks']`, the `DESKS_ENABLED` guards,
  the healthchecks, the `desk-net`/`desk-out` networks and the
  `desk-socket`/`desk-egress-socket` volumes are kept.
- **The `server`** got `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}`,
  `DESK_IMAGE: ${DESK_IMAGE:-}` and the `desk-socket:/run/zilar` mount, as in
  `docker-compose.app.yml`.
- **New `deploy/coolify/zilar.svg`**: a verbatim copy of
  `apps/site/public/favicon.svg` (1141 bytes; the `role`/`aria-label` attributes
  are kept).
- **`docs/INSTALL_DOCKER.md` › "The Coolify path"** rewritten for the template:
  paste-now / catalog-later, domain on `web` then deploy, browser setup, and the
  optional AI computers (host command + the four variables + redeploy).

Files changed: `deploy/coolify/docker-compose.yml`,
`deploy/coolify/zilar.svg` (new), `docs/INSTALL_DOCKER.md`, and this task file.

### Checks run

- `docker compose -f deploy/coolify/docker-compose.yml config --quiet` with
  dummy values for the `SERVICE_*` variables (all nine `SERVICE_PASSWORD_*`,
  `SERVICE_URL_WEB`, `SERVICE_FQDN_WEB`) → `CONFIG_OK` (exit 0).
- `docker compose -f deploy/coolify/docker-compose.yml --profile desks config
  --quiet` with the same dummy values → `CONFIG_DESKS_OK` (exit 0).
- `pnpm gate` from the repo root → `GATE PASS`, `4 changed file(s) against
  main`, every step PASS (install, format, lint, typecheck), effect SKIP, and
  `scope: every changed file is inside the Allowed files`.
- No single test files: the change is compose/docs/SVG only.

### Variables the user must set by hand

**Only the domain.** Everything else is a Coolify magic variable
(`SERVICE_PASSWORD_*`, `SERVICE_URL_WEB`, `SERVICE_FQDN_WEB`), is derived from
the domain, or has a `:-default` that turns the feature off. The domain is set
in the Domains field of the `web` component, not as an environment variable.

Optional values a user may set (all default off/empty): push
(`PUSH_ENABLED`, the VAPID pair, `PUSH_VAPID_SUBJECT`, `PUSH_STORAGE_KEY`),
SMTP overrides, `AGENT_GATEWAY_ENABLED`, `ACTION_DEMO_ENABLED`,
`RUNNER_HUB_ENABLED`, the FCM pair, `TOOLS_ENABLED`, `ROUTINES_ENABLED`,
`WEB_TOOLS_ENABLED`.

### The four AI computer variables

Turn AI computers on by setting exactly these four in the Service's environment
variables and redeploying:

- `DESKS_ENABLED=true`
- `COMPOSE_PROFILES=desks`
- `DESK_IMAGE=<jail image pinned by digest>`
- `DESK_AGENT_SOCKET=/run/zilar/desk.sock`

### Notes for the lead

- **Deviation (small):** the spec listed only `DESK_AGENT_SOCKET` and the mount
  for `server`, but `docker-compose.app.yml` (and `deploy/docker-compose.yml`)
  also pass `DESK_IMAGE` to the server, and the server's Hands wiring needs
  both (`apps/server/src/hands/wiring.ts` builds the client from
  `DESK_AGENT_SOCKET` and, separately, reads `DESK_IMAGE`). I added both so the
  template actually wires desks up. Say the word if you want it removed.
- The spec points at `docs/deploy/one-line-install-plan.md`, "Change of course";
  that section does not exist in this worktree (nothing matches "course"), so I
  could not read it. The four-variable names and the auto-Coolify host command
  are taken from the spec text itself.
- I kept a one-line note in the docs that a checkout-based install can still use
  the Application built from git (`docker-compose.app.yml`), since that is the
  live install and `docker-compose.app.yml`/`LAYOUT.md` are out of scope here.
- No new tests (compose/docs/SVG only).

## Review (written by Claude)

**Approved and merged after a live rehearsal on our Coolify 4.4.6.**

- **Pre-review:** clean, 0 nits. The extra `DESK_IMAGE` on the server is accepted: the server's Hands client needs the pinned image too.
- **The rehearsal** (approved by Julio: a scratch project, a throwaway domain, AI computers off):
  - **Setup:** project `zilar-rehearsal`; the branch's compose pasted as a Service (`49e2ki1080hof2tjaynqouay`). The web component's domain moved from Coolify's generated `movabase.com` host to `https://zilar-rehearsal.152.53.146.96.sslip.io`; nothing else was set by hand.
  - **Generated by Coolify:** all 9 `SERVICE_PASSWORD_*` values. `SERVICE_FQDN_WEB` followed the domain change.
  - **Start:** the four containers came up healthy in under 2 minutes with 0 restarts. `desk-agent`, `desk-egress` and `desk-net` were not created, so Coolify honours the `desks` profile.
  - **Over a real Let's Encrypt certificate:**
    - `/health` 200 `ok:true` (image `54633f5b9`);
    - `/api/me` 401;
    - `/` 200 HTML;
    - `/xmpp-ws/ws` upgraded with 101;
    - `/xmpp-ws/api/status` 404, so ejabberd's admin API is not exposed through the template.
  - **Logs:** 0 level-50 server errors.
  - **Cleanup:** the service (with its volumes) and the project are deleted afterwards.
- **Left for later:** `desk-net` has a fixed network name. Two installs with AI computers on the same host would share it; that's harmless for one Zilar per host. Coolify's catalog PR (with `zilar.svg`) needs Julio's OK.
