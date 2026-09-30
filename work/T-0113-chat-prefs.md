---
id: T-0113
title: Chat preferences: mute, archive and pin chats and topics (per user, synced)
status: merged
milestone: M5
branch: task/T-0113-chat-prefs
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108]
estimate: 1.5 days
---

# T-0113: Mute, archive, pin chats

## Spec (written by Claude, do not edit)

### Why
D28: a good daily chat needs the Telegram basics. Today `muted` exists only in client state and is never saved. This task stores per-user preferences on the server so they follow the user across web and phone: **mute** (with a duration), **archive** (hidden from the main list), **pin** (kept at the top). They apply to a DM, a group, and to individual **topics** (T-0108).

### Data and API
- Table `chat_prefs`: `user_id` (fk cascade), `chat_jid` (the room JID or DM JID, text ≤ 255), `muted_until` (timestamp, nullable; a far-future value means "forever"), `archived` (bool), `pinned_at` (timestamp, nullable; newer pins sort first), `updated_at`; pk `(user_id, chat_jid)`. Migration via `pnpm --filter @galena/server db:generate`. A row with all defaults is deleted rather than kept.
- `GET /api/chat-prefs` → the caller's rows. `PUT /api/chat-prefs/:chatJid` `{ mutedUntil?: string | null, archived?: boolean, pinned?: boolean }` (partial update; JID URL-encoded) validated with zod. **A user can only set prefs for chats they belong to:** DMs with their contacts or their own AIs, group General rooms and topic rooms they can see (use the T-0108 access helpers; a JID they cannot see answers 404, same as unknown). Limits: 200 rows per user, 20 pinned. Rate limit 60 writes per minute per user.
- Prefs never leak: reads are own-rows only; no audit entries (they are personal settings).
- Mute semantics for the clients: while `mutedUntil` is in the future the chat produces **no unread badge in the list totals, no notification and no sound**; the per-chat unread number is still shown in a muted style. (Web push and native push honour it later; keep the field authoritative.)

### Web (`apps/web`)
- `lib/api.ts` + store: load prefs with the chat list, merge into `ChatSummary` (`muted`, new `archived`, `pinnedAt`), optimistic updates with rollback.
- Chat list: pinned chats/topics first (a small pin icon), archived hidden from the main list with an **Archived (n)** row at the bottom that opens the archived list; a new archive does not auto-unarchive on a new message (Telegram does for muted chats not; here archived chats stay archived until the user unarchives; document it).
- Row and header menus: Pin/Unpin, Mute (options: 1 hour, 8 hours, 1 day, 1 week, forever, Unmute), Archive/Unarchive. Muted rows show a muted icon and a grey badge. Folder unread totals exclude muted chats.
- Topics: the same menu on a topic row; muting a group mutes all its topics (stored as a pref on the General room JID and applied by the client to every topic of the group unless a topic has its own row).
- Mock mode supports all of it in memory.

### Mobile
Out of this task (follows in T-0112's area later); only make sure the API is documented in the Report.

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md` (access helpers), `docs/design/ui-style.md`
- `apps/server/src/chats/routes.ts`, `topics/access.ts` (from T-0108), `rate-limit.ts`, `authz-sweep.test.ts`
- `apps/web/src/store/{realStore,store}.ts`, `components/{ChatList,ChatListItem,ChatHeader}.tsx`, `packages/chat-core/src/types.ts` (`muted` already exists)

### Allowed files
- `apps/server/src/chat-prefs/**` (new), `apps/server/src/db/schema.ts` + migration, `apps/server/src/app.ts`, `authz-sweep.test.ts`
- `apps/web/src/**` (store, lib, components, mock and tests), `packages/chat-core/src/types.ts` (optional fields)
- `docs/SERVER_CONFIG.md` (one line), `work/T-0113-chat-prefs.md`

**Not allowed:** mobile, other packages, dependencies.

### Tests
- Server: CRUD, partial updates, defaults delete the row, limits, 404 for a chat the user cannot see (a private topic they are not in), 401 without a session, rate limit, sweep.
- Web: merge into summaries, ordering (pinned first), archived list, mute durations, folder unread excludes muted, optimistic rollback, group mute applies to topics, mock mode.

### Acceptance criteria
- [ ] Prefs are saved per user on the server and shown on every device; a user cannot set or read prefs for a chat they cannot see.
- [ ] Muted chats do not count in totals; archived chats are out of the main list until unarchived.
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
- Push notification delivery, per-topic custom sounds, scheduled "do not disturb", mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Server: `chat_prefs` table (`user_id` cascade, `chat_jid` ≤ 255 via check, `muted_until`/`archived`/`pinned_at`/`updated_at`, pk `(user_id, chat_jid)`), migration `0024_abandoned_skullbuster.sql` via `db:generate` (plus prettier on the generated snapshot, which drizzle emits unformatted under prettier 3.9.9).
- `apps/server/src/chat-prefs/service.ts`: `requireChatAccess` (DM with a contact or own AI, or a group General/topic room visible under T-0108's `canSeeTopic`; anything else — malformed, wrong domain, invisible — answers 404 `not_found`), `listChatPrefs` (own rows only), `putChatPref` (partial update, defaults-delete the row, 200-row and 20-pin caps as 409s).
- `apps/server/src/chat-prefs/routes.ts`: `GET /api/chat-prefs` → `{ prefs }`; `PUT /api/chat-prefs/:chatJid` (zod-strict partial `{ mutedUntil?, archived?, pinned? }`, JID URL-decoded, rate limit 60 writes/min/user via the shared in-memory limiter). Mounted in `app.ts`. No audit entries (personal settings).
- Web: `ChatSummary` gains optional `archived`/`pinnedAt` (`muted` already existed). `lib/chatPrefs.ts` holds durations (1h/8h/1d/1w/forever; forever = 2126-01-01), `applyChatPrefs` (expired mutes read unmuted), `sortPinnedFirst` (newer pins first), `effectivePrefFor` (topic falls back to the group General row). Real store loads prefs with the chat list (boot + background refresh + createGroup), merges them, and does optimistic pin/mute/archive with rollback. `folderUnread` excludes muted chats; `visibleChats` pins first and hides archived.
- UI: `ChatActionsMenu` (Pin/Unpin, Mute with the 5 durations + Unmute, Archive/Unarchive, inline save error) on each row (hover/focus `…` button) and in the chat header menu; pin icon on pinned rows; muted icon + grey badge stay as before; `Archived (n)` collapsible row at the bottom of the list. New messages never auto-unarchive (documented in the type comment).
- Mock mode: in-memory `chat_prefs` in `mock/api.ts` (`GET` + `PUT` with defaults-delete and a 20-pin cap); the mock store goes through the same `putChatPref`/`listChatPrefs` API and re-merges server truth. `docs/SERVER_CONFIG.md` gains a "Chat preferences" note.
- Mobile API doc (spec asks for it in the Report): `GET /api/chat-prefs` → `{ prefs: [{ chatJid, mutedUntil: string|null, archived: bool, pinnedAt: string|null, updatedAt }] }`. `PUT /api/chat-prefs/:chatJid` (URL-encoded bare JID) with any subset of `{ mutedUntil: ISO-datetime-with-offset | null, archived: bool, pinned: bool }`; mute = `mutedUntil` in the future (far-future = forever), pin = `pinned: true` (server stamps `pinnedAt`; newer sorts first). Answers the row, or `{ prefs: null }` when the write lands on defaults (row deleted — drop it locally). 404 `not_found` for any JID the user cannot see (same as unknown); 409 `too_many_prefs`/`too_many_pins`; 429 `rate_limited`; 401 without a session. Group mute = pref on the General room JID, applied by the client to every topic of the group unless the topic has its own row.

### Files changed
- `apps/server/src/db/schema.ts` (+ `drizzle/0024_abandoned_skullbuster.sql`, meta snapshot/journal)
- `apps/server/src/chat-prefs/service.ts`, `routes.ts`, `chat-prefs.test.ts` (10 tests)
- `apps/server/src/app.ts` (mount), `authz-sweep.test.ts` untouched (new routes covered by the sweep automatically)
- `packages/chat-core/src/types.ts` (`archived?`, `pinnedAt?`)
- `apps/web/src/lib/api.ts` (`listChatPrefs`, `putChatPref`), `lib/chatPrefs.ts` + `lib/chatPrefs.test.ts` (6 tests)
- `apps/web/src/store/store.ts` (interface, selectors, mock store via mock API), `store/realStore.ts` (load/merge/optimistic), `store/realStore.test.tsx` (+4 tests), `store/reload.test.tsx` (fake API seam)
- `apps/web/src/components/ChatActionsMenu.tsx` (new), `ChatList.tsx` (Archived row), `ChatListItem.tsx` (pin icon, row menu), `ChatHeader.tsx` (menu), `ChatPrefs.test.tsx` (6 UI tests)
- `apps/web/src/mock/api.ts` + `mock/api.test.ts` (+1 test), `docs/SERVER_CONFIG.md`, `work/T-0113-chat-prefs.md`

### Commands run and real results
- `pnpm install`: pass (9.4s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!") after prettier --write on touched files + the drizzle journal/snapshot (drizzle emits the snapshot unformatted under prettier 3.9.9; older snapshots pass untouched)
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (turbo 10/10)
- `pnpm --filter @galena/server test --maxWorkers=2`: 72 files passed, 5 skipped; 1259 passed, 7 skipped (268s). Includes the 10 new chat-prefs tests and the authz sweep (new routes answer 401 unauthenticated).
- `pnpm --filter @galena/web test --maxWorkers=2`: 61 files passed, 682 passed — but the process exits 1 on a pre-existing unhandled `message_not_found` rejection from the `openAtMessage` stall test in `realStore.test.tsx`. Verified pre-existing: the same failure occurs on the base commit with my changes stashed. My new tests: 6 (chatPrefs) + 6 (ChatPrefs UI) + 4 (realStore prefs) + 1 (mock api) = 17, all pass.
- `pnpm build`: pass (2/2 turbo tasks)
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|as any` in new/changed source: no hits.

### Problems, deviations from the spec, open questions
- Unread-badge/mute semantics: the per-chat unread number still shows (muted style) and folder totals exclude muted chats; there is no notification/sound code in the web app today (grep for Notification/Audio found nothing outside voice playback), so "no notification and no sound" holds vacuously — the `mutedUntil` field is authoritative for future push work.
- Group-mute-applies-to-topics is client-side via `effectivePrefFor` (falls back to the General row); the server stores exactly one row per JID, no fan-out. Topic rows, when present, win over the group row.
- Expired mutes are treated as unmuted on read but the stale row stays until the next write to that chat; no sweeper (out of scope, avoids a new background job).
- The `PUT` route rate-limits only after access checks pass (a 404 for an invisible chat does not consume quota); invalid bodies (400) also bypass the limiter, matching the topics route pattern.
- `PUT` response shape: the row on save, `{ prefs: null }` on defaults-delete (a small deviation from a bare `204/200` to let the client drop the row without a refetch).
- Archiving a group archives its General JID; topics keep their own rows. Web push/native push honouring mute is later work (out of scope), as is mobile UI.

### Round 2 — web half redone on top of T-0111 (topics UI)
- The server half was left untouched (lead-rebased; two lead fixes noted in the handoff). All work below is `apps/web` + `packages/chat-core`.
- New files restored from `t0113-orig` and adapted: `components/ChatActionsMenu.tsx` (now exports shared `ChatPrefMenuItems` + `CHAT_MENU_ITEM_CLASS` plus the floating `ChatActionsMenu`), `components/ChatPrefs.test.tsx`, `lib/chatPrefs.ts`, `lib/chatPrefs.test.ts`. `lib/api.ts` regained `ChatPref`/`listChatPrefs`/`putChatPref`; `mock/api.ts` regained the in-memory prefs endpoints.
- `chat-core/src/types.ts`: added only `archived?`/`pinnedAt?` next to T-0111's `groupId`/`groupTitle`/`topic` fields.
- Menus combined: the topic header kebab keeps "Topic info" + "Search" (`startChatSearch` untouched), then Pin/Unpin, Mute (duration list + Unmute), "Archive chat"/"Unarchive chat", and last under a divider the manager-only "Archive topic for everyone" (renamed from "Archive topic" so the per-user and manager actions are never confused). Non-topic header kebab now opens the same per-user menu (the info/settings panel stays reachable via the title button). Row menus: `ChatListItem` (DMs/groups) and `TopicRow` both have the hover/focus `…` button with pin icon on pinned rows.
- List semantics: `groupChats` hides per-user archived DMs/AIs (bottom "Archived (n)" list via `archivedChats()`), while per-user archived topics stay in their group and share the group's existing Archived toggle (manager-archived + per-user in one section, never two). Pinned groups (General row's pref) float first among groups, pinned topics first inside their group with General first among the unpinned, newer pins first. `applyChatPrefs` inherits a group (General) mute into sibling topics unless a topic has its own row (own row only mutes, never archives/pins).
- Tests: 17 ChatPrefs UI + 7 chatPrefs unit (incl. group-mute inheritance) + 4 realStore prefs + 1 mock api; T-0111 suites (TaskStrip, TopicsSidebar, TopicPanel, ChatList, FolderTabs, api.topics, realStore.topics) all still pass.

### Commands run and real results (round 2)
- `pnpm install`: pass (already up to date)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (turbo 10/10)
- `pnpm --filter @galena/web test --maxWorkers=2`: 69 files passed, 742 passed, exit 0 (the pre-existing `openAtMessage` unhandled rejection from round 1 no longer appears)
- `pnpm --filter @galena/server test --maxWorkers=2`: 73 files passed, 5 skipped; 1294 passed, 7 skipped (lead's server half, untouched by me)
- `pnpm build`: pass (2/2 turbo tasks)
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|as any` in touched source: no hits.

---

## Review (written by Claude)

**Verdict:** Approved and merged. The web half is covered by tests and mock mode but was not checked in a real browser on Julio's chats (no browser was connected during the night).

### Findings
- Server: per-user rows only, access checked with the topic rules (404 for a chat the caller cannot see), row cap 200, pin cap 20, write rate limit, all-default rows deleted, no audit entries. Lead fixes: the DM check loads only the contacts' accounts, and a malformed percent escape in the JID answers 404.
- T-0111 merged first and rewrote the shared web files, so the lead kept the server half and had the worker redo the web half on top of topics. The per-user "Archive chat" is separate from the manager's "Archive topic for everyone", and both share one Archived section.

### Follow-ups
- Live check: pin a group and a topic, mute a group (its topics follow), archive a DM and find it under Archived, and confirm the phone app is unaffected (mobile follows later).
- Mobile support for chat prefs.
