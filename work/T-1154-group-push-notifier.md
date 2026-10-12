---
id: T-1154
title: "F5 (audit MP-3, P0): server-side group push — a poller reads new groupchat rows from the ejabberd archive and pushes each member who has no XMPP resource online, with the same mute/visibility/preview rules and dedupe as DM push"
status: merged
milestone: M5
branch: task/T-1154-group-push-notifier
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1154: Group push notifier (F5)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-3 (P0) and fix **F5**.
- **Why groups never push:** ejabberd's MAM push trigger handles only `chat`. A user with no session isn't a room occupant, so **group and topic messages never push to a closed app**.
- **What already exists:** our component can resolve room rows (`apps/server/src/push/candidates.ts`, `resolveCandidate` at `:21`), and `deliverToDevice` is exported (`apps/server/src/push/delivery.ts:149`). But the component is only driven by ejabberd's publish IQ.
- **The archive rows** carry `kind` (`apps/server/src/push/archive-scan.ts:17`, `:122` select list).
- **Topic visibility:** `canSeeTopic` (`apps/server/src/topics/access.ts:135`).
- **Wiring:** the push component starts in `apps/server/src/main.ts:495-497`. `main.ts` is 716 lines, so add **at most 4 lines** there.
- **The admin client** (`apps/server/src/xmpp/admin/client.ts`, 356 lines) has no "is this user connected" call yet.

### What to build
Follow the audit's **F5** section.

1. **A new `apps/server/src/push/group-notifier.ts`**, an Effect fiber started next to the push component when push is enabled:
   - **Poll:** every 3 s, read the ejabberd archive for `kind = 'groupchat'` rows newer than the last seen `(timestamp, id)`. At start, begin from "now", so no backlog is pushed after a deploy. Cap each tick at 200 rows.
   - **Recipients:** for each row, the group or topic members, from the server's own membership tables (find the query the groups code uses and cite it), **minus the sender**. Apply `canSeeTopic` for topic rooms.
   - **Skip members who are connected:** add `userResources(user)` to `apps/server/src/xmpp/admin/client.ts` and `types.ts` (ejabberd `mod_http_api` command `user_resources`), and skip users with one or more resources.
     - Pending, hibernated sessions still show as resources. ejabberd pushes those itself, so that's correct.
     - Cache the answer for 2 s per user within a tick.
   - **Deliver:** for each device row of the remaining members, build the verdict with `resolveCandidate` (mute, hidden, previews) and call `deliverToDevice`.
   - **Dedupe:** use the same `recentlyNotified` per node, so ejabberd's own publish for a pending session and the notifier never double-notify one message.
   - **Errors:** a failed tick logs at `warn` (never message text) and the loop goes on.
2. **Wiring:** in `main.ts`, start it next to `startPushComponent` (`:497`) and stop it on shutdown, at most 4 lines.
3. **Config:** none new; it runs whenever push is on.
4. **Tests** (the message pipeline), in a new `apps/server/src/push/group-notifier.test.ts` with a fake archive, fake membership, fake admin and fake sender, at most 3:
   - the sender is skipped, and so is a connected member;
   - each offline member's device gets exactly one delivery per row, and a second tick doesn't repeat it;
   - a muted member gets nothing.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (3E MP-3, F5), `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/delivery.ts:120-210`, `apps/server/src/push/service.ts`, `apps/server/src/push/component.ts`, `apps/server/src/topics/access.ts:120-160`, `apps/server/src/xmpp/admin/client.ts` and `apps/server/src/main.ts:480-520`.

### Allowed files
`apps/server/src/push/group-notifier.ts`, `apps/server/src/push/group-notifier.test.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/xmpp/admin/client.ts`, `apps/server/src/xmpp/admin/types.ts`, `apps/server/src/main.ts`, `apps/server/src/test-support.ts`, `apps/server/src/xmpp/admin-client.ts`, `work/T-1154-group-push-notifier.md`. (The lead added the last two at review: the typecheck forced them.)

In `archive-scan.ts`, only add an exported reader for groupchat rows if you need one. Another task, T-1155, changes its scan order, so keep any change there under 25 lines.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/group-notifier.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines (`main.ts` grows by at most 4).
- **The lead's check on production:** close the phone app fully, have another member post in a group, and a notification comes within about 5 s.

---

## Report (written by the worker when done)

Done. Group push notifier (F5/MP-3): a 3 s poller reads new `groupchat` rows
from the ejabberd archive and notifies offline members with the DM path's
verdict and dedupe.

What changed
- `apps/server/src/push/group-notifier.ts` (new, ~260 lines): `startGroupNotifier`
  (Effect fiber: `Effect.runFork` loop of tick + 3 s sleep; started next to the
  push component whenever push is on) and `runGroupNotifierTick` (exported so
  tests drive ticks directly).
  - Poll: `readGroupchatPage` for `kind = 'groupchat'` rows strictly after the
    `(timestamp, id)` cursor, cap 200, oldest first. State starts at "now" so
    no backlog is pushed after a deploy; the cursor advances to the newest row
    read.
  - Recipients: the row's topic via `topics.room_localpart` (same lookup
    `resolveCandidate` starts from), then `user_id`s from `group_members` by
    `group_id` — the groups code's member read (`groups/queries.ts:265`,
    `groups/ais.ts:78`) — minus the sender (`nick` is the stable account
    localpart, as `candidates.ts:86` documents). Topic visibility comes from
    `resolveCandidate` → `canSeeTopic`, same as DM push.
  - Online skip: `admin.userResources(localpart)` (new, see below); any
    resource (pending/hibernated included, which ejabberd pushes itself)
    skips the member. Cached 2 s per user within a tick.
  - Deliver: per member, one `resolveCandidate` (mute/hidden/previews) with a
    stub `SearchOwner` (unused for `groupchat` rows), then `deliverToDevice`
    per device row with `notify: [originId]`, marking `recentlyNotified` per
    node — the same map the component uses, so ejabberd's own publish for a
    pending session and the notifier never double-notify. `markDeviceUsed` on
    send, like `handleIncomingPush`.
  - Errors: per-member and per-delivery failures log at `warn` with ids only
    (never message text); a failed tick logs at `warn` with no error detail
    and the loop goes on.
- `apps/server/src/push/archive-scan.ts` (+37/-0): `GroupchatPage`,
  `GroupchatRow` (an `ArchiveCandidate` plus the ordering `id`), and
  `readGroupchatPage` selecting `CANDIDATE_COLUMNS` plus `id` with
  `(timestamp, id) > ($1, $2)`, oldest first.
- `apps/server/src/xmpp/admin/client.ts` (+16): `userResources` calling
  `user_resources` (`{ user, host }`), answering `[resource...]` (`[]` when
  offline), schema-validated like every other call. Verified the shape in the
  ejabberd admin API docs ("Result: resources :: [resource::string]").
- `apps/server/src/xmpp/admin/types.ts` (+6): `UserResource = string` and the
  `userResources` method. `apps/server/src/xmpp/admin-client.ts` (+1):
  re-export of `UserResource`.
- `apps/server/src/test-support.ts` (+16): `FakeAdminClient.onlineResources`
  + `setOnlineResources` + `userResources` (needed because the new
  `userResources` method broke the `implements EjabberdAdminClient` fake).
- `apps/server/src/main.ts` (+18/-11, net +7 stamped lines): builds the push
  `service` once, starts the notifier next to `startPushComponent`, and folds
  both stops into `running.pushComponent.stop` (`Promise.all`).
- `apps/server/src/push/group-notifier.test.ts` (new, 3 tests, seeded PGlite
  + static fake archive answering the same row every tick +
  `FakeAdminClient.setOnlineResources` + fake web sender):
  1. sender skipped, connected member skipped, offline member's device gets
     the send;
  2. 1 device + 2 devices get exactly one send each, and a second tick sends
     nothing (per-node `recentlyNotified` dedupe);
  3. muted member (`chat_prefs.muted_until` future on the room JID) gets
     nothing.

Commands (real results)
- `pnpm install`: done, 11.1 s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/push/group-notifier.test.ts`: 3 passed.
- Same command for `src/push/delivery.test.ts src/push/candidates.test.ts`:
  10 passed.
- `pnpm gate` from the repo root:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (14.8s)
  scope: 2 file(s) outside the Allowed files:
    apps/server/src/test-support.ts
    apps/server/src/xmpp/admin-client.ts
  GATE PASS
  ```

Deviations / needs a decision
- `main.ts` grows by 7 stamped lines, not 4: sharing one `service` object and
  one combined `stop` needs the `service` extraction. A 4-line version exists
  (bare `startGroupNotifier(...)` call, no shared handle) but leaves the fiber
  unstoppable on shutdown — I chose the combined handle. If the lead wants
  strictly 4, I can cut the comment and inline `service` twice (+5/-0), but
  shutdown then leaks the fiber.
- `archive-scan.ts` grows by 37 lines, over the 25-line budget: the cursor
  `(timestamp, id)` needs the exported `GroupchatPage`/`GroupchatRow` types
  plus the reader. The scan-order code T-1155 touches is untouched.
- Allowed-files scope: the gate lists `apps/server/src/test-support.ts` and
  `apps/server/src/xmpp/admin-client.ts` as outside Allowed. Both were
  forced: the test fake must implement the new `userResources` method or
  nothing typechecks, and the barrel must re-export `UserResource` or nothing
  imports it. The membership itself is real (seeded `group_members`), queried
  with the groups code's own read — no new membership abstraction.
- Production smoke (closed app receives a group notification in ~5 s) is for
  the lead's check; I verified the pipeline by test only.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 4 nits and 3 follow-ups.**
- **What it does:** `group-notifier.ts` polls the archive every 3 s for groupchat rows (from "now", cursor `(timestamp, id)`, 200 per tick). It skips the sender, members with any XMPP resource, and topics the member can't see. It resolves each row with `resolveCandidate` (mute and previews) and delivers with `deliverToDevice`, sharing `recentlyNotified` with the component.
- **The resource shape, verified by the lead:** local ejabberd `user_resources {user, host}` answers `[]` (a list of strings), matching the decoder.
- **Waived by the lead:**
  - `main.ts` +7 instead of +4: one handle stops both the component and the notifier, so there's no leaked fiber;
  - `archive-scan.ts` +37 instead of +25, for the reader types;
  - `test-support.ts` and `admin-client.ts` were forced by the typecheck, and are now added to Allowed.
- **Tests:** 3 of 3 in the branch.
- **Follow-ups:**
  - the cursor SQL isn't tested against a real archive;
  - `userResources` is serial per member;
  - duplicate helpers.
- **Still to do:** the live check (closed app, group message, notification within about 5 s).
