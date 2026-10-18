---
id: T-1938
title: "Audit: is the server still safe with two copies running during a rolling deploy? (re-check of the 10-13 audit)"
status: merged
milestone: M5
branch: task/T-1938-two-servers-reaudit
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1938: Two-servers re-audit

## Spec (written by Claude, do not edit)

### Why
Julio wants pushes to stop causing about 50 s of Bad Gateway. The fix is the split layout (`docs/deploy/zero-downtime-plan.md` Phase 2): server and web become Coolify image apps with rolling updates, so for a few seconds the old and new server run side by side on the same database and ejabberd.

Coolify's docs say the app must support parallel instances: "Schedulers, queue consumers, and other background work must tolerate two versions running briefly".

`docs/audit/two-servers-audit.md` checked this on 2026-10-13 (base commit `b447451b7`), and T-1316 added the Postgres leader lock (`apps/server/src/leader/lock.ts`, `apps/server/src/leader/start.ts`). Since then many server files were added: `agents` 44, `ai` 9, `message-blocks` 8, `topics` 7, `routines` 7, `chats` 6, `app` 6, `hands` 5, `card-media` 5, `ais` 5, `sandbox` 2, `machines`, and more. This task re-checks the whole server against today's `main`. **It is read-only: you write only the audit doc.**

### Facts (read by the lead on 2026-10-18)
- **`docs/audit/two-servers-audit.md`** (176 lines):
  - §1 is a table of 15 background items. Each row covers: what it is, its cadence, what happens with two instances, and whether a duplicate is prevented.
  - §2 covers start and shutdown, §3 the leader lock, §4 migrations, §5 other hazards, §6 the recommendation.
- **`apps/server/src/leader/start.ts`** (252 lines) holds the leader-only work: push component plus group notifier, approvals sweeper, task-event retention, action recovery, routine scheduler and the agent gateway (`:182`). A follower never runs them.
- **`/health`** returns 503 while draining (`apps/server/src/health.ts:36`); SIGTERM sets draining (`apps/server/src/health-status.ts:47`).
- **AI computers:** in the target layout, `desk-agent` and `desk-egress` live in `zilar-core` (`deploy/coolify/zilar-core.yml:1-14`), not in the server.

### Steps
1. **Find every candidate** in `apps/server/src` (excluding tests):
   - timers and loops: `setInterval`, `setTimeout` loops, `Schedule.`, `Effect.repeat`, `Effect.forever`, `forkDaemon`;
   - long-lived connections: XMPP clients and components, WebSockets, SSE, TCP listeners, child processes, the Docker or desk socket;
   - module-level mutable state: `new Map` or `new Set` at module scope, `let` caches;
   - startup one-shots: anything run once in `main.ts`, `startup/*` or `app/*` that changes shared data.
2. **For each one**, check whether it already appears in the 10-13 table and whether it's started from `leader/start.ts`. Then classify it:
   - **safe:** behind the leader lock, or race-safe by a conditional UPDATE, a claim or a unique key (cite the line);
   - **harmless:** per-process state that's lost or duplicated with no user-visible effect;
   - **hazard:** two copies would cause a double AI reply, a double push, a double charge, a double routine run, a lost write, a stuck job, two runners or desks fighting, and so on. Give a concrete scenario.
3. **Check the migrations path** (`apps/server/src/db/migrate*`, wherever startup runs them): if both copies start at once, can the new copy's migration break the old one, or can both try to migrate together? Cite the lock, if any.
4. **Write the result** into `docs/audit/two-servers-audit.md` as a new top section, `## 0. Re-audit 2026-10-18 (main <short sha>)`:
   - a table of the **new or changed** items, in the same columns as §1, with `file:line`;
   - a list of **hazards**, each with a one-line suggested fix (for example: move it into `leader/start.ts`, or add a conditional claim);
   - a one-line verdict: "safe to run two copies" or "N hazards must be fixed first".

   Keep §1–§6 as they are.

### Allowed files
- `docs/audit/two-servers-audit.md`
- `work/T-1938-two-servers-reaudit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The new §0 lists every timer, long-lived connection and module-level state added or changed since `b447451b7`, each with `file:line` and a classification.
- Every hazard has a concrete two-copy scenario and a suggested fix.
- No code changes.

---

## Report (written by the worker when done)

### What I did

- Read the 10-13 audit (`docs/audit/two-servers-audit.md`, §1–§6) and the current
  leader code (`leader/lock.ts`, `leader/start.ts`, `startup/*`).
- Searched `apps/server/src` (tests excluded) for `setInterval`, `setTimeout`,
  `Effect.repeat`/`Schedule`, `runFork`/`forkDaemon`, module-scope
  `new Map`/`new Set`/`let`, HTTP/Unix sockets, XMPP clients and components,
  `spawn`, and worker threads. Cross-checked every hit against
  `git diff b447451b7..HEAD -- apps/server/src` to keep only items added or
  changed since the last audit.
- Traced each item to its start site: `leader/start.ts` (leader-only), a
  per-request path, or boot. Classified each as safe / harmless / hazard with
  `file:line`.
- Checked the migration path: `startup/boot.ts:75` → `effect/sql.ts:301-329` →
  `effect Migrator.ts:276-288,321-327`; verified the 22 files added since
  `b447451b7` are additive apart from the already-shipped `0059`.
- Wrote `## 0. Re-audit 2026-10-18 (main 9d595c6f3)` as a new top section in
  `docs/audit/two-servers-audit.md`: 20-row table of new/changed work, four
  hazards with scenarios and one-line fixes, a migrations subsection and the
  verdict. Left §1–§6 untouched. No code change.

Files changed:
- `docs/audit/two-servers-audit.md` (new §0 only)
- `work/T-1938-two-servers-reaudit.md` (status + report)

### Checks run

- `pnpm gate` (from the repo root, one run):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.5s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No unit tests were run: the task touches no source and `pnpm gate` skipped
  tests for the same reason.

### Notes for the lead

- Verdict in §0 is **3 hazards must be fixed first** (H1 approval follow-up,
  H2 Stop/follow pause, H3 card correction, display-only); H4 (shutdown budget)
  is a one-line fix to land with them. H1–H3 share one root cause: an HTTP
  request served by the follower cannot reach the leader's live XMPP session.
  Every background job, push, routine and charge is now leader-only and cannot
  run twice.
- §0 is a code read, not a two-instance run: H1–H3 follow from the follower
  starting the gateway's `sessions` map empty and from `pauseDb` being set only
  in `initTopicFollow` on leader acquire; H4 is arithmetic. I did not start a
  stack to reproduce them, so they are stated as code conclusions, not live
  tests.
- One difference from the task Facts: `leader/lock.ts` and `leader/start.ts`
  already exist at `b447451b7` (the lock is effectively unchanged since; the
  `leader/start.ts` diff only adds retention and `initTopicFollow`). I treated
  the lock as the §3 design and audited the work on top of it.
- H4 predates this task: the 10-13 §2 total (3 s + 8 s) omitted the 5 s
  `SHUTDOWN_DRAIN_MS`, so the real worst case is 16 s against a 15 s force
  exit. Fix needs `deploy/coolify/docker-compose.app.yml` too, which is outside
  this task's Allowed files; I only wrote the recommendation.

### Round (fix round 1)

- Fixed finding 1 (should-fix): §0.1 now lists the H1 mechanism files with
  `file:line` — `approval-on-decided.ts:9-17`, its hook type
  `stop-types.ts:21-33` and the exact drop point (`createOnDecided:16`'s `?.`)
  in row 5, plus a new row 21 for the `delegate-run.ts:127-138`
  `Effect.runFork` room pump (classified harmless, leader-only).
- Nits 2–5 were left as they are: the brief says not to touch nits unless they
  sit in a line this round already changes, and none do.
- Tests: none added — the task is a docs-only audit and the finding changes
  prose and a table, not behaviour. No unit test was run for the same reason.
- `pnpm gate` after the edit: `GATE PASS` (2 changed files, all inside the
  Allowed files; install/format/lint/typecheck pass, effect/tests skipped for
  no source change).


## Review (written by Claude)

**Merged as reference.**
- Julio shelved the zero-downtime split on 2026-10-18 ("only fast stop for everyone").
- So this re-audit (§0, hazards H1–H4) is kept for the day two servers run at once. It isn't acted on now.

**Left open on purpose:**
- **The pre-review's should-fix:** the §0.1 table doesn't list the approval-follower mechanism (`stop-types.ts`, `approval-on-decided.ts:16`, the `delegate-run.ts:127` `Effect.runFork` pump). H1 in §0.2 covers it.
- **Four nits:**
  - the migration lock is the journal table's `ACCESS EXCLUSIVE` lock, not the row;
  - `topics/patch.ts` is at 166-177;
  - "Card correction skipped" is logged at `info`;
  - the release batch note.

Fix these before anyone uses §0 to plan a cutover.
