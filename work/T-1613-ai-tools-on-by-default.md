---
id: T-1613
title: "New installs turn on AI tools, routines and web tools by default (TOOLS_ENABLED, ROUTINES_ENABLED, WEB_TOOLS_ENABLED=true in the compose files, ./zilar init and the .env examples), like AGENT_GATEWAY_ENABLED in T-1601; the server schema default stays false"
status: merged
milestone: M5
branch: task/T-1613-ai-tools-on-by-default
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1613: AI tools, routines and web tools on by default

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio chose to have these three features on by default for new installs: "Yes, on by default". The rule is "easy, no variables".
- Live already runs with all three set to `true` (the lead set them on Coolify `zilar-chat`).
- The documented example ("every morning post gold, the S&P 500 and BTC", `docs/AI_TOOLS.md`) needs all three.
- T-1601 did the same for `AGENT_GATEWAY_ENABLED`: the install files default to `true`, while the server schema keeps `false`.

### Facts (the lead read them on 2026-10-16, main after T-1611)
Every place an install sets the three flags today (all `false`):
- **`deploy/docker-compose.yml:202-204`:** `TOOLS_ENABLED: ${TOOLS_ENABLED:-false}`, then the same for `ROUTINES_ENABLED` and `WEB_TOOLS_ENABLED`.
- **`deploy/coolify/docker-compose.yml:209-211`:** the same three lines.
- **`deploy/coolify/docker-compose.app.yml:219-221`:** the same three lines.
- **`deploy/zilar:469-471`:** `./zilar init` writes `TOOLS_ENABLED=false`, `ROUTINES_ENABLED=false` and `WEB_TOOLS_ENABLED=false`.
- **`deploy/.env.example`:**
  - `:9-10`, the header comment: "Optional AI features stay OFF unless you set them up: TOOLS_ENABLED, ROUTINES_ENABLED, PUSH_ENABLED and WEB_TOOLS_ENABLED all default to false.";
  - `:161`, the section comment: "--- Optional: server-side tools, routines and web tools. Default OFF.";
  - `:162-164`, the three `=false` lines.
- **`deploy/baremetal/.env.example:117-119`:** the three `=false` lines. Read the comment above them too.
- **`deploy/coolify/LAYOUT.md:203-205`:** the table rows say "optional (default `false`)".
- **The T-1601 pattern to copy:** `AGENT_GATEWAY_ENABLED: ${AGENT_GATEWAY_ENABLED:-true}` (`deploy/docker-compose.yml:158`), `AGENT_GATEWAY_ENABLED=true` (`deploy/zilar:443`, `deploy/.env.example:83`).

### Steps
1. **Change the default to `true`** in all three compose files: `${TOOLS_ENABLED:-true}` and the same for the other two keys.
2. **In `deploy/zilar:469-471`,** write `=true` for the three keys.
3. **In both `.env.example` files,** set the three keys to `true`.
   - Rewrite the comments so they stay true: tools, routines and web tools are **on** by default; set them to `false` to turn them off.
   - Keep `PUSH_ENABLED` as it is: only drop it from the sentence about these three if that sentence no longer fits it, and keep a correct statement about push.
4. **In `deploy/coolify/LAYOUT.md:203-205`,** change the rows to "optional (default `true`)".
5. **Change nothing else.** The server schema (`apps/server/src/config/server-schema.ts`) keeps `false`, and `docs/SERVER_CONFIG.md` is the lead's.

### Tests
None new. Run the two deploy test scripts (they exercise `./zilar init`) and fix any assertion that pinned the old `false` value, if one exists.

### Allowed files
- `deploy/docker-compose.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/zilar`
- `deploy/.env.example`
- `deploy/baremetal/.env.example`
- `deploy/coolify/LAYOUT.md`
- `deploy/tests/install.test.sh`
- `deploy/tests/host-setup.test.sh`
- `work/T-1613-ai-tools-on-by-default.md`

### Checks
```bash
sh deploy/tests/host-setup.test.sh
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- **No install file sets any of the three keys to `false` by default.**
- **`git grep -n -E "(TOOLS|ROUTINES|WEB_TOOLS)_ENABLED.*false" -- deploy` prints nothing,** except a comment that explains how to turn them off.

---

## Report (written by the worker when done)

### What I did

Flipped the default of the three AI feature flags from `false` to `true` in every install file, following the T-1601 `AGENT_GATEWAY_ENABLED` pattern. The server schema (`apps/server/src/config/server-schema.ts`) was left untouched.

- `deploy/docker-compose.yml:202-204` — `${TOOLS_ENABLED:-true}`, `${ROUTINES_ENABLED:-true}`, `${WEB_TOOLS_ENABLED:-true}`.
- `deploy/coolify/docker-compose.yml:209-211` — same three.
- `deploy/coolify/docker-compose.app.yml:219-221` — same three.
- `deploy/zilar:469-471` — `./zilar init` now writes `TOOLS_ENABLED=true`, `ROUTINES_ENABLED=true`, `WEB_TOOLS_ENABLED=true`.
- `deploy/.env.example` — keys set to `true`; rewrote the header comment (`:9-12`) and the section comment (`:161-162`) to say the three are on by default and how to turn them off. Kept `PUSH_ENABLED` at `false` and kept a correct statement about push.
- `deploy/baremetal/.env.example:117-119` — keys set to `true`. Note: this file has **no** comment above these three lines (the spec said to read it; the lines sit under the `STICKER_STORAGE_DIR` block with no tools-related comment), so there was nothing to rewrite. I did not add one, per "change nothing else".
- `deploy/coolify/LAYOUT.md:203-205` — rows now read `optional (default \`true\`)`.

No test assertion pinned the old `false` value (`grep -rn -E "ENABLED" deploy/tests/` matches only `DESKS_ENABLED`/`PUSH_ENABLED`, unrelated), so no test changes were needed.

Files changed: the 7 deploy files above, plus this task's Report.

### Checks run

- `sh deploy/tests/host-setup.test.sh` → `pass=52 fail=0`.
- `sh deploy/tests/install.test.sh` → `pass=58 fail=0`.
- Acceptance grep `git grep -n -E "(TOOLS|ROUTINES|WEB_TOOLS)_ENABLED.*false" -- deploy` → no matches (I reworded the header comment so even the "turn it off" note does not trip it; it is still explained in prose just above).
- `pnpm gate` from the repo root → `GATE PASS`:
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (1.4s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (1.4s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- `deploy/baremetal/.env.example` has no explanatory comment above the three keys, unlike `deploy/.env.example`; the spec assumed one existed. I left it comment-free to stay within "change nothing else". Say the word if you want a one-line comment added there too.
- No tests were added or changed; the two deploy scripts were the only test coverage this touches, and both pass unchanged.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - the three compose files, `./zilar init` and both `.env` examples now default to `true`;
  - the comments say how to turn them off, and the push statement stays correct;
  - the `LAYOUT.md` rows are updated;
  - `git grep -E "(TOOLS|ROUTINES|WEB_TOOLS)_ENABLED.*false" -- deploy` prints nothing.
- **In this review commit,** the lead updated the three `docs/SERVER_CONFIG.md` rows: `false` in the server, and every install sets `true`.
- **Live already runs with all three set to true** (set on Coolify on 2026-10-16).

