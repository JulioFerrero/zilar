---
id: T-1998
title: "AI computer isolation: each desk jail gets its own internal Docker network shared only with desk-egress (created on provision, removed on stop), so jails of different users can't reach each other — with tests"
status: merged
milestone: M5
branch: task/T-1998-desk-network-per-jail
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-1998: One network per desk jail

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1986) found that every desk jail joins the same Docker network, `desk-net`. Docker allows traffic between containers there by default, so one user's AI can connect to a server that another user's AI started in its own jail.

Julio chose the fix on 2026-10-18: "One network per desk". The desk agent creates a private internal network for each jail and shares it only with the egress proxy. This is a code-only change: it needs no manual VPS step and works on any self-hosted install.

### Facts (read by the lead on 2026-10-18; paths under `packages/desk/src/agent/`)
- **Config.** `config.ts` (149 lines) sets `network: textFromEnv(env.DESK_NETWORK, 'desk-net')` (`:144`) and `maxRunning` from `DESK_MAX_RUNNING` (`:137`; the Coolify compose default is 12).
- **Jail flags.** `docker-args.ts` (146 lines):
  - `createArgs(...)` adds `'--network', settings.network` (`:138-139`), plus `--add-host <proxyhost>:<proxyAddress>` when there is a proxy (`:140-142`).
  - `proxyAddress(network, host)` (`:67-99`) finds the egress container by `--filter network=<network> --filter label=com.docker.compose.service=<host>`, then reads its IPv4 on that network with `docker inspect`. gVisor can't reach Docker's DNS, so the proxy name is pinned in `/etc/hosts`.
- **The Docker layer.** `docker.ts` (264 lines), `createDockerLayer(settings)`:
  - `create` (`:138-157`) looks up `proxyAddress(settings.network, host)`, then runs `docker create`;
  - `remove` (`:179-185`) runs `docker rm -f <name>`;
  - `listDeskNames` follows.
- **Lifecycle.** `lifecycle.ts` (323 lines), `provisionNew` (`:157-200`): it registers egress, removes a jail left over from an earlier run, ensures the workspace, then calls `docker.create` and `docker.start`. On failure it unregisters egress, removes the jail and releases the workspace.
- **Compose.** In `deploy/coolify/docker-compose.app.yml`:
  - `desk-agent` has `DESK_NETWORK: desk-net` (`:321`);
  - `desk-egress` joins `desk-net` and `desk-out` (`:367-369`);
  - `desk-net` is `name: desk-net, internal: true` (`:393-395`).
  - `deploy/docker-compose.yml` has the same services.
- **Runner desks** (on users' own machines) use network `none` and are not affected.
- **Tests.** `lifecycle.test.ts`, `server.test.ts`, `admission.test.ts` and `egress.test.ts` exist in this folder.

### Steps
1. **A network per desk.** In the Docker layer, give each jail its own network named `zilar-desk-<jail name>`.
   - **On `create`:**
     - `docker network create --internal --label zilar.desk=<name> zilar-desk-<name>`; if it already exists, reuse it;
     - `docker network connect zilar-desk-<name> <egress container id>`, finding the egress container by the compose service label the way `proxyAddress` does today, but without the network filter;
     - read the proxy's IPv4 on the new network;
     - create the jail with `--network zilar-desk-<name>`.
   - **On `remove`:** after `docker rm -f`, disconnect the egress container from the network, then `docker network rm zilar-desk-<name>`. Both steps are best effort and idempotent.
2. **Clean up at start.** When the agent starts, remove any `zilar.desk`-labelled network that no existing jail uses. This catches leftovers from a crash.
3. **No proxy, still isolated.** With no proxy configured, the jail still gets its own internal network, and nothing else is connected to it.
4. **Keep `DESK_NETWORK`.** It stays as the network the egress container sits on for the address lookup fallback, so the compose files need no change. Leave `desk-net` in compose, and add a one-line comment there that jails now get their own networks.
5. **Address pool.** Docker's default address pools hold about 30 bridge networks. With `DESK_MAX_RUNNING` 12 plus the compose networks, this fits. If `network create` fails, throw `DeskError('jail_unavailable', ...)` with a clear log line naming the pool.
6. **Tests** in `lifecycle.test.ts` or a new `docker-args.test.ts`, with the docker calls faked:
   - the create args use the per-desk network;
   - the egress container is connected before the jail is created;
   - remove disconnects it and removes the network;
   - the start-up cleanup removes only unused labelled networks.
7. **Size.** Every file stays at or under 400 lines; split `docker.ts` if needed into `docker-network.ts`.

### Allowed files
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/docker-network.ts`
- `packages/desk/src/agent/docker-args.ts`
- `packages/desk/src/agent/lifecycle.ts`
- `packages/desk/src/agent/main.ts`
- `packages/desk/src/agent/lifecycle.test.ts`
- `packages/desk/src/agent/docker-args.test.ts`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/docker-compose.yml`
- `work/T-1998-desk-network-per-jail.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- After the deploy, the lead starts a cloud desk and checks two things on the VPS, with reads only: `docker network ls --filter label=zilar.desk` shows its network, and the jail's networks list only that one.

---

## Report (written by the worker when done)

### What I did
Each desk jail now runs on its own internal Docker network, `zilar-desk-<jail name>`, labelled `zilar.desk=<jail name>` and shared only with the egress proxy.

- Added `packages/desk/src/agent/docker-network.ts`: network naming, create-or-reuse, egress connect and IPv4 lookup, best-effort detach/remove, and the startup sweep over `zilar.desk`-labelled networks whose jail no longer exists.
- `docker-args.ts`: made the docker runner injectable (`Exec`) so tests can fake it, added `egressContainerId`/`containerAddress` helpers (reused by `proxyAddress`), and let `createArgs` take the jail's network name (defaults to `settings.network`).
- `docker.ts`: `create` creates/reuses the jail network, joins egress before `docker create`, pins the proxy address read on that network, and falls back to `DESK_NETWORK` for the address lookup. `remove` now detaches remaining containers and removes the network after `docker rm -f`. Added `cleanupNetworks`, and `createDockerLayer` accepts an injected `Exec`/log for tests.
- `main.ts`: after the start-up `stopAll`, removes unused labelled networks and logs the count; failures are logged, never fatal.
- `deploy/coolify/docker-compose.app.yml` and `deploy/docker-compose.yml`: kept `desk-net` and `DESK_NETWORK` unchanged, and updated the comments to say jails get their own networks.
- Runner desks (`network: none`) are deliberately left on `none`: no per-desk network is created, so their behaviour is unchanged.

### Checks run
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/docker-args.test.ts`: 9 passed.
- `pnpm --filter @zilar/desk exec vitest run src/agent --maxWorkers=2 --reporter=dot`: 5 files, 48 tests passed.
- `pnpm gate`: first run failed only on format for 3 new/changed files; after `pnpm exec prettier --write` on those files, the rerun passed:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (2.2s)
  PASS  typecheck  (4.1s)
  PASS  effect  (1.4s)
  PASS  tests @zilar/desk  (2.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Tests live in the new `docker-args.test.ts` and cover: the jail args use the per-desk network, egress is connected before the jail is created and its address is pinned, the network is reused when it already exists, no-proxy jails are still isolated, runner desks stay on `none`, remove detaches and deletes the network, startup cleanup removes only unused labelled networks, and a failed network create reports `jail_unavailable` with an address-pool log line. Docker calls are faked through the injected `Exec`; the shared test harness was not changed.
- On remove I detach every container still listed on that jail's network, not only the proxy. After `docker rm -f` that is the proxy in practice, and it keeps the path correct after an agent restart when the proxy host/URL from the earlier process is no longer known.
- Startup cleanup maps a network to its jail through the `zilar.desk` label value (not the network-name prefix), and runs after `stopAll` so networks of jails removed at boot are seen as unused.
- I did not run the lead's VPS acceptance check (`docker network ls --filter label=zilar.desk` and the jail's network list); it needs the deployed host.

## Review (written by Claude)

Approved. The pre-review was clean, apart from two nits about log wording.
- **The change.** Each jail gets its own internal network, `zilar-desk-<name>`, labelled `zilar.desk`.
  - The egress proxy is connected to that network before the jail is created, and its address is pinned.
  - Remove detaches every container from the network and deletes it.
  - Start-up removes only unused labelled networks.
- **Address pool.** The lead checked the VPS: its Docker `default-address-pools` is `10.0.0.0/8` with a `/24` size (about 65k networks), and only 9 bridge networks exist today, so there is no pool limit.
- **After the deploy.** The lead starts a cloud desk and checks two things: `docker network ls --filter label=zilar.desk`, and that the jail sits only on its own network.
