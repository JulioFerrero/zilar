---
id: T-2002
title: "Room hardening: people get plain member affiliation in every room (no MUC owner/admin they could use from a raw XMPP client); rooms are non-public and unlisted; nick registration is admin-only; archived topic rooms drop removed people; existing rooms are reconciled once at server start — with tests"
status: merged
milestone: M5
branch: task/T-2002-muc-rights-hardening
model: anthropic/claude-sonnet-5-5
effort: high
estimate: 60 min
---

# T-2002: Server-only room rights

## Spec (written by Claude, do not edit)

### Why
The lead's private security reviews of 2026-10-18 (T-1985, T-1987) found the following.
- **MUC rights people can misuse.** People hold MUC `owner` or `admin` affiliations: topic creators, group owners, and a channel's admins. From any raw XMPP client they can then:
  - turn off members-only;
  - grant room membership to people outside the group;
  - change the room config.

  The app never learns of it.
- **Listable rooms.** Rooms are also created with ejabberd's defaults `public: true` and `public_list: true`, so any user can list every room title and its occupants.
- **Nick registration.** Anyone can register a nick server-wide.
- **Archived topics.** People removed from a group keep their affiliation on archived topic rooms.

The server already performs every membership change through the admin API, so people only need the `member` affiliation.

### Facts (read by the lead on 2026-10-18)
- **Who gets `owner` or `admin` today.**
  - `apps/server/src/topics/room-members.ts` (210 lines) builds each room's wanted affiliations.
  - In a channel feed (the channel's General room), a group `admin` gets `admin` (`:60-64`). Everyone else gets `owner` when `topic.isGeneral ? role === 'owner' : userId === topic.createdBy`, otherwise `member` (`:65-68`, again at `:102-105` and `:112-115`).
  - `apps/server/src/groups/member-roles.ts` (171 lines) writes `setAffiliation(group.roomLocalpart, jid, input.role)` on a role change (`:81-85`).
  - `syncChannelVoice` (`:133-…`) re-applies a channel's voice mapping: "every owner/admin holds affiliation admin/owner". A channel room is moderated, so only an `admin` or `owner` affiliation may post (T-0124).
- **Clients never use moderator or owner powers.** There is no kick, moderation (XEP-0425) or subject change in `packages/xmpp-core`, `packages/client-core`, `apps/web` or `apps/mobile`. Only removal notices are parsed (`packages/xmpp-core/src/stanza/parse-presence.ts:67-78`).
- **Room creation.** `apps/server/src/xmpp/admin/client.ts` `createRoom` (`:113-160`) sends `members_only`, `persistent`, `mam` and `allow_subscription`, plus optional `anonymous`, `moderated`, `members_by_default` and `title`. It never sends `public` or `public_list`. The client also has `changeRoomOption(roomId, option, value)` (`:200-…`).
- **ejabberd configs.** `mod_muc` `default_room_options` sets `members_only`, `persistent`, `mam` and `anonymous: false`, in all three files:
  - `deploy/ejabberd/ejabberd.yml:206-224`;
  - `infra/ejabberd/ejabberd.yml`;
  - `deploy/baremetal/ejabberd.yml`.

  None of them sets `access_register`; ejabberd's default is `all`.
- **Archived topics.** `apps/server/src/groups/topic-rooms.ts:36-46` `syncGroupTopicRooms` skips topics with `archivedAt !== null`.
- **Existing tests.** `groups/member-roles.test.ts` and `groups/room-sync-retry.test.ts` exist. A fake admin client is in `apps/server/src/test-support.ts`.

### Steps
1. **People are members.**
   - In `room-members.ts` and `member-roles.ts`, every person gets `member`: owners, admins, topic creators.
   - **Keep channel posting working.** A channel feed's posters (the group's owner and admins) need voice in the moderated room.
     - First choice: keep them `member`, and give voice another way that ejabberd persists. Check ejabberd 26.07's `members_by_default`, and whether a persistent per-JID role is possible.
     - If ejabberd can only give persistent voice through `admin`, keep `admin` **only** for those people **only** in the channel feed room, and say so in the Report. `admin` can't change the room config, but it can grant membership, so also add step 4's re-assert for that room.
   - Update `syncChannelVoice` to match.
2. **Rooms are private and unlisted.**
   - `createRoom` always sends `public=false` and `public_list=false`.
   - Add `public: false` and `public_list: false` to `default_room_options` in all three ejabberd configs.
3. **Admin-only nick registration.** Add `access_register: admin` (an access rule that allows only `admin`) to `mod_muc` in all three configs. Check that clients and the AI gateway never register nicks; grep for `jabber:iq:register`.
4. **Reconcile existing rooms once, at server start.**
   - On the leader, after start-up, re-sync every live group and topic room. Its affiliations, now `member`, are covered by the existing topic room sync. Its options are set with `changeRoomOption`: `members_only=true`, `public=false`, `public_list=false`.
   - Make it idempotent, throttled (a few rooms per second), and logged as one summary line.
   - Keep it in a new small file (for example `apps/server/src/groups/room-reconcile.ts`), wired where the leader starts its jobs. Find that place and name it in the Report.
5. **Archived topics too.** `syncGroupTopicRooms` includes archived topics when someone is removed from the group, so their affiliation is set to `none` there too.
6. **Tests:**
   - the wanted affiliations for a topic creator, a group owner and a group admin are `member` (with the channel-feed rule from step 1 tested both ways);
   - `createRoom` sends `public=false` and `public_list=false`;
   - a removal re-syncs an archived topic room.
7. **Keep files small.** Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/groups/room-reconcile.ts`
- `apps/server/src/xmpp/admin/client.ts`
- `apps/server/src/xmpp/admin/client.test.ts`
- `apps/server/src/groups/member-roles.test.ts`
- `apps/server/src/groups/room-sync-retry.test.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/startup/lifecycle.ts`
- `apps/server/src/leader/start.ts`
- `deploy/ejabberd/ejabberd.yml`
- `infra/ejabberd/ejabberd.yml`
- `deploy/baremetal/ejabberd.yml`
- `work/T-2002-muc-rights-hardening.md`

If wiring the reconcile needs a different start-up file, stop and name it in the Report instead of editing it.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups src/topics src/xmpp --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- After the deploy, the lead checks with read-only admin API calls on the VPS:
  - a topic room's affiliations show no person as `owner`;
  - its options show `public=false`.
- After the deploy, the lead checks with Julio:
  - posting in a channel still works for its admins;
  - group chats work as before.

---

## Report (written by the worker when done)

### What I did
- **People are members** (`topics/room-members.ts`, `groups/member-roles.ts`). A new `roomAffiliationFor(role, isChannelFeed)` returns `member` for everyone, except the channel feed's owner and admins, who get `admin`. `desiredMembers` and `changeMemberRole` use it, and `syncChannelVoice` now sets `admin` (never `owner`) for the channel's owner and admins. A topic creator is now a plain `member` in every other room.
- **Channel voice (step 1 decision).** I did not find a way to give persistent per-JID voice other than the `admin` affiliation. In ejabberd, roles are not persisted; the only things stored in the room state are the affiliation and `members_by_default`. A channel room has `moderated` and `members_by_default=false`, so a `member` joins as a visitor. So I kept `admin` for the channel owner and admins, **only in the channel's General (feed) room**. This is from my reading of ejabberd's MUC behaviour; I did not test it against a live ejabberd. A channel admin can grant membership but cannot change the room config. The re-assert is the reconcile below (every `syncTopicRoom` also removes people who should not be in the room). AIs of channel admins keep `admin` in the feed as before; they are not people.
- **Private, unlisted rooms** (`xmpp/admin/client.ts`). `createRoom` always sends `public=false` and `public_list=false`. All three ejabberd configs (`deploy/ejabberd`, `infra/ejabberd`, `deploy/baremetal`) have `public: false` and `public_list: false` in `default_room_options`.
- **Admin-only nick registration.** In all three configs I added an access rule `muc_register` (`allow: admin`) and `access_register: muc_register` in `mod_muc`. I used a new named rule rather than the bare word `admin`, since `admin` is an ACL in these files, not an access rule. Grep for `jabber:iq:register`, `muc#register`, `registerNick` in apps and packages (`.ts`, `.tsx`, `.js`, `.mjs`): no match, so no client or the AI gateway registers nicks.
- **Reconcile at start** (new `groups/room-reconcile.ts`, wired in `leader/start.ts`). `createLeaderWork().start()` calls `startRoomRightsReconcile()` right after `startRunnerHubWork()`. That runs only on the leader (started by `onAcquire` in `startup/components.ts`, which I did not need to edit). For every non-archived topic (the group's room is its General topic's room) it runs `syncTopicRoom`, then `changeRoomOption` for `members_only=true`, `public=false`, `public_list=false`. It pauses 350 ms between rooms (about 3 rooms/s), a failing room is logged by localpart and does not stop the pass, it is idempotent, and it logs one summary line (`room rights reconcile finished` with rooms, reconciled, failed, interrupted). Leader step-down aborts it through an `AbortController`.
- **Archived topics** (`groups/topic-rooms.ts`). `syncGroupTopicRooms` no longer skips archived topics, so a removed person gets `none` there too.
- **Tests.**
  - `member-roles.test.ts`: wanted affiliations are all `member` for a group room and a private topic (creator, owner, admin); for a channel feed owner and admin get `admin`, a subscriber and every other topic get `member`; promoting via the route gives `member` in a group room and `admin` in a channel room.
  - `client.test.ts`: `createRoom` sends `public=false` and `public_list=false`.
  - `room-sync-retry.test.ts`: a removal re-syncs an archived topic room (the removed person is dropped). I also changed the existing retry test's expectation from `owner` to `member`.
  - I wrote no test for `room-reconcile.ts` itself.

### Files changed
`apps/server/src/topics/room-members.ts`, `groups/member-roles.ts`, `groups/topic-rooms.ts`, `groups/room-reconcile.ts` (new), `xmpp/admin/client.ts`, `xmpp/admin/client.test.ts`, `groups/member-roles.test.ts`, `groups/room-sync-retry.test.ts`, `leader/start.ts`, the three `ejabberd.yml` files, and this task file.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/member-roles.test.ts src/groups/room-sync-retry.test.ts src/xmpp/admin/client.test.ts`: 3 files, 13 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/groups src/topics src/xmpp --maxWorkers=2 --reporter=dot` (the task's check, with the worker cap): 18 files, 98 tests passed.
- `pnpm gate`: PASS for install (frozen), format, lint, typecheck, effect, tests @zilar/server (67.9s). Summary lines: `gate: 13 changed file(s) against main`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: every workspace package an app image needs is copied into its Dockerfile`, `size: every changed source file is within 400 lines`, `GATE PASS`.

### Notes for the lead
- **Gaps outside my Allowed files (not edited):**
  1. `groups/service.ts` (~line 249) still sets the creator as `owner` on the room when a group or channel is created. Until the next leader start (reconcile) or any later `syncTopicRoom` of that room, a freshly created group's creator keeps MUC `owner`. It should set `member` (and `admin` for a channel creator). Same file: the initial members are `member` already.
  2. `groups/ownership.ts` (~lines 80-100) sets `owner` and `admin` on the room after a hand-over. It then calls `syncChannelVoice` and `syncGroupTopicRooms`, which now correct both rooms, so it heals itself, but there is a short window and a failed sync leaves `owner`.
  3. `groups/room-sync-retry.ts` still filters `archived_at IS NULL`, so a failed archived-topic sync is not retried. The next removal or leader start fixes it.
- **Reconcile does not sweep archived topics.** Existing archived rooms keep old affiliations until a removal re-syncs them. I chose this because `syncTopicRoom` sends direct invitations for every changed affiliation and would do that for archived rooms.
- **Side effect of the first reconcile:** `syncTopicRoom` sends a direct invitation to every person whose affiliation changed (e.g. `owner` to `member`), so existing topic creators and group owners may get one invitation to a room they are already in. Clients should ignore it, but I did not verify that.
- The ejabberd config changes and the voice behaviour are untested against a real ejabberd; the lead's post-deploy checks cover them.

## Review (written by Claude)

Approved. The pre-review found no blockers, 4 nits and 3 follow-ups.
- **Affiliations.** `roomAffiliationFor` gives every person `member`. The one exception is a channel feed's owner and admins, who hold `admin` for voice, since ejabberd persists voice only through affiliation.
- **Room options.** Rooms are created with `public` and `public_list` set to false, in `createRoom` and in all three configs.
- **Nicks.** Nick registration is admin-only.
- **Archived topics.** A removal also re-syncs archived topic rooms.
- **Start-up reconcile.** The leader re-asserts the options and affiliations of every live room once at start.
- **Lead check on invitations.** The reconcile sends a direct invitation to everyone whose affiliation changes. Clients handle that only as a chat-list refresh (`client-core/src/store/connect.ts:96`), so it's harmless.
- **Follow-ups go to T-2010.** These still write `owner`:
  - group creation (`groups/service.ts`);
  - the hand-over (`groups/ownership.ts`, which heals itself);
  - the retry query, which skips archived topics.
- **After the deploy,** the lead checks one topic room's affiliations and options with read-only admin calls, then asks Julio to post in a channel he admins.
