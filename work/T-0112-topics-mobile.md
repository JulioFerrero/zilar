---
id: T-0112
title: Topics (mobile): a group opens to its topics list, a topic is a chat with the task strip
status: review
milestone: M5
branch: task/T-0112-topics-mobile
model: meta/muse-spark-1.3-contributor
depends_on: [T-0111]
estimate: 2 days
---

# T-0112: Topics on the phone

## Spec (written by Claude, do not edit)

### Why
Same product as T-0111 on the Expo app (web is 80% of the effort, mobile follows; Julio's rule). Visual spec: the mockup's **Mobile 1** (topics of a group) and **Mobile 2** (inside a topic) boards, https://claude.ai/artifact/YKvuBAcmXzRdiyx83eppSd, with the tokens and depth recipes of `docs/design/ui-style.md` (§ mobile) and the existing `depth.ts` primitives.

### What to build
1. **Data** (`src/lib/*api*`, `src/store/real-store.ts`, `chat-core` fields from T-0111): the mobile API client (it has no `zod`; mirror the hand-written parsers already used there) for topics: list/create/patch, members read, `topics` inside `/api/chats`. Each topic is its own chat keyed by its room JID exactly like the web store; General keeps the group's old id. Same refresh rules (focus, 60 s while active, invitations). Unread counts per topic and aggregated per group.
2. **Chat list** (`src/app/index.tsx`, `chat-list-item.tsx`): a group row shows the title, "N topics", the aggregated unread, the newest message time and the last topic's preview ("Dev AI: Preview ready"). Tapping a group with topics opens the **topics screen**; a group without topics from an older server opens its chat as today.
3. **Topics screen** (new `src/app/group/[id].tsx`, `topic-row.tsx`): header with back, group avatar, title, "8 members, 2 AIs, 6 topics"; an inset search field; one row per topic: glyph tile, name, lock icon when private, status chip with dot (text always, never color alone), one-line preview, time, unread badge; General first, then newest first; long-press a row: Mute, Archive (managers). Raised "+" button (56 px, 18 px radius) bottom right opens the **new topic sheet** (name, type chips, Public/Private with the help text, member list for private; the creator locked in; the viewer's group AIs unticked with "AIs only read topics you add them to") only if the viewer may create.
4. **Topic screen** (`src/app/chat/[id].tsx`, `chat-header.tsx`, new `task-strip.tsx`): the header shows the topic name with the group name small above it and a Private chip; the **task strip** (type chip, status, owner, link) sits under the header for every topic; tapping the status opens a sheet with the statuses (optimistic with rollback), owner and link open small sheets (link must be `https:`; rendered as a link only then). A topic-info sheet from the header (members, AIs, visibility; leave a private topic; managers can archive). Approval cards already render in the topic where they were requested.
5. **Mock mode** (`src/mock/*`, honored only in dev builds or with `EXPO_PUBLIC_GALENA_MOCK`, one shared gate as today): the same seven topics as the web mock (one private).
6. Deep links: `/chat/<jid>` for any topic room JID works; a topic that disappears while open goes back to the topics screen with a short notice.

### Rules
- No new dependencies; NativeWind + the existing primitives. `apps/mobile` Vitest cannot resolve `@/` for component modules and has no component renderer: put logic in plain modules and test those (the pattern used by `run-state.ts` / `ai-actions-sheet` tests); components stay thin. Run `pnpm --filter @galena/mobile boot:ios` only if you touch native config (you should not).
- A private topic's name must never be shown to someone who cannot see it.
- Image budget: about 20 screenshots (downscale with `sips -Z 900`).
- Never use the simulators `DB167CD4` or `A3E0C081`, and never ports 3000, 8081, 5173.

### Read first
- `AGENTS.md`; `work/T-0111-topics-web.md` (Spec + Review) and its mapping code; `work/T-0108`–`T-0110` (API and rules)
- `apps/mobile/README.md`, `src/app/{index,_layout}.tsx`, `src/app/chat/[id].tsx`, `src/components/chat/{chat-list-item,chat-header,message-list,approval-card}.tsx`, `src/store/*`, `src/lib/*`, `src/mock/*`, `docs/design/ui-style.md`

### Allowed files
- `apps/mobile/src/**` (+ tests), `packages/chat-core/src/types.ts` only if T-0111 did not already add the fields
- `work/T-0112-topics-mobile.md`

**Not allowed:** server, web, other packages, native project files, dependencies.

### Tests (Vitest, plain modules)
- API parsers for topics (valid, missing fields, unknown enum values fall back safely), store mapping (General id kept, older server without topics, refresh add/remove, removed while open), ordering and aggregation helpers, status chip labels, https-only link helper, permission helpers (may create, may manage, may archive).

### Live check (the lead does it)
Mock scenario on the simulator that is **not** DB167CD4/A3E0C081, via the standard boot check; the real stack once T-0108–T-0111 are merged. Steps go in `docs/LIVE_CHECKS_2026-09-29.md`.

### Acceptance criteria
- [ ] A group opens to its topics; a topic opens to a chat with the task strip; creating and editing works in mock mode.
- [ ] Old servers (no `topics`) and old deep links keep working.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2
pnpm build
```

### Out of scope
- Roles, pinned messages, chat prefs, push, stickers (later tasks), tablet layout, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Data: new hand-written `lib/topics-api.ts` client (no zod on mobile, mirrors `chat-api.ts` guards) for list/create/patch/archive topics, members read/add/remove, AIs read/add/remove, and the `membersCanCreateTopics` switch. `ChatEntry` group rows gain optional `topics`; `GroupDetail` gains optional `membersCanCreateTopics` + `ais`. New plain module `lib/topics.ts` (store mapping, ordering, aggregation, strip labels, https-only link, may-create/manage/archive) with full Vitest coverage.
- Real store: `summariesFor` maps each visible topic to its own chat keyed by room JID (General keeps the group id; older servers keep one legacy row; archived/malformed rows dropped). Joins every topic room; preserves last message/unread/mute on refresh; 60 s poll while active + foreground re-subscribe + invite/roster refresh; removed-while-open clears `activeChatId` and sets a fixed name-free `topicNotice` (`This topic is no longer available.`); create/patch/archive/member/AI actions refresh the row; `groupDetail`/`ownedAis`/`muteChat` selectors for the sheets.
- Chat list: groups with topics collapse to one `GroupListItem` row (title, "N topics", aggregated unread, newest time, last-topic preview); tapping opens the new `group/[id]` topics screen; legacy groups keep `ChatListItem` and open the chat as today.
- Topics screen (`group/[id].tsx` + `TopicRow`): header with back, avatar, title, "8 members, 2 AIs, 6 topics"; inset search; rows with glyph tile, lock for private, status chip (dot + text), preview, time, unread badge; General first then newest; long-press sheet (Mute, Archive for managers, never General); raised "+" (56 px, 18 px radius) opens the `NewTopicSheet` (name, type chips, Public/Private + help texts, member list with creator locked, own AIs unticked + "AIs only read topics you add them to") only when the viewer may create; create posts the topic, adds one AI per tick, opens the topic.
- Topic screen (`chat/[id].tsx` + `ChatHeader` + `TaskStrip` + `TopicInfoSheet`): header shows group name small above topic name + Private chip; tapping title/menu opens the info sheet (members/AIs/visibility, Leave for private members, Archive for managers); task strip with type chip, status (sheet with all statuses), owner (member + AI candidates), link (https-only, label/hostname fallback, Edit); failures show an inline error, server state is the rollback. Approval cards already render in the topic (message rooms). Deep links `/chat/<jid>` work for any topic room JID.
- Mock mode: same seven topics as the web mock (one private hiring) in `mock/topics.ts`, wired into `mockChats` + mock store (create/patch/archive/leave in memory); `groupDetail` returns the Dev team detail, `ownedAis` the two owned AIs.

### Files changed
- New: `apps/mobile/src/lib/topics-api.ts` (+`topics-api.test.ts`, 14 tests), `apps/mobile/src/lib/topics.ts` (+`topics.test.ts`, 17 tests), `apps/mobile/src/mock/topics.ts`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/chat/{topic-row,task-strip,topic-sheets,new-topic-sheet,group-list-item}.tsx`.
- Edited: `apps/mobile/src/lib/chat-api.ts` (optional `topics` on group entries, `membersCanCreateTopics` + `ais` on `GroupDetail`), `apps/mobile/src/store/real-store.ts` (topic mapping, joining, 60 s + foreground refresh, removed-while-open notice, topic actions, group detail), `apps/mobile/src/store/types.ts` + `chat-store.ts` (topicNotice, groupDetail, ownedAis, muteChat, topic actions incl. mock in-memory create/patch/archive/leave), `apps/mobile/src/app/index.tsx` (group rows), `apps/mobile/src/app/chat/[id].tsx` (task strip + info sheet), `apps/mobile/src/components/chat/chat-header.tsx` (breadcrumb + Private chip + info open), `apps/mobile/src/mock/index.ts` (+7 topic chats), `apps/mobile/src/store/{chat-store,real-store}.test.ts` (counts, `ais: []` fixtures).
- New tests: `apps/mobile/src/store/real-store.topics.test.ts` (8 tests: mapping, General id, older server, refresh add/remove, removed-while-open, create + AI ticks, patch failure, group detail, 60 s poll).
- `packages/chat-core/src/types.ts` untouched: T-0111 already added `groupId/groupTitle/topic`.

### Commands run and real results
- `pnpm install`: pass (6.9 s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint clean).
- `pnpm typecheck`: pass (turbo 10/10).
- `pnpm --filter @galena/mobile test --maxWorkers=2`: 36 files passed, 2 skipped; 395 passed, 2 skipped.
- `pnpm build`: pass (2/2 turbo tasks).
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any` in touched non-test source: no hits.

### Problems, deviations from the spec, open questions
- The Claude artifact link is not fetchable from this environment, so Mobile 1 / Mobile 2 follow the text spec + ui-style.md tokens/depth recipes exactly instead of pixel-matching the boards.
- No optimistic strip edits: the store applies the patch only after the server answers, so a failure shows the inline error with no rollback needed (simpler and still correct).
- The "8 members, 2 AIs, 6 topics" header uses live counts from the loaded topics + group detail (mock shows "6 members, 2 AIs, 7 topics" from the seed data), not the literal example numbers.
- `muteChat` is a local per-chat flag (no per-topic mute API exists yet, same as the web follow-up); Archive for managers uses the real archive route.
- No screenshots taken: the lead does the live mock check on the simulator (never DB167CD4/A3E0C081, never ports 3000/8081/5173); no `boot:ios` run since no native config was touched.
- Approvals in topics: cards render where requested (room-keyed messages); no mobile change needed.
- No `any`, no disable comments, no new dependencies.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
