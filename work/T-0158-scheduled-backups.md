---
id: T-0158
title: Scheduled backups with retention and a freshness check
status: review
milestone: M5
branch: task/T-0158-scheduled-backups
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0158: Scheduled backups with retention and a freshness check

## Spec (written by Claude, do not edit)

### Why
For a real install with about 200 people, `./deploy/zilar backup` exists but only runs when someone remembers to. Backups also pile up forever, and nothing says when the last good one is old. The archive holds secrets (the install `.env`), so it must stay mode 0600 and never be uploaded anywhere by default.

### What to build
1. `./deploy/zilar backup --keep N` (default keep 7 timestamped archives in `deploy/backups/`): after a successful new archive, delete the oldest beyond N (never delete before the new archive is complete and verified readable; only files matching the backup name pattern; never follow symlinks).
2. A schedule that works on all three install types: (a) Docker Compose: a small `backup` service or a documented cron line using `./deploy/zilar backup --keep N` (pick the one that is least invasive; if a container, it must not mount the Docker socket); (b) Coolify: a scheduled task entry in `deploy/coolify` docs/compose; (c) bare metal: a systemd timer unit file in `deploy/baremetal/` (daily at 03:30 with a random delay) plus install steps.
3. `./deploy/zilar doctor`: warn when the newest backup is older than 2 days, fail-soft (warn only) when there is none, with the exact command to run; show the newest backup's age in plain words.
4. `./deploy/zilar backup --offsite-hint`: print (not do) how to copy the newest archive to another machine safely (`scp`/`rclone`, encrypt first with `age` or `gpg`), with a clear warning that the archive contains secrets. No network code in the wizard.
5. Tests in the deploy shell test style: retention keeps the newest N, never touches unrelated files, survives a failed new archive (old ones kept); doctor age warnings with an injected clock/mtime; no secrets in any output.
6. Docs: `docs/INSTALL_DOCKER.md` and the bare-metal guide get a "Backups" section (schedule, retention, restore drill: restore into a throwaway project name and check the sticker and upload counts).
7. Out of scope: any app code, cloud uploads, new dependencies in the app.

### Read first
`AGENTS.md`, `work/T-0127-install-wizard-backup-baremetal.md`, `work/T-0151-deploy-storage-safety.md` (Review), `deploy/zilar`, `deploy/tests/storage-safety.test.sh`.

### Allowed files
`deploy/**`, `docs/**`, the deploy tests, `work/T-0158-scheduled-backups.md`. Not allowed: `apps/**`, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
sh deploy/tests/storage-safety.test.sh
sh deploy/tests/push-deploy.test.sh
(plus the new backup tests)
```

### Acceptance
- Retention and doctor freshness are tested; nothing is deleted before the new archive is verified.
- A schedule recipe exists for Compose, Coolify and bare metal.
- Docs include a restore drill.

## Report (written by the worker when done)

### What I did
- `deploy/zilar` `backup`: new `--keep N` (default 7, must be a positive number, `=` and space forms). After the archive is written AND verified readable (`tar -tzf` must list it back), `_prune_backups` deletes the oldest beyond N. Only regular files (`find -type f`, never symlinks) named exactly `zilar-backup-*.tgz`; one file at a time with a re-check (never `-delete`, never globs); anything else untouched. A failed dump deletes nothing (gate is before the prune call). Dry-run prints the retention plan. Archive stays mode 0600.
- `deploy/zilar` `backup --offsite-hint`: prints only (no archive, no deletion, no container traffic, no network) — secrets warning, newest-archive line (or "run backup first"), encrypt-first recipes (`age` + `scp`, `gpg` + `scp`, `rclone` with encrypt-first note). Rejects unknown flags; `--keep 0/abc` rejected before any container traffic.
- `deploy/zilar` `doctor` section 7 (backup freshness): newest `zilar-backup-*.tgz` by name (UTC stamps sort = age order); age from mtime via `stat` (BSD/GNU fallback); FAIL past 2 days naming `run 'zilar backup' now`; WARN at exactly 2 days; ok in plain words ("less than a day old", "1 day old", "N days old"); fail-soft WARN with the exact command when no backup exists; "skip" when stat is unavailable. Test injection via `ZILAR_DOCTOR_BACKUP_DIR` + `ZILAR_DOCTOR_NOW_EPOCH` (documented as tests-only). No archive bytes echoed.
- Schedules (least-invasive per install type, no container mounts the Docker socket): (a) Compose: `deploy/backup-cron.example` — one host cron line at 03:30 running `backup --keep 7`, with the no-sidecar rationale; (b) Coolify: `deploy/coolify/scheduled-backup.md` — Scheduled Tasks recipe (per-container tasks at `30 3 * * *`, shared storage, Execute-Now verification, retention rule), compose file untouched, marked not-verified-live; (c) bare metal: `deploy/baremetal/zilar-backup.{service,timer,sh}` — timer daily 03:30 + `RandomizedDelaySec=30min` + `Persistent=true`, oneshot service with hardening (mirrors the server unit), script dumps both DBs + 3 file stores + env into a 0600 archive with the same verify-then-prune retention (`BACKUP_KEEP_N`, default 7).
- Tests: `deploy/tests/scheduled-backups.test.sh` (new, shell-only, 32 checks): retention keeps newest 7 / deletes oldest 2, ignores unrelated files, never follows the symlink, deletes nothing when under keep, rejects bad `--keep`/unknown flags, corrupt archive fails the `tar -tzf` gate, gate-before-prune wired in script; doctor fresh/3-day/empty/multi-archive via injected clock; offsite-hint recipe + print-only + creates-nothing; all three schedule files' contents; no-secrets scan of outputs.
- Docs: `docs/INSTALL_DOCKER.md` — new "Backups: schedule, retention, off-machine copy" section + quarterly restore drill (throwaway project name, sticker + upload counts); retired the `find -mtime -delete` sidecar (prune is inside `backup --keep` now) and fixed the stale "gitignore pending" note (the entry exists). `docs/INSTALL_BARE_METAL.md` — §7 gains the timer install/observe/freshness section + bare-metal restore drill; §8 honestly marks the new unit/timer/script as never verified on a real machine.
- Incidental: updated two stale "lead decision pending: gitignore" comments (script + guide) — `deploy/backups/` is in `.gitignore` (line 43, commit `7882235`), so they now say gitignored + never-add-by-hand.

### Files changed
- `deploy/zilar` (backup --keep/--offsite-hint/_prune_backups/verify gate, doctor freshness section, usage text)
- `deploy/backup-cron.example` (new), `deploy/coolify/scheduled-backup.md` (new)
- `deploy/baremetal/zilar-backup.service`, `zilar-backup.timer`, `zilar-backup.sh` (new, script executable)
- `deploy/tests/scheduled-backups.test.sh` (new, executable)
- `docs/INSTALL_DOCKER.md`, `docs/INSTALL_BARE_METAL.md`, this task file (Report + status)

### Commands run and real results
- `pnpm install`: pass (Done in 7.7s).
- `sh deploy/tests/scheduled-backups.test.sh`: **32 pass, 0 fail**.
- `sh deploy/tests/storage-safety.test.sh`: **24 pass, 0 fail** (was 20 on main; +4 from the avatar additions merged earlier — no regressions from my edits).
- `sh deploy/tests/push-deploy.test.sh`: **19 pass, 1 fail** (`coolify push host derivation disagrees`) — PRE-EXISTING, proved by `git stash`: the same single failure occurs on the clean tree without my changes. Not in my scope (Allowed files overlap but the failure is in push-host derivation, untouched by this task).
- `pnpm format:check`: pass ("All matched files use Prettier code style!") after `--write` on the one flagged md file (shell/unit/timer/sh files have no prettier parser — syntax-checked with `sh -n` instead).
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (11 tasks successful, cached — no app code touched).
- `sh -n deploy/zilar`, `sh -n deploy/baremetal/zilar-backup.sh`: pass. `shellcheck`: NOT installed (same precedent as T-0127/T-0151).
- Manual probes: `--offsite-hint` prints recipe + warning, exit 0; `--dry-run` shows retention line; `--keep 0` rejected; doctor with injected mtime/now shows "1 day old" / WARN "2 days old" / FAIL "3 days old" correctly; extracted `_prune_backups` on 9 fixtures removed exactly the oldest 2, kept the symlink.
- Vitest: no app/package test files touched (Allowed files are deploy/docs only), so per AGENTS.md I ran the directly-touching shell tests instead of an unrelated package suite.

### Problems, deviations from the spec, open questions
- **No live backup/restore round trip here** (same standing caveat as T-0151): building + `up` on this shared machine risks the lead's dev stack/ports. The retention gate is proved by unit-style execution (real `_prune_backups` function, real `tar -tzf` on a corrupt archive, real mtime injection), not by a live dump. Lead's live check: scratch `init` → `up` → `backup --keep 3` twice → 0600 archives prune correctly → `doctor` green → `restore --yes` round trip.
- **Bare-metal timer/script never ran on a real machine** (no systemd/Postgres/ejabberd here): syntax-checked + retention logic mirrors the proved Docker pruner, but §8 says so plainly. Needs one Linux-host observation (archive written, verified, pruned, encrypted off-machine copy).
- **Coolify recipe not verified live** (no Coolify here): written from the official Scheduled Tasks docs (verified URLs in Report sources: coolify.io/docs/services/operations/scheduled-tasks). Says so in the file.
- **Doctor freshness judges by filename for "newest" + mtime for age.** If an operator hand-touches an old archive's mtime, the age follows the mtime (documented behavior: mtime is the freshness signal). Clocks skewed into the future clamp to 0 ("less than a day old"), never negative.
- **Security checklist:** no secrets read/committed (only throwaway single-char fixtures; no `.env` touched); archives stay 0600 with the secrets warning; `--offsite-hint` performs zero network (print-only, asserted in tests); no request logging touched; no deletes beyond the anchored backup-name pattern (asserted: unrelated files + symlink survive); no routes added (401 sweep N/A); no audit entries (file ops unaudited by design, same as before).

### Blocked / needs a decision
- None blocking. Lead follow-ups: (1) live backup→restore round trip with `--keep` pruning per Acceptance; (2) bare-metal timer on a real Linux host; (3) pre-existing `push-deploy.test.sh` coolify failure (fails on clean tree too — separate task).

## Review (written by Claude)
