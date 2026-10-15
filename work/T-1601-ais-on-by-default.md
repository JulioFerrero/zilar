---
id: T-1601
title: "AIs answer on a fresh install: AGENT_GATEWAY_ENABLED defaults to true in the three compose files, ./zilar init and the .env examples (Julio, 2026-10-15); docs say how to turn it off"
status: merged
milestone: M5
branch: task/T-1601-ais-on-by-default
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1601: AIs on by default

## Spec (written by Claude, do not edit)

### Why
- **The problem:** on a fresh install a user creates an AI and it never answers, because `AGENT_GATEWAY_ENABLED` defaults to `false` everywhere an install takes its settings from.
- **Julio chose "on by default"** (2026-10-15).
- **No cost risk:** an AI still does nothing until its owner adds a provider key, so nothing runs or costs money by itself. Live sets the variable explicitly, so it is unaffected.

### Facts (the lead read them on 2026-10-15, main `d7ee47007`)
- **The three compose files:**
  - `deploy/docker-compose.yml:158`: `AGENT_GATEWAY_ENABLED: ${AGENT_GATEWAY_ENABLED:-false}`;
  - `deploy/coolify/docker-compose.yml:167`: the same;
  - `deploy/coolify/docker-compose.app.yml:177`: the same.
- **The install files:**
  - `deploy/zilar:445`: `./zilar init` writes `AGENT_GATEWAY_ENABLED=false`;
  - `deploy/.env.example:81-83`: "# --- Optional: agent gateway. Default OFF. Needs ZILAR_KEY_ENCRYPTION_KEY / # --- to do anything useful. / AGENT_GATEWAY_ENABLED=false";
  - `deploy/baremetal/.env.example:78`: `AGENT_GATEWAY_ENABLED=false`;
  - `apps/server/.env.example:54`: `AGENT_GATEWAY_ENABLED=false`.
- **The docs:**
  - `deploy/coolify/LAYOUT.md:184`: the table row says "optional (default `false`)";
  - `docs/INSTALL_DOCKER.md:5-7`: "…They start answering once `AGENT_GATEWAY_ENABLED=true` is set in `.env` (`./zilar init` writes `false`)."
- **The server's own schema default stays `false`** (`apps/server/src/config/server-schema.ts`, `booleanFlagSchema()`); tests rely on it. This task changes only what installs write and pass.
- **No test or workflow references the variable:** `git grep` in `deploy/tests` and `.github` finds nothing.

### Steps
1. **In the three compose files,** change `${AGENT_GATEWAY_ENABLED:-false}` to `${AGENT_GATEWAY_ENABLED:-true}`.
2. **In the install files,** change `false` to `true` in `deploy/zilar:445`, `deploy/.env.example:83`, `deploy/baremetal/.env.example:78` and `apps/server/.env.example:54`. Rewrite the `deploy/.env.example:81-82` comment to say: "AIs answer in chats. On by default; set false to keep every AI silent. Needs ZILAR_KEY_ENCRYPTION_KEY."
3. **In `deploy/coolify/LAYOUT.md:184`,** make the row "optional (default `true`)".
4. **In `docs/INSTALL_DOCKER.md:5-7`,** replace the sentence with: "AIs need no extra service: each one calls its model provider directly with its owner's own key. They answer by default; set `AGENT_GATEWAY_ENABLED=false` in `.env` to keep them silent. Installs made before this change have `false` in their `.env`; change it to `true` to turn AIs on."

### Tests
None.

### Allowed files
- `deploy/docker-compose.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/zilar`
- `deploy/.env.example`
- `deploy/baremetal/.env.example`
- `apps/server/.env.example`
- `deploy/coolify/LAYOUT.md`
- `docs/INSTALL_DOCKER.md`
- `work/T-1601-ais-on-by-default.md`

### Checks
```bash
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- `git grep -n "AGENT_GATEWAY_ENABLED" -- deploy apps/server/.env.example` shows `true` everywhere.
- **`install.test.sh` passes.**

---

## Report (written by the worker when done)

### What I did
Turned AIs on by default, as the spec asked:
- `deploy/docker-compose.yml:158`, `deploy/coolify/docker-compose.yml:167` and
  `deploy/coolify/docker-compose.app.yml:177`: `${AGENT_GATEWAY_ENABLED:-false}` → `${AGENT_GATEWAY_ENABLED:-true}`.
- `deploy/zilar:445`: `AGENT_GATEWAY_ENABLED=false` → `true`.
- `deploy/.env.example:81-83`: value → `true`, and rewrote the comment to "AIs answer in chats. On by default; set false to keep every AI silent. Needs ZILAR_KEY_ENCRYPTION_KEY." (kept the `# --- ` prefix style).
- `deploy/baremetal/.env.example:77-78` and `apps/server/.env.example:51-54`: value → `true`.
- `deploy/coolify/LAYOUT.md:184`: row now "optional (default `true`)" (and Prettier re-padded the table cell, the only change on that line).
- `docs/INSTALL_DOCKER.md:5-9`: replaced the sentence with the spec's wording: AIs need no extra service, they answer by default, set `AGENT_GATEWAY_ENABLED=false` to keep them silent, and older installs have `false` in `.env`.

Files changed (10, all inside the Allowed files):
`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`,
`deploy/coolify/docker-compose.app.yml`, `deploy/zilar`, `deploy/.env.example`,
`deploy/baremetal/.env.example`, `apps/server/.env.example`,
`deploy/coolify/LAYOUT.md`, `docs/INSTALL_DOCKER.md`,
`work/T-1601-ais-on-by-default.md`.

### Checks run
- `git grep -n "AGENT_GATEWAY_ENABLED" -- deploy apps/server/.env.example` → every hit shows `true`
  (6 value lines + 1 comment-free row; comment lines were worded without the variable name so no `false` shows up).
- `sh deploy/tests/install.test.sh` → `pass=57 fail=0`.
- `pnpm gate` (from repo root) summary:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.7s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (First gate run failed on `format` for `deploy/coolify/LAYOUT.md`; Prettier re-padded the table cell — `false`→`true` shortens the cell by one char — and the second run passed. Only line 184 changed in that file.)
- No single-file unit tests were run: the change touches no source or test files (only compose/env/docs), and the gate reported "no nearby test files". The project's own `deploy/tests/install.test.sh` covers the install helper.

### Notes for the lead
- **Deviation (small):** step 2 only told me to rewrite the `deploy/.env.example` comment. I also adjusted the flag's own comment in `apps/server/.env.example:52` ("Off by default; set to true to enable" → "On by default; set to false to keep every AI silent") and the generic header in `deploy/baremetal/.env.example:77` ("all OFF unless you set them up" → "AIs answer by default; the other flags stay OFF…"), because leaving them would state the opposite about this flag. Both files are in Allowed files. Revert if you'd rather keep them untouched.
- The server's own schema default is untouched (still `false` via `booleanFlagSchema()`), as the spec says; I did not edit `docs/SERVER_CONFIG.md`, `docs/LEAD_PLAYBOOK.md` or `docs/design/agent-system.md`, which still describe the server default, not what installs write. They are outside Allowed files.
- `docs/INSTALL_DOCKER.md` is outside the acceptance grep path (`deploy apps/server/.env.example`) but was changed per step 4.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Approved and merged.** Julio chose "on by default" on 2026-10-15.

- **Pre-review:** clean, 0 nits.
- **What the lead checked on the branch:**
  - `git grep AGENT_GATEWAY_ENABLED -- deploy apps/server/.env.example` has no line without `true`;
  - `sh deploy/tests/install.test.sh` passes (pass=57 fail=0);
  - the diff is the 9 files the spec names, one or two lines each, plus the task file;
  - the server schema default is untouched.
- **Live is unaffected:** `zilar-chat` sets the variable itself. Installs made before this change keep `false` in their `.env`, and `docs/INSTALL_DOCKER.md` tells them how to switch.
