---
id: T-1605
title: "AI computers T3 (stacks and scripts): the desk services run in every stack (no profile, no guard, no DESKS_ENABLED), the agent gets DESK_IMAGE_OWNER/DESK_IMAGE_TAG, the server a fixed socket; ./zilar stops pinning (update clears its own old pin); --desks/--desks-host are host prep only; docs and deploy tests follow"
status: merged
milestone: M5
branch: task/T-1605-desks-always-in-stack
model: auto
effort: default
depends_on: [T-1602, T-1603]
estimate: 50 min
---

# T-1605: Desk services in every stack, one host command

## Spec (written by Claude, do not edit)

### Why
- **The plan:** `docs/deploy/ai-computers-auto-plan.md` §1.1, §1.6, §2.2 and §2.5 (T-1599). This is task T3 of its split.
- **The goal (Julio, 2026-10-15):** AI computers turn on with one host command, `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`, or the plain installer's own prompt. No variables, and updates move the jail image along.
- **The pieces:** T-1602 makes the agent wait for gVisor and pin its own image, and T-1603 makes the server ask the agent. This task removes the switches.
- **⚠ The lead merges this task only after T-1602 and T-1603.**

### Facts (the lead read them on 2026-10-15, main after T-1601)
- **The four compose files have the same desk blocks.**
  - **`deploy/docker-compose.yml`:**
    - `desk-agent` `:300-…`: `profiles: ['desks']` `:301`, `restart: on-failure` `:305`, a `command:` guard whose `sh -c` starts with `test "$${DESKS_ENABLED:-false}" = "true" || { echo "desks disabled …"; exit 0; };` (`:318-319`), env `DESKS_ENABLED: ${DESKS_ENABLED:-false}` `:322`, `DESK_IMAGE: ${DESK_IMAGE:-}` `:329`, `DESK_AGENT_SOCKET: /run/zilar/desk.sock` `:332`;
    - `desk-egress` `:352-…`: `profiles` `:353`, `restart: on-failure` `:357`, the guard `:366-367`, `DESKS_ENABLED` `:370`;
    - server env: `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}` `:212` (comments `:210-211`), `DESK_IMAGE: ${DESK_IMAGE:-}` `:214`;
    - the desk-socket volume comment `:233-234`; the section header `:295`.
  - **`deploy/coolify/docker-compose.yml`:** the header `:45-47` (set four variables), server `:217-221`, `:241-242`, section `:264-266`, agent `:272-304` (`profiles` `:273`, restart `:277`, guard `:290-291`, `DESKS_ENABLED` `:294`, `DESK_IMAGE` `:301`), egress `:322-340`.
  - **`deploy/coolify/docker-compose.app.yml`** (live): server `:225-228`, `:249-250`, section `:275-277`, agent `:281-312` (`profiles` `:282`, restart `:289`, guard `:300-301`, `DESKS_ENABLED` `:304`, `DESK_IMAGE` `:309`), egress `:329-348`.
  - **`deploy/coolify/zilar-core.yml`:** section `:115-117`, agent `:122-150`, egress `:167-183`.
- **`deploy/zilar`:**
  - `:52-54` sources `lib/desk-image.sh`;
  - `:89-109` `compose()` adds `--profile desks` and `DESK_AGENT_SOCKET` when `DESKS_ENABLED=true` (`:94-100`);
  - `:475-494` is the `.env` template (`DESKS_ENABLED=false` `:482`, comments `:480-489`);
  - `:514` and `:551` call `pin_desk_image` in `up` and `update`;
  - `:841-892` is the doctor desk block, run only when `DESKS_ENABLED=true` (`:843`, skip message `:892`; the socket probe `:872`).
- **`deploy/lib/desk-image.sh`:** `resolve_desk_digest` `:46-53`, `pin_desk_image` `:58-78`.
- **`deploy/install.sh`:**
  - usage `:45-52`;
  - `phase_desks` `:287-310`, which sets `DESKS_ENABLED=true` at `:294`, `:305` and `:308`;
  - `desks_host` `:318-353`, which prints `DESKS_ENABLED=true` and `COMPOSE_PROFILES=desks` at `:349-350` plus `DESK_IMAGE` and `DESK_AGENT_SOCKET`.
- **`deploy/lib/preflight.sh:136-144`:** the Coolify message, plus the `--desks-host` line `:143`.
- **`deploy/lib/host-setup.sh`:** `:12`, `:169`, `:175` mention `DESKS_ENABLED`.
- **`deploy/.env.example:189-214`:** the desk block (`DESKS_ENABLED=false` `:200`, the `COMPOSE_PROFILES` note `:199`, `DESK_IMAGE` `:208-214`).
- **The docs:**
  - `docs/INSTALL.md:27`, `:41`, `:73`;
  - `docs/INSTALL_DOCKER.md:155-160` (the "four variables" paragraph);
  - `docs/RELEASING.md:197-228`;
  - `deploy/coolify/LAYOUT.md:52-54`, `:151-154`, `:266-268`.
- **The deploy tests that encode the old flow:**
  - `deploy/tests/host-setup.test.sh`: `:89-92` (`init` writes `DESKS_ENABLED=false`), `:97-112` (`--profile desks`), `:119-128` (`DESK_AGENT_SOCKET`), `:226-234` (the guard and `restart: on-failure`);
  - `deploy/tests/install.test.sh`: cases 15-17, including `:302-324` ("prints the four Coolify variables").
- **After T-1602, the agent reads:** optional `DESK_IMAGE` (an override pinned by digest), `DESK_IMAGE_OWNER` (default `julioferrero`) and `DESK_IMAGE_TAG` (default `latest`).
- **After T-1603:** the server defaults `DESK_AGENT_SOCKET` to `/run/zilar/desk.sock` and treats an empty `DESK_IMAGE` as unset.

### Steps
1. **In all four compose files,** for `desk-agent` and `desk-egress`:
   - remove `profiles: ['desks']`;
   - remove the guard prefix from `command:`, keeping exactly the command after it (both services must still start the same program as today);
   - remove `DESKS_ENABLED`;
   - change `restart: on-failure` to `restart: unless-stopped`.
   - For the agent, add `DESK_IMAGE_OWNER: ${IMAGE_OWNER:-julioferrero}` and `DESK_IMAGE_TAG: ${IMAGE_TAG:-latest}`; keep `DESK_IMAGE: ${DESK_IMAGE:-}` as the override.
   - For the server, use `DESK_AGENT_SOCKET: /run/zilar/desk.sock` (fixed) and keep `DESK_IMAGE: ${DESK_IMAGE:-}`.
   - Rewrite every comment and header that says "off unless DESKS_ENABLED", "set COMPOSE_PROFILES=desks" or "set four variables". **The new rule:** the services are always there; the host prep (`--desks-host`, or `sudo ./zilar host-setup`) installs gVisor, and computers turn on within about a minute with no redeploy.
2. **`deploy/zilar`:**
   - remove the `--profile desks` and `DESK_AGENT_SOCKET` derivation from `compose()`;
   - in the `.env` template, drop `DESKS_ENABLED` and say `host-setup` is the only step, with `DESK_IMAGE` an optional override;
   - remove `pin_desk_image` from `up`;
   - in `update`, replace it with `clear_auto_desk_pin`: if `DESK_IMAGE` matches `ghcr.io/*/zilar-desk@sha256:*`, which is what `./zilar` itself wrote, set it empty and print one `info` line ("the jail image now follows the release"); any other non-empty value is kept, with a one-line warning that it overrides the release image;
   - the doctor desk block runs always: socket present, gVisor runtime registered, slice present. When `runsc` is missing, report "host not set up for AI computers: run sudo ./zilar host-setup" as a **warning, not a failure**.
3. **`deploy/lib/desk-image.sh`:** delete `pin_desk_image`. Keep `resolve_desk_digest` only if something still calls it after step 4; otherwise delete the file and its `source` line.
4. **`deploy/install.sh`:**
   - `phase_desks` keeps host-setup and the sandbox check, but drops `set_env_var DESKS_ENABLED true` and the "turns them on" wording;
   - `desks_host` keeps host-setup and the sandbox check, then prints one line instead of the variables: "AI computers are ready on this host; Zilar turns them on within a minute, nothing to set on the service.";
   - update the usage text.
5. **`deploy/lib/preflight.sh:136-144`:** keep the template message and the `--desks-host` line, and make the text after it match.
6. **`deploy/lib/host-setup.sh` and `deploy/.env.example`:** remove the `DESKS_ENABLED` and `COMPOSE_PROFILES` instructions, the same way.
7. **Docs:** rewrite the listed lines in `docs/INSTALL.md`, `docs/INSTALL_DOCKER.md`, `docs/RELEASING.md` and `deploy/coolify/LAYOUT.md`. `DESKS_ENABLED` and `COMPOSE_PROFILES` leave the variable tables, and `DESK_IMAGE` becomes "optional override". Add one sentence: the desk agent runs on every install and stays idle until the host has gVisor.
8. **Update the deploy tests** (`host-setup.test.sh`, `install.test.sh`) to the new behaviour: no profile, no guard, `unless-stopped`, `--desks-host` printing the one line, `update` clearing an auto pin and keeping a custom one. Remove the old assertions; don't weaken unrelated ones.

### Tests
The two deploy test scripts above. They are the safety net for the install flow.

### Allowed files
- `deploy/docker-compose.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/coolify/zilar-core.yml`
- `deploy/zilar`
- `deploy/lib/desk-image.sh` (may be deleted)
- `deploy/install.sh`
- `deploy/lib/preflight.sh`
- `deploy/lib/host-setup.sh`
- `deploy/.env.example`
- `deploy/tests/install.test.sh`
- `deploy/tests/host-setup.test.sh`
- `docs/INSTALL.md`
- `docs/INSTALL_DOCKER.md`
- `docs/RELEASING.md`
- `deploy/coolify/LAYOUT.md`
- `work/T-1605-desks-always-in-stack.md`

### Checks
```bash
sh deploy/tests/install.test.sh
sh deploy/tests/host-setup.test.sh
docker compose -f deploy/docker-compose.yml config --quiet
docker compose -f deploy/coolify/docker-compose.app.yml config --quiet
pnpm gate
```
Use dummy values for the required variables in the `config` checks, the way the existing tests do.

### Acceptance
- `git grep -n -E "DESKS_ENABLED|COMPOSE_PROFILES|profiles: \['desks'\]|pin_desk_image" -- deploy docs/INSTALL.md docs/INSTALL_DOCKER.md docs/RELEASING.md` finds nothing, or only a line that explains the variable is no longer used.
- **Both deploy test scripts pass.** The Report shows the before and after counts.
- `install.sh` stays within 400 lines.

---

## Report (written by the worker when done)

### What I did

- **Four compose files** (`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/coolify/zilar-core.yml`): dropped `profiles: ['desks']`, dropped the `sh -c` guard and kept only `command: ['node', '/app/desk-agent']` / `['node', '/app/desk-egress']` (the same program as before), removed `DESKS_ENABLED`, changed `restart: on-failure` to `restart: unless-stopped`. `desk-agent` gained `DESK_IMAGE_OWNER: ${IMAGE_OWNER:-julioferrero}` and `DESK_IMAGE_TAG: ${IMAGE_TAG:-latest}` with `DESK_IMAGE: ${DESK_IMAGE:-}` kept as the override. `server` uses the fixed `DESK_AGENT_SOCKET: /run/zilar/desk.sock` and keeps `DESK_IMAGE: ${DESK_IMAGE:-}`. Rewrote every "off unless DESKS_ENABLED" / "set COMPOSE_PROFILES=desks" / "four variables" comment and header to the new rule (services always there; host prep is the only step; computers turn on within about a minute, no redeploy).
- **`deploy/zilar`**: `compose()` no longer passes `--profile desks` or derives `DESK_AGENT_SOCKET`; the `.env` template drops `DESKS_ENABLED` and says `host-setup` is the only step with `DESK_IMAGE` an optional override; `up` no longer pins; `update` calls the new `clear_auto_desk_pin` (clears `ghcr.io/*/zilar-desk@sha256:*` and prints the info line, keeps any other value with a one-line warning). Added a small `env_set` helper (replaces the deleted `_desk_env_set`). The doctor desk block now runs always: runsc registered + slice present/right (FAIL when runsc is registered but the slice is wrong/missing), and when `runsc` is missing it prints the "host not set up for AI computers: run 'sudo zilar host-setup'" **warning**, not a FAIL; the socket status probe runs regardless.
- **`deploy/lib/desk-image.sh`**: deleted (nothing calls `resolve_desk_digest` after `--desks-host` stopped pinning) and its `source` line removed from `deploy/zilar`.
- **`deploy/install.sh`**: `phase_desks` keeps host-setup and the sandbox check but writes no `DESKS_ENABLED` (removed the now-unused `set_env_var`); `desks_host` keeps the prep and sandbox and prints the single ready line instead of four variables; usage text updated. Now 370 lines (limit 400).
- **`deploy/lib/preflight.sh`**, **`deploy/lib/host-setup.sh`**, **`deploy/.env.example`**: `DESKS_ENABLED`/`COMPOSE_PROFILES` removed, wording follows the new flow.
- **Docs**: `docs/INSTALL.md`, `docs/INSTALL_DOCKER.md`, `docs/RELEASING.md`, `deploy/coolify/LAYOUT.md` rewritten (variables leave the tables, `DESK_IMAGE` is an optional override, the "runs every install, idle until gVisor" sentence added, `DESK_IMAGE_OWNER`/`DESK_IMAGE_TAG` rows added to LAYOUT).
- **Tests**: `deploy/tests/host-setup.test.sh` and `deploy/tests/install.test.sh` updated to the new behaviour (no profile, no guard, `unless-stopped`, no `DESKS_ENABLED`, `update` clearing an auto pin and keeping a hand-set one, `--desks-host` one line, doctor warn-without-runsc). No unrelated assertions were weakened.

### Checks run

- `sh deploy/tests/host-setup.test.sh`: **pass=47 fail=0** (before, at base `ca583d0d9`: pass=44 fail=0).
- `sh deploy/tests/install.test.sh`: **pass=58 fail=0** (before: pass=57 fail=0).
- `docker compose -f deploy/docker-compose.yml config --quiet` with dummy REQUIRED vars: **plain OK**.
- `docker compose --project-directory . -f deploy/coolify/docker-compose.app.yml config --quiet` with dummy Coolify vars: **app OK**. (Also rendered `deploy/coolify/docker-compose.yml` and `deploy/coolify/zilar-core.yml`: both OK.)
- `git grep -n -E "DESKS_ENABLED|COMPOSE_PROFILES|profiles: \['desks'\]|pin_desk_image" -- deploy docs/INSTALL.md docs/INSTALL_DOCKER.md docs/RELEASING.md`: only test lines that assert the switch is no longer written/used ("no DESKS_ENABLED switch", "still guards on DESKS_ENABLED" negative assertions); no compose file, doc or script uses any of them.
- `pnpm gate` summary:
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.3s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Fix round 1:** `env_set` in `deploy/zilar` now writes atomically (a `cp -p` temp next to the env file, then `mv` in the same directory), so a crash never truncates the secrets; the `update` case in `host-setup.test.sh` also asserts the mode (`-rw-------`) and every other line survive the rewrite. The `init --dry-run` plan no longer lists "desks" among the feature flags and keeps the `sudo ./zilar host-setup` note. No other files changed.
- The doctor "before/after counts" above are real: I ran the committed test scripts against the base tree (`git stash` → run → `git stash pop`).
- `clear_auto_desk_pin` lives in `deploy/zilar` (with the new `env_set` helper) because `deploy/lib/desk-image.sh` is deleted; it writes nothing under `--dry-run`.
- I kept the workspace-root check inside the prepared-host branch of doctor (the spec listed runsc/slice/socket; the workspace root is host prep and only FAILs once runsc is registered).
- The `DESK_IMAGE_OWNER`/`DESK_IMAGE_TAG` variables are only consumed by the agent (T-1602); the compose files now feed them, this task changes nothing in `packages/desk`.
- Merge only after T-1602 and T-1603, as the spec warns.

## Review (written by Claude)

**Approved and merged, last of the ordered three** (T-1602, T-1603, then this).

- **Pre-review:** clean, 2 nits after one fix round from the lead.
  - **`env_set` is now atomic:** a temp file next to `.env` made with `cp -p` (same mode and owner), written, then `mv -f`. Before, a crash mid-write could truncate the file holding `ZILAR_KEY_ENCRYPTION_KEY`. A test checks the mode and the other lines survive.
  - The `init --dry-run` list no longer names "desks".
- **What the lead checked on the branch:**
  - **The four compose files:** no `profiles: ['desks']` and no guard; both desk services are `restart: unless-stopped` and keep their real commands (`node /app/desk-agent`, `node /app/desk-egress`). The agent gets `DESK_IMAGE_OWNER: ${IMAGE_OWNER:-julioferrero}` and `DESK_IMAGE_TAG: ${IMAGE_TAG:-latest}`; the server a fixed `DESK_AGENT_SOCKET: /run/zilar/desk.sock`.
  - **The deploy tests:** `install.test.sh` gives pass=58 fail=0 and `host-setup.test.sh` gives pass=47 fail=0.
  - **The leftover search:** the only remaining `DESKS_ENABLED` hits are tests that assert it is gone.
  - **`clear_auto_desk_pin`:** it clears only `ghcr.io/*/zilar-desk@sha256:*`, and warns on any other value.
- **Live's variables:** `DESK_IMAGE` and `DESK_AGENT_SOCKET` are empty on `zilar-chat`, so nothing overrides the new flow. `DESKS_ENABLED=false` is inert after this merge.
- **The lead's edits in this commit (the pre-review follow-up):** `docs/SERVER_CONFIG.md`'s desk rows (always-on services, the socket default and the probe, `DESK_IMAGE` as an optional override, the one host command, `update` clearing its own pin).
- **After the deploy:** live starts the idle desk agent. The next step is the one host command on the VPS, which needs no redeploy.
