---
id: T-1439
title: "Ops docs from the findings sweep: backup doc for the Application era (OPS-1), ejabberd-database in the backup list (OPS-20), a full restore drill runbook with RTO (OPS-14), stale install-doc pointer (OPS-12 docs part)"
status: merged
milestone: M5
branch: task/T-1439-ops-docs
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1439: Ops docs

## Spec (written by Claude, do not edit)

### Why
The findings sweep (`docs/audit/findings-sweep-server.md`) left these open or partly open. Full texts are in `docs/audit/ops-reliability-audit.md`.

**This task is documentation only:** no compose, workflow or server change, and no contact with any server. Production changes stay with Julio.

### Facts (from the sweep, which the lead reviewed)
- **OPS-1:**
  - the live backups were re-created on 2026-10-12: `pg-dump-nightly` at 03:30, plus volume backups for `postgres-data`, `sticker-data`, `avatar-data` and `ejabberd-uploads` to B2 `zilar-s3`;
  - `work/NOW.md` around line 1000 records this, and `docs/RELEASING.md:41` lists it;
  - `deploy/coolify/scheduled-backup.md` still describes the old Coolify **Service** setup ("Coolify runs the stack as a D…").
- **OPS-20:** `ejabberd-database` is absent from the backup list (`deploy/coolify/scheduled-backup.md:21-27,52-57`), and nothing says what it holds (Mnesia leftovers and the Erlang cookie).
- **OPS-14:**
  - the restore drill restores only `zilar.dump` on the same server (`deploy/coolify/scheduled-backup.md:104-124`);
  - `ejabberd.dump`, the volume archives and the secrets have never been restored;
  - no RTO is written, and the archive layout is "not checked yet" (`:77`).
- **OPS-12 (docs part):** `docs/INSTALL_DOCKER.md:131` still tells users to paste `deploy/coolify/docker-compose.yml`. The live install is the Application compose `deploy/coolify/docker-compose.app.yml`. Several `deploy/tests/*.test.sh` still read the old file, so it stays for now; don't delete it.

### What to write
1. **`deploy/coolify/scheduled-backup.md`:** rewrite it for the Coolify **Application** (`zilar-chat`, compose `deploy/coolify/docker-compose.app.yml`):
   - what runs, when, and where it goes;
   - how to check that a backup ran;
   - `ejabberd-database`, with what it holds and a recommendation to add it to the volume backups. Mark this as a step for Julio.
2. **`docs/ops/restore-drill.md`** (new), a step-by-step drill on a scratch host:
   - restore `zilar.dump` and `ejabberd.dump`, each volume archive, and the secrets (`ZILAR_KEY_ENCRYPTION_KEY`, the push storage key, the JWT secret and the DB passwords) from where Julio keeps them;
   - how to verify each one (counts, a login, an old message, an avatar);
   - a target RTO of 60 minutes;
   - a blank log table for each run.
   - Commands only; **don't run anything**.
3. **`docs/INSTALL_DOCKER.md`:** point users at `deploy/docker-compose.yml` with `./zilar` (self-host) or `deploy/coolify/docker-compose.app.yml` (Coolify Application), and drop the paste-the-old-compose step.
4. **`docs/RELEASING.md`:** add a link to the restore drill from the backups section.

### Tests
None.

### Allowed files
`deploy/coolify/scheduled-backup.md`, `docs/ops/restore-drill.md`, `docs/INSTALL_DOCKER.md`, `docs/RELEASING.md`, `work/T-1439-ops-docs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The docs are accurate to the repo.
- No secret values appear: names only.

---

## Report (written by the worker when done)

### What I did

Docs only; no compose, workflow or server change, and no contact with any server.

1. **`deploy/coolify/scheduled-backup.md` — rewritten for the Application.**
   - States the stack is the Coolify Application `zilar-chat` built from
     `deploy/coolify/docker-compose.app.yml` (a Coolify checkout, no host
     checkout, so `./zilar backup` does not apply).
   - What runs when and where: `pg-dump-nightly` (03:30, container `postgres`,
     `globals.sql`/`zilar.dump`/`ejabberd.dump` on `postgres-data`) and the four
     volume backups (`postgres-data` 03:40, `sticker-data` 03:45, `avatar-data`
     04:00, `ejabberd-uploads` 04:15) to B2 `zilar-s3`, 3 local / 30 days on S3.
   - **OPS-20:** a new section on `ejabberd-database`: what it holds (Mnesia
     leftovers from before `default_db: sql`, plus the Erlang cookie), and a
     recommendation to add it to the volume backups, marked "**Step for Julio**"
     and listed in the table as not live.
   - How to check a backup ran: the B2 listing (the only proof for the volume
     backups, since Coolify has no read-back for `backup_set`) plus the
     `pg-dump-nightly` executions list.
   - Updated container naming (`<service>-<app-uuid>-…`, found by the
     `com.docker.compose.service` label) and replaced the Service vocabulary.
   - Kept the cheap same-server two-task check; moved the full drill to the new
     page.
2. **`docs/ops/restore-drill.md` — new.** A step-by-step drill on a scratch
   host: secrets from Julio's password-manager copy (OPS-9; `ZILAR_KEY_ENCRYPTION_KEY`,
   `PUSH_STORAGE_KEY`, `ZILAR_XMPP_JWT_SECRET`, the four DB passwords,
   `BETTER_AUTH_SECRET`, the push keys — names only); download the newest
   archives from B2; restore `zilar.dump` and `ejabberd.dump`; unpack each
   volume archive; verify with counts, a login (console mailer on the throwaway
   host), an old message, an avatar, a sticker, an old attachment, the stored
   integration keys and a push subscription. **Target RTO 60 minutes**, stated
   at the top, with a blank run table and a blank per-check table. Commands
   only; I ran none of them.
3. **`docs/INSTALL_DOCKER.md`** — the Coolify section now points at
   `deploy/docker-compose.yml` with `./deploy/zilar` (self-host) or
   `deploy/coolify/docker-compose.app.yml` (Coolify Application, build pack
   Docker Compose, source GitHub App). The paste-the-old-compose step is gone.
4. **`docs/RELEASING.md`** — §9 Backups links to `docs/ops/restore-drill.md`.

### Files changed

- `deploy/coolify/scheduled-backup.md`
- `docs/ops/restore-drill.md` (new)
- `docs/INSTALL_DOCKER.md`
- `docs/RELEASING.md`
- `work/T-1439-ops-docs.md`

### Commands I ran (real results)

- `pnpm install` — done in 17.5s, 1251 resolved; one pre-existing peer warning
  (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18) unrelated to
  this task.
- `pnpm exec prettier --write deploy/coolify/scheduled-backup.md` (the three
  `docs/` files are in `.prettierignore`), then
  `pnpm exec prettier --check` on all four — `All matched files use Prettier
  code style!`.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.4s)
  PASS  lint  (1.6s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single tests ran: no source or package files changed, only docs and this
  task file.

### Deviations and notes

- **`SERVICE_PASSWORD_PUSHCOMPONENT`:** the old `INSTALL_DOCKER.md` said
  `SERVICE_PASSWORD_PUSH_COMPONENT` (with an underscore). The live compose
  (`docker-compose.app.yml`) uses `SERVICE_PASSWORD_PUSHCOMPONENT`, and its
  header comment says the id must have no underscore; I matched the compose
  file.
- **`INSTALL_DOCKER.md` closing caveat:** the old text said the Coolify path was
  "not verified live". The live install runs this Application, so I replaced it
  with a note that the path is proven and a fresh install may still need the
  domain hostname adjusted.
- **`scheduled-backup.md` drill:** I kept the cheap same-server two-task check
  and pointed to the new full drill, instead of deleting it (it still proves the
  on-server dump restores).
- **OPS-20** is written as a recommendation and a step for Julio; I did not (and
  could not) change the live schedule — docs only.
- The archive layout is still unknown to me; the drill and runbook tell the
  operator to record it on the first real restore, as before.
- No secret values appear anywhere: names, placeholders (`CHANGE_ME`) and
  `<scratch>`-style tokens only.

### Open questions

None. Not blocked.

### Round

Fix round for `PREREVIEW.md` (prereview: must-fix=0, should-fix=1, nit=1).

- **Finding 1 (should-fix, `docs/ops/restore-drill.md:74`): fixed.** Step 2 said
  "the five objects" but only four volume archives exist (four `aws s3 cp` lines
  follow; `ejabberd-database` is not scheduled and is handled conditionally in
  step 4). Now reads "the four objects (the four volume backups —
  `ejabberd-database` is not scheduled yet, see step 4)", matching the companion
  page's "the four volume backups". Commit `T-1439: fix finding 1 - four backup
  objects, not five`.
- **Finding 2 (nit, `docs/INSTALL_DOCKER.md:176`): left as is.** It is outside
  any line this fix touches, and AGENTS.md says not to touch nits otherwise.
- **Tests added:** none. The spec's Tests section is `None`, and the change is a
  docs wording fix, not crucial code.
- **Gate:** `pnpm gate` — **GATE PASS**.
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single tests ran: docs-only change, no source or package files touched.
- Disagreements: none.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round. Docs only, and no secret values appear (the lead grepped).
- `scheduled-backup.md` now describes the Coolify Application, and `ejabberd-database` is a step for Julio.
- `docs/ops/restore-drill.md` covers both dumps, the volumes and the secrets, with a 60-minute RTO.
- `INSTALL_DOCKER.md` points to the self-host compose or the Application compose.
