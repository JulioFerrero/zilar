---
id: T-1140
title: "Deploy: pass FCM_SERVICE_ACCOUNT_JSON and FCM_PROJECT_ID to the server container in deploy/docker-compose.yml and document them in deploy/.env.example (optional, empty = native push off)"
status: merged
milestone: M5
branch: task/T-1140-compose-fcm-env
model: auto
effort: default
depends_on: [T-1138]
estimate: 0.1 day
---

# T-1140: FCM env in compose

## Spec (written by Claude, do not edit)

### Why
T-1138 added `FCM_SERVICE_ACCOUNT_JSON` and an optional `FCM_PROJECT_ID` to the server's push config (`apps/server/src/push/config.ts`, `readFcmConfig` at `:205`). An empty value counts as unset (T-1133 `emptyPushSettingsAsUnset`). But the server service in `deploy/docker-compose.yml` lists its env one by one (the push block is at `:183-198`, ending with `PUSH_STORAGE_KEY: ${PUSH_STORAGE_KEY:-}` at `:198`), so a value set in Coolify never reaches the container. Julio's key is ready; the lead sets it in Coolify.

### What to build
1. **`deploy/docker-compose.yml`:** in the server's `environment`, right after `PUSH_STORAGE_KEY` (`:198`), add:
   ```yaml
      # Native (Android FCM) push, optional (T-1138): the Firebase service
      # account JSON on one line. Empty = native push off.
      FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}
      FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}
   ```
2. **`deploy/.env.example`:** after the `PUSH_STORAGE_KEY` block (`:158-162`), add commented lines in the same style:
   - `# FCM_SERVICE_ACCOUNT_JSON=` says it is the service-account key from Firebase (Project settings → Service accounts), on one line, **a secret**, and optional;
   - `# FCM_PROJECT_ID=` says it defaults to the JSON's `project_id`.
3. **No code change.** `deploy/docker-compose.yml` is the only compose file in `deploy/`.

### Read first
`AGENTS.md`, `deploy/docker-compose.yml:170-205` and `deploy/.env.example:140-168`.

### Allowed files
`deploy/docker-compose.yml`, `deploy/.env.example`, `work/T-1140-compose-fcm-env.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `docker compose -f deploy/docker-compose.yml config --quiet` still exits 0 with `ZILAR_DOMAIN=example.com` set. Run it with that env, and paste the exit code.

---

## Report (written by the worker when done)

### What I did
- `deploy/docker-compose.yml`: added `FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}` and `FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}` to the server's `environment`, immediately after `PUSH_STORAGE_KEY` (`:198`), with the two-line comment from the spec.
- `deploy/.env.example`: after the `PUSH_STORAGE_KEY` block (`:162`), added commented `# FCM_SERVICE_ACCOUNT_JSON=` (service-account key from Firebase → Service accounts, one line, **a secret**, optional) and `# FCM_PROJECT_ID=` (defaults to the JSON's `project_id`) lines in the surrounding style.
- No code change, no dependency added.

### Files changed
- `deploy/docker-compose.yml`
- `deploy/.env.example`
- `work/T-1140-compose-fcm-env.md` (status)

### Commands and real results
- `pnpm install`: Done in 16.6s (peer-dep warning in `apps/mobile` for `@types/react-dom`/`@types/react`, pre-existing).
- `docker compose -f deploy/docker-compose.yml config --quiet` with only `ZILAR_DOMAIN=example.com`: **exit 1**. It fails on pre-existing `:?` required vars (`EJABBERD_ADMIN_PASSWORD`, `EJABBERD_DB_PASSWORD`, `ZILAR_XMPP_JWT_SECRET`, `POSTGRES_PASSWORD`, `ZILAR_ARCHIVE_DB_PASSWORD`, `ZILAR_DB_PASSWORD`, `BETTER_AUTH_SECRET`) — there is no `deploy/.env` in the worktree. None of these relate to this change.
- Same command with `ZILAR_DOMAIN=example.com` plus those required vars set to `CHANGE_ME` placeholders: **exit 0**. This confirms the compose file (including the new FCM lines) interpolates and validates.
- `pnpm gate`: `gate: 3 changed file(s) against main` / `PASS install (frozen)` / `PASS format` / `PASS lint` / `PASS typecheck` / `SKIP effect (no source files changed)` / `scope: every changed file is inside the Allowed files` / `GATE PASS`. No package tests were run (no source files touched).
- No single test files were run (the change is compose/env docs only).

### Problems / deviations
- The Acceptance command as written (`config --quiet` with only `ZILAR_DOMAIN=example.com`) exits 1 in this worktree because of unrelated pre-existing required variables; the task text implied it exits 0. I ran it as written and pasted the exit code, then re-ran with placeholder values to prove the compose file is valid (exit 0). Flagging in case the lead expected a `deploy/.env` present.
- `.env.example`: the spec used an ASCII arrow label; I wrote `->` to match the file's plain-ASCII style. No secrets committed; only commented placeholders.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **`deploy/docker-compose.yml`:** the server gets `FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}` and `FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}` after `PUSH_STORAGE_KEY`. `deploy/.env.example` documents both, marked as a secret and optional.
- **The secret:** the lead set it in Coolify (literal, runtime-only) from Julio's key file, without printing it. The stored length matches the file and it parses as a service account. The key has no `$`, so Compose interpolation can't change it.
- **After this deploy,** the server log should say "push: native (FCM) sender on".
