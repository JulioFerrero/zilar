# Account deletion and export: what "delete my account" and "export my messages" must touch

Status: plan (no code, config or migration in this task).
Item 12 of the Telegram parity plan (`docs/audit/telegram-parity-audit.md:272`,
`:169-170`). Deletion with a 7-day grace, and an export of my messages as JSON
from MAM.

This document is the audit the lead asked for before any code: every Postgres
table that holds a user id or a JID derived from one, the ejabberd side, files,
AIs, the grace model, the export shape, the exact delete order, the open
decisions for Julio, and a split into follow-up tasks.

Evidence is `file:line`. Migrations are quoted from `apps/server/drizzle/`.

---

## 1. Postgres tables that hold a user id or a derived JID

The user row itself is Better Auth's `"user"`. Better Auth's `account`
(`0001_nifty_nomad.sql:62`) and `session` (`0001_nifty_nomad.sql:63`) cascade,
so deleting the `user` row removes credentials and sessions.

All 53 migrations were read. Column-by-column, with the FK that already exists
and what to do:

### 1a. Cascade is already correct (deleting `user` does the right thing)

| Table | Column(s) | FK | Evidence | Action |
| --- | --- | --- | --- | --- |
| `account` | `user_id` | cascade | `0001_nifty_nomad.sql:62` | cascade |
| `session` | `user_id` | cascade | `0001_nifty_nomad.sql:63` | cascade |
| `xmpp_accounts` | `user_id` | cascade | `0002_superb_katie_power.sql:12` | cascade (but see §2 for the ejabberd account) |
| `contacts` | `user_id`, `contact_user_id` | cascade both | `0003_shocking_boom_boom.sql:34-35` | cascade; also remove both roster items (§2) |
| `group_members` | `user_id` | cascade | `0003_shocking_boom_boom.sql:37` | cascade (the user leaves every group first, step 6) |
| `user_invites` | `user_id` | cascade | `0003_shocking_boom_boom.sql:39` | cascade |
| `chat_prefs` | `user_id` | cascade | `0024_abandoned_skullbuster.sql:12` | cascade |
| `group_member_roles` | `user_id` | cascade | `0027_opposite_red_hulk.sql:25` | cascade |
| `user_sticker_packs` | `user_id` | cascade | `0029_sloppy_jigsaw.sql:34` | cascade |
| `sticker_favorites` | `user_id` | cascade | `0032_nappy_ender_wiggin.sql:8` | cascade |
| `push_settings` | `user_id` | cascade | `0031_glossy_wasp.sql:22` | cascade |
| `push_subscriptions` | `user_id` | cascade | `0031_glossy_wasp.sql:23` | cascade |
| `push_subscriptions` | `session_id` | cascade | `0051_push_session.sql:3` | cascade (a revoked session drops its device) |
| `contact_requests` | `from_user_id`, `to_user_id` | cascade both | `0035_handles-contact-requests.sql:32-33` | cascade |
| `user_blocks` | `user_id`, `blocked_user_id` | cascade both | `0039_workable_sunspot.sql:9-10` | cascade |
| `chat_folder_seeds` | `user_id` | cascade | `0040_majestic_legion.sql:22` | cascade |
| `chat_folders` | `user_id` | cascade | `0040_majestic_legion.sql:23` | cascade |
| `chat_background_defaults` | `user_id` | cascade | `0043_giant_nitro.sql:27` | cascade |
| `chat_backgrounds` | `user_id` | cascade | `0043_giant_nitro.sql:29` | cascade (delete the file too, §3) |
| `chat_reads` | `user_id` | cascade | `0048_chat_reads.sql:10` | cascade |
| `chat_deliveries` | `user_id` | cascade | `0049_chat_deliveries.sql:10` | cascade |
| `user_profiles` | `user_id` | cascade | `0052_user_profiles.sql:1` | cascade |
| `machine_pairing_codes` | `owner_user_id` | cascade | `0010_bumpy_talkback.sql:25` | cascade |
| `machines` | `owner_user_id` | cascade | `0010_bumpy_talkback.sql:26` | cascade |
| `ais` (and children) | `owner` | cascade | `0005_clean_frightful_four.sql:35` | explicit teardown first (§4); `llm_virtual_keys`, `ai_limits`, `ai_memory_*`, `ai_delegations`, `ai_daily_spend` all cascade from `ais` (`0005:34,37`; `0009:9`; `0042:41-44`; `0045:33-35`) |
| `llm_virtual_keys` | `ai_id` | cascade | `0005_clean_frightful_four.sql:37` | cascade (gateway key must be revoked first, §4) |

### 1b. FK exists, but cascade is wrong or a decision

| Table | Column | FK today | Evidence | Problem | Recommended action |
| --- | --- | --- | --- | --- | --- |
| `groups` | `created_by` | **cascade** | `0003_shocking_boom_boom.sql:38` | deleting a user destroys every group they ever created, even after a hand-over | repoint `created_by` to the new owner before the delete; or migrate the column to `ON DELETE set null` |
| `topics` | `created_by` | **cascade** | `0018_lethal_warhawk.sql:37` | destroys topics a user created in someone else's group | repoint to the group owner before the delete (or `set null`) |
| `topic_members` | `user_id`, `added_by` | cascade | `0018_lethal_warhawk.sql:32-33` | correct for `user_id`; `added_by` removes a membership row a moderator added | keep (membership data, harmless) |
| `retired_handles` | `former_user_id` | **cascade** | `0035_handles-contact-requests.sql:36` | deleting the user drops the 30-day handle reservation, so the handle can be re-registered; a post-delete insert would violate the FK | the reservation must **outlive** the user delete: drop the FK (T-A migration) so the step-11 insert survives step 15 (decision 4) |
| `handles` | `user_id` | cascade | `0035_handles-contact-requests.sql:34` | frees the handle | cascade after retiring it |
| `pinned_messages` | `pinned_by` | **cascade** | `0025_married_hobgoblin.sql:12` | deletes pins the whole group sees, just because the pinner left | decision: reassign to the group owner, or delete deliberately (§8) |
| `group_roles` | `created_by` | **cascade** | `0027_opposite_red_hulk.sql:28` | deletes a role definition the group still uses | repoint to the owner (`set null`) |
| `group_member_roles` | `assigned_by` | cascade | `0027_opposite_red_hulk.sql:26` | drops grants a moderator handed out | keep |
| `group_invite_links` | `created_by` | cascade | `0026_simple_spitfire.sql:17` | deletes invite links the group still uses | repoint to the owner (`set null`) |
| `group_ais` | `added_by` | cascade | `0008_sad_vulcan.sql:11` | removing the row takes an AI out of the group | keep (the AI stays a user's; the group membership is consensus data) |
| `topic_ais` | `added_by` | cascade | `0020_dry_lord_hawal.sql:11` | same for a topic | keep |
| `ai_tools` | `created_by` | **cascade** | `0017_plain_warstar.sql:43` | deletes a group-shared tool | repoint to the group owner (`set null`) |
| `ai_tool_versions` | `created_by` | cascade | `0017_plain_warstar.sql:40` | same | repoint (`set null`) |
| `routines` | `created_by` | **cascade** | `0023_classy_lester.sql:28` | deletes a group-shared routine | repoint (`set null`) |
| `approval_rules` | `created_by` | **cascade** | `0016_glorious_lifeguard.sql:14` | deletes an always-allow rule the group still relies on | repoint (`set null`) |
| `provider_connections` | `owner` | cascade | `0004_charming_forgotten_one.sql:12` | holds provider API keys; fine to delete, but `ais.provider_connection_id` is `ON DELETE restrict` (`0005:36`) | delete AIs first, then let it cascade (§8) |
| `sticker_packs` | `owner_id` | cascade | `0029_sloppy_jigsaw.sql:32` | deleting the user removes a pack that subscribers still use | decision (§8.6): delete the user's packs; keeping them for subscribers needs a system owner |

### 1c. FK exists but is `ON DELETE set null` (already safe)

| Table | Column | Evidence | Effect |
| --- | --- | --- | --- |
| `invites` | `created_by` | `0001_nifty_nomad.sql:61` | invite stays, creator cleared |
| `user_invites` | `invited_by` | `0003_shocking_boom_boom.sql:41` | invite stays, inviter cleared |
| `approvals` | `decided_by` | `0011_silky_groot.sql:22` | decision kept, decider cleared |
| `topics` | `owner_user_id` | `0018_lethal_warhawk.sql:35` | topic kept, owner cleared |
| `approval_rules` | `revoked_by` | `0016_glorious_lifeguard.sql:15` | revocation kept, actor cleared |

### 1d. No FK at all: must be deleted or kept explicitly

| Table | Column that names a user | Evidence | Action |
| --- | --- | --- | --- |
| `audit_log` | `actor_user_id` (plain text, deliberately no FK) | `0012_add_audit_log.sql:4` | **keep** (ids only, append-only; T-0124/T-0125) |
| `avatars` | `owner_id` with `owner_kind IN ('user','ai','group')` (polymorphic, no FK) | `0037_calm_star_brand.sql:1-11`; `apps/server/src/avatars/service.ts:195` | delete by owner (the user and their AIs/groups) and delete the file (§3) |
| `media_items` | `archive_owner` (a JID) | `0041_blue_magneto.sql:10` | delete by `archive_owner = <own JID>` after MAM (§2, §8) |
| `media_index_state` | `archive_owner` (a JID) | `0041_blue_magneto.sql:1` | delete by `archive_owner` |
| messages themselves | live in the ejabberd `archive` table, keyed by `username` (the user's localpart) | `apps/server/src/search/archive-query.ts:65,128` | deleted through ejabberd (§2) |
| `pinned_messages` | `chatJid`, `sender_name` | `apps/server/src/db/rows.ts:129-136` | only reached through `pinned_by` (§1b) or the group delete path |
| `chat_prefs`/`chat_reads`/`chat_deliveries` | `chat_jid` (a room JID) | `apps/server/src/db/rows.ts:154,285,294` | cascade via `user_id`; a deleted group's rows are removed by JID (`apps/server/src/groups/delete-group.ts:100-102`) |

Roster/contact summary: `contacts` is the source of truth for who is connected
to whom, and it cascades. The XMPP roster is separate and must be cleaned
explicitly (§2), because ejabberd's `unregister` does not remove the user from
*other* people's rosters.

---

## 2. ejabberd

The server reaches ejabberd only through its HTTP admin API
(`apps/server/src/xmpp/admin/client.ts`), with the credential in
`config.adminJid`/`adminPassword` (`client.ts:85`). The client today exposes
`unregisterUser` (`client.ts:141-145`) but **no MAM or upload deletion command**.

| What | ejabberd command | Client today | Evidence |
| --- | --- | --- | --- |
| delete the account (auth, roster, vcard) | `unregister` | `unregisterUser`, `client.ts:141` / `types.ts:46` | ejabberd docs: "This deletes the authentication and all the data associated to the account (roster, vcard...)" |
| delete the user's archive | `remove_mam_for_user` (or `remove_mam_for_user_with_peer`) | **missing** — must be added to `client.ts`/`types.ts` | ejabberd docs: "Remove mam archive for user" |
| kick live sessions | `user_resources`, then `unregister` closes them | `userResources`, `client.ts:162` | `client.ts:158-161` |
| remove one roster item | `delete_rosteritem` | `deleteRosterItem`, `client.ts:355` / `types.ts:73` | `client.ts:355-365` |

Notes:

- **`unregister` deletes the archive too, but do not rely on it.** ejabberd's
  `unregister` fires the `remove_user` hook that `mod_mam` implements, so the
  archive normally goes. We still call `remove_mam_for_user` explicitly if the
  account row is already gone (a resumed job), and to be explicit about MAM in
  one place. Adding the command to `EjabberdAdminClient` is required either way.
- **`unregisterUser` is not idempotent.** It throws on any non-ok response
  (`expectMutationResult`, `apps/server/src/xmpp/admin/client.ts:112-118,141-145`);
  it has no not-found tolerance (unlike `deleteAi`, which guards with
  `userExists`). A resumed job that calls it again — or after the account is
  already gone — would fail and stick in `failed`/retry forever. Guard the call
  with `userExists` (`client.ts:147-156`) first, exactly as `deleteAi` does
  (`apps/server/src/ais/provisioning-xmpp.ts:126-132`).
- **The other person's copy stays.** MAM stores one row per *archive owner*:
  every query is scoped by `username` (`apps/server/src/search/archive-query.ts:65,128`;
  the rule is spelled out at `apps/server/src/search/service.ts:74-76`). So
  deleting user A removes only A's rows; B's copy of the DM is untouched, exactly
  like Telegram.
- **Rosters: remove the user from contacts' rosters.** `unregister` does not do
  this (the account's *own* roster goes, not the reverse direction). Reuse
  `removePairRosterItems` (`apps/server/src/blocks/roster.ts:48`), which already
  deletes both directions (`roster.ts:62-65`), once per `contacts` row before the
  delete. That helper is T-1233's (`blocks/roster.ts:1-5`), best-effort and
  idempotent (a missing item is a `warn`, never a throw, `roster.ts:66-72`).
- **Groups.** The user must leave every group. `removeGroupMember` already
  implements "leave" (`input.actorId === input.targetUserId`,
  `apps/server/src/groups/members.ts:116,131`) and refuses to remove an owner
  (`members.ts:135-137`). So:
  - groups the user **owns**: hand over with `transferGroupOwner`
    (`apps/server/src/groups/ownership.ts:35`), which swaps roles under a
    per-group advisory lock (`ownership.ts:48`) and re-syncs rooms. The target
    must be a member (`ownership.ts:56-61`). **Recommendation:** oldest remaining
    member by `group_members.added_at` (see §8 for admin-vs-member nuance).
  - groups where they are the **only** member: `deleteGroup`
    (`apps/server/src/groups/delete-group.ts:38`), owner-only
    (`delete-group.ts:73-77`), which destroys every room and the per-chat rows by
    room JID (`delete-group.ts:95-105`). T-1187 / T-1243 code paths.
  - groups they are neither owner of: `removeGroupMember` self-leave.
- **Channels.** Same table (`groups.kind = 'channel'`), but a channel may never
  lose its last admin's voice (`assertChannelKeepsAnAdmin`,
  `apps/server/src/groups/members.ts:143-145`). So a channel where the owner is
  the only admin must be transferred (promote the oldest member) or deleted;
  never left ownerless.
- **MUC/Sub push subscriptions** for the user's rooms are removed by
  `unregister`; our `push_subscriptions` rows are removed by the `user_id`
  cascade (§1a).

---

## 3. Files

File kinds and where they live:

| Kind | Location | Row/table | Evidence | Delete? |
| --- | --- | --- | --- | --- |
| message uploads (attachments, voice notes) | ejabberd container, `docroot: /opt/ejabberd/upload`, served over `/upload` | none in our DB; messages reference the URL | `infra/ejabberd/ejabberd.yml:198-201`; the server only proxies/streams them (`apps/server/src/files/api.ts:215,308-315`) | **yes**, but see the note below |
| avatars (`user`, `ai`, `group`) | `AVATAR_STORAGE_DIR` (`./data/avatars`), file `<uuid>.<ext>` | `avatars(owner_kind, owner_id)` | `apps/server/src/config.ts:149`; `apps/server/src/avatars/service.ts:195,285-300` | **yes** (all three owner kinds) |
| chat backgrounds | `BACKGROUND_STORAGE_DIR` (`./data/backgrounds`) | `chat_backgrounds.user_id` | `apps/server/src/config.ts:154`; `0043_giant_nitro.sql:29` | **yes** |
| stickers | `STICKER_STORAGE_DIR` (`./data/stickers`) | `sticker_packs.owner_id`, `stickers.pack_id` | `apps/server/src/config.ts:144`; `0029_sloppy_jigsaw.sql:32-33` | decision (§8) |

**Uploads are the hard one.** They are inside the ejabberd container
(`/opt/ejabberd/upload/<user>/<host>/...`), and ejabberd exposes **no** admin
command to delete one user's HTTP-upload files. The server never touches that
filesystem (it streams via the admin API origin, `apps/server/src/files/api.ts:215`).
Deletion therefore needs an infra step (a maintenance command run where the
docroot lives, e.g. a `docker exec … rm -rf /opt/ejabberd/upload/<user>` script /
ops job) — flagged as an open decision (§8), not something the app server can do
today.

**Avatars: delete** the `avatars` rows (`owner_kind IN ('user','ai','group')`
for the user and their AIs/groups) and the files under
`AVATAR_STORAGE_DIR`; the existing remove helper already deletes row + file
(`apps/server/src/avatars/service.ts:285-300`). A group avatar goes with the
group; an AI avatar with the AI.

---

## 4. AIs, agent tokens, integrations, approvals

| Thing | Where | Evidence | Action |
| --- | --- | --- | --- |
| AI row + XMPP account + private model + gateway key | `deleteAi` | `apps/server/src/ais/provisioning-xmpp.ts:31` | run once per owned AI: revoke key (`:55-65`), delete model (`:86-97`), delete `llm_virtual_keys` (`:101`), remove both roster items (`:112-136`), unregister the AI account (`:131`), delete `ais` (`:142`) |
| `ais.provider_connection_id` → `provider_connections` | FK `ON DELETE restrict` | `0005_clean_frightful_four.sql:36` | **must delete AIs before the user row**, or the cascade that deletes `provider_connections` (`0004:12`) fails on the restrict FK |
| provider connection (provider API keys) | `provider_connections.owner` cascade | `0004_charming_forgotten_one.sql:12` | cascade after AIs are gone |
| AI memory / limits / spend / delegations | cascade from `ais` | `0042_lethal_tattoo.sql:41-44`; `0005:34`; `0009:9`; `0045:33-35` | cascade |
| machines (runner registrations) + pairing codes | cascade | `0010_bumpy_talkback.sql:25-26` | cascade; the runner heartbeat dies with the row |
| approvals the user requested / decided | `approvals.requested_by` (no FK), `decided_by` set null | `0011_silky_groot.sql:11,22` | rows stay (an approval is an audit-ish record); `decided_by` clears. Decision: keep `requested_by` id, or delete pending ones (§8) |
| `pending_actions.requested_by` | no FK | `0014_thick_runaways.sql:9` | cascades only through `ai_id`/`group_id`; a pending row from another actor survives — decide whether to cancel pending actions for the deleted user |
| integrations | `instance_settings` (server-level, e.g. Telegram bot token) | `apps/server/src/integrations/settings.ts:43,63` | **keep** — not user-owned |
| agent gateway tokens | `llm_virtual_keys` per AI | `0005:37` | revoked + deleted by `deleteAi` |

---

## 5. The 7-day grace

### 5a. Data model

A new table, so the grace is durable across restarts and multiple servers:

```sql
CREATE TABLE "user_deletions" (
  "user_id"     text PRIMARY KEY,  -- no FK to "user": the row must outlive the user delete
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "delete_after" timestamptz NOT NULL,
  "phase"       text NOT NULL DEFAULT 'scheduled',  -- scheduled | running | failed
  "started_at"  timestamptz,
  "last_error"  text
);
CREATE INDEX "user_deletions_due_idx" ON "user_deletions" ("delete_after")
  WHERE "phase" = 'scheduled';
```

`delete_after = requested_at + interval '7 days'`. One row per user
(`user_id` PK; a second request is an upsert/no-op). `phase` makes the job
claimable exactly once and resumable (§8). Only ids and timestamps; never an
e-mail or message text. **`user_id` deliberately has no FK.** If it referenced
`"user"(id)` with `ON DELETE CASCADE` (or `restrict`), step 15 would either
erase the row or fail on it, so the lease-reclaim resume would lose its key and
`account.deleted` would never be audited; the row is deleted explicitly as the
true last step (step 16), not by a cascade.

### 5b. What the account can do meanwhile

Telegram: the account stays usable, and signing in **cancels** the deletion.
Recommend the same:

- sessions stay valid; the app shows a banner "Your account will be deleted on
  <date> — Sign in or tap Cancel to undo".
- `POST /api/account/deletion` schedules; `DELETE /api/account/deletion`
  cancels; a successful sign-in (`POST /api/auth/sign-in/...`) deletes the
  `user_deletions` row (all of these idempotent).
- the deletion job **re-checks the row inside the claim transaction** (like the
  routines scheduler, §5c), so a cancel racing the job either wins or loses
  cleanly — never a half-delete.

### 5c. The job

The server has scheduled work already, so no new mechanism:

- the approvals sweeper: a 60 s timer that claims rows and audits each
  (`apps/server/src/approvals/sweeper.ts:37`, wired at
  `apps/server/src/main.ts:678`), with a conditional `UPDATE … WHERE status =
  'pending' AND expires_at < now` so two sweeps never double-act
  (`sweeper.ts:33-36`).
- the routines scheduler: a timer that claims due rows exactly once and advances
  them before running (`apps/server/src/routines/scheduler.ts:46,115-174`).

**Recommendation:** add an account-deletion sweeper built like the approvals
sweeper: on each tick, claim due rows with
`UPDATE user_deletions SET phase = 'running', started_at = now()
 WHERE user_id = $1 AND phase = 'scheduled' RETURNING user_id` (no other worker
can claim the same row), then run the ordered steps (§8). A `running` row whose
`started_at` is older than a lease (e.g. 1 h) is reclaimable. Start it in
`main.ts` after the edge is listening, like the approvals sweeper.

### 5d. Audit entries (ids only)

Written through `recordAudit` (`apps/server/src/audit/recorder.ts:41`); the
`action` field is a `domain.verb` string (`apps/server/src/audit/schema.ts:4,56`),
so no enum change is needed:

- `account.deletion_requested` — `subject_id = userId`
- `account.deletion_cancelled` — `subject_id = userId`
- `account.deleted` — `subject_id = userId`, `detail = { aiCount, groupCount, chatCount }` (numbers only)
- `account.exported` — `subject_id = userId` (see §6)

Never a handle, an e-mail, a message body, a URL or a token.

---

## 6. Export ("export my messages as JSON from MAM")

### 6a. Shape

One JSON document (streamed), with:

```json
{
  "exportedAt": "…",
  "profile": { "id": "…", "name": "…", "handle": "…", "bio": "…" },
  "contacts": [ { "userId": "…", "name": "…", "jid": "…" } ],
  "chats": [
    { "jid": "peer@domain", "kind": "dm", "messages": [ { "id": "…", "at": "…", "from": "me|them", "body": "…", "kind": "text|image|file|voice" } ] },
    { "jid": "room@muc", "kind": "room", "messages": [ … ] }
  ]
}
```

Source of the pieces: profile/contacts from our tables (reuse
`allowedArchives`, `apps/server/src/search/service.ts:77,95-143`, which already
builds the caller's `ownLocalpart`, DM peers and rooms); messages from the
ejabberd `archive` table scoped to `username = <ownLocalpart>` (the same scope
the search query uses, `apps/server/src/search/archive-query.ts:128`), converting
each row's `xml` with the existing extractor (the media indexer already parses
attachment/body out of an archive row, `apps/server/src/media/extract.ts`). DM
`bare_peer` maps to "me|them" by comparing with the caller's JID.

### 6b. Paging and size limits

- Page the archive by `id` (the `archive` table has a `bigserial id`) or by
  `timestamp`, `ORDER BY timestamp ASC`, keyset-style (`WHERE timestamp > $cursor
  LIMIT $page`), so memory stays flat regardless of history size.
- Cap one export at, say, 200 k messages or 250 MB, whichever comes first;
  exceed it and the route answers a clear `413`/`409` "Export too large —
  contact the operator" rather than truncating silently. (Numbers to confirm,
  §8.)
- The archive query already has a statement timeout and a bounded pool
  (`apps/server/src/search/service.ts:34-41`); reuse them.

### 6c. Direct streaming download vs a background file

**Recommendation: a direct `GET /api/account/export` that streams JSON**
(`Content-Type: application/json`, `Content-Disposition: attachment`), like the
files route already streams an upstream body (`apps/server/src/files/api.ts:308-315`).
It needs no storage, no cleanup job and no new table, and the archive is read
once, paged. A background-built file is more machinery (a job, a place to put
it, a link, expiry) for a feature whose data is already paged — only worth it if
Julio wants multi-GB exports. Offered from web Settings → Profile
(`apps/web/src/components/ProfileSettingsSection.tsx`, rendered by
`apps/web/src/routes/ProfilePage.tsx:16`) and from the mobile account screen
(`apps/mobile/src/lib/settings-items.ts`, §9).

### 6d. Security rules

- **Auth required** (session middleware; the authz sweep covers every new
  `/api` route automatically, `apps/server/src/authz-sweep.test.ts:12-13,141`).
- **Fresh session:** the export exposes the full message history, so require a
  recent session rather than the plain one. Better Auth's `freshAge` default is
  24 h (`apps/server/src/auth/sessions.ts:4-6`); either reuse Better Auth's
  fresh check or require `session.created_at` within, say, 30 min for this one
  route. (Decision, §8.)
- **Rate limit:** one export per N minutes per user via `createRateLimiter`
  (used by the invite/me routes, `apps/server/src/auth/api.ts:120-125`), e.g. 1
  per hour, plus the endpoint's own concurrency cap.
- **Never log** the archive rows, the XML or the exported bodies; log only
  `{ userId, byteSize, messageCount }`.
- The export reads **only** the caller's own `username` scope — never a peer's
  archive (`apps/server/src/search/service.ts:74-76`).

---

## 7. The exact delete order

Nothing may break halfway; every step must be idempotent so a crash resumes.
The model is `deleteAi` (`apps/server/src/ais/provisioning-xmpp.ts:19-33`):
each step skips work already done and is safe to re-run.

Order (after the grace expires and the row is claimed with `phase = 'running'`):

| # | Step | Why here | Idempotent because |
| --- | --- | --- | --- |
| 1 | Claim `user_deletions` row (conditional `UPDATE`, §5c) | one worker only | the `UPDATE … WHERE phase='scheduled'` returns at most one row |
| 2 | Revoke every session of the user (`session` rows) | stop new writes/tokens first | `DELETE … WHERE user_id` is already idempotent (`apps/server/src/auth/sessions.ts:102-104`) |
| 3 | Kick the user's XMPP sessions / note resources | stop live delivery | `user_resources` is a read; `unregister` at step 9 closes them |
| 4 | Tear down **every owned AI** via `deleteAi` | must precede `provider_connections` (restrict FK, `0005:36`) | `deleteAi` is explicitly resumable (`provisioning-xmpp.ts:19-24`) |
| 5 | For each **owned group/channel**: `transferGroupOwner` to the oldest remaining member, or `deleteGroup` if alone | `removeGroupMember` refuses an owner (`members.ts:135-137`); a channel must keep an admin (`members.ts:143-145`) | transfer/delete are single-transaction with advisory locks (`ownership.ts:48`, `delete-group.ts:66`) |
| 6 | For each remaining **group membership**: `removeGroupMember` (self) | leave every group, drop role rows and topic rooms | the delete + topic cleanup is idempotent (`members.ts:163-172`) |
| 7 | For each **contact**: `removePairRosterItems` | remove the user from contacts' XMPP rosters both ways (`blocks/roster.ts:62-65`) | best-effort, a missing item is a `warn` (`roster.ts:66-72`) |
| 8 | **MAM**: `remove_mam_for_user` for the user's localpart | delete the user's own archive (peer copies stay) | a second call is a no-op ("Remove mam archive for user") |
| 9 | **ejabberd account**: `if (await userExists(localpart)) unregisterUser(localpart)` | account + own roster/vcard go; call after MAM so the archive command has a user | the `userExists` guard makes a resumed run (or a run after the account is gone) a no-op; `unregisterUser` alone throws on a non-ok response (`admin/client.ts:112-118,141-145`), so it must be guarded like `deleteAi` (`provisioning-xmpp.ts:126-132`) |
| 10 | Delete `media_items` + `media_index_state` by `archive_owner = <own JID>` | derived from MAM, no FK | `DELETE … WHERE archive_owner` is idempotent |
| 11 | Retire the handle (`retired_handles` insert) — only after the FK drop in decision 4 | keeps the 30-day reservation (`handles/store.ts:18,240-246`); without the FK drop the cascade erases it at step 15, and inserting after step 15 would violate the FK | `INSERT … ON CONFLICT (handle_lower)` into `retired_handles` |
| 12 | Repoint shared references that would otherwise cascade wrongly: `groups.created_by`, `topics.created_by`, `group_roles.created_by`, `group_invite_links.created_by`, `ai_tools.created_by`, `ai_tool_versions.created_by`, `routines.created_by`, `approval_rules.created_by` | §1b: a plain `DELETE FROM "user"` would destroy other people's data | `UPDATE … SET col = <new owner>` (or migration to `set null`) |
| 13 | Delete local files: avatars (user/AI/group), backgrounds, (owned sticker files) | files outlive their rows otherwise | `rm … .catch(() => {})` per file, like `avatars/service.ts:299` |
| 14 | Delete upload files (infra step) | ejabberd container docroot, server cannot reach it (§3) | the rm script is re-runnable |
| 15 | `DELETE FROM "user" WHERE id = $1` | the cascade now removes only rows that should go (`account`, `session`, `xmpp_accounts`, `contacts`, `chat_prefs`, `chat_reads`, `chat_deliveries`, `push_*`, `chat_folders`, `user_profiles`, `machines`, …) | a second delete is a no-op |
| 16 | Record `account.deleted`, then delete the `user_deletions` row explicitly | the row has no FK, so it survives step 15 and stays the resume key until this true last step; a crash before it leaves a `running` row the sweeper reclaims | `recordAudit` inserts once; the row delete is idempotent |

**Crash mid-way.** The job is a sequence of idempotent steps keyed by the
`user_deletions` row. On restart the sweeper reclaims a `running` row older than
the lease and re-runs from the top: steps 2, 4, 6, 7, 8, 10, 11, 13, 14 are
no-ops when already done (missing row = success, matching
`provisioning-xmpp.ts:216-218` / `hasRosterItem`); step 9 is a no-op only
because it is guarded by `userExists` (§2). Steps 12, 15, 16 are plain
`UPDATE`/`DELETE`. The one ordering rule that must hold on every retry: **AIs
(step 4) before the user row (step 15)**, because of the `restrict` FK.

---

## 8. Open decisions for Julio (each with a recommendation)

1. **Groups a user created but no longer owns** (`groups.created_by` cascade,
   `0003:38`) — today deleting the user would delete those groups.
   **Recommend:** repoint `created_by` to the current owner in step 12 (a tiny
   `UPDATE`), not a migration, so no schema change is needed.
2. **Topics a user created in other people's groups** (`topics.created_by`
   cascade, `0018:37`). **Recommend:** repoint to the group owner in step 12.
3. **Groups owned at deletion** — admin vs member as the new owner.
   **Recommend:** transfer to the oldest **admin**; if there is no admin, promote
   the oldest **member**; if the user is alone, `deleteGroup`. A channel with no
   other member is deleted (it cannot have no admin).
4. **Handle after deletion** (`retired_handles` cascade, `0035:36`).
   **Recommend:** retire it for the standard 30 days
   (`HANDLE_RESERVATION_DAYS`, `handles/store.ts:18`) so nobody can impersonate
   the account immediately. This needs one small schema change in T-A: **drop
   `retired_handles_former_user_id_user_id_fk`** (`0035:36`), because the
   reservation must survive the step-15 user delete and a post-delete insert
   would violate the FK — with the cascade kept, step 15 erases the reservation
   step 11 just created. `former_user_id` stays an id-only audit column with no
   FK; the `handle_lower` primary key is what reserves. `ON DELETE set null`
   does not work: `retired_handles_owner_check` (`0035:29`) requires exactly one
   owner, so the update would fail the check.
5. **Pins, shared roles, shared tools/routines/approval-rules created by the
   user** (`0025:12`; `0027:26,28`; `0017:40,43`; `0023:28`; `0016:14`).
   **Recommend:** repoint to the group owner (`set null` where nullable), so the
   group keeps its tools and rules; delete `pinned_messages` deliberately only
   if Julio prefers the pins to go with the pinner.
6. **Shared sticker packs the user owns** (`sticker_packs.owner_id` cascade,
   `0029:32-33`) — deleting the user removes the pack from everyone subscribed.
   **Recommend:** delete the user's packs (simplest); if Julio wants subscribers
   to keep them, that needs a schema change (a system owner), so keep it out of
   the first version.
7. **Message upload files** (`/opt/ejabberd/upload`, `infra/ejabberd/ejabberd.yml:198-201`)
   — the app server cannot delete them; ejabberd has no such command.
   **Recommend:** a small ops/infra cleanup step (documented script) run as part
   of or after the job; if the docroot were moved to a shared volume the server
   could delete it directly. Needs Julio's call.
8. **Export delivery** — direct streaming `GET` vs a background-built file.
   **Recommend:** direct streaming (§6c).
9. **Export freshness** — Better Auth's 24 h `freshAge` vs a stricter 30 min for
   this route. **Recommend:** 30 min (it dumps the whole history).
10. **Export caps** — messages/bytes/rate limit numbers (§6b). **Recommend:**
    200 k messages, 250 MB, 1 export per hour; confirm.
11. **Provider connections** (AI provider API keys) — delete with the user
    (cascade) once AIs are gone. **Recommend:** delete (they are the user's
    secrets).
12. **Pending approvals/actions requested by the user** — keep the records or
    cancel them. **Recommend:** keep `approvals` rows (decided history),
    cancel pending `pending_actions` for that user so nothing runs after they
    are gone.

---

## 9. Follow-up tasks (each with its Allowed files)

Split so no task touches another's files:

### T-A — server: request/cancel + the grace table
Request and cancel endpoints, the table, the sign-in cancel hook.
Allowed: `apps/server/drizzle/*` (one new migration),
`apps/server/src/db/rows.ts`, new `apps/server/src/account/{deletion-request,schemas}.ts`,
`apps/server/src/account/api.ts`, `apps/server/src/effect/edge.ts`,
`apps/server/src/auth/api.ts`, `packages/api-contract/src/account.ts` (+ its index),
`apps/server/src/account/deletion-request.test.ts`.

### T-B — server: the deletion job and its ordered steps
The sweeper, the ejabberd `remove_mam_for_user` client method, group/AI/roster/
file cleanup, the reference repointing.
Allowed: new `apps/server/src/account/{deletion,sweeper,steps}.ts`,
`apps/server/src/xmpp/admin/{client,types}.ts`,
`apps/server/src/groups/{members,ownership,delete-group}.ts`,
`apps/server/src/ais/provisioning-xmpp.ts`, `apps/server/src/blocks/roster.ts`,
`apps/server/src/avatars/service.ts`, `apps/server/src/backgrounds/*`,
`apps/server/src/handles/store.ts`, `apps/server/src/main.ts`,
`apps/server/src/account/deletion.test.ts` (+ test-support).

### T-C — server + web: export
The streaming export route and the extractor reuse.
Allowed: new `apps/server/src/account/{export,export-xml}.ts`,
`apps/server/src/account/api.ts`, `apps/server/src/media/extract.ts`,
`packages/api-contract/src/account.ts`, `apps/server/src/effect/edge.ts`,
`apps/server/src/account/export.test.ts`.

### T-D — web UI: request/cancel + export
The Settings → Profile entries and the confirmation flow.
Allowed: `apps/web/src/components/ProfileSettingsSection.tsx`,
new `apps/web/src/routes/AccountPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`,
new `apps/web/src/lib/api/account.ts`, `apps/web/src/lib/api.ts`.

### T-E — mobile UI: request/cancel + export
One new Settings entry; the account screen.
Allowed: `apps/mobile/src/lib/settings-items.ts` (**add ONE entry — do not
reorder or reformat**, AGENTS.md §Pitfalls), new
`apps/mobile/src/app/settings/account.tsx`, new
`apps/mobile/src/lib/account-api.ts`.

Order: T-A first (the table + contract), then T-B and T-C in parallel, then T-D
and T-E. Each depends on T-A's contract and table.
