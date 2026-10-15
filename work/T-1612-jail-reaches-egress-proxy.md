---
id: T-1612
title: "AI computers have no web: under gVisor the jail can't resolve the proxy name `desk-egress` (Docker's embedded DNS is unreachable from runsc), so every request fails; the agent adds --add-host <proxy>:<its IP on the desk network> to each jail, and the jail image gets curl"
status: merged
milestone: M5
branch: task/T-1612-jail-reaches-egress-proxy
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1612: The jail reaches the egress proxy

## Spec (written by Claude, do not edit)

### Why
AI computers are meant to reach the open web through the egress proxy (Julio's decision; `packages/desk/src/egress/registry.ts:16`: a `null` allowlist is the open web). On live, every web request from a jail fails, and the AI tells Julio "No curl, no net".

What the lead verified on live (2026-10-16):
- **The jail does have a proxy set.** It runs with `HTTPS_PROXY` pointing at `http://…@desk-egress:3128`, uses runtime `runsc`, and sits on the network `desk-net`. Its `/etc/resolv.conf` points at Docker's embedded DNS, `127.0.0.11`.
- **The name doesn't resolve.** In the jail, `python3` `urllib` to a public HTTPS URL fails with `[Errno -3] Temporary failure in name resolution`, and `socket.gethostbyname("desk-egress")` fails the same way. `desk-egress` is not in the jail's `/etc/hosts`.
- **The proxy can be found by label.** `docker ps --filter network=desk-net --filter label=com.docker.compose.service=desk-egress` finds the egress container, and its IP on `desk-net` is `10.0.6.2`.
- **A throwaway runsc container on `desk-net` reproduces both the bug and the fix:**
  - `getent hosts desk-egress` fails;
  - `nc -z 10.0.6.2 3128` connects;
  - with `--add-host desk-egress:10.0.6.2`, `nc -z desk-egress 3128` connects.
- **The cause:** gVisor's own network stack can't reach Docker's embedded DNS, but it can reach the IP.

### Facts (the lead read them on 2026-10-16, main `692148b9d`)
- **`packages/desk/src/agent/docker.ts`** (333 lines):
  - `createArgs(name, spec, workspaceDir, settings, proxyUrl)` (`:87-128`) builds the `docker create` args: `--network settings.network` (`:123-124`), then `...proxyFlags(proxyUrl)` (`:125`, which sets `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, `:72-84`);
  - `createDockerLayer(settings)` (`:217`) runs `docker` with `execFile` and no shell. `create(name, spec, workspaceDir, proxyUrl)` is at `:219-225`.
- **`packages/desk/src/agent/config.ts`:** `proxyUrl` comes from `DESK_EGRESS_PROXY` (`:23-24`, `:124-129`; for example `http://desk-egress:3128`), and `docker.network` from `DESK_NETWORK` (default `desk-net`, `:144`).
- **`packages/desk/src/agent/lifecycle.ts:155-160`:** provision registers egress to get the proxy URL, then calls `docker.create` and `docker.start` **only when the jail doesn't already exist**.
- **`packages/desk/src/agent/server.test.ts:55`** already calls `createArgs(…, null)`.
- **`packages/desk/Dockerfile:14-22`:** the jail image installs `git ripgrep python3 python3-pip build-essential ca-certificates jq`, with no `curl`.

### Steps
1. **In `docker.ts`, add `proxyAddress(network, host)`.** It finds the egress proxy's IPv4 on the jail network:
   - when `host` is already an IP literal, return it;
   - otherwise run `docker ps -q --filter network=<network> --filter label=com.docker.compose.service=<host>`, take the first id, then `docker inspect -f '{{with index .NetworkSettings.Networks "<network>"}}{{.IPAddress}}{{end}}' <id>`;
   - return the trimmed IP, or `null` when nothing is found or a command fails;
   - use `execFile` only, as the rest of the file does.
2. **Give `createArgs` a sixth parameter,** `proxyAddress: string | null = null`. When both `proxyUrl` and `proxyAddress` are non-null, add `--add-host`, `${new URL(proxyUrl).hostname}:${proxyAddress}` right after the network flags.
3. **In `createDockerLayer().create`,** when `proxyUrl !== null`, look up the address with `settings.network` and the proxy URL's hostname, then pass it to `createArgs`.
   - **If the lookup returns `null`,** still create the jail (a computer with no web beats no computer) and print one line on stderr naming the network and host.
   - Add a comment on why: gVisor can't reach Docker's embedded DNS, so the proxy name is pinned in `/etc/hosts`.
4. **`packages/desk/Dockerfile`:** add `curl` to the `apt-get install` list. Models reach for it first, and it honours `HTTPS_PROXY`.
5. **Test** in `packages/desk/src/agent/server.test.ts`:
   - `createArgs(…, 'http://u:p@desk-egress:3128', '10.0.6.2')` includes `--add-host` followed by `desk-egress:10.0.6.2`;
   - with a `null` address, there is no `--add-host`.
6. **Report only, don't fix:** read `lifecycle.ts:155-160` and say whether a jail that already exists (for example after an agent restart) keeps an old proxy credential in its env, while `registerEgress` registers a new secret on every provision.

### Tests
The two `createArgs` cases above.

### Allowed files
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/server.test.ts`
- `packages/desk/Dockerfile`
- `work/T-1612-jail-reaches-egress-proxy.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent/server.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A new jail's `/etc/hosts` maps the proxy host to its IP on the jail network.** The lead verifies on live after the deploy: `python3` `urllib` and `curl` to a public HTTPS URL work from a jail.
- **The jail is still created when the proxy lookup fails.**
- **`docker.ts` stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- **`packages/desk/src/agent/docker.ts`**
  - Added `proxyAddress(network, host)`: returns `host` unchanged when it is
    already an IPv4 literal; otherwise runs `docker ps -q --filter
    network=<network> --filter label=com.docker.compose.service=<host>`, takes the
    first id, then `docker inspect -f '{{with index .NetworkSettings.Networks
    "<network>"}}{{.IPAddress}}{{end}}' <id>`, and returns the trimmed IP or
    `null` on an empty result or any command failure. `execFile` only.
  - Gave `createArgs` a sixth parameter, `proxyAddress: string | null = null`.
    When both `proxyUrl` and `proxyAddress` are non-null it emits `--add-host`
    followed by `${new URL(proxyUrl).hostname}:${proxyAddress}` right after the
    `--network` flag. A comment records why: gVisor's network stack cannot reach
    Docker's embedded DNS, so the proxy name is pinned in `/etc/hosts`.
  - `createDockerLayer().create`: when `proxyUrl !== null`, it resolves the
    address with `settings.network` and the URL's hostname, then passes it to
    `createArgs`. When the lookup returns `null` it writes one stderr line naming
    the host and network and still creates the jail.
- **`packages/desk/Dockerfile`**: added `curl` to the `apt-get install` list (and
  to the header comment that enumerates the packages).
- **`packages/desk/src/agent/server.test.ts`**: added one case asserting
  `--add-host` is followed by `desk-egress:10.0.6.2` for
  `createArgs(…, 'http://u:p@desk-egress:3128', '10.0.6.2')`, and that a `null`
  address produces no `--add-host`.

### Checks run

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts`
  → `Test Files 1 passed (1)`, `Tests 13 passed (13)` (12 before, +1 new).
- `pnpm gate` (from the repo root) → `GATE PASS`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/desk  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed on `format` (prettier reformatted my `docker.ts`);
  after `pnpm exec prettier --write packages/desk/src/agent/docker.ts` the second
  run passed. `docker.ts` is 397 lines (under the 400 limit).

### Step 6 — does an existing jail keep an old proxy credential? (report only)

**Yes, and after an agent restart it can also become stale.** `provisionNew`
(`lifecycle.ts:155-161`) calls `registerEgress` on every provision, then calls
`docker.create` **only when `docker.inspect(name)` is false**. A jail that already
exists keeps whatever `HTTP_PROXY`/`HTTPS_PROXY` it was created with.

- Within one agent process this is harmless: `createEgressRegistrar` memoises one
  secret per desk for the process's lifetime (`egress.ts:31-35`, and its comment
  says a re-provision re-registers with the same credential the jail already
  carries), so the re-registered secret matches the jail's env.
- After an **agent restart** the `secrets` map is empty, so `register` mints a
  **new** secret and registers it with the proxy, replacing the desk's entry in
  the in-memory registry. But the surviving jail is not recreated, so it still
  carries the **old** secret in its env. The proxy then authenticates the old
  secret against the new registry entry and rejects it, so that jail loses the
  web until it is stopped and recreated. The previous secret also stays
  registered until `stop`/`unregister`, so secrets accumulate across restarts.

Reported only, not fixed, as the spec asks.

### Notes for the lead

- Deviations from the spec: none material. I exported `proxyAddress` (the spec
  did not say whether to export it) and used a small `isIpv4Literal` helper for
  the "host is already an IP literal" shortcut.
- `proxyAddress` builds the hostname via `new URL(proxyUrl).hostname`; an
  unparseable `DESK_EGRESS_PROXY` would make `create` throw. `proxyFlags` already
  assumes a valid URL, so I kept the same assumption.
- The acceptance check runs on live after deploy (`python3` urllib / `curl` from a
  new jail); I can only verify the argument construction here, which the test and
  gate cover.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits.
- **What the lead read:**
  - `proxyAddress` (`docker ps -q` filtered by network and the `com.docker.compose.service` label, then `docker inspect` for the IP on that network, with `null` on any miss and `execFile` only);
  - `createArgs` adds `--add-host <proxy host>:<ip>` only when both values are known;
  - `create` still makes the jail when the lookup fails, and says why on stderr;
  - `curl` is added to the jail image;
  - `docker.ts` is 397 lines.
- **The fix was proven on live before the spec:** in a throwaway runsc container on `desk-net`, `getent hosts desk-egress` failed, `nc 10.0.6.2 3128` connected, and with `--add-host desk-egress:10.0.6.2` it connected by name.
- **Step 6 (stale credential):** confirmed, but narrow.
  - Idle jails are removed (`lifecycle.ts:268-280`), and `stopAll` (`:286`) removes every jail on shutdown. So only a jail that outlives an agent **crash** keeps an old secret.
  - The same applies to a stale `/etc/hosts` IP if the egress container's IP changes.
  - **Follow-up, not filed yet:** on provision, recreate a jail that exists but isn't in `records`.
- **After deploy, the lead checks:** a new jail reaches a public HTTPS URL with `curl` and with `python3`.

