---
id: T-1629
title: "Every Zilar container rotates its logs: add a json-file logging block (max-size 10m, max-file 3) to each service in the four compose files, so a fresh self-hosted install never fills its disk with logs (audit OPS-8)"
status: merged
milestone: M5
branch: task/T-1629-compose-log-rotation
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1629: Log rotation in every compose file

## Spec (written by Claude, do not edit)

### Why
Audit finding OPS-8 is still open (`docs/audit/findings-sweep-server.md:68`): "neither `deploy/coolify/docker-compose.app.yml` nor `deploy/docker-compose.yml` sets `logging:` (json-file `max-size`/`max-file`)". Docker's default `json-file` driver never rotates, so a busy install fills its disk.
- **Live is safe today:** the live VPS has `log-driver` and `log-opts` in `/etc/docker/daemon.json`.
- **A fresh install has no such setting:** `curl … | sh` or the Coolify template.

### Facts (the lead read them on 2026-10-16, main after T-1624)
`grep -c 'logging:'` gives 0 in all four files:
- `deploy/docker-compose.yml` (403 lines; services `postgres`, `ejabberd`, `server`, `web`, `caddy`, `desk-agent` and `desk-egress`, starting at `:30`, `:59`, `:109`, `:238`, `:254`, `:301` and `:345`);
- `deploy/coolify/docker-compose.yml` (363 lines);
- `deploy/coolify/docker-compose.app.yml` (375 lines, the **live** file);
- `deploy/coolify/zilar-core.yml` (208 lines).

### Steps
1. **In each of the four files,** add this block to **every service** (and only to services):
   ```yaml
       logging:
         driver: json-file
         options:
           max-size: 10m
           max-file: "3"
   ```
   - Write it out per service. **No YAML anchors or `x-` extension fields:** Coolify parses these files, and plain keys are the safe form.
   - Place it at the end of each service block, at the service's indentation.
2. **Add a test** in `deploy/tests/host-setup.test.sh`: for each of the four files, every service has a `logging:` key. Parse with the same approach the file already uses for compose assertions; if it has none, count services under `services:` and compare with the `logging:` count.
3. **Change nothing else.**

### Allowed files
- `deploy/docker-compose.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/coolify/zilar-core.yml`
- `deploy/tests/host-setup.test.sh`
- `work/T-1629-compose-log-rotation.md`

### Checks
```bash
sh deploy/tests/host-setup.test.sh
sh deploy/tests/install.test.sh
pnpm gate
```
If `docker` is available, also run `docker compose -f <file> config -q` on `deploy/docker-compose.yml`, with a throwaway env file if needed. Say in the Report if you could not.

### Acceptance
- **Every service in the four files has the logging block.**
- **The deploy tests pass.**
- **CI's fresh-install test passes after the merge** (the lead checks).

---

## Report (written by the worker when done)

### What I did

- Added a `logging:` block (`driver: json-file`, `max-size: 10m`,
  `max-file: '3'`) at the end of **every service** in the four compose files,
  written out per service (no anchors, no `x-` fields):
  - `deploy/docker-compose.yml` — 7 services (postgres, ejabberd, server, web,
    caddy, desk-agent, desk-egress)
  - `deploy/coolify/docker-compose.yml` — 6 services
  - `deploy/coolify/docker-compose.app.yml` — 6 services
  - `deploy/coolify/zilar-core.yml` — 4 services (postgres, ejabberd,
    desk-agent, desk-egress)
  - Nothing else in those files changed. Where a service is followed by a
    section-header comment (the "AI computers (desks)" block), the logging
    block goes directly after the service's last key, before the comment.
- Added check **3c** to `deploy/tests/host-setup.test.sh`: for each of the four
  files it extracts the service names under `services:` with `awk`, then uses
  the file's existing `service_block` helper to assert every service block has
  a `^    logging:$` line, and counts `driver: json-file` / `max-size: 10m` /
  `max-file: '3'` once per service. The raw files have the same 2/4-space shape
  as a rendered config, so this needs no docker and no env file. Also added a
  line to the file's header list documenting the new check.

### Checks run

- `pnpm install` — Done in 15.3s, ok.
- `sh deploy/tests/host-setup.test.sh` — **pass=64 fail=0** (the 8 new ok lines
  are "every service (N) rotates its logs" / "json-file caps logs at 10m x 3"
  for N = 7, 6, 6, 4).
- `sh deploy/tests/install.test.sh` — **pass=58 fail=0**.
- `pnpm gate` — **GATE PASS**, exit 0:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.8s)
  PASS  format  (2.0s)
  PASS  lint  (2.4s)
  PASS  typecheck  (3.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `docker compose config -q` on all four files (docker 29.8.1 available here),
  with a throwaway placeholder env file: **exit 0** on all four. Rendering also
  shows the block on every service (`logging:` count 7/6/6/4, matching each
  file's service count).
- Negative check: running the new check's parse on a temp copy of
  `zilar-core.yml` with one block removed gives services=4, logging=3 → FAIL,
  so the check does catch a missing block (not just a tautology).

### Notes for the lead

- **One deviation from the spec's literal block:** Prettier (the gate's format
  step) rewrites `max-file: "3"` to `max-file: '3'`; the repo's YAML style is
  single quotes. The first gate run failed format on all four files, so I ran
  `pnpm exec prettier --write` on them. That changed only the `"3"` → `'3'`
  quoting in the 23 new blocks — no other line moved (verified the diff). The
  test greps for `max-file: '3'`.
- The test parses the files directly rather than through `docker compose config`
  for these four: the spec allows the count approach, and it keeps the check
  working with no docker or env file. `docker compose config -q` was still run
  by hand (above) to prove the YAML is valid.
- No files outside the Allowed list changed; no push, merge or branch switch.

## Review (written by Claude)

**Approved and merged.** This closes audit finding OPS-8.

- **Pre-review:** clean, no nits.
- **Every service in the four files has the json-file block (10m × 3).** The lead counted them:
  - `deploy/docker-compose.yml`: 7 of 7;
  - `deploy/coolify/docker-compose.yml`: 6 of 6;
  - `deploy/coolify/docker-compose.app.yml` (live): 6 of 6;
  - `deploy/coolify/zilar-core.yml`: 4 of 4.
- **The worker ran `docker compose config -q`** on each file with a throwaway env file. The lead ran `deploy/tests/host-setup.test.sh`: pass=64, fail=0.
- **On live,** the next deploy recreates the containers with these options. The VPS's `daemon.json` rotation already covered them.

