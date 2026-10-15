---
id: T-1584
title: "One-line install step 3 (docs/deploy/one-line-install-plan.md): the Coolify target layout as files — deploy/coolify/zilar-core.yml (postgres, ejabberd, desk-agent, desk-egress from published images, plain secret variables, ejabberd routed on /xmpp-ws and /upload) and deploy/coolify/LAYOUT.md (the three resources: zilar-core, zilar-server and zilar-web image apps, every variable by name, routing, volumes, health checks); live is not touched"
status: merged
milestone: M5
branch: task/T-1584-coolify-split-layout
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1584: Coolify target layout files

## Spec (written by Claude, do not edit)

### Why
`docs/deploy/one-line-install-plan.md` step 3, with the "Target layout" section.
- **The change:** Zilar on Coolify becomes three resources, so server and web get Coolify's rolling updates, which Coolify never does for a Compose stack (`docs/deploy/zero-downtime-plan.md`).
- **The users:** the installer (T-1585, then the Coolify mode) creates exactly this, and live moves to it later (plan step 8).
- **The output:** these files are the source both read. Nothing here touches the live app.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **Live today** is one Compose Application, `deploy/coolify/docker-compose.app.yml` (391 lines), built from git:
  - services `postgres` (`:43`), `ejabberd` (`:65`), `server` (`:120`), `web` (`:253`), `desk-agent` (`:281`) and `desk-egress` (`:329`);
  - networks `desk-net` and `desk-out`;
  - volumes `postgres-data`, `ejabberd-database`, `ejabberd-uploads`, `sticker-data`, `avatar-data`, `desk-socket` and `desk-egress-socket` (`:374-391`).
- **The Coolify conventions** in use (`:17-29`):
  - `SERVICE_PASSWORD_<ID>` generates a secret: `POSTGRES`, `ZILARDB`, `EJABBERDDB`, `ARCHIVEDB`, `BETTERAUTH`, and more in the file;
  - `SERVICE_URL_<SERVICE>_<PORT>` with a path gives a service a domain, as in web `SERVICE_URL_WEB_80: /` (`:265`);
  - services reach each other by Compose service name, e.g. `postgres:5432` (`:139-140`).
- **Today's routing:** the one domain goes to `web`, whose Caddy forwards `/api` to the server and `/xmpp-ws` and `/upload` to ejabberd (`:37-41`, `apps/web/Caddyfile`).
- **The spike** (`docs/deploy/zero-downtime-plan.md`, "Spike results"):
  - two apps on one host split by path works;
  - **Coolify strips the path prefix by default**, so the server app must turn strip-prefix off because it serves `/api/...`;
  - health checks run inside the container with `wget` or `curl`;
  - rolling updates lost 1 request in 289.
- **Published images:**
  - `ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-{server,web,postgres,ejabberd}:${IMAGE_TAG:-latest}` (`deploy/coolify/docker-compose.yml` uses them);
  - T-1582 adds `zilar-desk-agent` (desk-agent and desk-egress) and `zilar-desk` (the jail, pinned by digest in `DESK_IMAGE`).
- **Containers in a Coolify compose service** are named `<service>-<resource uuid>`. An app that joins the `coolify` network reaches them by that name ("Connect to predefined network", `docs/deploy/zero-downtime-plan.md` Phase 2).

### Steps
1. **New `deploy/coolify/zilar-core.yml`**, a Coolify **Service** compose using published images:
   - **Services:** `postgres`, `ejabberd`, `desk-agent` and `desk-egress`, with their environment, volumes, health checks and networks copied from `docker-compose.app.yml`. Change only these:
     - `image:` instead of `build:`;
     - **secrets:** plain variables instead of `SERVICE_PASSWORD_*`: `POSTGRES_PASSWORD`, `ZILAR_DB_PASSWORD`, `EJABBERD_DB_PASSWORD`, `ARCHIVE_DB_PASSWORD`, the ejabberd JWT secret and every other one the four services read. The installer generates them and sets the same values on the server app;
     - **the XMPP domain:** a plain `ZILAR_DOMAIN` variable replaces `SERVICE_FQDN_WEB`;
     - **routing:** ejabberd gets the public routes `/xmpp-ws` and `/upload` on `ZILAR_DOMAIN` through a Coolify `SERVICE_URL_EJABBERD_<port>` path, or the way Coolify documents several paths for one service. **Mark it unverified** if you can't confirm it from the docs.
   - The volumes keep their names, so live can keep its data at the cutover. Add the server's `sticker-data` and `avatar-data` here too.
   - The desk services stay behind `profiles: ['desks']` and keep their guards.
2. **New `deploy/coolify/LAYOUT.md`**, which the installer and the cutover follow:
   - **the three resources:** `zilar-core` (this file), `zilar-server` (Docker-image app `zilar-server`) and `zilar-web` (Docker-image app `zilar-web`);
   - **for each:** image, domain and path, strip-prefix on or off, internal port, health check command, volumes (the server mounts `sticker-data` and `avatar-data` from core), "connect to predefined network", `stop_grace_period`, and how it reaches the others (`postgres-<core uuid>`, `ejabberd-<core uuid>`);
   - **a table of every variable:** name, which resources need it, and generated or user-given. Take the server's from `docker-compose.app.yml:120-252`. **Names only, never values.**
   - **the web app:** what its Caddy still proxies once Traefik sends `/api`, `/xmpp-ws` and `/upload` straight to their apps. Say whether `apps/web/Caddyfile` needs a change; don't make it here;
   - **"To verify in the rehearsal (plan step 7)":** every point you could not confirm.
3. **Change nothing else:** not `docker-compose.app.yml`, `docker-compose.yml` nor any Dockerfile.

### Tests
None.

### Allowed files
- `deploy/coolify/zilar-core.yml` (new)
- `deploy/coolify/LAYOUT.md` (new)
- `work/T-1584-coolify-split-layout.md`

### Checks
```bash
docker compose -f deploy/coolify/zilar-core.yml config --quiet
docker compose -f deploy/coolify/zilar-core.yml --profile desks config --quiet
pnpm gate
```
Run them with dummy values for the required variables in the shell, and say so.

### Acceptance
- **Both `config` runs pass.**
- **The Report gives:**
  - the variables table's row count;
  - the list of points to verify;
  - **a diff summary:** for each of the four services, what differs from `docker-compose.app.yml` besides `image:` and the secret names.

---

## Report (written by the worker when done)

### What I did

New `deploy/coolify/zilar-core.yml` (Coolify **Service**, Docker Compose, published
ghcr.io images): `postgres`, `ejabberd`, `desk-agent` and `desk-egress`, copied
from `deploy/coolify/docker-compose.app.yml` with only the spec's changes —
`image:` for `build:`, plain variables for the `SERVICE_PASSWORD_*` secrets,
plain `ZILAR_DOMAIN` for `SERVICE_FQDN_WEB`, and
`SERVICE_URL_EJABBERD_5280: /xmpp-ws` on the `ejabberd` component. The desk
services keep `profiles: ['desks']` and their guards, and `sticker-data` and
`avatar-data` are declared here (mounted later by `zilar-server`).

New `deploy/coolify/LAYOUT.md`: the three resources (`zilar-core` Service,
`zilar-server` and `zilar-web` Docker-image Apps) with image, route/path,
strip-prefix, internal port, health check, volumes, network, `stop_grace_period`
and how each reaches the others (`postgres-<core uuid>`,
`ejabberd-<core uuid>`); a Traefik routing table; the variables table; the web
Caddy section; and the "to verify in the rehearsal" list.

Changed nothing else: `docker-compose.app.yml`, `docker-compose.yml` and the
Dockerfiles are untouched.

### Checks run

Dummy values exported in the shell for the required variables
(`IMAGE_OWNER=local IMAGE_TAG=t1584 ZILAR_DOMAIN=chat.example.test`,
`POSTGRES_PASSWORD/ZILAR_DB_PASSWORD/EJABBERD_DB_PASSWORD/ARCHIVE_DB_PASSWORD/
EJABBERD_ADMIN_PASSWORD/PUSH_COMPONENT_SECRET/XMPP_JWT_SECRET/DESK_IMAGE=CHANGE_ME`).

- `docker compose -f deploy/coolify/zilar-core.yml config --quiet` → exit 0.
- `docker compose -f deploy/coolify/zilar-core.yml --profile desks config --quiet`
  → exit 0.
- `pnpm gate` → **GATE PASS**:
  `gate: 3 changed file(s) against main`
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `SKIP effect (no source files changed)`,
  `scope: every changed file is inside the Allowed files`,
  `migration: …`, `images: …`, `size: …`.
- No single test files: the task's Tests section says none, and only `deploy/`
  and `work/` changed.

### Result for the acceptance

**Variables table row count: 72** (`deploy/coolify/LAYOUT.md`, "Variables").

**Diff summary, per service, besides `image:` and the secret names**
(from `deploy/coolify/docker-compose.app.yml`):

- **postgres** — nothing else. (Same environment keys, volume, health check.)
- **ejabberd** — `SERVICE_FQDN_WEB` → `ZILAR_DOMAIN` in five values
  (`EJABBERD_MACRO_HOST`, `EJABBERD_MACRO_MUC_HOST`, `EJABBERD_MACRO_ADMIN`,
  `ZILAR_DOMAIN`, `EJABBERD_MACRO_UPLOAD_URL`); added
  `SERVICE_URL_EJABBERD_5280: /xmpp-ws`; the push secret key becomes
  `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` ← `PUSH_COMPONENT_SECRET`.
- **desk-agent** — nothing else (only the image: `build:` + local
  `zilar-desk-agent:local` → the published `ghcr.io/…/zilar-desk-agent` tag).
- **desk-egress** — nothing else (same image change).

**Points to verify** (`LAYOUT.md` → "To verify in the rehearsal", 11 items):
1. two paths for one Service component (`/upload` via the component's Domains field);
2. per-path strip prefix (`/xmpp-ws` on → `/ws`, `/upload` off) — with the Caddy fallback;
3. `/xmpp-ws/api` must not reach ejabberd's `mod_http_api` (SEC-2);
4. cross-resource volume mounts (`sticker-data`, `avatar-data`, `desk-socket`);
5. path priorities `/` vs `/api`;
6. `/health` after the split (the web Caddy can no longer resolve `server`/`ejabberd`);
7. container-internal health checks; 8. cross-resource DNS; 9. the server SIGTERM drain;
10. desk profiles/guards; 11. watch paths.

### Notes for the lead

- **`docs/deploy/one-line-install-plan.md` does not exist** in the tree (not in
  `main`, not in this branch; nothing in git adds it). The spec is self-contained,
  so I worked from it plus `docs/deploy/zero-downtime-plan.md`; both new files
  cite that plan doc by name — if its path/step number changes, those two lines
  should follow.
- **Deviation:** the compose declares only `SERVICE_URL_EJABBERD_5280: /xmpp-ws`.
  The Coolify docs document one path suffix per `SERVICE_URL_*` variable and the
  component's **Domains** field as the way to change/set a component's domains,
  so `/upload` is described in `LAYOUT.md` as a second entry in that field
  (marked unverified, per the spec).
- **Security flag, not solved here:** the Caddyfile answers 404 for every
  `/xmpp-ws/*` except `/xmpp-ws/ws`, to keep ejabberd's admin REST API at `/api`
  private. Routing the `/xmpp-ws` prefix to ejabberd would make `/xmpp-ws/api/…`
  reachable as `/api/…`. Called out in "To verify" item 3; the fallback is to
  keep the WebSocket proxied by the web App's Caddy.
- Two paths also need opposite strip-prefix settings (`/xmpp-ws` stripped to
  `/ws`, `/upload` kept) — item 2, with the same fallback.
- First `pnpm gate` failed only on prettier for `LAYOUT.md`; I ran
  `pnpm exec prettier --write deploy/coolify/LAYOUT.md` and the second gate
  passed.

### Round 1 (fix round after prereview)

Findings fixed:

- **Finding 1 (must-fix), `deploy/coolify/LAYOUT.md:169`:** `TRUSTED_PROXY_HOPS`
  is now `fixed 1`, not `2`, with the corrected justification. After the split
  Traefik routes `/api` straight to `zilar-server`, so the web Caddy is no longer
  in the chain and only one proxy appends `X-Forwarded-For`. With `2` and a
  single-address header, `trustedClientIp` returns `null`
  (`apps/server/src/http/client-ip.ts:20`), `clientIpFrom` falls back to the
  socket address (Traefik's IP), and every visitor would share one per-IP limiter
  bucket for join, setup and invite preview. One-line diff; the table padding is
  unchanged.

Findings left untouched (nits, and not on a line this round changes):

- **Finding 2 (nit), `work/T-1584-coolify-split-layout.md:138-139`:** Report
  wording about `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`; left as-is.
- **Finding 3 (nit), `deploy/coolify/LAYOUT.md:154`:** `DESK_AGENT_SOCKET`
  "fixed" vs "conditional"; left as-is.

Tests added: none. The Spec's Tests section says "None", the change is
documentation only (no code path), and the pre-review confirms there are no
vitest files for this diff.

Checks run (dummy values as before):

- `docker compose -f deploy/coolify/zilar-core.yml config --quiet` → exit 0.
- `docker compose -f deploy/coolify/zilar-core.yml --profile desks config --quiet`
  → exit 0.
- `pnpm gate` → **GATE PASS** (`gate: 3 changed file(s) against main`; `PASS
  install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `SKIP effect
  (no source files changed)`, `scope: every changed file is inside the Allowed
  files`).

Status kept `review`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one autofix round (one must-fix), with 3 wording nits.
- **What the lead read:** `deploy/coolify/LAYOUT.md` (267 lines) and `deploy/coolify/zilar-core.yml` (228 lines).
  - **The three resources:** image, route, port, strip prefix, health check, volumes and drain for each.
  - **The routing table:** `/api` with strip-prefix off; `/xmpp-ws` with it on, because ejabberd serves `/ws`; `/upload` with it off.
  - **The variables table:** names only.
  - **The 11 rehearsal points.**
- **A real catch, point 3:** routing the `/xmpp-ws` prefix straight to ejabberd could expose its admin REST API (`mod_http_api` on the same 5280 listener, SEC-2). Today `apps/web/Caddyfile` answers 404 to everything under `/xmpp-ws/` except `/xmpp-ws/ws`. **The rehearsal must prove `/xmpp-ws/api` is unreachable before any cutover.**
- **A correction for the Coolify-mode task:** "Watch paths" (`LAYOUT.md:73-74`, `:91-92`) and rehearsal point 11 don't apply to Docker-image apps, which never build from git. Their deploys come from CI calling Coolify's deploy API after the images publish (`docs/deploy/one-line-install-plan.md`, target layout item 5). The Coolify-mode task fixes those lines.
- **Left as they are:** the 3 wording nits (the push-secret line in the Report, "fixed" for `DESK_AGENT_SOCKET`, and `SOURCE_COMMIT`/`ZILAR_COMMIT` missing from the variables table). `SOURCE_COMMIT` is a build argument of the git-built app, so it goes away with image apps.
