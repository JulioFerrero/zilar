---
id: T-1939
title: "Zero-downtime: fix zilar-core.yml and LAYOUT.md from the 10-18 split rehearsal (postgres name clash, ejabberd routes, shared volumes)"
status: merged
milestone: M5
branch: task/T-1939-core-layout-rehearsal-fixes
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1939: Core layout fixes from the rehearsal

## Spec (written by Claude, do not edit)

### Why
Julio wants pushes without the roughly 50 s of Bad Gateway. The lead rehearsed the split layout (`deploy/coolify/zilar-core.yml` plus the server and web image apps) on a throwaway Coolify project on 2026-10-18.

Rolling deploys of server and web lost 0 API requests. But the files as written would break the real cutover. The findings are in `docs/deploy/zero-downtime-plan.md` § "Split rehearsal (2026-10-18)", items 1–5. This task fixes the compose file and LAYOUT. **No production change, and no app code.**

### Facts (verified by the lead in the rehearsal on 2026-10-18, Coolify 4.4.6)
- **The name clash.** On Coolify's shared `coolify` network, the name `postgres` resolves to **Coolify's own database**: container `coolify-db` has the alias `postgres`.
  - `zilar-core` must be on that network ("Connect to predefined network"), so the apps reach `postgres-<core uuid>` and `ejabberd-<core uuid>`.
  - ejabberd's default `SQL_SERVER: postgres` (`deploy/ejabberd/ejabberd.yml:31`, used at `:58`) therefore hit Coolify's database. The login failed and ejabberd was down.
  - Setting `EJABBERD_MACRO_SQL_SERVER: postgres-<core uuid>` fixed it (`/health` showed `ejabberd: ok`).
- **Containers can find each other by full name.** A Service component's container is named `<service>-<core uuid>`, and that name resolves from the apps on the `coolify` network.
- **Strip prefix is one flag per Service component,** not per path. With `SERVICE_URL_EJABBERD_5280: /xmpp-ws` (`zilar-core.yml:106`) plus `/upload` added in the Domains field:
  - `/upload/...` arrived stripped (404);
  - `/xmpp-ws/api/status` reached ejabberd's admin API path (403 from ejabberd's own permissions; it must not be routed at all).
  - `/xmpp-ws/ws` upgraded fine (101).
- **App volumes.** Coolify names an app's persistent storage `<app uuid>-<name>`, so an app can't mount an existing volume by name. A `-v` in the app's custom Docker run options was ignored.
  - The core's `sticker-data` and `avatar-data` (`zilar-core.yml:219-224`) are never created, because no core service uses them.
- **Strip prefix on the server app** can't be turned off through Coolify's API. The rehearsal used the app's `custom_labels` without the stripprefix middleware, and `/api/...` arrived unchanged.
- **Desks are on in production:** gVisor is installed, and 2 jails run.
  - `desk-agent` mounts `desk-socket:/run/zilar` (`zilar-core.yml:159`), and the server reaches it at `DESK_AGENT_SOCKET=/run/zilar/desk.sock` (`apps/server/src/config/server-schema.ts:194`).
  - The network `desk-net` has the fixed name `desk-net` (`zilar-core.yml:209-211`), which the live compose app already owns.

### Steps
1. **`deploy/coolify/zilar-core.yml`, ejabberd:**
   - Add `EJABBERD_MACRO_SQL_SERVER: ${CORE_POSTGRES_HOST:-postgres}` next to `EJABBERD_MACRO_SQL_PASSWORD` (`:87`).
   - Add a comment explaining the `coolify-db` alias clash, and that the value is `postgres-<core uuid>`.
2. **Same service: replace `SERVICE_URL_EJABBERD_5280: /xmpp-ws` (`:106`) and its comment block** with explicit Traefik labels, and update the comment.
   - **Shared:** `traefik.enable=true`; `traefik.docker.network=coolify`; one service `zilar-ejabberd` on `loadbalancer.server.port=5280`.
   - **Router `zilar-xmpp-ws`:** rule ``Host(`${ZILAR_DOMAIN}`) && Path(`/xmpp-ws/ws`)``, entryPoints `https`, `tls=true`, `tls.certresolver=letsencrypt`, middleware `zilar-xmpp-strip` (a `stripprefix` with prefixes `/xmpp-ws`).
   - **Router `zilar-upload`:** rule ``Host(`${ZILAR_DOMAIN}`) && PathPrefix(`/upload/`)``, same TLS settings, **no** middleware.
   - **Plus two `http` entryPoint routers** with the same rules and a `redirectscheme` https middleware.
3. **Volumes** (`:215-228`):
   - Remove `sticker-data` and `avatar-data`: they belong to the zilar-server app now.
   - Make `desk-socket` external: `external: true`, `name: ${SERVER_DESK_SOCKET_VOLUME:?…}`. The value is the zilar-server app's storage volume, `<server app uuid>-desk-socket`, so desk-agent and the server share one socket.
   - Comment each change.
4. **`deploy/coolify/LAYOUT.md`:**
   - **Variables table:** add `CORE_POSTGRES_HOST` (derived: `postgres-<core uuid>`) and `SERVER_DESK_SOCKET_VOLUME` (derived: `<server app uuid>-desk-socket`).
   - **zilar-server:** volumes become the app's own persistent storages `sticker-data` → `/data/stickers`, `avatar-data` → `/data/avatars` and `desk-socket` → `/run/zilar`. Strip prefix goes off via the app's custom labels, with the exact label list from the rehearsal: routers for `/api` and `/health`, entryPoints http→https and https, `gzip`, port 3000, **no stripprefix**.
   - **zilar-core:** domains come from the labels in the compose file; the ejabberd component has no Domains entry.
   - **Rewrite "To verify in the rehearsal"** with the answers above, and keep what's still open: the re-rehearsal of these files, and `ejabberdSchema: "drift"` on a fresh database.
   - **Add a short "Order of creation" list:**
     1. Create the zilar-server app with its 3 storages and deploy it once. It turns unhealthy without a database, but its volumes now exist.
     2. Create zilar-core with `CORE_POSTGRES_HOST` and `SERVER_DESK_SOCKET_VOLUME` set, "Connect to predefined network" on, then deploy.
     3. Redeploy zilar-server.
     4. Create and deploy zilar-web.
     - Note: on the live host, the old compose app (which owns `desk-net`) must be stopped and removed before zilar-core starts.
5. **Run `sh deploy/tests/compose-config.sh`;** it must still render all four files.

### Allowed files
- `deploy/coolify/zilar-core.yml`
- `deploy/coolify/LAYOUT.md`
- `deploy/tests/compose-config.sh`
- `work/T-1939-core-layout-rehearsal-fixes.md`

### Checks
```bash
sh deploy/tests/compose-config.sh
pnpm gate
```

### Acceptance
- `zilar-core.yml` renders. ejabberd's SQL host comes from `CORE_POSTGRES_HOST`, and the two routes are explicit labels: only `/xmpp-ws/ws` is stripped, `/upload/` is not, and no other `/xmpp-ws/*` path is routed.
- The core no longer declares `sticker-data` or `avatar-data`, and `desk-socket` is external, named by `SERVER_DESK_SOCKET_VOLUME`.
- LAYOUT.md matches: new variables, the server's custom labels, the volumes and the order of creation.

---

## Report (written by the worker when done)

### What I did

**`deploy/coolify/zilar-core.yml`**
- ejabberd: added `EJABBERD_MACRO_SQL_SERVER: ${CORE_POSTGRES_HOST:-postgres}` next
  to `EJABBERD_MACRO_SQL_PASSWORD`, with a comment on the `coolify-db` `postgres`
  alias and the `postgres-<core uuid>` value. The fallback `postgres` only fits a
  local compose run.
- Replaced `SERVICE_URL_EJABBERD_5280: /xmpp-ws` and its comment block with
  explicit Traefik labels on the `ejabberd` service:
  - shared: `traefik.enable=true`, `traefik.docker.network=coolify`, service
    `zilar-ejabberd` on port 5280;
  - `zilar-xmpp-ws`: `Host(...) && Path(/xmpp-ws/ws)`, entrypoint `https`, TLS
    with `letsencrypt`, middleware `zilar-xmpp-strip` (`stripprefix.prefixes=/xmpp-ws`);
  - `zilar-upload`: `Host(...) && PathPrefix(/upload/)`, same TLS, no middleware;
  - `zilar-xmpp-ws-http` and `zilar-upload-http` on entrypoint `http`, both using a
    `zilar-https-redirect` (`redirectscheme.scheme=https`) middleware.
- Volumes: removed `sticker-data` and `avatar-data` (with a comment saying they are
  the `zilar-server` App's own storages); `desk-socket` is now `external: true` with
  `name: ${SERVER_DESK_SOCKET_VOLUME:?...}` and a comment naming
  `<server app uuid>-desk-socket`.
- Updated the file-header comments that described the old volumes and the
  `SERVICE_URL_*` convention.

**`deploy/coolify/LAYOUT.md`**
- Resource table: core routes are `/xmpp-ws/ws` and `/upload/`, strip is per label;
  server routes are `/api` and `/health`, strip off via custom labels.
- `zilar-core`: domains come from the Compose labels, no Domains entry; SQL host is
  `CORE_POSTGRES_HOST`; volume list drops `sticker-data`/`avatar-data` and marks
  `desk-socket` external.
- `zilar-server`: volumes are the App's own storages (`sticker-data` →
  `/data/stickers`, `avatar-data` → `/data/avatars`, `desk-socket` → `/run/zilar`),
  named `<app uuid>-<name>`; added the custom-label list (routers for `/api` and
  `/health`, http→https and https entrypoints, `zilar-gzip`, port 3000, no
  `stripprefix`).
- Routing table: `/xmpp-ws/ws` and `/upload/`; note that other `/xmpp-ws/*` paths
  have no route.
- Variables: dropped `SERVICE_URL_EJABBERD_5280`; added `CORE_POSTGRES_HOST`
  (derived `postgres-<core uuid>`), `SERVER_DESK_SOCKET_VOLUME` (derived
  `<server app uuid>-desk-socket`) and, for completeness, `EJABBERD_MACRO_SQL_SERVER`
  (derived from `CORE_POSTGRES_HOST`).
- Added "Order of creation" (server App + storages first, core, server redeploy,
  web) with the note that the old live compose app owning `desk-net` must be
  removed first.
- Replaced "To verify in the rehearsal" with "Rehearsal findings (2026-10-18)"
  (the seven answers) plus "Still open": re-rehearsing these files and
  `ejabberdSchema: "drift"` on a fresh database.

`deploy/tests/compose-config.sh` needed no change; the new `:?` variable is
picked up by its existing `grep`/`sed` scan.

### Checks run

`sh deploy/tests/compose-config.sh`:
```
ok: deploy/docker-compose.yml renders with a throwaway env file
ok: deploy/coolify/docker-compose.yml renders with a throwaway env file
ok: deploy/coolify/docker-compose.app.yml renders with a throwaway env file
ok: deploy/coolify/zilar-core.yml renders with a throwaway env file
```

Manual render with a dummy env file (`docker compose ... config`) confirmed:
`EJABBERD_MACRO_SQL_SERVER: postgres` (the fallback), all four routers plus the
strip and redirect middlewares, `name: app-uuid-desk-socket` with
`external: true`, and no `sticker-data` volume.

`pnpm gate`:
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (1.2s)
PASS  typecheck  (1.3s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The third changed file is the spec commit's `work/T-1939-...md`; the two
working-tree changes are the allowed `deploy/coolify` files.

No single test files were run: the change is compose/docs only.

### Notes for the lead

- The spec points to `docs/deploy/zero-downtime-plan.md` § "Split rehearsal
  (2026-10-18)", but that section does not exist on this branch (the word
  "rehearsal" does not appear in the file). I worked from the facts in the Spec.
- Deviation: both `http` routers share one `zilar-https-redirect` middleware
  instead of two separate ones; the spec asked for "a `redirectscheme` https
  middleware".
- Router names I chose: `zilar-xmpp-ws`, `zilar-upload`, `zilar-xmpp-ws-http`,
  `zilar-upload-http`; server labels use `zilar-server-api` and
  `zilar-server-health` (plus `-http` variants).
- `/upload/` is a `PathPrefix` ending in a slash, so a bare `/upload` (no
  trailing slash) is not matched. Upload URLs are `/upload/<id>`, so this is
  fine, but worth knowing.
- Nothing was deployed or verified live; the rehearsal answers are the lead's
  facts, and the re-rehearsal is listed under "Still open".

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `a25c0b1de`.
- **I read the compose diff:**
  - ejabberd's SQL host comes from `${CORE_POSTGRES_HOST:-postgres}`;
  - the routes are explicit labels: exact `Path(/xmpp-ws/ws)` with stripprefix `/xmpp-ws`, `PathPrefix(/upload/)` without it, and http→https redirects;
  - `sticker-data` and `avatar-data` are gone, and `desk-socket` is external, named by `SERVER_DESK_SOCKET_VOLUME`.
- **The pre-review nits, left as is:**
  - The routers don't name `zilar-ejabberd`. Traefik attaches the only service defined, and the re-rehearsal checks it.
  - The LAYOUT label snippet needs the real domain substituted. The cutover runbook will say so.
- **Next:** re-rehearse with these files (desk-socket tested with a dummy container).
