---
id: T-1588
title: "One-line install step 5 (docs/deploy/one-line-install-plan.md): Coolify mode — when the installer finds Coolify on the host it asks for a Coolify API token and creates the target layout (deploy/coolify/LAYOUT.md) through Coolify's API: project, zilar-core service, zilar-server and zilar-web image apps, generated secrets, volumes, deploys, health wait, AI computers when the sandbox passes, a root-only secrets copy and the first invite code; T-1582/T-1584 follow-ups"
status: merged
milestone: M5
branch: task/T-1588-install-coolify-mode
model: auto
effort: default
depends_on: []
estimate: 90 min
---

# T-1588: Installer Coolify mode

## Spec (written by Claude, do not edit)

### Why
This is `docs/deploy/one-line-install-plan.md` step 5. Julio's decision (2026-10-15): when Coolify is installed, the one-liner sets Zilar up through **Coolify's API** with a token the user pastes. The script creates everything, fills in every variable, deploys and checks it. The layout it creates is `deploy/coolify/LAYOUT.md` (T-1584).

### Facts (the lead read them on main `8ba0466fb`, 2026-10-15)
- **The installer flow** (T-1585): `deploy/install.sh` (344 lines) fetches the release into a temp dir, then sources `deploy/lib/preflight.sh` (166).
  - When Coolify is found, it prints "Coolify mode is not available in this version yet; nothing was changed." and exits 0 (`deploy/lib/preflight.sh:140-143`; the dry run's branch line is `deploy/install.sh:179`).
  - It detects Coolify by a container named `coolify` or `/data/coolify/source`.
- **The layout:** `deploy/coolify/LAYOUT.md` gives:
  - **resources:** `zilar-core` (a Service from `deploy/coolify/zilar-core.yml`), `zilar-server` and `zilar-web` (Docker-image apps);
  - **routes:** `/api` with strip-prefix off; `/xmpp-ws` (strip on) and `/upload` (strip off) on ejabberd; `/` on web;
  - **ports and health checks;** the volumes; "Connect to predefined network"; the variables table (`:107-206`, generated or user-given);
  - the 11 rehearsal points (`:227-267`).
- **Coolify's API:** `docs/deploy/coolify-api-notes.md` lists every endpoint and body field this task needs (projects, `POST /services` with `docker_compose_raw` and `urls`, `POST /applications/dockerimage`, envs bulk, storages, `POST /deploy`), plus the auth header.
  - Our instance is 4.4.6.
  - **Use only what that file lists.** If you need another call, stop and say which.
- **The jail image:** `pin_desk_image` in `deploy/lib/desk-image.sh` (T-1582) pulls `ghcr.io/<owner>/zilar-desk:<tag>` and reads its digest. It works on any Docker host, so Coolify mode can reuse that logic.
- **The first account:** `./zilar create-admin` runs `node /opt/tsx/node_modules/tsx/dist/cli.mjs src/auth/invite-cli.ts --uses N --days N` inside the server container (`deploy/zilar:944`). In Coolify mode the script is on the host, so `docker exec` into the `zilar-server` container works the same way.
- **Follow-ups to fold in:**
  - **T-1582 nit:** `./zilar update` (`deploy/zilar` `cmd_update`) doesn't call `pin_desk_image`;
  - **T-1582 follow-up:** `deploy/.env.example:189-205` still says to build and pin the jail by hand;
  - **T-1584 correction:** the "Watch paths" lines (`deploy/coolify/LAYOUT.md:73-74`, `:91-92`) and rehearsal point 11 don't apply to image apps. Their deploys come from `POST /deploy`, which CI calls later (plan, target layout item 5).

### Steps
1. **New `deploy/lib/coolify-api.sh`** (HTTP helpers):
   - one function per call in `coolify-api-notes.md`, using `curl -fsS`;
   - the token in a root-only temp file read by `curl -H @file`, **never** in argv, a log line or the screen;
   - JSON built with `printf` plus a small escaping helper, or `jq` when present. Check what the host has, and prefer `jq` with a clear stop if it's missing (Coolify hosts usually have it; say what you found).
2. **New `deploy/lib/coolify-mode.sh`**, the flow:
   1. **Inputs:** the Coolify URL (default `http://localhost:8000`), the token (read without echo; with `--yes`, from `ZILAR_COOLIFY_TOKEN`), `--domain` and `--admin-email`.
   2. **Checks:**
      - `GET /version` (warn below 4.4);
      - `GET /servers`: pick the one for this host, `localhost` / `host.docker.internal`, or the only one; otherwise ask;
      - a 401 or 403 stops with "the token was refused".
   3. **Project:** find or create "Zilar". If it already holds a `zilar-core`, stop with "Zilar is already installed in Coolify" and change nothing.
   4. **Secrets:** generate every value the variables table marks as generated (`openssl rand`).
   5. **`zilar-core`:**
      - create it from `deploy/coolify/zilar-core.yml`, with `urls` for ejabberd set to `https://<domain>/xmpp-ws,https://<domain>/upload`;
      - set `connect_to_docker_network`;
      - set its variables;
      - deploy.
   6. **`zilar-server`:**
      - create it with domain `https://<domain>/api`, `is_stripprefix_enabled: false`, port 3000 and health check `/health`;
      - add storages `sticker-data` and `avatar-data`;
      - set the variables: hosts `postgres-<core uuid>` and `ejabberd-<core uuid>`, the shared secrets;
      - deploy.
   7. **`zilar-web`:** port 80 and the health check, then deploy.
   8. **Wait** up to 10 minutes for `https://<domain>/health` (or `--resolve` to 127.0.0.1) to answer `ok:true`. On timeout, print which resource to open in Coolify, and stop.
   9. **AI computers:** offer them (or `--desks`):
      - run `zilar host-setup` from the fetched tree, then the T-1585 sandbox check;
      - **on a pass:** pin the jail image, set `DESKS_ENABLED=true`, `COMPOSE_PROFILES=desks` and `DESK_IMAGE` on core, and `DESK_AGENT_SOCKET` plus the `desk-socket` storage on server, then redeploy both;
      - **on a fail:** "AI computers stay off: <reason>".
   10. **Secrets copy:** write every generated value to `/root/zilar-secrets-<date>.env` (mode 600) and print: "Copy this file to your password manager, then delete it from the server."
   11. **The first invite:** mint one invite code with `docker exec` as `create-admin` does. Print the URL, the code and "sign up with <admin email>".
3. **`preflight.sh` and `install.sh`:**
   - the Coolify branch runs `coolify-mode.sh` instead of the "not in this version" message;
   - `--dry-run` prints each API call it would make (method and path), with no token;
   - the help text names `ZILAR_COOLIFY_TOKEN`.
4. **The folded-in follow-ups:**
   - `cmd_update` calls `pin_desk_image`;
   - `.env.example`'s desk lines match the auto-pin;
   - `LAYOUT.md`'s "Watch paths" lines and rehearsal point 11 say image apps deploy through `POST /deploy`.
5. **Sizes:** every shell file stays at most 400 lines.

### Tests
**New `deploy/tests/coolify-mode.test.sh`**, offline, with a stub `curl` that records each call and returns canned JSON. Cases:
- the happy path's call order;
- "already installed" stops with no POST;
- a 401 stops with the refused message;
- **the token never shows** in the recorded argv, stdout or stderr;
- `--dry-run` makes no calls.

`deploy/tests/install.test.sh` must still pass.

### Allowed files
- `deploy/lib/coolify-api.sh` (new)
- `deploy/lib/coolify-mode.sh` (new)
- `deploy/lib/preflight.sh`
- `deploy/install.sh`
- `deploy/tests/coolify-mode.test.sh` (new)
- `deploy/tests/install.test.sh`
- `deploy/zilar`
- `deploy/.env.example`
- `deploy/coolify/LAYOUT.md`
- `docs/INSTALL.md`
- `docs/deploy/coolify-api-notes.md` (written by the lead and placed in your worktree uncommitted; commit it unchanged with your first commit)
- `work/T-1588-install-coolify-mode.md`

### Checks
```bash
sh deploy/tests/coolify-mode.test.sh
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- **The Report pastes:**
  - the dry-run output of Coolify mode (the calls in order);
  - both test summaries;
  - the line counts.
- **Never run it against a real Coolify;** the lead's rehearsal does that.

---

## Report (written by the worker when done)

### What I did

**New `deploy/lib/coolify-api.sh`** (64 lines): one thin function per call in
`docs/deploy/coolify-api-notes.md`, all over `curl -fsS`. The token lives in a
root-only file handed to curl as `-H @file`, and so does every JSON body
(`--data @file`), so no secret reaches argv, a log line or the screen. A 401 or
403 stops with "the token was refused"; a connection failure and any other
status stop with a clear message.

**New `deploy/lib/coolify-mode.sh`** (398 lines): the flow, sourced by
install.sh and run by `preflight_decide` when the report finds Coolify.
- inputs: Coolify URL (default `http://localhost:8000`, `ZILAR_COOLIFY_URL`
  overrides), the token read without echo (with `--yes`, from
  `ZILAR_COOLIFY_TOKEN`), `--domain` and `--admin-email`;
- checks: `GET /version` (warns below 4.4), `GET /servers` (localhost /
  host.docker.internal / the only one, else asks, then `GET …/destinations`;
  a destination uuid only when the server has more than one);
- find or create project "Zilar"; if it already holds `zilar-core` it stops with
  "Zilar is already installed in Coolify" and changes nothing;
- the nine generated secrets (`openssl rand -hex 24`);
- `zilar-core`: `POST /services` from `deploy/coolify/zilar-core.yml` with
  `urls` = `https://<domain>/xmpp-ws,https://<domain>/upload`,
  `PATCH` `connect_to_docker_network`, envs bulk, `POST /deploy`;
- `zilar-server`: `POST /applications/dockerimage` (`https://<domain>/api`,
  strip off, port 3000, health `/health`), the `sticker-data` and `avatar-data`
  storages, the envs (hosts `postgres-<core uuid>` / `ejabberd-<core uuid>`,
  the shared secrets), `POST /deploy`;
- `zilar-web`: port 80, health `/`, `POST /deploy`;
- wait up to 10 minutes for `https://<domain>/health` to answer `ok:true`
  (`ZILAR_COOLIFY_RESOLVE=1` adds `--resolve <domain>:443:127.0.0.1`); on
  timeout it names zilar-core → zilar-server → zilar-web and stops;
- AI computers: `./zilar host-setup`, the gVisor sandbox, then the pinned jail
  digest + `DESKS_ENABLED=true`, `COMPOSE_PROFILES=desks`, `DESK_IMAGE` on core
  and `DESK_AGENT_SOCKET` + the `desk-socket` storage on server, and redeploys
  both; a failed sandbox prints "AI computers stay off: <reason>";
- `/root/zilar-secrets-<date>.env` (mode 600) and the first invite code via
  `docker exec` into the `zilar-server` container.

**`deploy/lib/preflight.sh`**: the Coolify branch calls `coolify_run` instead of
the "not available in this version" message. **`deploy/install.sh`** (364
lines): sources the two libs before preflight, and `--help` / the plan name
`ZILAR_COOLIFY_TOKEN` and the call order.

**New `deploy/tests/coolify-mode.test.sh`** (378 lines): offline, with stub
`curl`, `tee`, `chmod` and `docker`. The flow runs in a child `sh` (install.sh
runs it under `set -e`, so a stop must end the script).

**Folded-in follow-ups:** `deploy/zilar` `cmd_update` now calls
`pin_desk_image`; `deploy/.env.example`'s desk lines say `./zilar up`/`update`
pin the digest automatically; `deploy/coolify/LAYOUT.md`'s two "Watch paths"
blocks and rehearsal point 11 now say image apps are deployed by CI's
`POST /deploy`. **`docs/INSTALL.md`** describes Coolify mode and
`ZILAR_COOLIFY_TOKEN`.

### Checks run

```
sh deploy/tests/coolify-mode.test.sh   ->  pass=24 fail=0
sh deploy/tests/install.test.sh        ->  pass=53 fail=0
pnpm gate                              ->  GATE PASS
```

`pnpm gate` summary lines:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (1.4s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Dry run of Coolify mode (`DRY_RUN=1 coolify_run`, `--domain chat.example.com`,
desks off), calls in order:

```
==> coolify
zilar-install: dry run: Coolify mode would install Zilar on https://chat.example.com through http://localhost:8000/api/v1
    + GET /version
    + GET /servers
    + GET /projects
    + POST /projects
    + POST /services
zilar-install: created zilar-core (<core-uuid>)
    + PATCH /services/<core-uuid>
    + PATCH /services/<core-uuid>/envs/bulk
    + POST /deploy?uuid=<core-uuid>
zilar-install: zilar-core is deploying
    + POST /applications/dockerimage
zilar-install: created zilar-server (<server-uuid>)
    + POST /applications/<server-uuid>/storages
    + POST /applications/<server-uuid>/storages
    + PATCH /applications/<server-uuid>/envs/bulk
    + POST /deploy?uuid=<server-uuid>
zilar-install: zilar-server is deploying
    + POST /applications/dockerimage
zilar-install: created zilar-web (<web-uuid>)
    + POST /deploy?uuid=<web-uuid>
zilar-install: zilar-web is deploying
    + wait up to 10 minutes for GET https://chat.example.com/health to answer "ok":true
    + write /root/zilar-secrets-20261015.env (mode 600) with the generated secrets
    + docker exec <zilar-server container> node /opt/tsx/node_modules/tsx/dist/cli.mjs src/auth/invite-cli.ts --uses 1 --days 7

zilar-install: dry run complete — nothing was changed
```

Line counts: `deploy/lib/coolify-api.sh` 64, `deploy/lib/coolify-mode.sh` 398,
`deploy/install.sh` 364, `deploy/lib/preflight.sh` 167,
`deploy/tests/coolify-mode.test.sh` 378, `deploy/tests/install.test.sh` 584,
`deploy/zilar` 1467, `deploy/.env.example` 218, `docs/INSTALL.md` 87.

### Deviations from the spec

- **`GET /deployments/{uuid}` is not implemented.** The flow follows step 8 and
  waits on the public `/health` from outside (the notes say the same: a
  service's status is not in the API). Adding an unused helper would be dead
  code, so `coolify-api.sh` has every call the flow makes and no more.
- **The "already installed" check** reads the Zilar project's `services` /
  `applications` arrays from `GET /projects`. If that projection does not list
  the project's resources at all, the flow stops with the same
  "already installed" style message instead of creating a second copy — it never
  changes anything on a project it cannot inspect. The exact shape of
  `GET /projects` is the one thing I could not verify (the notes' own "Not
  verified yet" caveat); the lead's rehearsal will confirm it.
- **Bodies are passed with `--data @file`** (root-only), not as an argv
  argument: the notes require the file trick for the token, and the JSON bodies
  carry the generated secrets.
- **`--dry-run`:** `install.sh --dry-run` prints the report items and the
  Coolify branch with its call order as plan text (the earlier dry-run phases
  never fetch the release, so the libs are not on disk to run); the flow's own
  `DRY_RUN=1` path — the output pasted above — prints each API call and host
  step and reads no token.
- **`ZILAR_COOLIFY_RESOLVE=1`** is the switch for `--resolve` (step 8's
  "or `--resolve` to 127.0.0.1").
- **Sizes:** the new libs and `install.sh` stay under 400 (398, 64, 364); the
  test files are exempt. `deploy/tests/install.test.sh` and `deploy/zilar` were
  already over the limit on main.

### Notes for the lead

- I did **not** run anything against a real Coolify, as instructed; the test is
  fully offline with a stub `curl`.
- The rehearsal should confirm: the `GET /projects` resource projection (above),
  and that Coolify accepts `urls` with two comma-separated paths on the
  `ejabberd` component (rehearsal point 1) and `--data @file` bodies.

### Round: PREREVIEW.md findings

PREREVIEW.md is not part of the work: it was never staged, edited or deleted
(stage files by name). One commit per finding.

- **Finding 1 (must-fix, secrets copy mode):** `coolify_write_secrets_copy`
  now creates the file empty under `umask 077`, `chmod 600`s it with a hard
  failure (`|| die`), and only then writes the secrets, so `tee` (which can
  ignore the umask under `sudo`) can never leave them world-readable and a
  failed chmod stops the run. Test: the secrets copy must end `-rw-------`.
- **Finding 2 (should-fix, temp files):** `_api_request` removes its
  `request.XXXXXX` body (it holds the generated secrets) on both the success
  and the error path; `install.sh`'s exit trap now also removes `COOLIFY_TMP`.
  Test: no `request.*` file is left under the run's temp dir.
- **Finding 3 (should-fix, old releases):** `phase_report` sources
  `coolify-api.sh`/`coolify-mode.sh` only when both exist, so an
  `install.sh --version <old-tag>` still installs on a plain host; the Coolify
  branch already stops clearly (`preflight_decide`'s `command -v coolify_run`).
  Test: a stub tarball with no Coolify libs installs on a plain host and never
  prints "no deploy/lib/coolify".
- **Finding 4 (should-fix, destinations):** `coolify_pick_server` now calls
  `GET /servers/{uuid}/destinations` instead of reading an embedded
  `.destinations` array the API does not send, so a multi-destination server
  gets `destination_uuid` in the create-service body. Tests: a two-destination
  stub sets `destination_uuid`, a one-destination stub does not; the
  happy-path call order gains the destinations GET.

Nits 5-9 are untouched: none sits on a line this round changed.

Checks this round: `sh deploy/tests/coolify-mode.test.sh` → pass=24 fail=0;
`sh deploy/tests/install.test.sh` → pass=53 fail=0; `pnpm gate` → GATE PASS.

### Round: PREREVIEW.md round 2 (should-fix 1–3)

Findings 1–3 were should-fix; 4–9 are nits and none sits on a line this round
changed, so they are untouched. One commit per finding.

- **Finding 1 (should-fix, docs pipe):** `docs/INSTALL.md`'s non-interactive
  Coolify example now puts `ZILAR_COOLIFY_TOKEN=CHANGE_ME` on the `sh` side of
  the pipe (`curl ... | ZILAR_COOLIFY_TOKEN=CHANGE_ME sh -s -- ...`), where it
  reaches the installer instead of `curl`. Docs-only, so no test.
- **Finding 2 (should-fix, `$SUDO`):** `coolify_enable_desks`'s `docker pull`
  and `docker image inspect` (`:318,320`) and `coolify_first_invite`'s
  `docker ps` (`:364`) now run through `$SUDO`, like the flow's other host
  steps. Test 7: a `SUDO=sudo` desks flow asserts `docker pull`,
  `docker image inspect`, `docker ps` and `docker exec` all appear in the stub
  sudo log, so a bare `docker` would fail the test.
- **Finding 3 (should-fix, rerun advice):** the missing-`zilar-server` stop in
  `coolify_first_invite` (`:366`) now prints the manual
  `docker exec … invite-cli.ts --uses 1 --days 7` command instead of advising a
  rerun that would stop at "already installed". Test 8: with no container
  running, the stop names the manual command and never says "run this installer
  again".

Checks this round:

```
sh deploy/tests/coolify-mode.test.sh   ->  pass=27 fail=0
sh deploy/tests/install.test.sh        ->  pass=53 fail=0
pnpm gate                              ->  GATE PASS
```

`pnpm gate` summary lines:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Line counts now: `deploy/lib/coolify-mode.sh` 399,
`deploy/tests/coolify-mode.test.sh` 460 (tests are exempt from the 400-line
limit); the other files are unchanged from round 1.

### Round: lead fix round 1 (nits 7 and 2)

- **Nit 7 (error bodies):** `_api_request` no longer echoes Coolify's response
  body on an HTTP failure — it printed the first 300 bytes, which an
  envs/bulk validation error can use to quote a submitted secret. It now prints
  the method, the path and the code, and appends the body's JSON `message` only
  for the calls that send no secrets (every GET, `POST /projects`,
  `POST /deploy`), never for `envs/bulk` or a create. The request now uses
  `curl -sS` instead of `-fsS`: `-f` discarded the body on error, so the code
  reads `%{http_code}` itself and the body is available to `.message` but is
  never printed. Test 9: a stubbed 422 on `envs/bulk` whose body quotes the
  request body (secret included) prints the code and path and leaks no secret;
  I confirmed the test fails if the body is echoed again.
- **Nit 2 (version check):** the comparison moved to
  `coolify_api_version_is_old` in `coolify-api.sh` and now compares major and
  minor as numbers, so 4.10 and later count as newer than 4.4 and 4.3.x warns
  (the old `4.[0-3].*` glob warned on 4.10). Tests 10: 4.10.0 is not warned,
  4.3.9 is. Moving it kept `coolify-mode.sh` at 399 lines.

Checks: `sh deploy/tests/coolify-mode.test.sh` → pass=30 fail=0;
`sh deploy/tests/install.test.sh` → pass=53 fail=0; `pnpm gate` → GATE PASS
(install frozen, format, lint, typecheck; scope clean; size within 400 lines).
`deploy/lib/coolify-mode.sh` 399 lines, `deploy/lib/coolify-api.sh` 90.

### Round: lead fix round 2 (must-fix 1: `/health` route)

- **Must-fix 1 (the health wait had no route):** `zilar-server` is now created
  with `domains` = `https://<domain>/api,https://<domain>/health` (strip-prefix
  still off), so the install wait's `https://<domain>/health` reaches the server
  instead of the web App (`deploy/coolify/LAYOUT.md:103` routing table). Test 1
  now asserts the server App's create body carries both URLs.
  `deploy/coolify/LAYOUT.md`: the routing-table `/health` row, the "open
  question" paragraph and rehearsal point 6 now say the installer routes it and
  the rehearsal confirms both `/api` and `/health` reach the server.

Checks: `sh deploy/tests/coolify-mode.test.sh` → pass=31 fail=0;
`sh deploy/tests/install.test.sh` → pass=53 fail=0; `pnpm gate` → GATE PASS
(install frozen, format, lint, typecheck; scope clean; size within 400 lines).
`deploy/lib/coolify-mode.sh` 399 lines.

### Disagreements

None.

## Review (written by Claude)

**Approved and merged after two autofix rounds and two lead fix rounds.**

- **Lead fix 1:**
  - **Error messages:** an HTTP failure no longer prints Coolify's response body. `_api_error_detail` shows Coolify's `message` only for calls that send no secrets, and a test proves that a stubbed 422 on envs/bulk, with a generated secret in its body, never reaches stdout or stderr.
  - **The version check:** it compares major and minor as numbers, so 4.10 doesn't warn and 4.3.9 does.
- **Lead fix 2** (the second pre-review's must-fix): `zilar-server` is created with `https://<domain>/api,https://<domain>/health` (strip off; `coolify-mode.sh:225`). Before, the 10-minute health wait polled a path nothing routed to the server.
- **Checks the lead ran on the branch:**
  - `sh deploy/tests/coolify-mode.test.sh`: pass=31 fail=0;
  - `sh deploy/tests/install.test.sh`: pass=53 fail=0;
  - sizes: `coolify-mode.sh` 399 lines, `coolify-api.sh` 90.
- **The packet's security notes:**
  - the token travels only through a mode-600 file with `curl -H @file`; a test asserts it is absent from argv, stdout and stderr;
  - request bodies and the temp dir are removed;
  - every `${…}` in `zilar-core.yml` is set.
- **The planned calls, in the dry run:** `GET /version`, `GET /servers`, `GET`/`POST /projects`, `POST /services`, `PATCH` the core service and its envs, `POST /deploy`; then for server and web, `POST /applications/dockerimage`, the server's storages, envs and `POST /deploy`.
- **Folded in:**
  - `./zilar update` now pins the jail image;
  - `.env.example`'s desk lines match the auto-pin;
  - `LAYOUT.md` says image apps deploy through `POST /deploy`.
- **Left for later** (3 nits):
  - a half-built layout reruns as "already installed";
  - a server with several destinations silently takes the first;
  - the dry run needs `jq` without checking for it.
- **Not run against a real Coolify yet.** The rehearsal (plan step 7) is next and needs Julio's OK.

