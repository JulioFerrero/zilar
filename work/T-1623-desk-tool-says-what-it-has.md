---
id: T-1623
title: "The bash tool tells the model what its computer has: a persistent /workspace, web access through the HTTPS proxy (curl, pip, git clone), the installed tools, no root — so the AI stops answering 'no curl, no net' from a guess"
status: merged
milestone: M5
branch: task/T-1623-desk-tool-says-what-it-has
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1623: The computer tool says what the computer has

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio's AI told him "My Linux shell has no network" and "No curl, no net" without running anything. The `bash` tool description says only "Run a shell command on the AI's Linux computer …", so the model guesses what the computer can do.
- **T-1612, T-1615 and T-1612's image change** gave the computer web access through the egress proxy, a persistent writable `/workspace`, and `curl`.
- **The model should know** what it has before it answers.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/agents/tools/desk-definitions.ts`** (161 lines): `:26-29`, the `bash` description, "Run a shell command on the AI's Linux computer. `command` runs in `/bin/bash -lc`; set `cwd` to pick a working directory inside the workspace, and `timeout_ms` for a long command."
- **What the computer has:**
  - **Installed packages** (`packages/desk/Dockerfile`, after T-1612): `git ripgrep curl python3 python3-pip build-essential ca-certificates jq`;
  - **The user:** `desk` (uid 10001, `USER 10001`), with `--cap-drop ALL` and `no-new-privileges` (`packages/desk/src/agent/docker.ts:87-128`), so there is no root;
  - **Scratch space:** `/tmp` is a 256 MB tmpfs;
  - **The workspace:** `/workspace` is the AI's own disk and persists between jobs (T-1615);
  - **The web:** `HTTP_PROXY` and `HTTPS_PROXY` are set (`docker.ts:72-84`), so `curl`, `pip`, `git clone` and Python `urllib` reach the public web through the egress proxy. IP literals and private addresses are refused (`packages/desk/src/egress/policy.ts`).

### Steps
1. **Extend only the `bash` description** with one or two short sentences:
   - files in `/workspace` persist between jobs, and `/tmp` is scratch;
   - the public web works through the built-in proxy (curl, pip, git clone), but not raw IP addresses or private networks;
   - installed: git, python3 with pip, build-essential, curl, jq and ripgrep; it runs as a normal user without root.
2. **Change nothing else.** Keep it under about 500 characters.

### Tests
None.

### Allowed files
- `apps/server/src/agents/tools/desk-definitions.ts`
- `work/T-1623-desk-tool-says-what-it-has.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The `bash` description names the persistent workspace, the web through the proxy, the installed tools and no root.**
- **Nothing else changes.**

---

## Report (written by the worker when done)

### What I did

Extended only the `bash` tool description in `apps/server/src/agents/tools/desk-definitions.ts` (T-1623 step 1). It now also says: `/workspace` persists between jobs and `/tmp` is scratch; the public web works through the built-in proxy (curl, pip, git clone) but not raw IP addresses or private networks; installed tools are git, python3 with pip, build-essential, curl, jq and ripgrep; it runs as a normal user without root. The final description is 466 characters (spec asked for about 500). No other string, parameter or line was changed.

### Checks run

- `pnpm install` (from the repo root): done, 17 workspace projects, no errors.
- `pnpm gate` (from the repo root): 
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (1.3s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (6.3s)`
  - `PASS  effect  (1.1s)`
  - `PASS  tests @zilar/server  (5.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No standalone test file was run: the spec says "Tests: None" and the change is a description string only.

### Notes for the lead

- Deviation: none. Only the `bash` description changed, as the spec required.
- The spec said the description should stay under about 500 characters; the result is 466.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The change:** the `bash` description now names the persistent `/workspace` and scratch `/tmp`, web through the proxy (no IP literals or private networks), the installed tools, and no root. It is 466 characters, and nothing else changed.

