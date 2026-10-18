---
id: T-2085
title: "Cut comments (server routines, chats, actions, auth, tools): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2085-comments-server-routines-chats-actions-auth-tools
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2085: Comment cut — server routines, chats, actions, auth, tools

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2038 comment lines in 80 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1019** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/server/src/actions/announce.ts`
- `apps/server/src/actions/approval-path.ts`
- `apps/server/src/actions/canonical.ts`
- `apps/server/src/actions/decisions.ts`
- `apps/server/src/actions/demo.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/policy.ts`
- `apps/server/src/actions/production-announcer.ts`
- `apps/server/src/actions/queries.ts`
- `apps/server/src/actions/recovery.ts`
- `apps/server/src/actions/registry.ts`
- `apps/server/src/actions/support.ts`
- `apps/server/src/actions/topic-recheck.ts`
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/auth.ts`
- `apps/server/src/auth/deletion-request.ts`
- `apps/server/src/auth/export-stream.ts`
- `apps/server/src/auth/export.ts`
- `apps/server/src/auth/invite-cli.ts`
- `apps/server/src/auth/invites.ts`
- `apps/server/src/auth/mailer.ts`
- `apps/server/src/auth/me-view.ts`
- `apps/server/src/auth/profile-bio.ts`
- `apps/server/src/auth/profile-time-zone.ts`
- `apps/server/src/auth/sessions.ts`
- `apps/server/src/auth/sql-adapter.ts`
- `apps/server/src/auth/sql-where.ts`
- `apps/server/src/chats/ai-entries.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/delete-own.ts`
- `apps/server/src/chats/delivered-notice.ts`
- `apps/server/src/chats/deliveries.ts`
- `apps/server/src/chats/list-handler.ts`
- `apps/server/src/chats/mark-handlers.ts`
- `apps/server/src/chats/reads.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/chats/unread-queries.ts`
- `apps/server/src/chats/unread-skip.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/routines/access.ts`
- `apps/server/src/routines/alert-link.ts`
- `apps/server/src/routines/alert-note.ts`
- `apps/server/src/routines/alert-run.ts`
- `apps/server/src/routines/api.ts`
- `apps/server/src/routines/audit.ts`
- `apps/server/src/routines/deletes.ts`
- `apps/server/src/routines/execute-prompt.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/message-store.ts`
- `apps/server/src/routines/outcomes.ts`
- `apps/server/src/routines/preflight.ts`
- `apps/server/src/routines/prompt-routines.ts`
- `apps/server/src/routines/queries.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/schedule.ts`
- `apps/server/src/routines/scheduler.ts`
- `apps/server/src/routines/schemas.ts`
- `apps/server/src/routines/service.ts`
- `apps/server/src/routines/status-errors.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/routines/wiring.ts`
- `apps/server/src/tools/access.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/tools/adapters.ts`
- `apps/server/src/tools/api.ts`
- `apps/server/src/tools/card-header.ts`
- `apps/server/src/tools/deletes.ts`
- `apps/server/src/tools/hosts.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/tools/queries.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/routine-list-lines.ts`
- `apps/server/src/tools/runner.ts`
- `apps/server/src/tools/schemas.ts`
- `apps/server/src/tools/service.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/tools/tool-arg-schemas.ts`
- `apps/server/src/tools/types.ts`
- `apps/server/src/tools/wire.ts`
- `work/T-2085-comments-server-routines-chats-actions-auth-tools.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1019 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in all 80 allowed source files (13 actions, 14 auth, 12 chats, 22 routines, 19 tools) following `docs/COMMENTS.md`: deleted task IDs, size-split/moved-unchanged history, narration, parameter-restating JSDoc and banners; shortened multi-line blocks to one or two lines; kept security, permission, protocol/invariant, units/limits and tool-directive comments.

- Source-only `git diff --shortstat main...HEAD -- 'apps/**'`: `80 files changed, 578 insertions(+), 2017 deletions(-)` — net **1,439 lines removed** (target was 1,019).
- Full `git diff --shortstat main...HEAD` also counts this task file as new (about 177 lines, since it is not on `main`), so its insertion count is that much higher; deletions stay 2,017.
- Every changed line in `git diff` is a comment line or a blank line (mechanically checked: 2,595 changed lines, 0 non-comment).
- No code, string, import, type or logic change.

Kept comment longer than 3 lines:

- `apps/server/src/routines/execute.ts:1` (6 lines) — the ordered run steps (AI active/room membership, deleted tool, host pinning, alert threshold, audit detail), an invariant a reader would break by simplifying.

### Checks run

- `pnpm install --frozen-lockfile`: done.
- `pnpm gate`:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  effect`
  - `PASS  build @zilar/server`
  - `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the task says "No tests", and gate ran the server suite once.

### Notes for the lead

- The first gate run exposed `// effect-plain:` markers that had lost their required reason (the marker regex needs a non-empty reason). I restored the marker on those files with a current reason instead of the old size-split history (`actions/support.ts`, `chats/mark-handlers.ts`, `routines/access.ts`, `routines/audit.ts`, `tools/routine-adapters.ts`, `tools/tool-adapters.ts`); `effect` then passed.
- Prettier re-indented the shortened comment lines and collapsed blank lines left by removed blocks; those remain comment/blank-line changes only.
- `git diff main...HEAD --shortstat` (after commit): `80 source files changed, 578 insertions(+), 2017 deletions(-)`, plus this task file (not on `main`) as new.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +578 -2017 net -1439; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
