---
id: T-1583
title: "One-line install step 2 (docs/deploy/one-line-install-plan.md): a CI workflow that installs Zilar with deploy/install.sh on a fresh GitHub runner after the Production images publish for main (empty database, all migrations), then checks /health, /api/me 401, the XMPP WebSocket upgrade and the migration count"
status: merged
milestone: M5
branch: task/T-1583-fresh-install-ci-test
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1583: Fresh-install test in CI

## Spec (written by Claude, do not edit)

### Why
This is `docs/deploy/one-line-install-plan.md` step 2.
- **The gap:** the plain Docker install was tested end to end only once, on localhost (T-0126; `docs/INSTALL_DOCKER.md:459-475`). No CI job applies all 67 migrations (`apps/server/drizzle/0000…0066`) to an empty database; live got them one at a time.
- **The goal:** every green main proves a fresh install works.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **`.github/workflows/images.yml`** is named "Production images".
  - It publishes `ghcr.io/julioferrero/zilar-{server,web,postgres,ejabberd}:latest` after a green CI on main (`:1-12`). Its last runs on main succeeded (`gh run list --workflow images.yml`).
- **`deploy/install.sh` flags:** `--yes --domain HOST --admin-email EMAIL --dir PATH --version main` (`docs/INSTALL.md:27-35`).
  - With `--yes`, `init` gets `--acme-email` and `--push-subject` too, so it never prompts (`deploy/install.sh:299-318`).
  - `ZILAR_INSTALL_TARBALL=<file>` replaces the GitHub download with a local archive (`deploy/install.sh:7`, `:244-257`, `:282-283`).
  - Version `main` maps to image tag `latest` (`:308-309`).
- **The T-0126 proof** (`docs/INSTALL_DOCKER.md:459-475`):
  - `curl -k https://localhost/health` returns JSON with `ok:true`;
  - `/api/me` answers 401;
  - `/xmpp-ws/ws` answers `101 Switching Protocols`.
- **The migrations journal** is written by `migrateSql` (`apps/server/src/effect/sql.ts:301`). Read the file for the journal table's name.

### Steps
1. **New `.github/workflows/install-test.yml`:**
   - **Triggers:**
     - `workflow_run` of "Production images", `completed`, branch `main`, running only when the conclusion is `success`;
     - `workflow_dispatch`.
   - **The job:** one `ubuntu-latest` job, `timeout-minutes: 25`:
     1. check out the commit the images run built (`github.event.workflow_run.head_sha`, else `github.sha`);
     2. pack the checkout as the archive `install.sh` expects (read `do_fetch` for the layout it extracts);
     3. run `sudo ZILAR_INSTALL_TARBALL=<archive> sh deploy/install.sh --yes --domain localhost --admin-email ci@example.com --dir /opt/zilar --version main`;
     4. assert:
        - `/health` answers 200 with `ok:true` (`curl -k --resolve`, or `https://localhost`, as T-0126 did);
        - `/api/me` answers 401;
        - `/xmpp-ws/ws` upgrades with 101;
        - the migrations journal row count equals the number of `apps/server/drizzle/*.sql` files (read it with `docker compose exec postgres psql`, from `/opt/zilar`).
   - **On failure:** print `./zilar ps` and the last 200 lines of the server and ejabberd logs. The run is fresh with throwaway secrets, so printing those logs is fine. **Never print `.env`.**
2. **Keep `install.sh` unchanged.** If it can't run on the runner without a change, stop and write the needed change in the Report (T-1585 is changing that file now).
3. **`docs/INSTALL_DOCKER.md` › "What was tested":** add one line naming the new workflow.

### Tests
The workflow is the test. Locally, run steps 2–4 of the job in the Report if Docker can do it on this Mac; if not, say so.

### Allowed files
- `.github/workflows/install-test.yml` (new)
- `docs/INSTALL_DOCKER.md`
- `work/T-1583-fresh-install-ci-test.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The workflow file is valid YAML; give the `node -e` or `npx yaml` parse output.
- The Report gives:
  - the exact commands the job runs;
  - how the archive is built;
  - how the migration count is read.
- The lead confirms the first real run after merge.

---

## Report (written by the worker when done)

### What I did

- Added **`.github/workflows/install-test.yml`** ("Fresh install"):
  - **Triggers:** `workflow_run` of "Production images", `types: [completed]`,
    `branches: [main]`; plus `workflow_dispatch`.
  - **One `ubuntu-latest` job**, `timeout-minutes: 25`, `permissions:
    contents: read`, `concurrency: install-test` (a fresh install holds ports
    80/443 and pulls `:latest`, so one at a time). The job's `if` runs it only
    after `workflow_run.conclusion == 'success'` *and* `workflow_run.event ==
    'push'` (the extra event guard is copied from `images.yml`, see Notes), or
    always on a manual dispatch.
  - **Steps:** check out `workflow_run.head_sha` (else `github.sha`); pack the
    checkout; run `deploy/install.sh`; assert `/health` (200, `ok:true`),
    `/api/me` (401) and `/xmpp-ws/ws` (101); assert the migration journal row
    count equals the `apps/server/drizzle/*.sql` count; on failure print
    `./zilar ps` and the last 200 lines of the server and ejabberd logs.
- Read `deploy/install.sh` `do_fetch` (`:251-276`) for the archive layout and
  `apps/server/src/effect/sql.ts:27` for the journal table name
  (`effect_sql_migrations`; `migrateSql` at `:301`, `SQL_MIGRATIONS_TABLE` at
  `:27`). Read `deploy/zilar` `cmd_doctor` (`:569-895`) to check a fresh
  install's `doctor` step (run by `install.sh`) passes on `localhost`.
- Added one paragraph to **`docs/INSTALL_DOCKER.md` › "What was tested"**
  naming the new workflow.
- **`install.sh` is unchanged.**

### Checks run

- `pnpm gate` (from the repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.5s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- **YAML parses** with the repo's `yaml@2.9.1` package (`node --input-type=module`
  import of `node_modules/.pnpm/yaml@2.9.1/.../dist/index.js`): `parsed ok`;
  `on` keys `workflow_run,workflow_dispatch`; workflow `Production images`;
  job `install`; `timeout-minutes: 25`; the six step names.
- **Archive layout** (the packing command, run locally): `git archive
  --format=tar --prefix=zilar/ HEAD | gzip > zilar.tar.gz`; extracting it gives
  a single top-level `zilar/` holding `zilar/deploy/install.sh` and
  `zilar/deploy/zilar` — exactly the one-root-with-`deploy/` shape `do_fetch`
  expects.
- **Every `run:` block parses** with `bash -n` (extracted from the parsed YAML;
  all 5 blocks OK).
- **`install.sh` dry-run** against that real archive:
  `ZILAR_INSTALL_TARBALL=<archive>./deploy/install.sh --dry-run --yes --domain
  localhost --admin-email ci@example.com --dir <tmp>/opt --version main` →
  `==> check / docker / fetch (version: main) / configure / up / doctor`,
  exits 0, plans `cp -R <tmp>/x/zilar-*/deploy/. <tmp>/opt/`.
- **Existing installer test:** `sh deploy/tests/install.test.sh` → `pass=40
  fail=0` (offline; proves the flags `--yes` passes to `init` and the archive
  stub path).

### The exact commands the job runs

```
git archive --format=tar --prefix=zilar/ HEAD | gzip > "$RUNNER_TEMP/zilar.tar.gz"

sudo ZILAR_INSTALL_TARBALL="$RUNNER_TEMP/zilar.tar.gz" \
  sh deploy/install.sh --yes --domain localhost --admin-email ci@example.com \
  --dir /opt/zilar --version main

# /health
curl -k -sS --max-time 15 --resolve localhost:443:127.0.0.1 -w '\n%{http_code}' https://localhost/health
# /api/me
curl -k -sS --max-time 15 --resolve localhost:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://localhost/api/me
# /xmpp-ws/ws (WebSocket upgrade)
curl -k -sS --max-time 15 --resolve localhost:443:127.0.0.1 -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://localhost/xmpp-ws/ws

# migration count (from /opt/zilar's compose project)
sudo docker compose -f /opt/zilar/docker-compose.yml --env-file /opt/zilar/.env \
  exec -T postgres psql -U postgres -d zilar -tAc 'select count(*) from effect_sql_migrations'
```

The job asserts `200`/`401`/`101` and compares the `psql` count with
`ls apps/server/drizzle/*.sql | wc -l`.

### How the archive is built

`git archive --format=tar --prefix=zilar/ HEAD | gzip` writes one top-level
`zilar/` directory containing `deploy/`. `do_fetch` (`install.sh:263-273`) takes
the first entry of the extract dir as the root and requires `<root>/deploy`, then
copies only `deploy/.` into `--dir`; the prefix gives it exactly that. `HEAD` is
the checked-out commit, so the archive mirrors the codeload tarball
(`<repo>-<ref>/deploy/...`) that a real install downloads.

### How the migration count is read

`migrateSql` journals one row per drizzle file in `effect_sql_migrations`
(`apps/server/src/effect/sql.ts:27`, `:221`); on an empty database
`adoptDrizzleJournal` adds no row (no `drizzle.__drizzle_migrations`), so the
row count equals the number of `apps/server/drizzle/*.sql` files. The job reads
it from the running `postgres` container with `docker compose ... exec -T
postgres psql -U postgres -d zilar -tAc 'select count(*) from
effect_sql_migrations'` (unix-socket local `trust`, so no password) and compares
it to `ls apps/server/drizzle/*.sql | wc -l`.

### Local run of the job's steps 2-4

Not possible on this Mac: `install.sh` is Linux-only (`check_host` dies on
Darwin) and needs root, free ports 80/443 and a Linux Docker host; the `main`
images are amd64 while this Mac's Docker VM is `linux/arm64`. Docker itself is
running here, but a real end-to-end install would need `sudo` and privileged
host ports and could disturb the shared machine, so I did not run it. I instead
ran everything that does not need a Linux host: the YAML parse, the packing
command and its extracted layout, `bash -n` on every `run:` block, the
`install.sh --dry-run` against the real archive, and the offline
`deploy/tests/install.test.sh` (40/40). The workflow itself is the test; the
first real run after merge is the acceptance.

### Notes for the lead

- **Deviation (small):** the job's `if` also requires
  `github.event.workflow_run.event == 'push'`, copied from `images.yml:32,67`.
  Without it a fork PR whose head branch is named `main` would pass the
  `branches: [main]` filter and run the job. Say the word if you want it dropped.
- **Stale-run edge case (question):** `images.yml`'s `tip` job lets an
  out-of-date `workflow_run` finish green *without* publishing (`:27-55`). If a
  newer main push lands during a build, "Production images" still ends
  `success`, so this job would fire, check out the newer sha, and pull the
  *older* `:latest` — the migration-count assertion would then fail on a
  checkout/`:latest` mismatch, not on a broken install. I followed the spec's
  "conclusion is success" as written and did not add a tip check. Tell me if you
  want the tip guard (`images.yml`-style) added.
- The install runs as root; `.env` is never printed. Diagnostics print only
  `./zilar ps` and the last 200 lines of the server and ejabberd logs, which is
  fine for a throwaway runner with generated secrets.
- After `install.sh` returns, its `doctor` step has already checked `/health`
  and the stack is `up -d --wait`-healthy, so the assertions run against a ready
  stack. I added no extra wait loop; the `--max-time 15` and `curl -k
  --resolve` mirror the Caddy healthcheck (`deploy/docker-compose.yml:281-291`)
  and T-0126.
- Acceptance: the lead confirms the first real run of `install-test` after this
  merges.

---

## Round (fix round after pre-review)

### Findings fixed

- **1 (must-fix) — the job never ran after a green main.** The job `if` required
  `github.event.workflow_run.event == 'push'`, but the triggering "Production
  images" run is itself `workflow_run`-triggered by CI on main, so its event is
  `workflow_run` and the job was skipped on the green-main path. The guard now
  accepts `event == 'push' || event == 'workflow_run'` (still rejecting a fork
  PR whose head branch is named `main`), in
  `.github/workflows/install-test.yml:34-39`. This also resolves the "Deviation
  (small)" note above.
- **2 (should-fix) — diagnostics called a nonexistent subcommand.**
  `deploy/zilar` has no `ps` command (`deploy/zilar:1455`, `:1462`), so the
  failure step printed `unknown command 'ps'`. Changed to
  `sudo ./zilar status` (`install-test.yml:144-145`).
- **3 (should-fix) — stale images run caused a false-red migration assertion.**
  `images.yml`'s `tip` job lets an out-of-date run finish `success` without
  publishing (`images.yml:25-55`), so `:latest` can be an older commit than
  `workflow_run.head_sha`. Added a tip check (a `fetch-depth: 0` checkout plus a
  compare step, mirroring `images.yml`'s `tip` job) that outputs `latest`, and
  gated the pack, install and both assertion steps on
  `steps.tip.outputs.latest != 'false'` (`install-test.yml:41-84`, `:92`,
  `:99`, `:129`). A manual dispatch has no tip output, so it still runs as
  before.

### Not changed

- **4 (nit) — manual-dispatch version-skew docs line.** Out of scope for this
  round: it asks for a docs sentence, and nits are only touched on lines already
  changed. The dispatch path still pulls `:latest` while checking out
  `github.sha`; the spec already treats `workflow_dispatch` as manual, and no
  line of `docs/INSTALL_DOCKER.md` was changed this round.

### Tests / validation

- The workflow is the test (Spec › Tests); no unit-test file exists for
  workflows and the task's Allowed files list only the workflow, the docs page
  and this task file, so no test file could be added. Findings 1 and 3 name no
  test; each is validated against the workflow file itself:
  - parsed `.github/workflows/install-test.yml` with the repo's `yaml@2.9.1` →
    `parsed ok`; `on` keys `workflow_run,workflow_dispatch`; job `install`;
    `timeout-minutes: 25`; 8 steps; job `if` =
    `github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && (github.event.workflow_run.event == 'push' || github.event.workflow_run.event == 'workflow_run'))`.
  - `bash -n` on every `run:` block → all 6 OK (including the new tip-check
    block).

### Checks run

- `pnpm gate` (from the repo root): `GATE PASS` (PASS install (frozen),
  format, lint, typecheck; SKIP effect; scope clean; migration/images/size
  checks pass).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one autofix round, with 3 nits.
- **What the lead read** in `.github/workflows/install-test.yml`:
  - **Triggers:** `workflow_run` after "Production images" succeeds on main, plus `workflow_dispatch`. A tip check skips a run whose commit is no longer main's last code commit, so it never tests a `:latest` it didn't publish.
  - **The install:** packs the checkout with `git archive --prefix=zilar/`, then runs `sudo ZILAR_INSTALL_TARBALL=… sh deploy/install.sh --yes --domain localhost --admin-email ci@example.com --dir /opt/zilar --version main`.
  - **The checks:**
    - `/health` answers 200 with `"ok":true`;
    - `/api/me` answers 401;
    - `/xmpp-ws/ws` upgrades with 101;
    - the `effect_sql_migrations` row count equals the number of `apps/server/drizzle/*.sql` files.
  - **On failure:** status plus server and ejabberd logs; `.env` is never printed.
- **After merge:** the lead runs it once by hand and records the result in `work/NOW.md`.
- **Left as they are:**
  - a comment hard-codes "67 migrations";
  - the `event == 'push'` clause for tags can't be reached;
  - back-to-back pushes can republish `:latest` mid-run. The tip check makes that rare.
