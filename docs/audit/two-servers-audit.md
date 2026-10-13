# Audit: two server instances during a rolling deploy (2026-10-13)

Docs only, no code change. Every claim cites `file:line`; where the answer needs a
running stack it is marked **suspected (check: …)**.

Why: `docs/deploy/zero-downtime-plan.md:25-36` moves the server to a Coolify
Dockerfile app. Coolify starts the new container, waits for its health check, then
stops the old one, so for about 5–30 s **two `zilar-server` processes run against
the same Postgres and ejabberd** (`zero-downtime-plan.md:36`). Anything a server
does on its own could then run twice, or lose its in-memory state when the old one
stops. This audit lists that work, then designs a Postgres advisory-lock leader.

## 1. Background work, timers, long-lived connections and in-memory state

| # | What (where) | Cadence / life | Two instances at once | Duplicate already prevented? |
| --- | --- | --- | --- | --- |
| 1 | Routines scheduler (`apps/server/src/routines/scheduler.ts:49,126-178`; wired `routines/wiring.ts:37-59`, `main.ts:714-721`) | tick 30 s, after the edge listens | two schedulers claim the same due rows | **Yes:** `UPDATE … WHERE … next_run_at = <read>` returns the row to one claimer only (`scheduler.ts:163-175`); the loser sees 0 rows. No duplicate run. |
| 2 | Approvals sweeper (`apps/server/src/approvals/sweeper.ts:37-43,91`; `main.ts:678-682`) | 60 s | two sweeps expire the same due rows | **Yes:** conditional `UPDATE … WHERE status='pending' AND expires_at < now RETURNING` (`approvals/queries.ts:206-209`); second sees nothing. |
| 3 | Action recovery loop (`apps/server/src/actions/recovery.ts:31,61`; `main.ts:687-690`) + the one startup `recoverStuck` (`main.ts:696-706`) | 5 min | both mark the same stuck `running` rows `failed` | **Yes:** conditional `UPDATE … WHERE status='running' AND started_at < cutoff` (`recovery.ts:92-96`). Two instances may audit one row at most once. |
| 4 | Agent gateway: one XMPP session per active AI (`apps/server/src/agents/gateway/sessions.ts:88-191`; `main.ts:659-672`) and its reconcile timer (`agents/gateway/lifecycle.ts:210-221`, `contracts.ts:74` = 60 s) | long-lived + 60 s | both log every AI in with resource `GATEWAY_RESOURCE` (`contracts.ts:101`), so both could answer a DM | **Mostly yes, by ejabberd:** the second login replaces the first; `on('replaced')` marks the AI `superseded` and the old process stops reconnecting it (`sessions.ts:148-150,337-347`). An in-flight turn may still finish (`sessions.ts:335-336`). No duplicate DM is sent. |
| 5 | Push component, XEP-0114 (`apps/server/src/push/component.ts:38-45`; `main.ts:488-548`) | long-lived outbound to `ejabberd:5347`, reconnects itself (`component.ts:69-73`) | two components connect as the same `push.<domain>` JID (`docker-compose.app.yml:211`) | **No application guard.** Suspected (check: coolify spike, `zero-downtime-plan.md:40`): ejabberd keeps one component per domain and drops the other, as it does for the gateway. If it accepts both, every DM push IQ is delivered twice. |
| 6 | Push group notifier (`apps/server/src/push/group-notifier.ts:23,248-260`; `main.ts:508`) | poll every 3 s | both poll the same archive and notify the same members | **No.** Its "seen" dedupe is in-process (`main.ts:506`, `group-notifier.ts:159`), so each instance has its own set; the cursor is in-process too (`group-notifier.ts:39,48-54`). Two `pollIntervalMs` apart → **duplicate group push**, and duplicates across instances are not suppressed by `recentlyNotified`. |
| 7 | Runner hub tunnel + approved-key refresh 30 s (`apps/server/src/machines/hub.ts:54,271`) + last-seen poll 60 s (`hub.ts:249,316-326`; `main.ts:628-653`) | long-lived listener + timers | runners split across two listeners; both write `last_seen_at` | Runners are keyed by machine (`hub.ts:333-335`), not deduped across instances. Losing the instance a runner is attached to drops its tunnel until it reconnects. `last_seen_at` writes are idempotent (`hub.ts:284-297`). Off by default (`docker-compose.app.yml:185`). |
| 8 | Topic-room sync retry (`apps/server/src/groups/room-sync-retry.ts:12,19-27`) | lazy 60 s `setInterval`, only after a failed sync | the old instance retries its own failed groups | The pending map is in-process (`room-sync-retry.ts:14`). Losing it is harmless: `syncTopicRoom` is idempotent (`room-sync-retry.ts:8-10`). |
| 9 | Room-subscription reconcile (`apps/server/src/topics/room-push.ts:192-209`; `main.ts:527-537`) | once at push startup | both call `change_room_option` on every room | **Yes:** setting an option to `'true'` twice is idempotent (`room-push.ts:209`). |
| 10 | Drafts hub, in-memory (`apps/server/src/drafts/hub.ts:156`; used `main.ts:592`, streamed `drafts/api.ts:64-108`) | per process; per-turn throttle timers (`drafts/hub.ts:118`) | a subscriber on instance A never sees drafts published on B | **No, by design** (`drafts/hub.ts:34-35`: "in-process, per server, no cross-server fan-out"). Cosmetic only — see §5. |
| 11 | Push delivery dedupe map (`main.ts:506`; read `push/archive-scan.ts:66`, `push/delivery.ts:63`) | per process, per node | two instances do not share it | **No.** Only matters where the same publish reaches both (§5). |
| 12 | `health-status` module state (`apps/server/src/health-status.ts:28`; read `health.ts:83`) | per process | follower reports push `unknown`/`offline` | Informational only; `/health`'s status code still reflects Postgres only (`health.ts:37-38,58`). |
| 13 | Account-deletion job, T-1261 task T-B | **not built yet** | n/a today | The grace row exists (`auth/deletion-request.ts:1-5,75-84`) but the job is held (`docs/audit/account-deletion-plan.md:468`). The plan already recommends an approvals-style sweeper (`account-deletion-plan.md:258-276`); it must be leader-only or claim atomically. |
| 14 | Postgres pools: main (`effect/sql.ts:79-84`) and archive (`main.ts:441-444`) | long-lived | both connect normally | Safe: plain reads/writes; no instance-wide state. |
| 15 | HTTP SSE streams: `/api/drafts/stream` only (`drafts/api.ts:100-107`) | one per open client | each instance holds its own subscribers | See §5. |

Net: the timers that mutate shared tables (1, 2, 3, 9) are already race-safe. The
two real hazards are the **push component** (5, suspected) and the **group push
notifier** (6, real duplicate); losing in-memory state (8, 10, 11) is harmless.

## 2. Startup and shutdown order

Startup is one Effect program; `index.ts:4` runs it with
`NodeRuntime.runMain(serverProgram, { teardown: serverTeardown })` (`main.ts:201-221`).
`startServer` (`main.ts:229-722`) runs, in order: config + logger (`:231-233`),
mailer (`:235-247`), DB and `registerSqlRuntime` (`:249-255`), **`runMigrations`
before anything listens (`:256`)**, stored mail settings (`:263-269`), storage-dir
checks (`:281-320`), auth (`:323`), action gateway + announcer (`:357-438`),
archive pool (`:441-444`), push config (`:449`), `createApp` (`:451-470`), **push
component** (`:488-548`), **agent gateway build** (`:574-609`), **HTTP listener**
(`serveEdgeOnNode`, `:614-621`), then the work that must not block the API:
runner hub (`:628-653`, forked), `gateway.start()` (`:659-672`, forked),
approvals sweeper (`:678-682`), recovery timer (`:687-690`) + one startup sweep
(`:696-706`), routine scheduler (`:714-721`).

Shutdown: the first SIGINT/SIGTERM makes `runMain` interrupt the main fiber
(`main.ts:181-194`); the scope finalizer runs `shutdownServer` (`:158-174`), which
arms `FORCE_EXIT_MS = 15_000` then `stopServer` (`main.ts:125-152`): HTTP close
(`:128-130`, waits `CONNECTION_GRACE_MS = 3_000` for live SSE, `:78-79`), runner hub
(`:131-133`), push component (`:134-136`), agent gateway `stop()` — drains in-flight
turns up to `AI_DRAIN_MS = 8_000` (`contracts.ts:86`; `lifecycle.ts:271-317`), then sweeper (`:140`),
recovery (`:141`), scheduler (`:142`), SQL runtime (`:146`), `closeDb` (`:148-150`).
Worst case ≈ 3 s + 8 s, force-exit at 15 s; the compose `stop_grace_period: 20s`
(`docker-compose.app.yml:125`) leaves room. `serverTeardown` turns a
signal-only exit into code 0 (`main.ts:201-207`), so Coolify does not see a crash.

## 3. Leader-lock design

**Lock.** One session-level Postgres advisory lock on one **dedicated connection**,
not on the pooled `effect/sql` client (a pool connection is recycled and would drop
the lock). Use the existing `postgres` dependency: `postgres(url, { max: 1 })`
(`apps/server/package.json:30`), `.reserve()` one connection, and run
`SELECT pg_try_advisory_lock($1, $2)` on it. Two-int form with a dedicated class
scope, so it never collides with the per-key `pg_advisory_xact_lock(hashtext(…))`
locks already in the database (the same precedent as `ENSURE_MODEL_LOCK_SCOPE`,
`ais/provisioning-keys.ts:302-304`). Session-level locks release automatically when
the connection closes, so a killed container hands over with no cleanup.

**Leader-only.** AI gateway (start + reconcile + sessions), routines scheduler,
approvals sweeper, action recovery loop, push component **and** group notifier,
runner hub, room-subscription reconcile, and the deletion sweep when Task T-B lands.
These are exactly the components that start after the HTTP listener in `main.ts`
(`:508-548,628-721`) plus `gateway.start()` (`:659`).

**Follower.** Everything stateless runs on both: all HTTP routes, auth, the
`/health` probe, all DB reads/writes that are already per-request and atomic. A
follower must **not** start the list above.

**Acquire / take over.** At boot, try the lock; if it is held, poll
`pg_try_advisory_lock` every 1 s. On success, start the leader-only set. The new
instance normally wins the lock about 1 s after the old one releases it — the old
one releases at the **start** of SIGTERM handling (step 1 below), so the handover
lands inside the ~5–30 s overlap. If the leader's lock connection drops (DB blip),
`postgres` raises on the reserved connection; the process logs and exits 1 so
`restart: unless-stopped` (`docker-compose.app.yml:124`) brings it back as a
follower rather than running leaderless.

**Shutdown order change.** Today `stopServer` closes HTTP first (`main.ts:128`).
The leader must instead stop leader-only work and drop the lock **first**, then
close HTTP, so the new leader never runs the scheduler/gateway while the old one
still is. One-line intent: `running.leader?.stepDown()` before the `closeHttp`
block, and `stopServer` keeps its current order after that.

**Drafts.** Because the gateway runs only on the leader, a client whose
`/api/drafts/stream` SSE landed on a follower sees no live draft (`drafts/hub.ts:34-35`,
`main.ts:592`). The final message still arrives over XMPP, so this is cosmetic; if it
matters, route that one path to the leader or move the hub to Postgres `NOTIFY`.

**Files a later task changes, with size.**
- New `apps/server/src/leader/lock.ts` (~120 lines): reserved connection, try-lock
  loop, `isLeader`, `onAcquire`/`onStepDown`, `stepDown()`.
- `apps/server/src/main.ts` (~60 lines): wrap the leader-only starts
  (`:508-548,628-721`) in the acquire callback; add `leader` to `RunningServer`;
  call `stepDown()` first in `stopServer`; close the lock last.
- A new `apps/server/src/main.test.ts` (~40 lines): a second program does not start
  leader-only work.
- `apps/server/src/config.ts` (a few lines): optional `LEADER_LOCK_SCOPE` override,
  defaulting to the constant.
- No compose, Dockerfile or migration change.

Estimated: 0.5–1 day, medium risk (shutdown reorder + a new long-lived connection).

## 4. Migrations in an overlap

`migrateSql` runs before the listener (`main.ts:256`) and applies each file in its
own transaction; a duplicate number fails the start (`effect/sql.ts:296-329`;
OPS-5/OPS-6, `docs/audit/ops-reliability-audit.md:65,76-79`). Within a migration,
`SET LOCAL lock_timeout = '5s'` scopes the wait to that file and releases it at
commit (`effect/sql.ts:184-196`). The journal is locked inside the migrator, so two
migrators cannot interleave, and an id at or below the tip is skipped with a warning
(`effect/sql.ts:296-300`, effect `Migrator.ts:258`).

In the overlap the **old server does not migrate again** — it migrated at its own
start — so only the new one runs files. The risk is the old process still serving
queries while the new schema is live, and a DDL file taking a long lock on a table
the old process reads. That is the whole reason for the expand/contract rule
(`zero-downtime-plan.md:23`): every release must be additive and backward
compatible — no `DROP`/`RENAME` of anything the running old code still uses, new
columns nullable or defaulted, backfill and cleanup in **later** releases. With
that rule the overlap is safe; without it, an `ALTER TABLE` can block the old
server's queries for up to the 5 s `lock_timeout`, after which the new container
fails its migration and exits (`lock_timeout` → migration error →
`restart: unless-stopped` loop; OPS-5, `ops-reliability-audit.md:67-74`).

## 5. Other things that make two instances unsafe

- **In-memory rate limits.** Better Auth uses `storage: 'memory'`
  (`apps/server/src/auth/auth.ts:102-111`) and the app-wide limiters are per process
  (`rate-limit.ts:13-16`). For a 30 s overlap the effective limit doubles only for a
  caller who lands on both instances; every rule is a low-stakes abuse cap, so this
  is acceptable and already documented (`rate-limit.ts:14-15`). Not a correctness bug.
- **OTP flow.** Safe across instances: Better Auth stores the OTP hashed and its
  attempts in Postgres (`auth.ts:139-143`), so verification does not depend on
  in-process state. Only the send-OTP *rate cap* is per process (`auth.ts:106`).
  `pendingInviteCodes` (`auth.ts:76`) is consumed inside the sign-up transaction on
  the instance that handled the request, so it is safe.
- **Drafts SSE subscribers on the old instance.** A client keeps its SSE open on the
  old process until it stops; drafts published by the new leader's gateway never
  reach it (`drafts/hub.ts:34-35`). The live typing indicator goes quiet for at most
  the overlap, then the SSE closes on shutdown and the client reconnects. The final
  message is unaffected. Cosmetic.
- **Session cookie cache.** `profileVersions` is in-memory (`auth.ts:72,123`), so a
  profile change on one instance is invisible to the other and its signed
  `session_data` cookie can carry the old user for up to 5 min (`auth.ts:112-124`).
  Same worst case the cache already allows (`auth.ts:113-115`); low impact.
- **Runner hub.** If enabled, two listeners accept runners; a runner attached to the
  old one reconnects after it stops (`hub.ts:330-344`). No duplicate side effect
  (`last_seen_at` is idempotent, `hub.ts:284-297`). Off by default.
- **`/health` on the follower** reports `push: 'unknown'` until the leader's state is
  visible, because `health-status` is per process (`health-status.ts:28`). The status
  code is unaffected (`health.ts:37-38`), but an uptime check that reads the push
  field (OPS-2, `ops-reliability-audit.md:126`) should be told the leader design, or
  the field should read `leader: true/false`.

## 6. Recommendation

Build the leader lock (§3) **as part of** the stack split, before the push
component's group-notifier path is exposed to two instances (§1 row 6). The
timers that only write shared tables need no change. Expand/contract (§4) stays a
written release rule.
