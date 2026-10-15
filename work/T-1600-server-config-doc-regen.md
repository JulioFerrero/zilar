---
id: T-1600
title: "Rewrite docs/SERVER_CONFIG.md from the current config schema (it still documents LiteLLM, Hono, config.ts and assertRunnerHubConfig); fix the stale runner-hub comment in server-schema.ts"
status: merged
milestone: M5
branch: task/T-1600-server-config-doc-regen
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1600: A current server configuration reference

## Spec (written by Claude, do not edit)

### Why
`docs/SERVER_CONFIG.md` (367 lines) describes a server that no longer exists. Among other things it has:
- a LiteLLM proxy in "What runs where" (`:7`, `:15`) and a LiteLLM section (`:90-96`);
- `LITELLM_*` prerequisites (`:112`, `:118-119`, `:151-155`, `:358`, `:367`);
- `@hono/node-server` (`:11`), and citations to `config.ts`/`index.ts` lines that moved (the config now lives in `apps/server/src/config/`);
- `assertRunnerHubConfig` (`:161`), deleted in T-1598.

LiteLLM was removed (T-1413, T-1598), and `README.md` links this page as "every environment variable and flag".

### Facts (the lead read them on 2026-10-15, main `d7ee47007`)
- **The config:**
  - `apps/server/src/config/server-schema.ts` (195 lines): the schema of every server variable, with comments;
  - `apps/server/src/config/load.ts` (180 lines): loading, defaults and the secret list (`:80` lists `DESK_AGENT_SOCKET` among them);
  - also `apps/server/src/config/mail.ts` and `apps/server/src/config/schema-helpers.ts`.
- **The stale comment:** `apps/server/src/config/server-schema.ts:136-139` still says "The HTTP-only gateway requirement is checked at startup"; that check was removed in T-1598.
- **Where the variables are set:** `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/.env.example`.

### Steps
1. **Rewrite `docs/SERVER_CONFIG.md` from the code as it is now.** Read the files above and anything they import that reads `process.env`; `git grep -n "process.env\." -- apps/server/src ':!*.test.ts'` finds the rest. Sections:
   1. **What runs where:** server, web, Postgres, ejabberd, Caddy (plain stack), the optional runner hub, and the AI computer services (`desk-agent`, `desk-egress`), with ports and the file that sets each.
   2. **Every variable,** grouped (core, database, XMPP, auth and mail, AI and keys, push, feature flags, AI computers, limits), as one table per group: name | required | default | what it does | secret?
      - Each row cites `file:line` in `apps/server/src/config/`, or the file that reads it.
      - **Mark secrets** (passwords, keys, tokens) as **Secret**; values are always placeholders (`CHANGE_ME`).
   3. **Feature flags:** what each one turns on, and what else it needs.
   4. **Background jobs and health checks:** what runs on a timer, and what `/health` reports, with `file:line`.
   5. **Where to set them:** the plain stack (`deploy/.env.example`, `./zilar init`), the Coolify template, and live (Coolify app variables).
2. **Leave out:** test-only variables (`ZILAR_*_INTEGRATION` and the like), LiteLLM, and anything the code no longer reads. Don't add a history section; the old text is in git.
3. **In `server-schema.ts:136-139`,** change the comment so it no longer mentions a gateway check (for example, "Runner hub (T-0071): off by default. When enabled, the server accepts tunnel connections from approved machines on RUNNER_HUB_PORT (default 3189) bound to 127.0.0.1."). **Comment only, no code change.**
4. **Keep it tight:** the doc should land under ~300 lines. Tables, not prose.

### Tests
None.

### Allowed files
- `docs/SERVER_CONFIG.md`
- `apps/server/src/config/server-schema.ts` (comment lines 136-139 only)
- `work/T-1600-server-config-doc-regen.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n -i -E "litellm|hono|assertRunnerHubConfig" -- docs/SERVER_CONFIG.md` finds nothing.
- **Every variable the server reads** (from step 1's `git grep`, minus test-only ones) appears exactly once in the doc. The Report lists the count, and any variable you found in a compose file that the server does not read.

---

## Report (written by the worker when done)

### What I did

- Rewrote `docs/SERVER_CONFIG.md` from the current code (367 lines → 174 lines), with the five
  requested sections: "What runs where", "Every variable" (one table per group), "Feature flags",
  "Background jobs and health checks", "Where to set them".
- Every server-read variable is listed exactly once in a table row, each with a `file:line` citation,
  a required/default/what-it-does/secret column. Sources read: `apps/server/src/config/server-schema.ts`,
  `apps/server/src/config/load.ts`, `apps/server/src/config/mail.ts`, `apps/server/src/config/schema-helpers.ts`,
  `apps/server/src/push/config.ts`, `apps/server/src/xmpp/config.ts`, `apps/server/src/health.ts`, plus the
  wiring files cited inline.
- Removed all LiteLLM, `@hono/node-server`, `assertRunnerHubConfig` and moved-line references. No history section.
- In `apps/server/src/config/server-schema.ts`, dropped the stale sentence about the HTTP-only gateway
  check from the runner-hub comment (comment only, no code change; the block is now lines 136-138).

### Checks run

- `pnpm install`: done, 1137 packages added, no errors.
- `git grep -n -i -E "litellm|hono|assertRunnerHubConfig" -- docs/SERVER_CONFIG.md`: no matches (exit 1).
- Coverage check: extracted the 64 env keys from the three schemas plus `ZILAR_COMMIT`; all 64 are present in the doc, none missing.
- `pnpm gate` (from the repo root), real summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the only code change is a comment, and the gate skipped the server tests
  for the same reason.

### Notes for the lead

- **Variable count: 64** (45 from `config/server-schema.ts`, 7 from `xmpp/config.ts`, 11 from `push/config.ts`, 1 from `health.ts`).
- **"Exactly once" caveat:** each variable has exactly one table row, but a raw `grep -c` finds a few names more
  than once because rows cross-reference each other (e.g. `BETTER_AUTH_URL` default `PUBLIC_URL`) and because
  the required "Feature flags" section names the flags again. If you want a strict one-occurrence rule, say so
  and I will move the flag narrative out of §3.
- **Variables present in the compose files / `deploy/.env.example` that the server does not read**
  (they configure the other containers or the `./zilar` CLI): `ZILAR_DOMAIN`, `ACME_EMAIL`, `HTTP_PORT`,
  `HTTPS_PORT`, `POSTGRES_PASSWORD`, `IMAGE_OWNER`, `IMAGE_TAG`, `ZILAR_DB_PASSWORD`, `EJABBERD_DB_PASSWORD`,
  `ZILAR_ARCHIVE_DB_PASSWORD`, `DESKS_ENABLED`, `DESK_RUNTIME`, `DESK_MAX_RUNNING`, `DESK_NETWORK`,
  `DESK_CGROUP_PARENT`, `DESK_WORKSPACE_ROOT`, `DESK_WORKSPACE_MODE`, `DESK_EGRESS_PROXY`, `DESK_EGRESS_PORT`,
  `DESK_EGRESS_REGISTRY_SOCKET`, `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`, `SOURCE_COMMIT`, and the Coolify
  `SERVICE_*` names. They are called out at the end of §5.
- `LISTENER_ENABLED`/`LISTENER_MODEL` are still in the schema but the wiring deliberately ignores the flag
  (`apps/server/src/startup/components.ts:204-211`, T-1399); the doc says so.
- Test-only variables (`ZILAR_*_INTEGRATION`, `*_URL`, `XMPP_WS_URL`) and the web's `ZILAR_API_URL` are
  intentionally omitted.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 3 nits.
- **What the lead checked on the branch:**
  - `docs/SERVER_CONFIG.md` is 174 lines (367 before), covering all 64 variables;
  - `git grep -i "litellm|hono|assertRunnerHubConfig"` in it finds nothing;
  - the `server-schema.ts` change is comment-only: the gateway-check sentence is removed.
- **Edits the lead made in this commit:**
  - the `AGENT_GATEWAY_ENABLED` row now says the server default is `false` but every install sets `true` (T-1601 merged meanwhile);
  - nit 3: the reconcile interval cites `agents/gateway/contracts.ts:81`, checked.
- **Left as they are:**
  - nit 1: "Semi" in the secret column is undefined. It's readable enough, and the next doc pass can define it.
  - nit 2: some variables are named twice, once in the table and once in §3 "Feature flags". The spec asked for both.
