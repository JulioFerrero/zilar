---
id: T-1940
title: "Zero-downtime: CI asks Coolify to deploy zilar-server and zilar-web after main's images are published (skips when the secrets are unset)"
status: merged
milestone: M5
branch: task/T-1940-ci-coolify-deploy
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1940: CI triggers the Coolify deploys

## Spec (written by Claude, do not edit)

### Why
After the split (`docs/deploy/zero-downtime-plan.md`, `deploy/coolify/LAYOUT.md`), `zilar-server` and `zilar-web` are Coolify **Docker-image** apps. Nothing builds on the server any more, so after CI publishes new `latest` images, someone must ask Coolify to deploy them. Coolify then does a rolling update; the 10-18 rehearsal lost 0 requests.

LAYOUT.md says "CI calls Coolify's `POST /deploy` for this App after it publishes a new … image tag". `images.yml` has no such step today.

### Facts (read by the lead on 2026-10-18)
- **`.github/workflows/images.yml`** (344 lines):
  - job `build` (`:57`) publishes the images;
  - on a green CI run on main (`workflow_run`), the matrix pushes `latest` (`:282`, `:293-303`);
  - job `installer` (`:319-325`) shows the pattern for a job that runs after the whole matrix: `needs: [build]`, `if: ${{ !cancelled() && needs.build.result == 'success' && … }}`.
- **No Coolify secret exists in the repo yet** (`gh secret list`). Julio adds them at the cutover; the lead never handles them.
- **Coolify's deploy API:** `GET /api/v1/deploy?uuid=<uuid>` with `Authorization: Bearer <token>`. It pulls the image again ("Pulling latest images from the registry" in the rehearsal log).

### Steps
1. **In `images.yml`, add a job `deploy`** after `installer`:
   - `name: Deploy server and web on Coolify`, `runs-on: ubuntu-latest`, `timeout-minutes: 10`, `needs: [build]`;
   - `if: ${{ !cancelled() && needs.build.result == 'success' && github.event_name == 'workflow_run' }}`, so only main's published `latest` triggers it, never tags or PRs.
2. **One step**, with env `COOLIFY_URL`, `COOLIFY_DEPLOY_TOKEN`, `COOLIFY_SERVER_APP_UUID` and `COOLIFY_WEB_APP_UUID`, all from `secrets.*`. In shell:
   - If any of them is empty, print "Coolify deploy secrets not set; skipping (see deploy/coolify/LAYOUT.md)" and exit 0.
   - Otherwise, call `curl -fsS --retry 3 -X GET "$COOLIFY_URL/api/v1/deploy?uuid=<uuid>" -H "Authorization: Bearer $COOLIFY_DEPLOY_TOKEN"` for the server first, then for web, and print only the HTTP status.
   - Never echo the token, and never use `set -x`.
3. **In `deploy/coolify/LAYOUT.md`, add a short "Deploys from CI" paragraph:**
   - the 4 secret names and what each holds;
   - the token needs Coolify's "deploy" permission only;
   - until they're set, the job skips.

### Allowed files
- `.github/workflows/images.yml`
- `deploy/coolify/LAYOUT.md`
- `work/T-1940-ci-coolify-deploy.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On a main `workflow_run` with all 4 secrets set, the job deploys server, then web. With any secret missing, it logs the skip line and succeeds.
- No other job changes, and the token never appears in the log.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added a `deploy` job at the end of `.github/workflows/images.yml` (after
  `installer`): `needs: [build]`, `timeout-minutes: 10`, and
  `if: ${{ !cancelled() && needs.build.result == 'success' && github.event_name == 'workflow_run' }}`,
  so only a green main run that published `:latest` deploys — never a tag or a PR.
- One step reads `COOLIFY_URL`, `COOLIFY_DEPLOY_TOKEN`,
  `COOLIFY_SERVER_APP_UUID` and `COOLIFY_WEB_APP_UUID` from `secrets.*`. If any is
  empty it prints `Coolify deploy secrets not set; skipping (see deploy/coolify/LAYOUT.md)`
  and exits 0. Otherwise it calls
  `curl -fsS --retry 3 -o /dev/null -w '%{http_code}' -X GET "$COOLIFY_URL/api/v1/deploy?uuid=$uuid"`
  with `Authorization: Bearer $COOLIFY_DEPLOY_TOKEN` for `zilar-server` first and
  then `zilar-web`, printing only `<app>: HTTP <status>`. There is no `set -x`,
  and `-o /dev/null` drops the body, so the token never reaches the log.
- Two small shell details: the emptiness checks use `${VAR:-}` so `set -u`
  cannot trip when a secret is unset, and a trailing slash on `COOLIFY_URL` is
  stripped before building the URL.
- Added a `## Deploys from CI` section to `deploy/coolify/LAYOUT.md` (between
  Routing and Variables): the endpoint and order, a table of the four secrets
  with what each holds, the note that the token needs Coolify's **deploy**
  permission only, and that the job skips until all four exist.

### Checks run

`pnpm gate` (from the repo root), exit 0:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (0.9s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No unit tests were run: the change is a workflow and a doc, no package code
changed (`SKIP effect` is the gate's own note). Extra local verification, all
offline:

- Parsed `images.yml` with the repo's `yaml` package: the `deploy` job has the
  expected name, `needs: [build]`, the `if`, `timeout-minutes: 10` and one step.
- Extracted the step's `run` script and ran `bash -n` on it: syntax OK.
- Ran the script against a stub `curl` on `PATH` (no network): with one secret
  empty it printed the skip line and exited 0; with all four set (and a trailing
  slash on `COOLIFY_URL`) it printed `zilar-server: HTTP 200` then
  `zilar-web: HTTP 200`, exited 0, and the stub recorded the URLs as
  `https://coolify.example.com/api/v1/deploy?uuid=srv-uuid` then
  `...?uuid=web-uuid` (server first).
- I did **not** call the real Coolify API: no secrets exist yet and tests must
  not call external services.

### Notes for the lead

- The two existing app bullets in `LAYOUT.md` (`zilar-server` / `zilar-web`,
  "Deploys:") still say `POST /deploy`, while the real endpoint is
  `GET /api/v1/deploy` (as the spec's Facts say). I left them alone because the
  task only asks to add the paragraph; a one-line follow-up or a phrase in the
  review could align them.
- With the secrets set, a non-2xx Coolify answer fails the job (`curl -f`), so a
  failed deploy request turns the run red; with any secret missing it stays
  green. `--retry 3` covers transient errors.
- The spec's phrase "print only the HTTP status" is implemented as
  `Coolify deploy for <app>: HTTP <status>` so the two calls can be told apart;
  nothing else is printed.
- No deviations from the spec. The four secret names are exactly the ones in
  `LAYOUT.md`.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `a0afe0296`.
- **I read the job.** It runs only on main's `workflow_run` after `build` succeeds, and skips green while any of the 4 secrets is missing.
- **Order:** server first, then web.
- **The token stays out of the log:** `-o /dev/null`, only the HTTP status is printed, and there's no `set -x`.
- **Left as is:** the pre-review nit (older LAYOUT lines say `POST /deploy`; the call is `GET`). It's wording only, and the cutover runbook will state the real call.
- **Pending:** a real run needs the cutover and Julio's secrets.

