---
id: T-1490
title: "CI: delete the dead Coolify Service deploy job from images.yml (OPS-18; the live Coolify Application deploys itself on push) and add a daily TLS certificate-expiry check for chat.zilar.app and zilar.app (OPS-19)"
status: merged
milestone: M5
branch: task/T-1490-ci-dead-deploy-cert-check
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1490: Dead deploy job out, certificate check in

## Spec (written by Claude, do not edit)

### Why
`docs/audit/findings-sweep-server.md` has two open rows here:
- **OPS-18:** the `deploy` job in `.github/workflows/images.yml` calls the Coolify **Service** restart API. Since 2026-10-11 the live install is a Coolify **Application** that deploys itself on every push to main. The repository variable `AUTO_DEPLOY` is `off` and the `COOLIFY_*` secrets were removed, so the job only ever prints "skipping".
- **OPS-19:** nothing warns before a TLS certificate expires.

### Facts (the lead read them on main, 2026-10-15)
- **`.github/workflows/images.yml`** (355 lines):
  - the `deploy` job runs from `:284` to the end of the file (`:355`);
  - its steps are "Check whether auto-deploy is configured" (`:303-319`), "Restart the live service and pull latest" (`:321-333`) and "Wait until /health reports the new commit" (`:335-355`);
  - the jobs before it, `tip` (`:27`) and `build` (`:57`), build and push the images. They stay exactly as they are.
- **`.github/workflows/uptime.yml`** (45 lines) checks `/health` every 10 minutes. A failing scheduled run is emailed to the owner by GitHub, and that is the alert.
- **Both hosts serve Let's Encrypt certificates** (the lead read them with `openssl s_client`): `chat.zilar.app` and `zilar.app`, each ending on 2026-12-31.

### What to build
1. **`.github/workflows/images.yml`:** delete the whole `deploy` job, from its `deploy:` key (`:284`) to the end of the file, plus the blank line before it. Change nothing else in the file.
2. **New `.github/workflows/cert-expiry.yml`,** modelled on `uptime.yml`:
   - `name: Certificate expiry`;
   - a header comment in the same style: it checks the TLS certificates daily, a failing scheduled run is emailed by GitHub, and Let's Encrypt renews at 30 days left, so under 14 days means renewal failed;
   - `on:` a `schedule` with `cron: '17 6 * * *'`, plus `workflow_dispatch`;
   - `permissions: contents: read`;
   - one job, `certificates`, on `ubuntu-latest` with `timeout-minutes: 5`;
   - one step with `set -euo pipefail` that loops over `chat.zilar.app` and `zilar.app`:
     - read the end date with `echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate`;
     - compute the whole days left with GNU `date -d`;
     - print one line per host, such as `chat.zilar.app: 77 days left (Dec 31 20:24:17 2026 GMT)`;
     - a host whose date can't be read, or that has under 14 days left, prints an `::error::` line and marks the run failed;
     - the loop finishes all hosts before it exits 1.
   - No secrets, no checkout.
3. No other file changes.

### Tests
None (CI config).

### Allowed files
`.github/workflows/images.yml`, `.github/workflows/cert-expiry.yml`, `work/T-1490-ci-dead-deploy-cert-check.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `images.yml` has no `deploy` job and no `COOLIFY_` reference; `tip` and `build` are byte-for-byte unchanged (`git diff` shows only removed lines at the end).
- **Lead:** after the merge, a manual `gh workflow run cert-expiry.yml` passes and prints both hosts.

---

## Report (written by the worker when done)

### What I did

- `.github/workflows/images.yml`: deleted the whole `deploy` job, from its `deploy:` key to the end of the file, plus the blank line before it (73 lines). Nothing else changed; the `tip` and `build` jobs are byte-for-byte untouched.
- `.github/workflows/cert-expiry.yml`: rewrote it to the spec, modelled on `uptime.yml`:
  - `name: Certificate expiry` and a header comment (daily check, GitHub emails a failing scheduled run, Let's Encrypt renews at 30 days left so under 14 days means the renewal failed);
  - `on:` `schedule` (`cron: '17 6 * * *'`) plus `workflow_dispatch`; `permissions: contents: read`;
  - one job `certificates` on `ubuntu-latest` with `timeout-minutes: 5`, one step with `set -euo pipefail`;
  - the step loops over `chat.zilar.app` and `zilar.app`, reads the end date with `echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate`, computes whole days left with GNU `date -d`, prints one line per host (`<host>: <n> days left (<end date>)`), and for an unreadable date or fewer than 14 days left prints an `::error::` line and marks the run failed. It records `failed=1` and keeps looping, then `exit "$failed"` after all hosts, so every host is checked before the run fails. No secrets, no checkout.

### Checks run

- `pnpm install` → "Done in 11.9s", 17 workspace projects, 1137 packages added.
- `pnpm gate` → `GATE PASS` (run from the repo root against `main`). Its summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (1.5s)
  PASS  lint  (2.4s)
  PASS  typecheck  (2.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `git diff --numstat -- .github/workflows/images.yml` → `0  73`, so the change is removals only at the end of the file. `grep -c COOLIFY .github/workflows/images.yml` → 0 matches.
- Parsed both workflows with the `yaml` package: `cert-expiry.yml` jobs = `certificates`, triggers = `schedule,workflow_dispatch`; `images.yml` jobs = `tip,build`. Both `ok: true`.
- No tests: the spec says none (CI config only), and I ran no single test files.

### Notes for the lead

- **Deviation from the spec:** the spec calls `cert-expiry.yml` "New", but a tracked version already existed on this branch from T-1462 (`T-1462: Daily TLS certificate expiry check for chat.zilar.app`), with the same `cron`, a job named `expiry`, and only `chat.zilar.app`. I updated that file in place to satisfy this spec (job renamed to `certificates`, both hosts, spec header comment). This is why `git status` shows it as modified, not added; everything else is as specified. No other file changed.
- I did not run the workflow itself: it needs `gh`/network and a live host, which the acceptance assigns to the lead (`gh workflow run cert-expiry.yml` after merge).
- The certificate check prints whole (floored) days, so a certificate ending on 2026-12-31 read today is ~77 days, matching the spec's example.

### Fix round 1 (lead)

- `.github/workflows/images.yml:8` header comment no longer claims the workflow deploys: replaced with the lead's wording, nothing else touched. `git diff --numstat` for the fix was `1 insertion(+), 1 deletion(-)`. `pnpm gate` after the fix → `GATE PASS` (`install`, `format`, `lint`, `typecheck` all PASS; "scope: every changed file is inside the Allowed files"). Committed as `T-1490: images.yml header no longer claims a deploy`.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Spec error (lead):** the spec called `cert-expiry.yml` new, but T-1462 had already added it for `chat.zilar.app` only. The lead had not listed `.github/workflows` first. The worker handled it correctly: it updated the file in place, and said so. The net change adds `zilar.app`.
- **`images.yml`:**
  - the diff is removals only, plus the one header line from fix round 1;
  - `tip` and `build` are unchanged;
  - no `COOLIFY_` reference is left.
- **`cert-expiry.yml`:** it reads both hosts, collects every failure before it exits, and fails under 14 days. Both packets were clean; the last one is for head `1edcd215a`.
- **Carried:**
  - `docs/RELEASING.md` is rewritten for the git-built Application: the §1 note, §3 scoped to installs that run the published images, §6 rollback by revert or redeploy (OPS-5), and §9 deploy on watch paths without waiting for CI (OPS-18);
  - both findings sweeps gain an "Updates after the sweep" list.
- **After the merge:** the lead runs `gh workflow run cert-expiry.yml` once.
