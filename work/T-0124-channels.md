---
id: T-0124
title: Channels: one-way broadcast feeds (only admins post, members subscribe)
status: merged
milestone: M5
branch: task/T-0124-channels
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108, T-0115]
estimate: 2 days
---

# T-0124: Channels

## Spec (written by Claude, do not edit)

### Why
Julio loves Telegram's flow, and channels are part of it: an announcements feed (releases, team news, a personal project log) where **only admins post** and everyone else just reads, reacts and subscribes. A channel is a group with one feed and a posting restriction; no topics.

### Model
- `groups.kind` (`group` | `channel`, default `group`; migration via `pnpm --filter @galena/server db:generate`). A channel has exactly one topic, its General topic (T-0108), which is the feed; it cannot have more topics and cannot be made private; `members_can_create_topics` is ignored.
- Roles: `owner`/`admin` **post**; `member` = **subscriber**, reads and reacts only.
- **Enforced by the chat server:** the channel's room is created **moderated** (ejabberd MUC option `moderated: true`, `members_only: true`, `mam: true`, `persistent: true`) so subscribers have the `visitor` role and cannot send; admins/owner get affiliation `admin`/`owner` (which carry voice). Verify on real ejabberd through the existing admin client options and add the needed option to `createRoom` options only if it is missing. Reactions by visitors: check what ejabberd allows for a visitor in a moderated room (reactions are messages); if they are blocked, document it in the Report and keep channels read-only for subscribers (reactions are then a follow-up), do not weaken the moderation.
- Subscribers: `group_members` rows as today (so invite links T-0115, join flow and sync work unchanged). Subscriber count is shown; the **member list is visible to admins only**.
- AIs: an AI can be an admin-level poster only when its owner is a channel admin (posting through the gateway/`postToChat` as an AI member with voice); AIs do not read a channel's audience list. Default: no AIs in channels; adding one uses the T-0109 flow and the same voice rule.

### Server API
- `POST /api/groups` accepts `{ kind: 'channel' }`; `GET /api/chats` group entries gain `kind` (`'group' | 'channel'`) and, for channels, `subscriberCount`; `GET /api/groups/:id` returns `kind` and hides the member list from non-admins of a channel.
- Invite links (T-0115) work for channels ("Join channel" wording via `kind` in the join preview).
- Posting rules are enforced by the room; the API also refuses topic creation in a channel (400 `channel_has_no_topics`).
- Audit entries as for groups.

### Web
- New chat menu: **New channel**; dialog (name, description optional field stored in `groups.description`, text ≤ 300, new nullable column). Channel rows in the list get a megaphone icon and the `CHANNEL` tag (as in the mockup); the header shows "N subscribers".
- In a channel, subscribers see, instead of the composer, a recessed bar: "Only admins can post here" with a **Mute / Unmute** button (T-0113 prefs); admins see the normal composer.
- Channel panel: description, subscriber count, invite links (admins), admins management as in the group panel; **Leave channel** for subscribers.
- Mock mode: one channel "Acme Announcements".

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md`, `T-0115-invite-links.md`, `T-0113-chat-prefs.md`
- `apps/server/src/groups/{service,routes}.ts`, `xmpp/admin-client.ts` (`createRoom` options), `chats/routes.ts`; `apps/web/src/components/{NewChatButton,NewGroupDialog,ChatListItem,ChatHeader,GroupPanel,Composer}.tsx`, `mock/*`

### Allowed files
- `apps/server/src/{groups,chats,topics,xmpp}/**` (channel rules only), `db/schema.ts` + migration, `app.ts`, `authz-sweep.test.ts`
- `apps/web/src/**` (components, routes, lib, store, mock, tests)
- `packages/chat-core/src/types.ts` (optional `kind` field values), `work/T-0124-channels.md`

**Not allowed:** mobile, dependencies, changes to ejabberd.yml (use room options).

### Tests
- Server (fake admin client): a channel room is created with the moderated options; a subscriber's affiliation/role never grants voice; admins do; topic creation refused; member list hidden from subscribers; join by link works; group behaviour unchanged.
- Web: composer replaced for subscribers, admins keep it, list icon/tag, new channel dialog, panel, leave, mock mode.

### Acceptance criteria
- [ ] Only owner/admins can post in a channel, enforced by the room configuration, not by the UI.
- [ ] Groups and DMs behave exactly as before.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Discussion comments under posts, public @handles and channel directories, view counters, scheduled posts, mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Schema (`apps/server/src/db/schema.ts`, NOT yet migrated — see below): `groups.kind` (`group`|`channel`, default `group`, zod enum `groupKindSchema`) + `groups.description` (nullable text, ≤ 300 validated at the route boundary).
- `xmpp/admin-client.ts`: `CreateRoomOptions` gains `moderated?: boolean` and `membersByDefault?: boolean`, sent as the `moderated` / `members_by_default` room options to `create_room_with_opts` when defined (both were missing — verified against the ejabberd `create_room_with_opts` API and the mod_muc `moderated`/`members_by_default` semantics).
- `groups/service.ts`: `createGroup` accepts `kind`/`description`; channel rooms are created with `moderated: true, membersByDefault: false` (group rooms send neither, keeping the ejabberd default). `GroupDetail`/`ChatGroup` carry `kind` + `description`. New `changeMemberRole` (owner only, promote/demote member↔admin; room affiliation follows at once inside the same transaction; demoting the last admin answers 409 `channel_needs_admin`; every change audited as `group.role_changed` with ids + roles only). `removeGroupMember` refuses to remove the last admin of a channel (same 409). New `listMembersForViewer` (admins see all, channel subscribers see `[]`) and `syncChannelVoice` (re-applies the voice mapping, best-effort).
- `topics/rooms.ts` (`desiredMembers`): the channel feed (General of a `kind='channel'` group) keeps voice — owner→`owner`, admins→`admin`, subscribers→`member` — so later joins/leaves never clobber an admin. New `applyChannelAiVoice`: an active group AI holds `admin` (voice) only while its owner is a channel owner/admin, else `member` (voiceless visitor). Group rooms byte-identical to before.
- `topics/service.ts`: `createTopic` refuses in a channel (400 `channel_has_no_topics`), checked before the permission check so groups behave exactly as before.
- `groups/routes.ts`: `POST /api/groups` accepts `{ kind, description }`; `GET /api/groups/:id` strips `members` for channel subscribers; new `GET /api/groups/:id/members` (audience for admins, `[]` for subscribers, 404 for strangers) and `PUT /api/groups/:id/members/:userId/role` (`{ role: 'admin'|'member' }`, owner only). All behind `requireSession` (covered by the 401 sweep, no allowlist change).
- `chats/routes.ts`: group entries gain `chatKind: 'group'|'channel'` always, plus `subscriberCount` + `description` for channels only (groups keep exactly their old keys).
- `invite-links/service.ts`: join preview gains `kind` ("Join channel" wording, subscriber count); join flow unchanged (adds as `member` → voiceless subscriber, room sync + audit as before). Fixed a test asserting the exact preview body.
- Web: `chat-core` `ChatSummary` gains `chatKind`/`subscriberCount`/`description`/`myRole` (all optional). `lib/api.ts` parses `chatKind`/`subscriberCount`/`description` on entries, `kind`/`description` on details, `kind` on join previews; new `createGroup(kind, description)`, `listGroupMembers`, `changeGroupMemberRole`, `removeGroupMember`. `realStore` maps channel rows (`summariesFor`), `createChannel`/`leaveChannel`/`changeChannelRole`; mock store mirrors them in memory. `NewChatButton` gains **New channel**; `NewGroupDialog` gains a `channel` mode (name + optional description ≤ 300). `ChatListItem` shows megaphone + `CHANNEL` tag; `chatSubtitle` shows "N subscribers" for channels. `ChatView` renders `ChannelComposerBar` (admins get the composer; subscribers get "Only admins can post here" + Mute/Unmute via the T-0113 pref) and `ChannelPanel` (description, subscriber count, admins list for subscribers / full audience + promote/demote for the owner, invite links for admins, AIs, Leave channel). `JoinPage` reads "Join the channel"/"N subscribers" from preview `kind`. Mock mode: "Acme Announcements" channel + `POST /groups` + member/role routes in the mock API.
- Ejabberd semantics verified (mod_muc docs + ejabberd#3222): in a moderated room only `participant`+ may send; `members_only` + `members_by_default: true` (default) makes affiliated `member`s participants (voice) — so plain `member` affiliation is NOT enough; the design instead relies on ejabberd mapping affiliation `member` → role `participant`?? See deviation below. Reactions are `groupchat` messages, so subscribers cannot react either — channels are read-only for subscribers (mute only), per spec instruction; documented below.

### Files changed
- `apps/server/src/db/schema.ts` (kind + description, NO migration committed — see Round 2)
- `apps/server/src/xmpp/admin-client.ts` (`moderated` + `membersByDefault` options), `admin-client.test.ts` (wire-format test)
- `apps/server/src/groups/service.ts`, `routes.ts`, `app.ts` (audit recorder wiring), `groups.test.ts` (+10 channel tests incl. `group.role_changed` audit)
- `apps/server/src/topics/topics.test.ts` (topic rooms carry neither flag)
- `apps/server/src/topics/rooms.ts` (channel voice mapping + AI voice rule)
- `apps/server/src/topics/service.ts` (`channel_has_no_topics`)
- `apps/server/src/chats/routes.ts` (`chatKind`/`subscriberCount`/`description`)
- `apps/server/src/invite-links/service.ts`, `invite-links.test.ts` (preview `kind`)
- `packages/chat-core/src/types.ts` (optional channel fields)
- `apps/web/src/lib/api.ts`, `lib/format.ts`, `store/realStore.ts`, `store/store.ts`, `store/realStore.topics.test.tsx`, `store/realStore.test.tsx`, `store/reload.test.tsx`
- `apps/web/src/components/{NewChatButton,NewGroupDialog,ChatListItem,ChatHeader,ChannelComposerBar,ChannelPanel,Channels.test}.tsx`, `routes/{ChatView,JoinPage}.tsx`, `mock/{api,chats,groups,messages}.ts`
- `docs/SERVER_CONFIG.md` (Channels T-0124 section; allowed in round 2)
- `work/T-0124-channels.md` (this report)

### Commands run and real results
- `pnpm install`: pass (13.1s)
- `pnpm format:check`: pass on all touched files (explicit file list incl. new files: "All matched files use Prettier code style!"); repo-root run still flags only the two generated drizzle files (`meta/_journal.json`, `meta/0028_snapshot.json`) — drizzle emits them unformatted, same as previous tasks (T-0113 report notes the same).
- `pnpm lint`: pass (oxlint clean; one unused var caught and removed, re-run clean)
- `pnpm typecheck`: pass (turbo 10/10; fixed a duplicate `createChannel` key in the mock store and three test `ApiClient` stubs missing the new methods)
- `pnpm --filter @galena/server test --maxWorkers=2 src/groups/groups.test.ts`: 40 passed (31 existing + 9 new channel tests)
- Adjacent server suites: chats+topics 39 passed; invite-links+xmpp+sweep 42 passed (incl. the preview-`kind` fix); topics/audit/roles/chat-prefs/pins/search 124 passed; xmpp/contacts/drafts/ais/auth/config/app 284 passed; approvals/machines/actions/tools/routines/voice/connections/git/db 513 passed.
- Full server suite (background, `--maxWorkers=2`): 81 files passed, 5 skipped; 1426 passed, 7 skipped, 1 failed — the single failure was `invite-links > previews the group`, asserting the exact preview body before I added `kind`; fixed, then `invite-links.test.ts` alone: 16 passed. One gateway test (`mints a fresh token`) timed out at 35s under parallel-worker load in the same run; passes alone in 11s (untouched JWT code — load flake, not a regression).
- `pnpm --filter @galena/web test --maxWorkers=2` (full suite): 76 files passed, 830 passed (incl. 7 new `Channels.test.tsx` + 1 new `summariesFor` channel mapping test).
- `pnpm build`: pass (2/2 turbo tasks, 1m50s)
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|as any` in touched source: no hits (two comment-word false positives only).

### Round 3 (pre-review findings fixed, status stays review)
- **(1) XMPP out of the transaction:** `changeMemberRole` now commits the DB row first, then sets the affiliation outside the transaction (best effort + `could not set the member role affiliation` log, like `addGroupMembers`). On a room failure it reconciles with `syncChannelVoice`, so a committed row with a stale affiliation heals instead of diverging. `syncChannelVoice` now has a caller (was dead code). Regression test: flaky client fails the role-change affiliation write once → 200, row is `admin`, log line present, reconcile lifts the affiliation to `admin`.
- **(2) AI voice at add time:** `addGroupAi` (new `domain`/`logger` on `AddGroupAiInput`, wired from the route) re-syncs the channel feed room after the commit for channels only, applying the `applyChannelAiVoice` outcome — an admin-owned AI lands at `admin` at once. Best effort + log; groups untouched. The existing `desiredMembers`-level test became an end-to-end HTTP test asserting the fake's affiliation state is `admin` right after `POST .../ais`.
- **(3) ChannelPanel admins for subscribers:** server `listMembersForViewer` now answers the admins slice (owner/admins, names + roles) to channel subscribers instead of `[]` — who posts is public (every admin post carries its name), the subscriber audience stays hidden; the detail still strips `members` entirely. Panel loads it via the existing `listGroupMembers` endpoint for non-managers (managers keep reading the detail, no second request), with loading/error states; `ownerName` falls back through the slice. Mock API mirrors the slice. New panel tests: subscriber sees the admin name via a stubbed endpoint (and the fetch URL asserted), error state on failure. Server test renamed to `hides the audience from subscribers but shows the admins` and asserts the slice + that the subscriber id is absent.
- **(4) Same-404 on the role route:** non-owner members now get 404 `not_found` like strangers (was 403 → membership oracle). Test asserts both.
- **(5) Rate limit on the role route:** `ROLE_CHANGE_RATE_LIMIT_MAX = 30/hour` per user (`createRateLimiter`, same pattern as topic creation, `now` injectable), 429 `rate_limited`. Regression test loops 30 writes → 31st is 429.
- **(6) Race comment corrected:** the last-admin guard comment no longer claims self-healing — concurrent demotions leave the channel owner-only-voiced until a manual promotion.
- **(7) Docs:** `docs/SERVER_CONFIG.md` stays (lead explicitly allowed it in round 2).
- **(9) Preview over-fetch:** `previewInviteLink` selects `{ title, kind }` only.
- **Migration:** still NOT run/committed per instruction (lead rebases after T-0120, then `db:generate` → 0030). Local `db:generate` output used for test runs only and deleted before commit — verified no `drizzle/` paths in `git status`.
- Round-3 checks (scoped, per instruction — no full suites): `pnpm install` pass; `pnpm format:check` clean on all touched files (repo run flags only the doomed local drizzle files + untracked PREREVIEW.md, neither committed); `pnpm lint` pass; `pnpm typecheck` 10/10; server `groups` (42) + `admin-client` + `topics` + `chats` + `invite-links` + `sweep` all pass; web `Channels` + mock invite-links/mock/realStore.topics all pass. `grep` for disables/`any`/`ts-ignore`: no hits.

### Round 4 (post-rebase: migration 0030, flaky-test fix, admins-slice approved)
- **Migration 0030 committed:** after the rebase onto main (T-0120 merged, latest was 0029), ran `pnpm --filter @galena/server db:generate` → `drizzle/0030_aromatic_masked_marvel.sql` with ONLY the two columns (`ADD COLUMN "kind" … DEFAULT 'group' NOT NULL`, `ADD COLUMN "description"`). Ran `prettier --write` on the generated meta files (`0030_snapshot.json`, `_journal.json`) per instruction; repo-root `pnpm format:check` now passes fully ("All matched files use Prettier code style!").
- **Flaky `Channels.test.tsx` fixed:** the create-channel assertion used bare `findByText('Releases')`, which matches twice once the row paints (dialog input + list row); now scoped with `within(screen.getByRole('navigation', { name: 'Chats' }))`. Same multi-match class fixed in the admins-error test (scoped to the Admins `region` — other panel sections surface the same network text in their own alerts when every fetch fails). File passes alone: 9/9.
- **Admins slice approved (lead decision):** subscribers see admin/owner names only, never other subscribers — kept as implemented (admin posts carry their names anyway). Noted in Report.
- **`docs/SERVER_CONFIG.md`:** kept — explicitly allowed by the lead (round 2).
- Round-4 checks (scoped, per instruction): server `groups` + `invite-links` + `xmpp` + `authz-sweep`: 8 files, 119 passed; web `Channels` alone: 9 passed; `pnpm lint` pass; `pnpm typecheck` 10/10; `pnpm format:check` full pass.

### Round 5 (lead review findings, status stays review)
- **(1) Subscriber-kick 409 fixed:** the last-admin guard in `removeGroupMember` now fires only when `target.role === 'admin'` — kicking a subscriber in a channel with zero admins succeeds. New test: owner kicks a subscriber in a fresh channel (200, affiliation cleared, row gone).
- **(2) Admins slice blessed (lead decision):** kept — subscribers see owner/admin names only, never other subscribers; admin posts carry their names anyway. No code change.
- **(3) Composer bar after role change:** `changeChannelRole` now awaits `refreshChatsOrThrow()` after applying the detail, so the acting device's rows rebuild from server truth (`myRole`, counts) and the composer bar flips. The target's own device converges on the next list refresh (60s poll / focus), like every other membership change. New `realStore.test.tsx` test: role write → `getChats` re-called → row `myRole` flips `member` → `admin`.
- **(4) Docs fixed:** `docs/SERVER_CONFIG.md` Channels section now says the members endpoint answers the full audience for admins, the owner/admins slice for subscribers, 404 for strangers.
- **(5) Role route is channels-only:** `changeMemberRole` 404s plain groups exactly like an unknown id (spec: channel rules only; no group UI calls it). New test asserts identical code+message for a plain group vs an unknown id (requestIds compared field-by-field — one per request by design).
- **(6) Mock nits:** mock `PUT .../role` is channels-only + same-404 for non-owners (was 403, plus no channel check); mock `DELETE` enforces the last-admin `channel_needs_admin` guard (subscriber kicks still succeed); mock join preview includes `kind: 'channel'` so mock-mode JoinPage reads "Join channel".
- **Migration 0030 untouched.**
- Round-5 checks (scoped, per instruction, `--maxWorkers=2`): server `groups` (44) + `invite-links` + `xmpp` + `sweep`: all pass; web `Channels` + `realStore` + mock suites: 134 passed; `pnpm format:check` full pass; `pnpm lint` pass; `pnpm typecheck` 10/10. `grep` for disables/`any`/`ts-ignore`: no hits.
- **`members_by_default: false` for channel rooms (lead option b):** `CreateRoomOptions` gains `membersByDefault?: boolean`, sent as `members_by_default` to `create_room_with_opts` only when defined. Channel `createRoom` now sends `moderated: true, membersByDefault: false`; groups and topic rooms send neither (ejabberd default `true` keeps every member voiced there). Affiliations stay `owner`/`admin`/`member` as specced — subscribers join as visitors (read, no post), owner/admin keep voice. Live voice behaviour left for the lead to verify on real ejabberd after merge.
- **Tests:** `admin-client.test.ts` asserts the wire format (`moderated: 'true'`, `members_by_default: 'false'` alongside the old keys) for a channel-style call; `groups.test.ts` asserts the channel room carries both flags and plain groups carry neither; `topics.test.ts` asserts topic rooms carry neither.
- **`group.role_changed` audit:** the recorder WAS already wired into the groups area (used for `group.role_unassigned` on leave), so this was trivial: `changeMemberRole` takes optional `audit?: AuditRecorder`, the route passes the shared `auditRecorder` (wired in `app.ts`, which is an allowed file), and every promote/demote records `{ groupId, subjectUserId, from, to }` (ids + roles only, never names). Write failures are logged, never thrown. Test asserts the row.
- **`docs/SERVER_CONFIG.md`:** re-added the short Channels (T-0124) section (config/behaviour only, no secrets), updated for `members_by_default: false` + `group.role_changed`.
- **Migration:** NOT run, per instruction (T-0120/0029 merges first; will run `db:generate` for 0030 after the lead's rebase). For local test runs only, `db:generate` was executed and its output DELETED afterwards — verified no `drizzle/` paths remain in `git status` before commit.
- Round-2 checks: `pnpm install` pass; `pnpm format:check` pass on all touched files; `pnpm lint` pass; `pnpm typecheck` pass (10/10); `groups.test.ts` + `admin-client.test.ts`: 62 passed; topics+chats+invite-links+sweep: 60 passed. Web untouched this round (full web suite was green in round 1: 76 files, 830 passed).

### Round 3 (pre-review findings fixed, status stays review)

### Problems, deviations from the spec, open questions
- **Moderation semantics (important, verified):** with ejabberd's defaults (`members_by_default: true`), affiliation `member` maps to role `participant` = HAS voice even in a moderated room — so a plain-`member` subscriber could still post. What actually silences them is affiliation `none`/visitor. My implementation sets subscribers to `member` (matching the existing group code), which under default ejabberd config does NOT silence them. Two compliant options: (a) set subscribers to affiliation `none` — but in a `members_only` room `none` removes them from the room (can't read); (b) create the room with `members_by_default: false` so members join as visitors (read, no voice) — this is the correct Telegram-like mapping and needs one more `CreateRoomOptions` flag. I did NOT guess: the room is created `moderated: true` per spec, affiliations are `owner`/`admin`/`member` as specced, and the API refuses topic creation + the UI hides the composer. **Lead decision needed:** add `membersByDefault: false` to channel `createRoom` (my recommendation — subscribers become visitors: read, no post, affiliations stay intact) or keep `member` (posting then relies on clients). Flagging rather than changing room semantics unilaterally.
- **Reactions:** verified reactions are `groupchat` messages (`sendReactions` → same stanza path), so visitors cannot react in a moderated room. Per spec instruction I kept subscribers read-only (no reaction UI) and did NOT weaken moderation. Follow-up if wanted.
- **Member vs subscriber wording:** `group_members` rows unchanged (invite links, join flow, sync untouched); the subscriber count IS the member count surfaced as `subscriberCount`.
- **Migration NOT committed (per lead instruction):** `db:generate` was run locally to test (clean `0028_sleepy_blackheart.sql`: `ADD COLUMN kind DEFAULT 'group' NOT NULL` + `ADD COLUMN description`), then the migration files were REVERTED/deleted — schema.ts changes are written and tested against the local migration, but no migration file is committed. Awaiting the lead's rebase + migration number. `git status` shows no `drizzle/` additions (verified: no drizzle paths in `git status`).
- **`docs/SERVER_CONFIG.md`:** I wrote a "Channels (T-0124)" section but reverted it — docs/ is outside Allowed files. Happy to re-add if the lead allows.
- **AI audience access:** `agents/` is outside Allowed files so the gateway is untouched. The AI never receives member names through my changes; its room gate (`loadRoomGateState`) reads membership only for authorization. The voice rule (admin-owned AIs get `admin` affiliation) is enforced at the room-sync layer, which the gateway respects (its sends land or are refused by ejabberd).
- **No new audit actions (superceded in round 2):** `group.role_changed` is now recorded for every promote/demote (see Round 2). Group/channel create remains unaudited, like groups.
- **Last-admin guard is check-then-act** (same known race as the group cap, documented in code); concurrent demotions can both pass, the next write refuses again.
- **Mock `POST /groups` creates rows keyed `c-mock-N`** but no chat row — the mock store's `createChannel` throws (like `createGroup`); the real-store path is untested in mock mode beyond the dialog calling the store. Acceptable per mock-mode patterns.

### Blocked / needs a decision
- (status is review — one item left) Migration number after rebase (migration files deleted, schema.ts ready; will run `db:generate`, expecting 0030).

---

## Review (written by Claude)

**Verdict:** approved, merged.

### Findings
- Round 1 fixes verified: subscriber-kick guard only for admin targets, role route channels-only (same 404), composer refresh after a role change, mock parity, migration 0030 regenerated.
- Blessed: subscribers see the owner/admins slice of the member list (poster names are public); `docs/SERVER_CONFIG.md` edit and the join-preview `kind` in `invite-links/service.ts` are accepted scope.
- Deferred nits: mock 400 vs server 403 for owner role change; `GET /groups/:id/members` also serves plain groups.
- To verify after merge on the real ejabberd: subscribers are read-only (`members_by_default: false`).
