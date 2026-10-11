# Move Zilar to a Coolify Application (the movabase model)

This is the plan for review. Nothing here has been run.

## Why

**Movabase** apps, and Zilar's own `landing`, are Coolify **Applications** linked to the GitHub App:
- on a push to `main`, Coolify builds from git and swaps the container;
- `watch_paths` limit rebuilds to the files that matter.

**The chat stack** (`zilar` service `zogjtvwnoh9rqo96h7e7ajz1`) is a Coolify **Service** fed by GHCR images. A deploy needs four steps to agree: GitHub builds the images, a GitHub job calls Coolify's restart API, `IMAGE_TAG` points at the new image, and the job waits for `/health`.

On 2026-10-11 the restart call answered "success" but did not recreate the containers: the same server hostname kept serving, and live stayed on `73fae1bf`. GitHub auto-deploy is paused (`AUTO_DEPLOY=off`).

## The target

There will be **one Coolify Application**:
- **build pack:** Docker Compose;
- **source:** GitHub App, repo `JulioFerrero/zilar`, branch `main`;
- **compose file:** `deploy/coolify/docker-compose.yml`, changed so `server`, `web`, `ejabberd` and `postgres` use `build:` (the existing Dockerfiles) instead of `image: ghcr.io/…`;
- **auto-deploy:** on, with `watch_paths` set to `apps/server/**`, `apps/web/**`, `packages/**`, `deploy/**`, `pnpm-lock.yaml`, `package.json` and `pnpm-workspace.yaml`. A docs-only push does not rebuild.

**What goes away:**
- the GHCR images for live (GitHub can keep building them as a CI check, or stop);
- the 3 `COOLIFY_*` GitHub secrets;
- the `IMAGE_TAG` pin;
- the GitHub deploy job.

**Optional: keep the CI gate.** Turn Coolify auto-deploy off and let CI call the Application's deploy webhook only after a green run. This is one `curl` in the workflow and it keeps "red CI never deploys". Without it, a push deploys even when CI fails.

## The traps, and how the move handles each

1. **The secrets.** Every `SERVICE_PASSWORD_*` and the other stored values must be **copied verbatim** from the old service to the new Application before its first start:
   - **`ZILAR_KEY_ENCRYPTION_KEY`:** a new one makes every stored AI provider key unreadable;
   - **`BETTER_AUTH_SECRET`:** a new one signs everyone out;
   - **the DB passwords** (`ZILARDB`, `EJABBERDDB`, `ARCHIVEDB`): they must match the roles already in postgres;
   - **`XMPPJWT`, `EJABBERDADMIN` and `PUSHCOMPONENT`:** they must match ejabberd's stored state.

   The lead does this through the Coolify MCP, reading and writing value by value and never printing values in chat. Afterwards a check compares the two key lists (keys only).
2. **The data volumes.** Coolify names volumes per resource, so the new Application starts with empty ones:
   - **postgres:** do not copy the raw files. Take a `pg_dumpall` from the old container, then restore it into the new postgres before the server starts;
   - **ejabberd:** `ejabberd-database` and `ejabberd-uploads`;
   - **the server:** `sticker-data` and `avatar-data`.

   The ejabberd and server volumes are copied with `docker run --rm -v old:/from -v new:/to alpine cp -a /from/. /to/` on the host. This needs host shell access, which the MCP may not give; if it doesn't, Julio runs the four commands.
3. **The domain.** `chat.zilar.app` moves from the old service to the new Application. Then `SERVICE_FQDN_WEB` and `SERVICE_URL_WEB` must resolve to the same host, or ejabberd's XMPP domain changes and every account breaks.
4. **Downtime:** about 10 to 20 minutes. Stop the old service, dump and restore, copy the volumes, start the new app, and check.
5. **Rollback:** the old service stays stopped, not deleted, for a week. To roll back, stop the new app and start the old one, then move the domain back.

## The steps

1. A worker changes `deploy/coolify/docker-compose.yml` to `build:` contexts, as a new file `deploy/coolify/docker-compose.app.yml`, so the old service keeps working. The lead checks `docker compose config` on it.
2. The lead creates the Application in Coolify (MCP), **not started**, with the new compose file and watch paths, and auto-deploy **off** for now.
3. The lead copies every env value from the service to the Application, then compares the keys.
4. **The cut-over, with Julio watching:**
   - backup: `pg_dumpall` plus the nightly B2 copy;
   - stop the old service;
   - restore the dump and copy the volumes;
   - move the domain;
   - start the Application;
   - check that `/health` shows the new commit, sign in, open a chat, and that AI keys still work.
5. Turn auto-deploy on, or use the CI webhook, and push a docs change to see a skipped rebuild, then a code change to see a deploy.
6. After a week without trouble, delete the old service, the GHCR deploy job and the 3 secrets.

## The lighter alternative

Coolify services also have a real **Deploy** action (re-render plus pull), which is not the same as the **Restart** the GitHub job calls today. Pointing the job at the deploy endpoint, and dropping the `IMAGE_TAG` pin, would probably fix today's deploy without any data move. It keeps the four-step chain, though, which is what Julio wants gone.
