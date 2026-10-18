---
id: T-1992
title: "Permissions: a block or contact removal can't be undone by re-accepting the old request; a channel subscriber can't list the channel's audience through the General topic's members — with tests"
status: merged
milestone: M5
branch: task/T-1992-contacts-channel-edges
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-1992: Contacts and channel audience edges

## Spec (written by Claude, do not edit)

### Why
These two fixes come from the lead's private security review of 2026-10-18 (T-1985). Permissions are crucial, so tests are required.
1. **Re-accept undoes a block.** Accepting an already accepted contact request runs an "idempotent repair" that re-adds the contact pair and re-syncs both rosters. A block or a contact removal deletes the pair but leaves that request `accepted`. So re-accepting the old request brings the contact back.
2. **The channel audience leaks.** For a channel, the group routes deliberately show subscribers only the owner and admins. But the General topic's members route lists everyone.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Accepting a request: `contact-requests/decide.ts` (159 lines).**
  - An `accepted` row passes the status check (`:39-41`).
  - The repair (`:84-95`) calls `addContactPair(...)` and `syncRoster(...)` for both users. It has no block check.
- **Blocking: `blocks/service.ts` (257 lines).**
  - The block transaction cancels only `status = 'pending'` requests between the pair (`:165-169`).
  - It then deletes the contact rows in both directions (`:170-175`).
- **Removing a contact: `contacts/service.ts` (369 lines).** `removeContact` (`:84-99`) deletes the contact rows and touches no request row.
- **The General topic's members: `topics/queries.ts` (119 lines).** `listTopicMembers` checks `requireVisibleTopic` first. For General (`:60-75`) it then returns every `group_members` row with the user's name, with no check for channels.
- **The group routes' channel rule.**
  - `groups/api.ts:177-179` returns `members: []` to a channel subscriber (role `member`).
  - `groups/queries.ts:170-176` filters out `role === 'member'` rows for a viewer who is not a manager.
- **Existing tests:** `contact-requests/contact-requests.test.ts`, `blocks/blocks.test.ts`, `contacts/contacts.test.ts` and `topics/public-members.test.ts`.

### Steps
1. **Undo the request with the pair.**
   - In the block transaction, set every `accepted` request between the pair to `status = 'cancelled'` too, and set `decided_at`.
   - Do the same in `removeContact`, inside a transaction with the delete.
   - In `decide.ts`, run the repair only when the pair has no block; `blocks/service.ts` may already export a helper for that check.
2. **Hide the channel audience.** In `listTopicMembers`, when the topic is General and its group is a channel, apply the same rule as `groups/queries.ts:170-176`: a viewer who is not an owner or admin sees only owners and admins. Check `countTopicMembers` and the topic views for the same leak, and apply the same rule there.
3. **Tests (permissions are crucial).** Add each test to the nearest existing test file:
   - block, then re-accept: no contact row comes back;
   - remove a contact, then re-accept: no contact row comes back;
   - a channel subscriber's General members list holds only owners and admins.
4. **Keep files small.** Every file must stay at or under 400 lines.

### Allowed files
- `apps/server/src/contact-requests/decide.ts`
- `apps/server/src/contact-requests/contact-requests.test.ts`
- `apps/server/src/blocks/service.ts`
- `apps/server/src/blocks/blocks.test.ts`
- `apps/server/src/contacts/service.ts`
- `apps/server/src/contacts/contacts.test.ts`
- `apps/server/src/topics/queries.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/public-members.test.ts`
- `work/T-1992-contacts-channel-edges.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/contact-requests src/blocks src/contacts src/topics/public-members.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The three tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did
- **Block:** `blockUser` now cancels `accepted` contact requests between the pair as
  well as `pending` ones (same transaction, `decided_at` set).
- **Remove contact:** `removeContact` deletes the pair and cancels the pair's
  `accepted` requests in one `withTransaction`. The update runs only after the
  delete returned rows, so an unknown target still has no effect before its 404.
- **Accept:** `acceptContactRequest` checks `pairHasBlock` (already exported by
  `blocks/service.ts`) before the idempotent repair and skips `addContactPair` +
  both roster syncs while either side blocks the other.
- **Channel audience:** `listTopicMembers` looks up the group kind and the
  viewer's role for General; when the group is a channel and the viewer is not an
  owner or admin, the query returns only `owner`/`admin` rows.
- `countTopicMembers` and the topic view builders (`loadTopicViewParts`) apply the
  same narrowing to a channel's General audience. `countTopicMembers` moved from
  `topics/views.ts` to `topics/queries.ts` (and is re-exported from `views.ts`) to
  keep `views.ts` under 400 lines.
- **Tests:** added a block-then-re-accept test (`blocks.test.ts`), a
  remove-then-re-accept test (`contacts.test.ts`) and a channel-subscriber
  audience test covering `listTopicMembers`, `toTopicViews` and `memberCount`
  (`public-members.test.ts`).

Files changed (all inside the Allowed files):
`contact-requests/decide.ts`, `blocks/service.ts`, `blocks/blocks.test.ts`,
`contacts/service.ts`, `contacts/contacts.test.ts`, `topics/queries.ts`,
`topics/views.ts`, `topics/public-members.test.ts`,
`work/T-1992-contacts-channel-edges.md`.

### Checks run
- `pnpm install`: done, 43s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks/blocks.test.ts`:
  4 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contacts/contacts.test.ts`:
  2 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-members.test.ts`:
  6 passed.
- `pnpm --filter @zilar/server exec vitest run src/contact-requests src/blocks src/contacts src/topics/public-members.test.ts --reporter=dot --maxWorkers=2`:
  4 files passed, 22 tests passed.
- `pnpm gate` (final):
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (3.4s)
PASS  format  (3.0s)
PASS  lint  (1.9s)
PASS  typecheck  (8.9s)
PASS  effect  (5.4s)
PASS  tests @zilar/server  (113.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead
- **Topic-view deviation:** `toTopicViews`/`toTopicView` take no viewer, and their
  callers (`topics/api.ts`, `chats/list-handler.ts`) are outside the Allowed files,
  so a channel's General `memberIds`/`memberCount` are narrowed for every viewer,
  owners and admins included. Owners/admins still get the full audience from the
  members route and the group detail route. If managers should see everyone in
  views too, the viewer must be threaded through those callers, which are outside
  this task's Allowed files.
- `pairHasBlock` is read inside the repair transaction under the pair's
  `user-block:` locks (round 1) and once more after the roster sync; `blockUser`
  cancels accepted rows in its own transaction, and contact reads already hide
  blocked pairs.
- `countTopicMembers` is not called by production code today (only re-exported and
  used in tests); it is narrowed anyway so the rule does not rot.

### Round (fix round 1)

- **Finding 1 (should-fix): fixed.** The accept repair now checks the pair's block
  and inserts the pair in one transaction under both sides' `user-block:` advisory
  locks (sorted, so opposite-direction accepts cannot deadlock) — the same keys
  `blockUser` takes. A block that commits first is seen by the check; a block that
  arrives while the repair holds the locks waits and then deletes the pair. After
  the roster sync a second `pairHasBlock` check undoes the pair and both roster
  items if a block landed between the insert and the sync, so the ejabberd `both`
  subscription cannot survive a block either.
  `contacts/service.ts` gained `addContactPairEffect`, the insert as an effect on
  the caller's transaction connection; `addContactPair` now uses it.
- **Tests:** extended the block-then-re-accept test to assert that no roster item
  is pushed for the blocked pair; added `repairs a half-finished accept under the
  pair lock and syncs both rosters` (pair repaired, both roster items pushed once,
  a second accept adds nothing) in `blocks.test.ts`.
- **Findings 2 and 3 (nits)** are untouched: both sit in lines this round does not
  change, and the instructions exclude nits.
- Single tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/blocks/blocks.test.ts` → 5 passed;
  `... src/contact-requests/contact-requests.test.ts src/contacts/contacts.test.ts`
  → 12 passed.
- `pnpm gate` (final):
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (5.1s)
PASS  format  (4.5s)
PASS  lint  (3.5s)
PASS  typecheck  (3.7s)
PASS  effect  (6.2s)
PASS  tests @zilar/server  (72.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
  (`contacts/service.ts` was 401 lines on the first gate run; two comment lines
  were trimmed to keep it at 399.)

### Round (fix round 2)

- **Finding 1 (should-fix): fixed.** The block-then-re-accept test now passes
  `adminClient` and `domain` to the re-accept, so a repair that ignored the block
  would push both `both` roster items, and it asserts on the raw `contacts` rows
  instead of only `listContacts`, which hides blocked pairs by construction. I
  checked it fails with the `pairHasBlock` guard removed: the raw rows came back.
- **Finding 2 (should-fix): fixed.** `removeContact` now takes the sorted pair
  `user-block:` advisory locks in its delete+cancel transaction, mirroring
  `decide.ts`. One lock alone cannot close the race, because a re-accept can read
  the still-`accepted` row before the removal commits and only run its repair
  afterwards; the accept repair therefore also re-reads the request status inside
  its own transaction under the same locks and skips the pair insert when the row
  is no longer `accepted`. Ordering: if the repair wins the lock it inserts and the
  removal then deletes+cancels; if the removal wins, the repair sees `cancelled`
  and adds nothing.
- **Tests:** rewrote the assertions of the block-then-re-accept test
  (`blocks.test.ts`); added `a re-accept that read the request first cannot undo
  the removal` (`contacts.test.ts`). The new test deterministically reproduces the
  interleaving by running `removeContact` between the accept's settle read and its
  repair transaction; it passes with the re-read guard and fails without it (raw
  pair rows reappear). It cannot exercise the advisory lock itself — PGlite tests
  run on one connection — but it pins the guard the lock protects.
- **Findings 3 and 4 (nits)** are untouched: neither sits in a line this round
  changes.
- Single tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/blocks/blocks.test.ts src/contact-requests/contact-requests.test.ts
  src/contacts/contacts.test.ts src/topics/public-members.test.ts`
  → 4 files passed, 24 tests passed.
- `pnpm gate` (final, before only this Report text was added):
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
PASS  tests @zilar/server  (14.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
  (`contacts/service.ts` hit 406 lines on the first gate run; three comment blocks
  were condensed to bring it to 399.)



## Review (written by Claude)

Approved after 2 auto rounds. The pre-review found 2 narrow nits and 1 follow-up.
- **Blocks and removals.** A block or a contact removal deletes the pair and cancels accepted requests in one transaction, under sorted pair locks. A repair after accept re-checks blocks.
- **Channel audience.** A channel's General topic view lists only owners and admins, so subscribers can't list the audience.
- **Lead check on counts.**
  - The channel subscriber counts that people see come from `subscriberCount`: `chats/list-handler.ts:137`, web `ChannelPanel.tsx:69` and `ChannelInfoRoot.tsx`.
  - So the narrowing changes only a channel topic's people line, and only for owners.
- **Follow-up:** pass the viewer through `toTopicViews`, so owners and admins still get the full list.
