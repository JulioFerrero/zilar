---
id: T-1652
title: "Fix stat on Linux: try GNU `stat -c` before BSD `stat -f` (GNU/busybox `stat -f` is file-system mode and exits 0 with junk), so `zilar doctor` reads the backup age on real servers and CI's deploy checks pass"
status: merged
milestone: M5
branch: task/T-1652-stat-gnu-first
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1652: GNU stat first

## Spec (written by Claude, do not edit)

### Why
CI's new Deploy checks job (T-1644) failed on main with `FAIL: wizard env is not mode 0600` (`deploy/tests/push-deploy.test.sh`, run 38831030280).

**The cause:** the scripts try BSD `stat -f %Lp` first and fall back to GNU `stat -c %a` only when it fails. On Linux, `stat -f` means "file-system status", **exits 0** and prints file-system info, so the fallback never runs.
- **The lead checked this** in `alpine:3.20`: `stat -f %m /tmp/x` prints `Blocks: Total: … Inodes: …`.
- **The same bug is in production code:** `deploy/zilar:829` reads the newest backup's mtime with `stat -f %m … || stat -c %Y …`. On every Linux host the value isn't a number, so `zilar doctor` always prints "skip: cannot read the age of … (stat unavailable)" and never warns about an old backup.

### Facts (the lead read them on 2026-10-16)
The BSD-first calls (`git grep -n "stat -f"`):
- `deploy/zilar:829`: `_mtime_epoch="$(stat -f %m "$_newest" 2>/dev/null || stat -c %Y "$_newest" 2>/dev/null || true)"`
- `deploy/tests/push-deploy.test.sh:62`: `stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -c %a "$ENV_FILE"`
- `deploy/tests/scheduled-backups.test.sh:201`: `stat -f %m … || stat -c %Y …`
- `deploy/tests/scheduled-backups.test.sh:464`: `stat -f %Lp … || stat -c %a …`
- `deploy/baremetal/zilar-backup.sh:60` already does it right, GNU first: `stat -c %a … 2>/dev/null || stat -f %Lp … 2>/dev/null`.

### Steps
1. **At each of the four places,** swap the order to GNU first, the same way as `zilar-backup.sh:60`: `stat -c <gnu-format> FILE 2>/dev/null || stat -f <bsd-format> FILE 2>/dev/null`. Keep each line's formats and the existing `|| true` where present. On macOS, `stat -c` fails ("illegal option") and the BSD form answers.
2. **Add a one-line comment above `deploy/zilar:829`:** GNU first, because GNU/busybox `stat -f` is file-system mode and exits 0.
3. **Change nothing else.**

### Allowed files
- `deploy/zilar`
- `deploy/tests/push-deploy.test.sh`
- `deploy/tests/scheduled-backups.test.sh`
- `work/T-1652-stat-gnu-first.md`

### Checks
```bash
sh deploy/tests/push-deploy.test.sh
sh deploy/tests/host-setup.test.sh
pnpm gate
```
If Docker is available, also run `push-deploy.test.sh` once inside `alpine:3.20` or `ubuntu:24.04` to prove the Linux path, or say you could not.

### Acceptance
- **The four call sites are GNU-first,** and the tests pass on macOS.
- **CI's Deploy checks job passes after the merge** (the lead checks).

---

## Report (written by the worker when done)

### What I did

Swapped all four BSD-first `stat` call sites to GNU-first, the same shape as
`deploy/baremetal/zilar-backup.sh:60`, and changed nothing else:

1. `deploy/zilar:830` — `stat -c %Y "$_newest" 2>/dev/null || stat -f %m "$_newest" 2>/dev/null || true`
   (kept the `|| true`), with the one-line comment above it:
   `# GNU first: GNU/busybox `stat -f` is file-system mode and exits 0 with junk.`
2. `deploy/tests/push-deploy.test.sh:62` — `stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE" 2>/dev/null`
3. `deploy/tests/scheduled-backups.test.sh:201` — `stat -c %Y … 2>/dev/null || stat -f %m … 2>/dev/null`
4. `deploy/tests/scheduled-backups.test.sh:464` — `stat -c %a "$_bm_new" 2>/dev/null || stat -f %Lp "$_bm_new" 2>/dev/null`

On the two test lines the BSD fallback previously had no `2>/dev/null`; I added
it so a failing `stat -c` on macOS leaves stderr silent (the scheduled-backups
test asserts an empty stderr on the fresh path). Formats kept as they were.

### Checks run

- `sh deploy/tests/push-deploy.test.sh` → **pass=25 fail=0** (exit 0).
- `sh deploy/tests/host-setup.test.sh` → **pass=64 fail=0** (exit 0).
- `sh deploy/tests/scheduled-backups.test.sh` → **pass=45 fail=1** (exit 1).
  Not in the task's Checks list, but I edited this file, so I ran it. The one
  failure is `FAIL: coolify doc missing the schedule or the NOT-covered volumes`
  (test line 394), which only inspects `deploy/coolify/scheduled-backup.md`
  (its `grep -qi 'NOT covered'`). I did not touch that doc; `git show
  HEAD:deploy/coolify/scheduled-backup.md | grep -qi 'NOT covered'` also fails,
  so it is **pre-existing and unrelated to this task**.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.2s)
  PASS  lint  (1.5s)
  PASS  typecheck  (1.6s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 4 changed files are the 3 Allowed deploy files plus this task file — all
  inside the Allowed files.

### Linux path (Docker available, version 29.8.1)

I could **not** run the full `push-deploy.test.sh` inside `alpine:3.20` /
`ubuntu:24.04`: the script needs `node` (resolving the repo's `node_modules`,
which are macOS binaries), the `docker compose` CLI and `openssl`, none of which
a plain image has. Instead I proved the exact Linux behaviour of the changed
line directly in `alpine:3.20`:

```
GNU -c:            [600]
BSD-first (old):   [  File: "/tmp/…"  … Blocks: … Inodes: … ]   <- junk, never "600"
GNU-first (new):   [600]
```

The old BSD-first form printed multi-line file-system info and exited 0, so the
`|| stat -c` fallback never ran — the root cause in the spec. The new GNU-first
form returns `600`.

### Notes for the lead

- Deviation from spec: none in the four call sites. I added `2>/dev/null` to the
  BSD fallback on the two test lines (the spec said "keep each line's formats";
  the format is unchanged, only the redirect added, matching `zilar-backup.sh:60`).
- `sh deploy/tests/scheduled-backups.test.sh` is red on main already because of
  the unrelated `deploy/coolify/scheduled-backup.md` "NOT covered" phrase; it is
  not in this task's Checks list. Flagging in case it belongs to another task.
- `deploy/zilar` has no dedicated shell test in this repo; I verified its changed
  line by inspection plus the alpine proof above.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits. The one red test was branch staleness; main has T-1650.
- **The change:** all four call sites are GNU-first, like `zilar-backup.sh:60`.
- **Verified by the lead:**
  - in `alpine:3.20`, the GNU-first form prints `600` for a 0600 file;
  - on macOS, `push-deploy.test.sh` gives pass=25, fail=0.
- **Effect on real servers:** `zilar doctor` now reads the newest backup's age on Linux hosts (it always said "stat unavailable" before).
- **After the merge:** the lead checks CI's Deploy checks job on main.
