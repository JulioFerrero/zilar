---
id: T-0113
title: Chat preferences: mute, archive and pin chats and topics (per user, synced)
status: planned
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
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Push notification delivery, per-topic custom sounds, scheduled "do not disturb", mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
