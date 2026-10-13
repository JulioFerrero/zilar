---
id: T-1306
title: "Audit: what breaks when two server instances run side by side for ~30 s during a rolling deploy — list every background job and long-lived connection, and design a Postgres advisory-lock leader so singleton work runs on one instance and hands over on shutdown"
status: merged
milestone: M5
branch: task/T-1306-singleton-jobs-audit
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1306: Two servers at once (audit and design, no code)

## Spec (written by Claude, do not edit)

### Why
`docs/deploy/zero-downtime-plan.md` Phase 2 moves the server to a Coolify Dockerfile app with rolling updates. The new container starts while the old one still runs, Coolify waits for its health check, then stops the old one. For that window, about 5–30 s, **two servers run against the same postgres and ejabberd**. Anything the server does on its own could then happen twice. For example:
- two AI gateways logged in as the same AI could each answer;
- two routine schedulers could each post;
- two push scanners could each notify.

Background work found by a quick search (not complete; find the rest):
- `apps/server/src/routines/scheduler.ts`;
- `apps/server/src/groups/room-sync-retry.ts`;
- `apps/server/src/machines/hub.ts`;
- `apps/server/src/actions/recovery.ts`;
- `apps/server/src/approvals/sweeper.ts`;
- the agents gateway (`apps/server/src/agents/gateway/`);
- the push component (`apps/server/src/push/component.ts`, XEP-0114, one connection per domain, reconnects on its own at `:69-72`);
- the drafts hub (`apps/server/src/drafts/hub.ts`, in memory);
- the deletion job (T-1261).

### What to deliver
`docs/audit/two-servers-audit.md`, at most about 250 lines, with:
1. **A table of every background job, timer, long-lived outbound connection and in-memory state in the server.** For each: `file:line`; what it does; what happens if two instances run it at once (duplicate side effect, lost state, harmless); whether something already prevents duplicates (`FOR UPDATE SKIP LOCKED`, a unique constraint, an idempotency key; cite it).
2. **Startup and shutdown order** (`apps/server/src/main.ts`, `index.ts`): when each job starts, what SIGTERM does, and how long a graceful stop takes (`stop_grace_period` is 20 s in the compose file).
3. **A leader-lock design:**
   - a Postgres session advisory lock (`pg_try_advisory_lock`) held on one dedicated connection;
   - which jobs and connections run only on the leader (the AI gateway, the scheduler, the sweepers, the push component);
   - how the new instance waits, polls the lock every 1 s, and takes over within about 1 s of the old one releasing it on SIGTERM (or its connection dropping);
   - what HTTP requests may do on a non-leader (everything stateless, yes).
   - Name the exact files a later task would change, and estimate the size.
4. **Migrations in an overlap:** what the migrator does when the new server migrates while the old one runs (`apps/server/src/effect/sql.ts`: the lock on the journal), and what that means for the expand/contract rule.
5. **Anything else that makes two instances unsafe**: in-memory rate limits (Better Auth `storage: 'memory'`, `apps/server/src/auth/auth.ts:102-111`), the OTP flow, drafts SSE subscribers on the old instance. Say for each whether it matters for a 30 s overlap.

**No code changes.**

### Read first
`AGENTS.md`, `docs/deploy/zero-downtime-plan.md`, `docs/audit/ops-reliability-audit.md` (OPS-3, OPS-5), and the files above.

### Allowed files
`docs/audit/two-servers-audit.md`, `work/T-1306-singleton-jobs-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The audit exists, every claim cites `file:line`, and the gate passes.

---

## Report (written by the worker when done)

### What I did
Wrote `docs/audit/two-servers-audit.md` (176 lines, no code). It has the five
requested parts: (1) a table of every background job, timer, long-lived connection
and piece of in-memory state, each with `file:line`, its behaviour under two
instances and any existing duplicate guard; (2) the startup/shutdown order from
`main.ts`/`index.ts` with the timing constants; (3) a `pg_try_advisory_lock`
leader design (dedicated reserved connection, 1 s poll, leader-only job list,
stateless HTTP on followers, shutdown reorder, exact files and size); (4) what the
migrator does in an overlap and what that means for expand/contract; (5) the other
hazards (in-memory rate limits, OTP, drafts SSE, session cookie cache, runner hub,
`/health` push field).

### Key findings
- Timers that write shared tables are already race-safe: routines (`scheduler.ts:163-175`),
  approvals (`queries.ts:206-209`), action recovery (`recovery.ts:92-96`), room
  reconcile (`room-push.ts:209`).
- Two real hazards: the **group push notifier** duplicates across instances
  (in-process cursor + `recentlyNotified`, `main.ts:506`, `group-notifier.ts:39,159`),
  and the **push component** has no application guard (suspected: ejabberd keeps one
  connection per domain — spike already listed in `zero-downtime-plan.md:40`).
- The agent gateway is protected by XMPP resource replacement + the `replaced`
  stand-down (`sessions.ts:148-150,337-347`).
- The deletion job (T-1261 T-B) is not built yet; the plan (`account-deletion-plan.md:258-276`)
  recommends an approvals-style sweeper that must be leader-only.

### Files changed
- `docs/audit/two-servers-audit.md` (new)
- `work/T-1306-singleton-jobs-audit.md` (status + this Report)

### Commands run
- `pnpm install` — done, 18.2 s, no errors (one pre-existing peer warning:
  `@types/react-dom` vs `@types/react` in `apps/mobile`).
- `pnpm gate` (from the repo root), real summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No single tests were run: the task is docs-only, so there is nothing to test and
  the gate's nearest-test step skipped (`effect` has no source change).

### Problems / deviations
- None against the spec. The spec asks for "at most about 250 lines"; the audit is
  176.

### Open questions
- None blocking. One decision is left to the design task, not this audit: whether
  `/api/drafts/stream` should be routed to the leader or the hub made cross-instance
  via Postgres `NOTIFY` (noted in §3); and whether `/health` should expose a
  `leader: true/false` field so the planned uptime check (OPS-2) does not read a
  follower's `push: 'unknown'` as an outage.

### Round (fix round)
- **Finding 1 (should-fix)** — fixed. `docs/audit/two-servers-audit.md:111` called
  `apps/server/src/main.test.ts` an "existing test", but that file does not exist
  (nothing under `apps/server/src` imports `main.ts`). Reworded to "A new
  `apps/server/src/main.test.ts`", so a later task knows to create it. Commit:
  `T-1306: fix finding 1 - reference main.test.ts as a new test`.
- **Findings 2 and 3 (nits)** — left as they are. They sit on lines this round did
  not otherwise change (line 88, and the bare-basename citations), and the
  fix-round rule is not to touch nits outside a changed line.
- **Tests** — none added or changed: the task is docs-only and the finding
  describes no behaviour to test.
- **Gate** (re-run from the repo root after the fix), real summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.0s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (5 nits).**
- `docs/audit/two-servers-audit.md` (176 lines):
  - a table of 13 background jobs, connections and in-memory state, with `file:line`;
  - the real duplicates in an overlap are the AI gateway, the routines scheduler and the push group notifier;
  - a leader-lock design (`apps/server/src/leader/lock.ts`, `pg_try_advisory_lock` polled every 1 s; the old server steps down before closing HTTP).
- It feeds the server task in phase 2 of `docs/deploy/zero-downtime-plan.md` (not specced yet; Julio paused new tasks).
