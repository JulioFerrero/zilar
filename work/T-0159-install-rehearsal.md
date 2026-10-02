---
id: T-0159
title: Fresh production install rehearsal (find the real defects)
status: planned
milestone: M5
branch: task/T-0159-install-rehearsal
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0159: Fresh production install rehearsal (find the real defects)

## Spec (written by Claude, do not edit)

### Why
The deploy files (`deploy/`) were written and unit-tested with shell tests, but nobody has done a real fresh install end to end with the production images: the sticker volume ownership, the upload quota, push wiring, backup and restore, and `doctor` were all only verified in pieces. Before real users arrive we want one honest rehearsal. The machine is shared: run this ONLY when nothing else heavy is running, and tear everything down afterwards.

### What to build
1. In a scratch copy of the repo checkout (not the lead's running stack) use a unique compose project name (`zilar-rehearsal`) and a fake local domain, host ports that are free (check first; never 3000, 3188, 5173, 5280, 5222 or 8081 if they are used by the dev stack), and a throwaway `.env` produced by `./deploy/zilar init` with SMTP in console mode (`MAIL_ALLOW_CONSOLE_IN_PRODUCTION=true`).
2. Build and start the production stack (`./deploy/zilar up`), wait for healthy, run `./deploy/zilar doctor` (everything green or each warning explained).
3. Exercise: create the admin invite (`create-admin`), sign in through the API with the console code, create a sticker pack and upload a sticker (checks the sticker volume is writable by the non-root server), upload an attachment through XEP-0363 (checks the upload volume and quota), check `GET /api/push/config`, run `backup`, delete a sticker and an upload, `restore` the archive, and verify both are back.
4. Fix defects found ONLY inside the allowed files; list everything else in the Report as findings for the lead (with exact commands and output, secrets removed).
5. Tear down completely: `docker compose -p zilar-rehearsal down -v`, remove the scratch copy and any images only you built. Show `docker ps -a` and `docker volume ls` afterwards proving only the lead's dev containers remain.
6. Never touch the dev stack containers (`zilar-dev-*`), their volumes, or ports in use.

### Read first
`AGENTS.md`, `docs/INSTALL_DOCKER.md`, `work/T-0127-*.md`, `work/T-0145-deploy-push.md`, `work/T-0151-deploy-storage-safety.md`, `work/T-0158-scheduled-backups.md` (Reviews).

### Allowed files
`deploy/**`, `docs/**`, `apps/server/Dockerfile` (only to fix a defect the rehearsal proves), `work/T-0159-install-rehearsal.md`. Not allowed: other `apps/**` files, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
sh deploy/tests/storage-safety.test.sh
sh deploy/tests/push-deploy.test.sh
```

### Acceptance
- The Report has a step-by-step log with real outputs (secrets removed) and a list of defects: fixed in scope / needs the lead.
- Teardown is shown to be complete.

## Report (written by the worker when done)

## Review (written by Claude)
