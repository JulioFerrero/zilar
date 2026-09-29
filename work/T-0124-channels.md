---
id: T-0124
title: Channels: one-way broadcast feeds (only admins post, members subscribe)
status: planned
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
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Discussion comments under posts, public @handles and channel directories, view counters, scheduled posts, mobile UI, usage or cost tracking.

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
