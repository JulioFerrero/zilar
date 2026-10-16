---
id: T-1650
title: "Fix the stale scheduled-backups test failure: the Coolify backup doc says ejabberd-database is 'not covered' again (it is, OPS-20), and CI's deploy job runs scheduled-backups.test.sh too"
status: merged
milestone: M5
branch: task/T-1650-backup-doc-test-ci
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1650: Backup doc wording and its test in CI

## Spec (written by Claude, do not edit)

### Why
`deploy/tests/scheduled-backups.test.sh` fails on main (`pass=45 fail=1`, `FAIL: coolify doc missing the schedule or the NOT-covered volumes`), so T-1644 left it out of the new CI `deploy` job.
- **What the test checks** (`:389-395`): `grep -qi 'NOT covered' deploy/coolify/scheduled-backup.md`.
- **What the doc says:** since T-1439 it reads "`ejabberd-database` … is **not** in the …" (`:54`), which no longer matches.

The fact is still true: audit OPS-20 says `ejabberd-database` is absent from the backup schedule.

### Facts (the lead read them on 2026-10-16, main after T-1644)
- **`deploy/coolify/scheduled-backup.md`:** the section "What `ejabberd-database` holds, and why it should be backed up" is at `:52`, and its first sentence at `:54` says the volume is **not** in the backup list.
- **`.github/workflows/ci.yml`:** the `deploy` job (T-1644) runs `sh deploy/tests/<name>.test.sh` steps, then `sh deploy/tests/compose-config.sh`. Its comment says `scheduled-backups` is left out because it fails.

### Steps
1. **In the sentence at `scheduled-backup.md:54`,** say the volume is **not covered** by the nightly backups, using those words. Keep the rest of the sentence's meaning. Change no other line.
2. **Run `sh deploy/tests/scheduled-backups.test.sh`.** It must pass with no Docker daemon and no network.
3. **`ci.yml`, the `deploy` job:** add `- run: sh deploy/tests/scheduled-backups.test.sh` next to the other test steps, and drop "`scheduled-backups` is left out…" from the job comment.

### Allowed files
- `deploy/coolify/scheduled-backup.md`
- `.github/workflows/ci.yml`
- `work/T-1650-backup-doc-test-ci.md`

### Checks
```bash
sh deploy/tests/scheduled-backups.test.sh
pnpm gate
```

### Acceptance
- **`scheduled-backups.test.sh` passes locally,** and CI's deploy job runs it.

---

## Report (written by the worker when done)

### What I did
- `deploy/coolify/scheduled-backup.md:54`: changed "is **not** in the schedule
  above" to "is **not covered** by the nightly backups above", so the sentence
  uses the test's `NOT covered` wording. Every other line is untouched.
- `.github/workflows/ci.yml`: added `- run: sh deploy/tests/scheduled-backups.test.sh`
  to the `deploy` job (between `push-deploy` and `storage-safety`), and removed the
  "`scheduled-backups` is left out too: it already fails on a stale doc assertion."
  sentence from the job comment.
- `work/T-1650-backup-doc-test-ci.md`: status + this Report.

### Checks run
- `pnpm install` — `Done in 11.9s`.
- `sh deploy/tests/scheduled-backups.test.sh` — `pass=46 fail=0`, including
  `ok: coolify doc: database-backup schedule at 03:30, volumes marked NOT covered`.
  No Docker daemon or network used.
- `pnpm gate` — `GATE PASS`; summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`

### Notes for the lead
- No source files changed, so the gate skipped the Effect/test stage; the one test
  that covers this change is the `scheduled-backups.test.sh` run above.
- No deviations from the spec. 3 changed files, all under Allowed files.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The change:** the doc says `ejabberd-database` is **not covered** by the nightly backups (OPS-20 still stands), and CI's deploy job runs `scheduled-backups.test.sh`. Locally it gives pass=46, fail=0.
- **In CI** the deploy job stays red until T-1652 merges. That task swaps the BSD-first `stat -f` calls, including two in this test, to GNU-first.
