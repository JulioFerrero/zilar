---
id: T-0054
title: "AIs in groups (server): add/remove an AI to a group, the gateway joins its rooms and replies when @mentioned"
status: review
milestone: M2
branch: task/T-0054-ai-in-groups-server
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0050, T-0053]
estimate: 2 days
---

# T-0054: AIs in groups (server)

## Spec (written by Claude, do not edit)

### Goal

The M2 milestone is "**first AI in a room**": an owner adds their AI to a group, and the AI replies when a person **@mentions** it (`docs/PROJECT_PLAN.md` §9, rule 1: "A person @mentions AIs: only those AIs reply"; rule 3: no mention, nobody replies for now). T-0053 added mentions (XEP-0372 references → `ChatMessage.mentions`). This task does the server side. The web UI to add an AI and show it in the member list and mention picker is T-0055.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §9, the "How AIs work together" rules 1–3 (search for "A person @mentions AIs")
- `apps/server/src/groups/service.ts` and `routes.ts`: `createGroup`, `addGroupMembers`, `removeGroupMember`, `getGroupDetail`, `getMembership`, the role checks, `setAffiliation`, `inviteNewMembers`, `mapXmppError`. Also `groups.test.ts`.
- `apps/server/src/db/schema.ts` and the `drizzle/` folder (migrations are generated with `pnpm --filter @galena/server db:generate`)
- `apps/server/src/agents/gateway.ts` (after T-0050: the fixed resource, `replaced`, superseded AIs, `handleIncoming`, `pumpSession`, `runSessionTurn`, read markers), `context.ts` (`buildDmContext` and its budgets), `reply.ts` (`runDmTurn`, failure texts, tool rules), and their tests
- `apps/server/src/ais/service.ts`: **read only**, for `findOwnedAi`, `listActiveAisForGateway`, `onAiLifecycle`. T-0052 is editing this file; don't touch it.
- `packages/xmpp-core/src/types.ts`: `joinRoom`, `leaveRoom`, `loadHistory` (`groupchat`), `sendMessage` with `replyTo` and `mentions`, `ChatMessage.mentions`, `fromNick`, `occupantId`

### Allowed files
- `apps/server/src/db/schema.ts` and one new generated migration in `apps/server/drizzle/` (plus its `meta/` snapshot and journal)
- `apps/server/src/groups/**`
- `apps/server/src/agents/gateway.ts`, `context.ts`, `reply.ts`, plus their tests (`*.test.ts` in that folder)
- `apps/server/src/app.ts`: only for wiring new dependencies into the groups routes or gateway, if needed
- `work/T-0054-ai-in-groups-server.md`

**Not allowed:** `apps/server/src/ais/**` (T-0052), `apps/web/**`, `apps/mobile/**`, `packages/**`, `docs/**`, `infra/**`. If you need any of them, stop and ask in the Report.

### Allowed dependencies
None.

### What to build

**1. Data.**
- A new table `group_ais`:
  - `group_id` (FK groups, on delete cascade);
  - `ai_id` (FK ais, on delete cascade);
  - `added_by` (FK user);
  - `added_at`.
  Primary key `(group_id, ai_id)`.
- Generate the migration with drizzle-kit. Don't hand-edit other migrations.
- AIs count toward `MAX_GROUP_MEMBERS` together with the people.

**2. Routes.**
- `POST /api/groups/:id/ais` with `{ aiId }`. The actor must be:
  - an owner or admin of the group (the same rule as adding members); **and**
  - the **owner of the AI** (`findOwnedAi`; anything else → 404, never revealing someone else's AI).
  An AI that's already there → 200, idempotent. Then:
  - `setAffiliation(room, aiJid, 'member')`;
  - insert the row;
  - emit a groups event so the gateway joins.
- `DELETE /api/groups/:id/ais/:aiId`. Allowed for the AI's owner, or a group owner or admin. It:
  - sets the affiliation to `none`;
  - deletes the row;
  - emits the event.
- `GET /api/groups/:id` (detail) adds `ais: [{ aiId, jid, name, ownerId }]`. The existing `members` stays unchanged, so the web keeps working.
- zod validation as the existing routes do.

**3. Gateway: rooms.**
- For every active AI, join each room it belongs to (`group_ais` joined with `groups`) with the nick = the AI's name. Do it on connect, on the groups events (join or leave live), and in `reconcile`.
- On `replaced` (T-0050), nothing extra: the session is gone.
- A room join failure is logged (ids only) and retried by `reconcile`. It never breaks the AI's DMs.

**4. Gateway: replying to mentions in a room.** For a `groupchat` message, the AI takes a turn **only if** all of these hold:
- it isn't the AI's own reflection (`outgoing`);
- it isn't from **any** AI: the sender's real JID starts with `ai-`, or it's an occupant whose real JID is unknown and whose nick matches an AI of the room. No AI-to-AI turns in M2; hop budgets are M4.
- it isn't delayed history: skip room history replayed on join (`<delay/>`, or older than the join time);
- its `mentions` include this AI's bare JID;
- the sender is a current **human member** of the group (checked against `group_members` by the real JID's user id). Rooms are non-anonymous members-only, so the real JID is known; if it isn't, skip.

The turn:
- one turn at a time per (AI, room), coalescing like DMs;
- a **per-room rate limit**: at most 6 turns per AI per room per 10 minutes, the rest dropped with one log line (ids only);
- context: the last 30 room messages from MAM (`groupchat`) within the same 24k-character budget, each prefixed with the sender's display name. The system prompt adds one line: it's in a group, it replies to the person who mentioned it, and it stays brief unless asked. Add `buildGroupContext` next to `buildDmContext`, sharing the prefix and budget helpers.
- The model call is the same LiteLLM path with the AI's capped virtual key. **No persona tools in groups**: only the owner may reshape the AI, and only in the DM.
- The reply is sent to the room (`groupchat`) with `replyTo` pointing at the triggering message and a mention of the sender. Failure texts are the same honest ones as in DMs, in the room.
- No drafts or streaming in groups: the drafts SSE is owner-only, and group streaming is a later task. Send `composing` and `paused` chat states in the room.
- No read markers in groups.

**5. Privacy and cost notes (code comments plus the Report).**
- Any human member may trigger the AI. The owner pays, capped by the AI's limits.
- The AI only sees the room messages sent while it's a member, plus the MAM history that membership grants.
- Log ids only: the AI id, group id and message id. Never bodies, names or keys.

### Tests (Vitest, no network; fake xmpp-core and LiteLLM as the existing tests do)
- Routes:
  - adding: an owner or admin with their own AI → 200, the affiliation is set, the row exists, the event fires;
  - a member (not admin) → 403;
  - someone else's AI → 404;
  - a duplicate → 200 idempotent;
  - the member cap counts AIs;
  - removal by the AI owner and by a group admin → OK; by others → 403;
  - the detail lists `ais`.
- Gateway:
  - it joins its rooms on connect, on the event, and in reconcile; it leaves on removal;
  - a mention by a human member → one turn, a groupchat reply with `replyTo` and a mention of the sender;
  - no mention → no turn;
  - a mention from another AI → no turn;
  - a mention in delayed history → no turn;
  - a mention from a non-member real JID → no turn;
  - the rate limit drops the 7th turn in 10 minutes;
  - a burst coalesces;
  - persona tools are not offered in groups;
  - DMs are unchanged: all the existing tests stay green.
- The context: sender names, the budget, oldest dropped first, the trigger always included.

### Live proof (you, safely)
Don't touch the running server on 3188 or its data, and send no messages to real users. The lead does the live check with Julio's OK. Give exact steps in the Report.

### Acceptance criteria
- [ ] Every check below passes, including the migration generation (`db:generate` produces no further diff after yours).
- [ ] An owner can add or remove their AI in a group; only a human member's mention triggers a reply, rate-limited; no AI-to-AI turns.
- [ ] DM behavior is unchanged.
- [ ] Only the Allowed files changed; logs contain ids only.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- The web UI (T-0055): the add-AI dialog, AIs in the member list and the mention picker.
- The listener mode ("no mention, the listener decides"), hop budgets, AI-to-AI handoffs (M4).
- Streaming drafts in groups; mobile.

## Report (written by the worker when done)

Implemented the server side of AIs in groups: `group_ais` membership, add/remove
routes, gateway room joins, and @mention-triggered group replies.

### What I did

**1. Data (`apps/server/src/db/schema.ts`, `drizzle/0008_sad_vulcan.sql`).**
New `group_ais` table: `(group_id, ai_id)` PK, `added_by` (FK user,
`onDelete: cascade` like the other membership FKs), `added_at`. Generated with
`pnpm --filter @galena/server db:generate`; a re-run reports "No schema
changes". Prettier `--write` applied to the generated journal/snapshot exactly
like the previously committed ones.

**2. Groups service/routes (`apps/server/src/groups/`).**
- New `apps/server/src/groups/events.ts`: in-process `onGroupAi` /
  `emitGroupAi` notifier (`ai-added` / `ai-removed`, ids only), mirroring
  `onAiLifecycle` in `ais/service.ts`.
- `service.ts`: `GroupDetail` gains `ais: [{ aiId, jid, name, ownerId }]`
  (sorted by name); `members` unchanged. `addGroupAi` (owner/admin of the group
  + owner of the AI via `findOwnedAi`, foreign AI answers the same 404 as a
  missing one; duplicate is a 200 no-op; `setAffiliation(room, aiJid,
  'member')` + row insert in one transaction; emits `ai-added`) and
  `removeGroupAi` (allowed for the AI owner even when no longer a group member,
  or a group owner/admin; affiliation `none` + row delete; emits `ai-removed`).
  People and AIs share `MAX_GROUP_MEMBERS`: `addGroupAi` counts both, and I
  also added the AI count to the `addGroupMembers` cap check, otherwise the
  "together" cap would only hold in one direction.
- `routes.ts`: `POST /api/groups/:id/ais` (`{ aiId }`, zod) and `DELETE
  /api/groups/:id/ais/:aiId`, same error style as the member routes.

**3. Gateway rooms (`apps/server/src/agents/gateway.ts`).**
- Each session tracks `rooms` (bare room JID -> `{ groupId, joinedAtMs, nick
  }`), per-room coalescing queues/busy flags, and per-room turn timestamps.
- `syncAiRooms` joins every room from `group_ais`+`groups` with the AI's name
  as nick, re-joins on a stale nick, leaves rooms no longer in the DB. Called
  after connect, on `ai-added`/`ai-removed` events, and in `reconcile` for
  already-connected sessions. Join failures log `{ aiId, groupId }` and are
  retried by `reconcile`; they never throw and never affect DMs.
- `replaced` clears room queues too; `stop` unsubscribes both notifiers.

**4. Group replies.** A `groupchat` message takes a turn only if: not
`outgoing`, non-empty, from a joined room, newer than join-minus-60s skew
(delayed replay carries its original stamp, live messages carry ~now), mentions
this AI's bare JID, sender is not `ai-*`, sender is `fromResolved`, and the
sender's JID is a current `group_members` JID (derived with the same
`localpartFor` provisioning uses). Unresolved senders are always skipped, which
covers both spec clauses (AI nick behind an occupant JID, and the
must-be-a-member rule). Per (AI, room): coalesced single-flight pump, max 6
turns per 10-min sliding window (7th+ dropped with one warn carrying aiId,
groupId, messageId), context via new `buildGroupMessages` (last 30 MAM
`groupchat` messages, same 24k budget helpers, `Name: body` prefixes, AI's own
as assistant, trigger always included), same LiteLLM path with the AI's capped
key, **no persona tools**, reply as `@Name text` `groupchat` with `replyTo` +
XEP-0372 mention of the sender, `composing`/`paused` states, same honest
failure texts posted in the room, no drafts, no read markers.

**Privacy/cost (also as code comments in `gateway.ts`):** any human member can
trigger the AI; the owner pays under the AI's capped key. The AI sees only
room traffic from while it is a member plus granted MAM history. All new log
lines carry ids only (aiId, groupId, messageId) — verified by leak assertions
in the tests.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0008_sad_vulcan.sql`,
  `drizzle/meta/0008_snapshot.json`, `drizzle/meta/_journal.json`
- `apps/server/src/groups/service.ts`, `routes.ts`, `events.ts` (new),
  `groups.test.ts`
- `apps/server/src/agents/gateway.ts`, `context.ts`, `reply.ts`,
  `gateway.test.ts`, `context.test.ts`, `reply.test.ts`
- `work/T-0054-ai-in-groups-server.md` (this report + status)

### Commands and real results
- `pnpm install`: ok (6.9s).
- `pnpm format:check`: pass (after `prettier --write` on touched files).
- `pnpm lint` (oxlint): pass, no warnings.
- `pnpm typecheck` (turbo, 9 tasks): pass. (One `exactOptionalPropertyTypes`
  error on `displayNameOf` fixed by widening its parameter type.)
- `pnpm exec turbo test --force --filter=@galena/server`: **37 files passed,
  5 skipped files; 472 tests passed, 7 skipped, 0 failed** (~2m18s). Includes
  10 new groups-route tests, 13 new gateway group tests, 8 context tests, 5
  `runGroupTurn` tests. One test bug of mine fixed along the way (owner adding
  someone else's AI is 404, not 403).
- `pnpm build`: pass (2 tasks).
- `pnpm --filter @galena/server db:generate`: "No schema changes, nothing to
  migrate".

### Deviations / decisions (spec was silent)
- `added_by` FK is `onDelete: cascade`, consistent with the other membership
  FKs. If the adder's account is deleted, the row goes with it.
- Disabled AIs can be added to a group (no status check on add); the gateway
  only joins rooms for `active` AIs, so a disabled AI just stays silent until
  re-enabled (a later `reconcile` picks it up).
- Room replies prepend `@Name ` so the XEP-0372 mention has a text span to
  point at (offsets are UTF-16 units, converted by xmpp-core on the wire).
- No `app.ts` change was needed: the gateway subscribes to `onGroupAi`
  internally, no new dependencies.

### Live proof steps (for the lead, do NOT run against :3188 data)
1. Start a scratch stack (empty DB + local ejabberd), create two users A and B
   as contacts, have A create an AI and a group with B.
2. `POST /api/groups/:id/ais { aiId }` as A -> 200, `ais` lists the AI;
   check ejabberd MUC affiliation of the AI JID is `member`.
3. As B, send a group message `@AI-name hello` with an XEP-0372 mention of the
   AI's bare JID -> the AI replies in the room mentioning B with `replyTo`.
4. Repeat without a mention -> silence; repeat from a non-member JID ->
   silence; send 7 mentions in 10 min -> 6 replies, 7th dropped.
5. `DELETE /api/groups/:id/ais/:aiId` as A -> 200, affiliation `none`.

### Blocked / needs a decision
Nothing blocking. One question for review: the spec's AI-sender rule names
"nick matches an AI of the room" for unknown-JID occupants, but the very next
rule skips every unknown real JID anyway, so I implemented a single
skip-unresolved with a comment citing both clauses. Say the word if you want
the nick check split out explicitly.

## Review (written by Claude)
