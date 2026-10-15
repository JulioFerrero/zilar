---
id: T-1462
title: "Ops: a daily GitHub workflow fails (and so emails the owner) when the TLS certificate of chat.zilar.app expires in under 14 days (OPS-19 remainder)"
status: merged
milestone: M5
branch: task/T-1462-cert-expiry-check
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1462: Certificate expiry alert

## Spec (written by Claude, do not edit)

### Why
This is the remainder of OPS-19 in `docs/audit/findings-sweep-server.md`: there is no explicit certificate-expiry check. Caddy renews on its own, but a silent renewal failure would take the site down without warning.

### Facts (the lead read them on main, 2026-10-15)
- **`.github/workflows/uptime.yml`** checks `https://chat.zilar.app/health` every 10 minutes. A failing scheduled run is emailed to the owner by GitHub, which is the alert.
  - It uses no secrets and no checkout, with `permissions: contents: read`.
- **There is no certificate check anywhere** in `.github/workflows/`.

### What to build
1. **A new workflow** `.github/workflows/cert-expiry.yml`:
   - it runs on `schedule: cron: '17 6 * * *'` (daily) and `workflow_dispatch`;
   - `permissions: contents: read`, no secrets, no checkout, `timeout-minutes: 5`.
2. **One step** reads the certificate's `notAfter` for `chat.zilar.app:443`. Use `openssl s_client -servername chat.zilar.app -connect chat.zilar.app:443 </dev/null 2>/dev/null | openssl x509 -noout -enddate`. Then:
   - it computes the days left with GNU `date` (ubuntu-latest);
   - it prints the end date and the days left;
   - it fails with `::error::` when fewer than 14 days are left, or when the date can't be read.
3. **Hosts:** keep the host list a single shell array, so `get.zilar.app` can be added later. Today it holds only `chat.zilar.app`.
4. **Docs:** add one line to `docs/ops/log-access.md`, or to the nearest ops doc that lists the alerts, naming this check.

### Tests
None (CI config). Validate the YAML with `pnpm exec prettier --check .github/workflows/cert-expiry.yml`.

### Allowed files
- `.github/workflows/cert-expiry.yml`
- `docs/ops/log-access.md`
- `work/T-1462-cert-expiry-check.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- After the merge, the lead runs the workflow once with `gh workflow run cert-expiry.yml` and reads the result.

---

## Report (written by the worker when done)

### What I did
- Added `.github/workflows/cert-expiry.yml`: runs daily (`cron: '17 6 * * *'`) and on `workflow_dispatch`, with `permissions: contents: read`, no secrets, no checkout, `timeout-minutes: 5`. One step iterates a shell array `hosts=("chat.zilar.app")`, reads the presented certificate's `notAfter` with `openssl s_client -servername "$host" -connect "$host:443" </dev/null 2>/dev/null | openssl x509 -noout -enddate`, computes days left with GNU `date -d`, prints the end date and days left, and fails with `::error::` when fewer than 14 days are left or when the date cannot be read or parsed. The host list is one array, so `get.zilar.app` can be appended later.
- Added an "Alerts" line to `docs/ops/log-access.md` naming the check (spec allowed this doc; no other ops doc in `docs/ops/` lists alerts, and neither OPS_LOG.md nor the others are in Allowed files).

### Files changed (all inside Allowed files)
- `.github/workflows/cert-expiry.yml` (new)
- `docs/ops/log-access.md` (one "## Alerts" line added)
- `work/T-1462-cert-expiry-check.md` (front matter + this Report)

### Commands and real results
- `pnpm install` — done in 11.8s, no errors.
- `pnpm exec prettier --check .github/workflows/cert-expiry.yml` — "All matched files use Prettier code style!".
- `bash -n` on the extracted `run:` block — "bash syntax OK".
- Logic check (the four outcomes the spec names), run locally with stub `openssl`/`date` on `PATH` so the real script ran unmodified: 30 days left -> prints `days left: 30`, exit 0; 5 days left -> prints `::error::chat.zilar.app: certificate expires in 5 days (fewer than 14)`, exit 1; no certificate date -> `::error::... could not read the certificate end date`, exit 1; unparsable date -> `::error::... could not parse the certificate end date`, exit 1.
- `pnpm gate` (repo root) — real summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.0s)
  PASS  lint  (1.3s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No tests were run for this change (CI config, no package source changed).

### Deviations / notes
- No deviations from the spec.
- The certificate read itself was not exercised against the live host (no external calls and the local machine has BSD `date`, not GNU `date`), so the GNU-`date` parsing path is covered by the stub-run above, not by a live run. The acceptance step (lead runs `gh workflow run cert-expiry.yml`) will confirm it end to end.

### Open questions
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- `cert-expiry.yml` runs daily at 06:17 UTC with no secrets.
- It fails when it can't read or parse the date, or when fewer than 14 days are left.
- The host list is one array.
- After the merge, the lead runs it once by hand.
