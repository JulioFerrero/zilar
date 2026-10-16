---
id: T-1630
title: "Docs only: re-check the 24 open/partly rows of docs/audit/findings-sweep-server.md against today's main (several are already fixed, e.g. SG-7 by T-1437, AI-17 by T-1440) and rewrite the table with current status and evidence; add the new risk SEC-13b (any group member can run the owner's AI computer)"
status: merged
milestone: M5
branch: task/T-1630-findings-resweep
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1630: Fresh status for the open server findings

## Spec (written by Claude, do not edit)

### Why
`docs/audit/findings-sweep-server.md` (2026-10-15) lists 7 `open` and 17 `partly` findings (its summary is at `:86-87`). The lead found two that are already done:
- **SG-7** is fixed: `apps/server/src/contact-requests/search.ts:75-90` calls the batched `relationsFor` (T-1437).
- **AI-17** is fixed: the prompt uses the user's zone through `promptNow` and `timeZoneFor` (`apps/server/src/agents/gateway/dm-turn.ts:228`, `apps/server/src/agents/gateway/group-turn-body.ts:141-143`, T-1440).

The lead needs an accurate list to plan the next fix waves. **Docs only. No code.**

### Facts (the lead read them on 2026-10-16)
- **The table rows to re-check:** `docs/audit/findings-sweep-server.md:20-80`, the `partly` and `open` rows (SG-7, SG-8, SEC-3, SEC-12, SEC-13, SEC-14, PERF-5, PERF-11, AI-15, AI-17, AI-22, AI-23, OPS-1, OPS-3, OPS-5, OPS-7, OPS-8, OPS-11, OPS-12, OPS-13, OPS-14, OPS-18, OPS-19, OPS-20 and any others marked so).
- **Running now:** OPS-8 (log rotation) is T-1629.
- **A new risk, related to SEC-13:**
  - since 2026-10-16, AI computers are live, and a turn with the computer gets 40 rounds, 80 calls and 15 minutes (T-1611);
  - the desk tools are offered on any group turn, whoever triggered it (`apps/server/src/agents/gateway/group-turn-body.ts:212-219`, `deskEnabled` doesn't depend on the trigger's role), while actions are owner/admin only (`:196-201`);
  - an AI with no `ai_limits` row fails open (`apps/server/src/ais/usage.ts:46`).

### Steps
1. **Re-check each `open` and `partly` row** against today's code. Find the code by searching (line numbers move), and update its status (`fixed`, `partly`, `open`) with `file:line` evidence and the task id when a comment names one.
2. **Add a row `SEC-13b`** for the computer risk above, with evidence and the options:
   - (a) the computer only when the AI's owner (or a room owner/admin) triggers the turn;
   - (b) a per-AI setting for who may use the computer;
   - (c) a default daily limit for AIs with a computer.
   Mark it `open` and leave the choice to Julio.
3. **Update the summary counts.** Keep the doc's format, and date the re-check 2026-10-16.

### Allowed files
- `docs/audit/findings-sweep-server.md`
- `work/T-1630-findings-resweep.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every `open` or `partly` row has fresh `file:line` evidence.**
- **No source files change.**

---

## Report (written by the worker when done)

### What I did

Docs only; no source file changed.

Re-checked all 24 rows then marked `open` or `partly` in
`docs/audit/findings-sweep-server.md` against today's `main`, finding the code by
searching (line numbers had moved). Rewrote each of those rows with fresh
`file:line` evidence and the current status, folded in the fixes the old
"Updates after the sweep" section listed (and now verified in code), added the
new `SEC-13b` row plus a short options block for Julio, and recomputed the
counts. Dated the re-check 2026-10-16 in the title, intro and a new
"Re-check notes" section (which replaces the old "Updates after the sweep"
section, now that its content is in the table).

Status flips from this re-check: SG-7, SEC-12, PERF-11, AI-17, AI-22, OPS-1 and
OPS-5 are now `fixed`; OPS-7, OPS-14 and OPS-20 are now `partly` (were `open`);
OPS-18 moves to `needs Julio` (repo half deleted in T-1490, only the Coolify
auto-deploy setting remains). New counts: fixed 33, partly 13, open 4,
needs Julio 9, obsolete 1, total 60 (was 26/17/7/8/1/59).

`SEC-13b` evidence: a desk turn gets 40 rounds / 80 calls / 15 min
(`apps/server/src/agents/tool-loop.ts:185-186`, T-1611); the desk tools are
offered on any group turn regardless of the trigger's role
(`apps/server/src/agents/gateway/group-turn-body.ts:213-221`, desk resolved
from the AI's `computerMode`/owner alone in `.../gateway/desk-exec.ts:163-189`)
while actions stay owner/admin only (`group-turn-body.ts:199-201`); an AI with
no `ai_limits` row fails open (`apps/server/src/ais/usage.ts:58-60`). Options
(a)/(b)/(c) are in the doc; the row is left `open` for Julio.

### Checks run

- `pnpm install` — done (14.9s, no errors).
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 2 changed files are `docs/audit/findings-sweep-server.md` and
  `work/T-1630-findings-resweep.md`, both in the Allowed files.
- No package tests were run: the change touches no package source (gate skipped
  `effect` and the per-package tests for that reason).

### Notes for the lead

- OPS-8 is still `open` in the doc and noted "(T-1629 is working on this)";
  nothing for it has landed in this worktree.
- Two claims in the earlier T-1439 report do not match today's repo and are
  recorded correctly as "remains": `docs/INSTALL_DOCKER.md:131,139-141` still
  tells Coolify users to paste `deploy/coolify/docker-compose.yml` (OPS-12), and
  `apps/server/src/tools/runner.ts:70,74` still grants a rewritten tool version
  its old host approvals (AI-23).
- I left the fixed rows' evidence as it was (not part of the 24-row re-check)
  except where a row's status changed; every changed row has fresh `file:line`
  evidence. No `area` column added for fixed rows, matching the doc's convention.

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean.
- **The server sweep now reads:** 34 fixed, 13 partly, 3 open, 9 needs Julio, 1 obsolete, of 60.
- **The lead's own edit:** OPS-8 moved to `fixed`, because T-1629 merged while this ran. The counts and the open list follow.
- **What's left to plan:**
  - SEC-13b (computer access in groups, Julio's call, in `work/NOW.md`);
  - AI-23 (tool versions keep approved hosts, by design);
  - OPS-11 (an XMPP domain variable);
  - the 13 partly rows, mostly ops.
