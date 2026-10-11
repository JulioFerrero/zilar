---
id: T-1144
title: "Deploy: pass FCM_SERVICE_ACCOUNT_JSON and FCM_PROJECT_ID to the server in deploy/coolify/docker-compose.app.yml — the compose file production actually deploys (T-1140 edited only deploy/docker-compose.yml)"
status: merged
milestone: M5
branch: task/T-1144-coolify-compose-fcm-env
model: auto
effort: default
depends_on: [T-1140]
estimate: 0.1 day
---

# T-1144: FCM env in the Coolify compose

## Spec (written by Claude, do not edit)

### Why
Production (Coolify app `zilar-chat`) deploys `deploy/coolify/docker-compose.app.yml` (Coolify `docker_compose_location`, read by the lead on 2026-10-11), not `deploy/docker-compose.yml`. T-1140 added the FCM env only to the latter, so the Firebase secret, which is set in Coolify, never reaches the live server, and native push stays off.

The server's push env block in the Coolify file runs from `PUSH_ENABLED` (`:189`) to `PUSH_STORAGE_KEY: ${PUSH_STORAGE_KEY:-}` (`:207`).

### What to build
1. **In `deploy/coolify/docker-compose.app.yml`,** right after `PUSH_STORAGE_KEY` (`:207`) in the server's `environment`, add the same lines T-1140 added to `deploy/docker-compose.yml`:
   ```yaml
      # Native (Android FCM) push, optional (T-1138): the Firebase service
      # account JSON on one line. Empty = native push off.
      FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}
      FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}
   ```
2. **The other Coolify compose,** `deploy/coolify/docker-compose.yml` (the image-based variant), lists the same block, ending at `PUSH_STORAGE_KEY` (`:191`). Add the same two lines there too.
3. **No code change.**

### Read first
`AGENTS.md` and `deploy/coolify/docker-compose.app.yml:180-215`.

### Allowed files
`deploy/coolify/docker-compose.app.yml`, `deploy/coolify/docker-compose.yml`, `work/T-1144-coolify-compose-fcm-env.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The two lines are present in every server push env block.

---

## Report (written by the worker when done)

### What I did
Added the two FCM env lines exactly as specified, right after `PUSH_STORAGE_KEY`, in both Coolify compose files:
- `deploy/coolify/docker-compose.app.yml` — server `environment` block, after `:207`.
- `deploy/coolify/docker-compose.yml` — server `environment` block, after `:191`.

Lines added (with the same comment T-1140 used):
```yaml
      # Native (Android FCM) push, optional (T-1138): the Firebase service
      # account JSON on one line. Empty = native push off.
      FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}
      FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}
```

No code changes.

### Files changed
- `deploy/coolify/docker-compose.app.yml`
- `deploy/coolify/docker-compose.yml`
- `work/T-1144-coolify-compose-fcm-env.md` (status + this report)

### Commands and results
- `pnpm install`: 16 workspace projects resolved, 1180 packages added, done in 11.4s (1 deprecation and 1 peer-dep warning unrelated to this change).
- `pnpm gate`: first run `FAIL format (timed out after 10 min)` under contention on the shared machine; the retry passed:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (5.5s)
  PASS  lint  (4.0s)
  PASS  typecheck  (29.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No single test files were run: this task touches only compose YAML, so there were no near tests to run.

### Verification
- `grep` over `deploy/` confirms the two lines now appear in all three server push env blocks: `deploy/docker-compose.yml:201-202`, `deploy/coolify/docker-compose.yml:194-195`, `deploy/coolify/docker-compose.app.yml:210-211`. Acceptance "the two lines are present in every server push env block" holds.

### Problems / deviations
- None. Spec followed literally; no files touched outside the Allowed list.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **Both Coolify compose files** (`docker-compose.app.yml`, which production deploys, and `docker-compose.yml`) pass `FCM_SERVICE_ACCOUNT_JSON` and `FCM_PROJECT_ID` to the server, after `PUSH_STORAGE_KEY`.
- **Why it was needed:** T-1140 had changed only `deploy/docker-compose.yml`, which is not the production file.
- **After this deploy,** the Firebase secret set in Coolify reaches the live server.
