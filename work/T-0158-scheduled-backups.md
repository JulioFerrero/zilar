---
id: T-0158
title: Scheduled backups with retention and a freshness check
status: planned
milestone: M5
branch: task/T-0158-scheduled-backups
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0158: Scheduled backups with retention and a freshness check

## Spec (written by Claude, do not edit)

### Why
For a real install with about 200 people, `./deploy/galena backup` exists but only runs when someone remembers to. Backups also pile up forever, and nothing says when the last good one is old. The archive holds secrets (the install `.env`), so it must stay mode 0600 and never be uploaded anywhere by default.

### What to build
1. `./deploy/galena backup --keep N` (default keep 7 timestamped archives in `deploy/backups/`): after a successful new archive, delete the oldest beyond N (never delete before the new archive is complete and verified readable; only files matching the backup name pattern; never follow symlinks).
2. A schedule that works on all three install types: (a) Docker Compose: a small `backup` service or a documented cron line using `./deploy/galena backup --keep N` (pick the one that is least invasive; if a container, it must not mount the Docker socket); (b) Coolify: a scheduled task entry in `deploy/coolify` docs/compose; (c) bare metal: a systemd timer unit file in `deploy/baremetal/` (daily at 03:30 with a random delay) plus install steps.
3. `./deploy/galena doctor`: warn when the newest backup is older than 2 days, fail-soft (warn only) when there is none, with the exact command to run; show the newest backup's age in plain words.
4. `./deploy/galena backup --offsite-hint`: print (not do) how to copy the newest archive to another machine safely (`scp`/`rclone`, encrypt first with `age` or `gpg`), with a clear warning that the archive contains secrets. No network code in the wizard.
5. Tests in the deploy shell test style: retention keeps the newest N, never touches unrelated files, survives a failed new archive (old ones kept); doctor age warnings with an injected clock/mtime; no secrets in any output.
6. Docs: `docs/INSTALL_DOCKER.md` and the bare-metal guide get a "Backups" section (schedule, retention, restore drill: restore into a throwaway project name and check the sticker and upload counts).
7. Out of scope: any app code, cloud uploads, new dependencies in the app.

### Read first
`AGENTS.md`, `work/T-0127-install-wizard-backup-baremetal.md`, `work/T-0151-deploy-storage-safety.md` (Review), `deploy/galena`, `deploy/tests/storage-safety.test.sh`.

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

## Review (written by Claude)
