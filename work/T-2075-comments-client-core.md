---
id: T-2075
title: "Cut comments (client-core): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2075-comments-client-core
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2075: Comment cut — client-core

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2106 comment lines in 76 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **1053** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `packages/client-core/src/api-effect.ts`
- `packages/client-core/src/atom-store.ts`
- `packages/client-core/src/composer-drafts.ts`
- `packages/client-core/src/errors.ts`
- `packages/client-core/src/foreground-hooks.ts`
- `packages/client-core/src/groups-api.ts`
- `packages/client-core/src/people-handle-search.ts`
- `packages/client-core/src/people-search.ts`
- `packages/client-core/src/store/actions.ts`
- `packages/client-core/src/store/activity-refresh.ts`
- `packages/client-core/src/store/ai-cards.ts`
- `packages/client-core/src/store/chat-list-cache.ts`
- `packages/client-core/src/store/chat-rows.ts`
- `packages/client-core/src/store/connect.ts`
- `packages/client-core/src/store/ctx.ts`
- `packages/client-core/src/store/delete-own.ts`
- `packages/client-core/src/store/delivered.ts`
- `packages/client-core/src/store/draft-events.ts`
- `packages/client-core/src/store/draft-stream.ts`
- `packages/client-core/src/store/folders.ts`
- `packages/client-core/src/store/group-actions.ts`
- `packages/client-core/src/store/groups.ts`
- `packages/client-core/src/store/history-core.ts`
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/index.ts`
- `packages/client-core/src/store/last-read.ts`
- `packages/client-core/src/store/ledger-edits.ts`
- `packages/client-core/src/store/ledger-history-ingest.ts`
- `packages/client-core/src/store/ledger-identity.ts`
- `packages/client-core/src/store/ledger-ids.ts`
- `packages/client-core/src/store/ledger-incoming.ts`
- `packages/client-core/src/store/ledger-mutators.ts`
- `packages/client-core/src/store/ledger-reactions.ts`
- `packages/client-core/src/store/ledger-routine-bump.ts`
- `packages/client-core/src/store/ledger-signatures.ts`
- `packages/client-core/src/store/ledger-types.ts`
- `packages/client-core/src/store/ledger.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/lifetime.ts`
- `packages/client-core/src/store/message-cache.ts`
- `packages/client-core/src/store/online.ts`
- `packages/client-core/src/store/pins.ts`
- `packages/client-core/src/store/polling.ts`
- `packages/client-core/src/store/ports.ts`
- `packages/client-core/src/store/prefs.ts`
- `packages/client-core/src/store/previews.ts`
- `packages/client-core/src/store/prune.ts`
- `packages/client-core/src/store/reads.ts`
- `packages/client-core/src/store/row-helpers.ts`
- `packages/client-core/src/store/rows.ts`
- `packages/client-core/src/store/send-failure.ts`
- `packages/client-core/src/store/send.ts`
- `packages/client-core/src/store/send/album.ts`
- `packages/client-core/src/store/send/attachment.ts`
- `packages/client-core/src/store/send/context.ts`
- `packages/client-core/src/store/send/forward.ts`
- `packages/client-core/src/store/send/outbox.ts`
- `packages/client-core/src/store/send/pipeline.ts`
- `packages/client-core/src/store/send/retry-text.ts`
- `packages/client-core/src/store/send/sticker.ts`
- `packages/client-core/src/store/send/text.ts`
- `packages/client-core/src/store/send/voice.ts`
- `packages/client-core/src/store/sender-avatar.ts`
- `packages/client-core/src/store/session-check.ts`
- `packages/client-core/src/store/suspend.ts`
- `packages/client-core/src/store/test-ctx.ts`
- `packages/client-core/src/store/topic-rows.ts`
- `packages/client-core/src/store/typing.ts`
- `packages/client-core/src/task-steps.ts`
- `packages/client-core/src/topics-api.ts`
- `packages/client-core/src/use-action.ts`
- `packages/client-core/src/use-delayed.ts`
- `packages/client-core/src/use-media-retry.ts`
- `packages/client-core/src/use-query.ts`
- `packages/client-core/src/use-smooth-text.ts`
- `work/T-2075-comments-client-core.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1053 lines are removed.

---

## Report (written by the worker when done)

### What I did

Read `docs/COMMENTS.md` and `AGENTS.md` first, then edited comments only in all 76 Allowed files (75 source files plus this task file).

- Comment lines in the group: **2,106 → 1,036**, so **1,070 comment lines removed** (target 1,053).
- Total source lines in the group: **10,782 → 9,711** (**1,071 fewer**).
- Deleted task IDs (`T-…`), history ("moved unchanged", "size split", "line budget"), narration, JSDoc that repeated parameters and section banners.
- Kept and shortened the WHY comments: security/privacy (untrusted media URLs, no raw error text, no logs), permissions (who may post/read/join), protocol/data invariants (origin ids, archive ids, status ladders, outbox resend and dedupe rules, XEP ids), platform/library workarounds (StrictMode, BigInt/postgres.js, `crypto.randomUUID` polyfill, stale presence) and units/limits (ms, character counts, 1–50 ids, caps).
- No code, string, import, type or formatting change. I checked the diff mechanically: every changed line is a comment line or a blank line. No tests were run individually because no test file and no source (non-comment) line changed.

### Checks run

`pnpm gate` from the repo root (final code, before the report edit):

```
gate: 76 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.9s)
PASS  lint  (1.4s)
PASS  typecheck  (3.8s)
PASS  effect  (4.6s)
PASS  build @zilar/server  (0.8s)
PASS  tests @zilar/client-core  (20.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`git diff main...HEAD --shortstat`: `76 files changed, 1075 insertions(+), 1870 deletions(-)`. The insertions include this report; the 75 source files alone are 1,071 lines shorter.

### Kept comments longer than 3 lines

Each line is `file:line` — reason.

- `packages/client-core/src/api-effect.ts:10` — abort semantics match `fetch`
- `packages/client-core/src/atom-store.ts:74` — selector re-render rule
- `packages/client-core/src/errors.ts:18` — untrusted error mapping
- `packages/client-core/src/foreground-hooks.ts:32` — protocol check cadence
- `packages/client-core/src/foreground-hooks.ts:77` — refresh cadence, failed call
- `packages/client-core/src/groups-api.ts:23` — shared API boundary
- `packages/client-core/src/people-handle-search.ts:7` — debounce, rate limit, privacy
- `packages/client-core/src/people-handle-search.ts:22` — handle normalisation
- `packages/client-core/src/people-handle-search.ts:63` — request ordering
- `packages/client-core/src/people-handle-search.ts:123` — StrictMode workaround
- `packages/client-core/src/people-handle-search.ts:196` — Enter/debounce contract
- `packages/client-core/src/store/activity-refresh.ts:13` — which events count as activity
- `packages/client-core/src/store/activity-refresh.ts:40` — burst fetch timer
- `packages/client-core/src/store/chat-rows.ts:1` — preview id/archive id invariant
- `packages/client-core/src/store/chat-rows.ts:24` — merge precedence
- `packages/client-core/src/store/chat-rows.ts:56` — presence source and prefs
- `packages/client-core/src/store/ctx.ts:42` — per-app hook boundary
- `packages/client-core/src/store/ctx.ts:54` — mobile context rebuild
- `packages/client-core/src/store/ctx.ts:107` — poll gate
- `packages/client-core/src/store/ctx.ts:115` — per-user outbox isolation
- `packages/client-core/src/store/ctx.ts:126` — one status writer
- `packages/client-core/src/store/delivered.ts:1` — delivery mark protocol
- `packages/client-core/src/store/delivered.ts:30` — BigInt/postgres.js workaround
- `packages/client-core/src/store/delivered.ts:41` — debounce and safety
- `packages/client-core/src/store/delivered.ts:92` — status ladder
- `packages/client-core/src/store/delivered.ts:133` — delivered ladder
- `packages/client-core/src/store/group-actions.ts:189` — web/mobile refresh difference
- `packages/client-core/src/store/groups.ts:13` — cache keyed by group id
- `packages/client-core/src/store/groups.ts:25` — load once, force rule
- `packages/client-core/src/store/groups.ts:66` — archived topic rule
- `packages/client-core/src/store/history-core.ts:31` — duplicate archive rows
- `packages/client-core/src/store/history-core.ts:54` — per-room joining
- `packages/client-core/src/store/history-core.ts:69` — superseded pending chat
- `packages/client-core/src/store/history.ts:46` — archive alias vs wire id
- `packages/client-core/src/store/history.ts:64` — overlapping history pages
- `packages/client-core/src/store/history.ts:278` — rekeyed question card jump
- `packages/client-core/src/store/incoming.ts:277` — same-object perf contract
- `packages/client-core/src/store/ledger-edits.ts:27` — live-only routine bump
- `packages/client-core/src/store/ledger-history-ingest.ts:165` — batch working copy
- `packages/client-core/src/store/ledger-history-ingest.ts:226` — merge cost
- `packages/client-core/src/store/ledger-ids.ts:183` — origin-id cross-sender invariant
- `packages/client-core/src/store/ledger-incoming.ts:32` — voice URL leaks viewer IP
- `packages/client-core/src/store/ledger-incoming.ts:185` — card mapping, AI-only rule
- `packages/client-core/src/store/ledger-routine-bump.ts:8` — fresh object vs real change
- `packages/client-core/src/store/ledger-types.ts:52` — origin claim scope
- `packages/client-core/src/store/ledger-types.ts:61` — correction card order
- `packages/client-core/src/store/lifecycle.ts:117` — resume contract
- `packages/client-core/src/store/message-cache.ts:19` — device-only URLs never stored
- `packages/client-core/src/store/message-cache.ts:70` — settled messages only
- `packages/client-core/src/store/message-cache.ts:109` — lenient pins decode
- `packages/client-core/src/store/message-cache.ts:180` — open chat kept outside cap
- `packages/client-core/src/store/message-cache.ts:214` — oldest-first trimming
- `packages/client-core/src/store/message-cache.ts:255` — corrupt cache never breaks start
- `packages/client-core/src/store/online.ts:12` — outbox flush on every online path
- `packages/client-core/src/store/online.ts:28` — rebound resend
- `packages/client-core/src/store/pins.ts:86` — untrusted media trust rule
- `packages/client-core/src/store/polling.ts:138` — push burst coalescing
- `packages/client-core/src/store/ports.ts:41` — numeric archive id
- `packages/client-core/src/store/ports.ts:46` — origin ids, 1 to 50
- `packages/client-core/src/store/ports.ts:106` — session check outcomes
- `packages/client-core/src/store/prefs.ts:31` — optimistic rollback merge
- `packages/client-core/src/store/previews.ts:9` — bounded reconnect preview
- `packages/client-core/src/store/prune.ts:1` — inactive chat cap
- `packages/client-core/src/store/prune.ts:10` — skip in-flight and drafts
- `packages/client-core/src/store/reads.ts:1` — numeric marks, best-effort storage
- `packages/client-core/src/store/reads.ts:62` — peer read mark ladder
- `packages/client-core/src/store/row-helpers.ts:1` — preview id and name invariant
- `packages/client-core/src/store/rows.ts:20` — recency sort rule
- `packages/client-core/src/store/send-failure.ts:3` — no raw error text
- `packages/client-core/src/store/send.ts:1` — deadline and run token
- `packages/client-core/src/store/send/album.ts:3` — `randomUUID` polyfill
- `packages/client-core/src/store/send/album.ts:12` — album marker grouping
- `packages/client-core/src/store/send/outbox.ts:8` — outbox caps and dedupe
- `packages/client-core/src/store/send/outbox.ts:272` — resend reasons
- `packages/client-core/src/store/send/voice.ts:26` — retry keeps bytes
- `packages/client-core/src/store/sender-avatar.ts:17` — member JID localpart
- `packages/client-core/src/store/sender-avatar.ts:26` — picture fallback
- `packages/client-core/src/store/session-check.ts:22` — revoked session handling
- `packages/client-core/src/store/suspend.ts:20` — wake vs stale status
- `packages/client-core/src/store/topic-rows.ts:18` — malformed topic rows
- `packages/client-core/src/store/topic-rows.ts:85` — General row id
- `packages/client-core/src/store/typing.ts:1` — per-sender clearing fibers
- `packages/client-core/src/store/typing.ts:34` — `aiStatus` wiring
- `packages/client-core/src/task-steps.ts:35` — log-gone fallback
- `packages/client-core/src/topics-api.ts:18` — older-server normalisation
- `packages/client-core/src/topics-api.ts:61` — server trims fields
- `packages/client-core/src/use-action.ts:1` — run modes, fixed error text
- `packages/client-core/src/use-action.ts:40` — stable identity, no provider
- `packages/client-core/src/use-delayed.ts:17` — delayed paint
- `packages/client-core/src/use-media-retry.ts:5` — 404 backoff
- `packages/client-core/src/use-media-retry.ts:12` — local preview sources
- `packages/client-core/src/use-media-retry.ts:115` — retry state machine
- `packages/client-core/src/use-query.ts:1` — deps and interrupt semantics
- `packages/client-core/src/use-smooth-text.ts:4` — reveal behaviour

Note: `groups-api.ts:23` etc. are the line of the `/**` or first `//` of the kept block.

### Notes for the lead

- No code line changed; the mechanical diff check reported 0 non-comment changed lines.
- One comment inside a `.pipe(...)` (`history.ts`, boot preview) had to stay: removing it made Prettier collapse the call into a different line layout, which would have been a code-format change. It is kept as a one-line WHY.
- No single test file was run; the gate ran the full `@zilar/client-core` nearest tests and passed.
- Nothing is blocked.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +799 -1870 net -1071; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
