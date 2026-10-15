# One-line install: plan (2026-10-15)

Julio asked for one command that installs Zilar, including AI computers, on a server that already runs Coolify or on plain Docker, served from `get.zilar.app`.

## Julio's decisions (2026-10-15)

- **Coolify:**
  - **Coolify found:** the script sets Zilar up through **Coolify's API**. The user pastes an API token, and the script creates everything, fills in every variable, deploys and checks it.
  - **No Docker:** on a server where Docker can't run, the script **stops with a clear message** (why, and which servers work). Bare metal stays a manual guide (`docs/INSTALL_BARE_METAL.md`) and is not part of the one-liner.
- **Live runs what users get:** `chat.zilar.app` moves to the same published-images setup, "without downtime or strange hacks".
- **The URL:** `get.zilar.app` is served by the existing landing app on Coolify.

## What exists today (the lead read it on main `9a5f54b15`)

- **`deploy/install.sh`** checks disk, RAM, ports, `curl` and `tar`. It installs Docker from get.docker.com after a yes, copies only `deploy/` to `/opt/zilar`, then runs `./zilar init`, `up` and `doctor`.
  - It does not detect the virtualization type, Coolify or gVisor.
- **`--desks` cannot work on the plain stack today.** `desk-agent` and `desk-egress` are built from source (`deploy/docker-compose.yml`, `build: context: ..` with `deploy/desk/Dockerfile.agent`, which copies `packages/desk` and the lockfile), and the install has only `deploy/`.
- **The jail image is never built in CI.** `.github/workflows/images.yml` builds only server, web, postgres and ejabberd, though it does publish `latest` after every green main.
  - `DESK_IMAGE` must be pinned by digest (`packages/desk/src/agent/config.ts:84`).
- **Compose files:**
  - **`deploy/coolify/docker-compose.yml`** (published images) has no desk services.
  - **`deploy/coolify/docker-compose.app.yml`** (what live runs, built from git) has them.
- **Testing:**
  - The plain stack was tested end to end once, on localhost (T-0126).
  - No CI job applies all 67 migrations to an empty database.
- **Rolling updates:** Coolify does them only for single-container apps, never for Compose (`docs/deploy/zero-downtime-plan.md`).
  - The spike there showed path routing across apps on one host, health checks inside the container, and about 1 failed request in 289 during a rolling update.
  - The server's SIGTERM drain is done (T-1316).

## Target layout (users and live, the same)

1. **`zilar-core`** is a Coolify compose service with postgres and ejabberd, plus `desk-agent` and `desk-egress` when AI computers are on.
   - It owns every volume, and it redeploys only when its own images change (rarely, at a planned time).
2. **`zilar-server`** is a Docker-image app (`ghcr.io/…/zilar-server`) on `https://<domain>/api`, with a health check and rolling updates. It mounts the sticker and avatar volumes.
3. **`zilar-web`** is a Docker-image app (`ghcr.io/…/zilar-web`) on `https://<domain>`, with rolling updates.
4. **`/xmpp-ws` and `/upload`** are routed by Traefik straight to ejabberd, so web deploys never cut chat connections.
5. **Deploys:** CI publishes the images, then calls Coolify's deploy API for server and web. Nothing builds on the server.

The plain Docker stack (`deploy/docker-compose.yml`) runs the same images, with Caddy in front.

## Steps

Each step is a task unless it says otherwise.

1. **Desk images in CI.**
   - `images.yml` also publishes `zilar-desk-agent` and the jail image `zilar-desk`, and records the jail image's digest where the installer can read it.
   - Both compose files pull these images instead of building them. This fixes `--desks` on the plain stack.
2. **Fresh-install test in CI.** On a GitHub runner, `install.sh --yes --domain localhost` installs from the just-built images on an empty database (all migrations). The job then checks `/health`, a 401 on `/api/me`, and one sign-up.
3. **Coolify files for the target layout:** a `zilar-core` compose file, plus the env list for each of the three resources.
4. **`install.sh` check phase.** It prints a report: OS, CPU architecture, RAM, disk, ports, the virtualization type (`systemd-detect-virt`), whether Docker runs or can be installed, whether Coolify is present, and one real gVisor sandbox run.
   - Without Docker it stops with the message Julio chose.
   - AI computers are offered only when the sandbox run passed.
5. **`install.sh` Coolify mode.** With a pasted token it:
   - creates the project, `zilar-core`, `zilar-server` and `zilar-web` through Coolify's API (the API can create a service from a raw compose file and an app from a Docker image);
   - generates the secrets and fills in the variables;
   - runs `host-setup` when AI computers are on;
   - deploys and waits for health;
   - saves a root-only copy of the secrets and tells the user to keep it off the server. Live lacks that copy today (OPS-9).
6. **`get.zilar.app`:** the landing app serves the script from the latest release.
   - **Julio:** the DNS record, and the OK for the landing app's domain change.
7. **Rehearsal (lead, no task):** run the Coolify mode on the live Coolify into a scratch project with an sslip.io domain, like the `zdt-spike` project, with AI computers off.
   - **Julio's OK:** turning AI computers on in the rehearsal installs gVisor on the live host. That is a Docker reload, not a restart.
8. **Live cutover (Julio picks the time):** `chat.zilar.app` moves to the target layout.
   - The existing app becomes `zilar-core` and keeps its volumes.
   - Server and web become image apps; Julio copies the secrets in the Coolify UI.
   - **Downtime:** one planned outage of about 2 minutes; deploys are rolling after it.
   - **Julio:** the GitHub secret for Coolify's deploy API.
9. **AI computers on live:** `host-setup`, then the desk variables on `zilar-core`, then one AI set to cloud for a real job.

## Julio, in any order

- Export the `zilar-chat` environment to your password manager (OPS-9).
- Turn on Coolify's own backup to B2.
- Turn on B2 server-side encryption (OPS-15).
