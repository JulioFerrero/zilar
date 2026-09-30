---
id: T-0111
title: Topics (web): nested sidebar, topic view, task strip on every topic, new-topic dialog, members panel
status: merged
milestone: M5
branch: task/T-0111-topics-web
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108, T-0109, T-0110]
estimate: 3 days
---

# T-0111: Topics in the web app

## Spec (written by Claude, do not edit)

### Why
D25, D26, D29. The server now serves topics (T-0108), AIs per topic (T-0109) and topic-scoped approvals/rules/tools (T-0110). This task builds the web UI. **The visual spec is the Claude artifact "Galena Topics Mockup"** (https://claude.ai/artifact/YKvuBAcmXzRdiyx83eppSd; boards: desktop, mobile 1, mobile 2, new-topic dialog). Match its layout and states; tokens and depth recipes are in `docs/design/ui-style.md` (implement with the existing components/utilities, never ad hoc shadows).

### What to build
1. **Data** (`lib/api.ts`, `store/realStore.ts`, `packages/chat-core` types, mock): 
   - API client for the T-0108/T-0109/T-0110 routes with zod schemas: list/create/patch topics, members, AIs, `membersCanCreateTopics`, topic tools/rules (only what the UI shows).
   - `GET /api/chats` group entries now carry `topics`. The store maps **each topic to its own `ChatSummary`** keyed by its room JID (`chatJid`), with new optional fields on `ChatSummary` (in `@galena/chat-core`, backward compatible): `groupId`, `topic?: { id, glyph, kind, status, visibility, isGeneral, archived, owner, linkUrl, linkLabel }`. The General topic's `chatJid` is the group's old chat id, so existing deep links `/c/<jid>` keep working. A group with no `topics` field (older server) behaves exactly as today.
   - Joining: the store joins every visible topic room like it joins group rooms today; unread counts and last message per topic come from the existing per-chat machinery.
   - Refresh: refetch `/api/chats` when a room invitation arrives (already handled), when the tab regains focus, and every 60 s while visible, so a topic created, made private, or where I was removed appears/disappears without reload. A topic that disappears while open navigates to the group's General topic with a short notice.
2. **Sidebar** (`ChatList.tsx`, new `TopicRow.tsx`, `ChatListItem.tsx` as needed): a group is rendered as a **header row** (group avatar, title, "N topics", aggregated unread, time of the newest message) with its topics **nested underneath** in a 1 px left rail as in the mockup: General first, then the others by newest message; each row shows a raised glyph tile, the topic name (ellipsis), a lock icon for private topics, a one-line preview, the unread badge (existing rules for muted). The selected topic is highlighted (raised segment). The header row toggles collapse (chevron; state remembered per group in `localStorage`, wrapped in try/catch); collapsed shows only the header with the aggregated unread. Archived topics live under a small "Archived (n)" toggle at the bottom of the group. Search filters topics by name and keeps their group header. Folders (All/Personal/AIs/Work) treat a topic like its group.
3. **Chat header** (`ChatHeader.tsx`): for a topic show the breadcrumb `Group › Topic`, a **Private** chip with a lock for private topics, the subtitle (members/online), and in the kebab: **Topic info** (opens the panel), Search, Mute, Archive topic (managers; not General).
4. **Task strip** (new `TaskStrip.tsx`) under the header for **every** topic: type chip (TOPIC for `chat`, GENERAL for General, TASK, BUG, UI, ROUTINE), status chip with its colored dot (`open` grey, `in_progress` amber, `in_review` blue, `blocked` red, `done` green: always with the text, never color alone), owner ("Owner: Ana" / "Owner: Dev AI" / "No owner"), link chip (`linkLabel` or the hostname; opens in a new tab with `rel="noopener noreferrer"`; only `https:` URLs are rendered as links). Anyone who can see the topic can edit: click the status chip → menu of statuses; owner → picker (topic members, and AIs in the topic); link → small form (URL + optional label, validated as https). Optimistic update with rollback and an inline error. Read-only look when the request fails.
5. **New topic dialog** (new `NewTopicDialog.tsx`, opened from the New chat menu "New topic" (asks which group when several) and from a group header's "+"): name, type chips, **Public / Private** segmented control with the help text from the mockup, and for Private a people list (group members with their role tag, the creator ticked and locked) plus the viewer's own AIs that are in the group (unticked by default, with the note "AIs only read topics you add them to"). Create → `POST` topic, then one `POST /topics/:id/ais` per ticked AI, then navigate to the new topic. Shown only if the viewer may create (owner/admin, or members when the group allows it); otherwise the entry is absent (not disabled).
6. **Topic info panel** (new `TopicPanel.tsx`, used from the header kebab; same panel pattern as `GroupPanel`): visibility, members (private: list with Add/Remove for managers and a Leave button for a member; public: "All N members of the group"), AIs in the topic (the owner of an AI can add/remove it; a manager can remove any), the topic's approval **Always allowed** rules and tools count (read-only lists that reuse `AlwaysAllowedList`; rows now show the topic name), **Archive topic**, and **Make public / Make private** with a confirmation dialog for private → public that says in plain words that the topic's history becomes visible to every member of the group.
7. **Group panel** (`GroupPanel.tsx`): for owners/admins a switch "Members can create topics" (`membersCanCreateTopics`).
8. **Approval card, rules list, AI panel**: approval cards already render inside the topic they belong to (the message sits in that room); `AlwaysAllowedList` and the AI panel's rules/tools rows show `Group › Topic`.
9. **Mock mode** (`?mock=1`): the "Dev team" group gets the topics of the mockup (General, Bug: checkout button hidden on Safari with progress/preview/approval messages, UI: new pricing page, Daily standup, Release 2.4 notes, Hiring: frontend role **private**, Ideas) with strips, owners (people and an AI), one topic with unread; create/patch/members/AIs/archive work in memory; the dialog works. Keep every existing mock behaviour.

### Rules that apply
- Follow `docs/LEAD_PLAYBOOK.md` gotchas: oxlint forbids setState in effect bodies (use adjust-state-during-render), no lint disables; `?mock=1` is dropped by in-app navigation (use deep links); web first, mobile follows later (T-0112).
- Accessibility: real `<button>`s, `aria-label` on icon buttons, focus rings, Esc closes menus and dialogs, keyboard navigation in the topic list (Up/Down, Enter), reduced motion respected.
- A private topic's name must never be shown to someone who cannot see it, including in notices, breadcrumbs of other views, and tab titles.
- **Image budget for your session: about 20 screenshots** (LEAD_PLAYBOOK gotcha 17): downscale with `sips -Z 900` and capture each state once, after the code is final.

### Read first
- `AGENTS.md`; the mockup artifact (open the link; boards Main, Mobile-Topics, Mobile-Topic, NewTopic)
- `docs/design/ui-style.md`; `docs/LEAD_PLAYBOOK.md` (gotchas 17 and the web ones); `work/T-0108`, `T-0109`, `T-0110` (Specs and Reviews: the API and rules)
- `apps/web/src/components/{ChatList,ChatListItem,ChatHeader,GroupPanel,NewChatButton,NewGroupDialog,ApprovalCard}.tsx`, `approvals/AlwaysAllowedList.tsx`, `ais/AiPanel.tsx`, `store/{realStore,store}.ts`, `lib/api.ts`, `mock/*`, `packages/chat-core/src/types.ts`

### Allowed files
- `apps/web/src/**` (components, store, lib, mock, routes and their tests)
- `packages/chat-core/src/types.ts` (+ tests) for the optional `ChatSummary` fields only
- `work/T-0111-topics-web.md`

**Not allowed:** server, mobile, other packages, new dependencies.

### Tests (Vitest + Testing Library, no network)
- api client (schemas, URLs, methods, 404 → `ApiError`); store mapping (topics → chats, General keeps the old id, older server without `topics`, refresh adds/removes a topic, removed-while-open navigation).
- Sidebar: nested rendering, order, collapse persisted, archived toggle, search, unread aggregation, lock icon, keyboard navigation.
- Header breadcrumb and Private chip; task strip states, status/owner/link editing with rollback, https-only link rendering.
- New topic dialog (public/private, member list with locked creator, AI ticks, permission gating), topic panel (manager vs member vs non-manager AI owner), confirmation for private → public, group switch.
- Mock mode end to end (create a private topic in the dialog, see it in the sidebar with a lock).

### Live check (the lead does it)
Chrome on the `?mock=1` deep link: nested sidebar, open each topic, edit the strip, create a private topic, make it public with the confirmation, archive. The real stack needs T-0108–T-0110 merged and a second account; steps go in `docs/LIVE_CHECKS_2026-09-29.md`.

### Acceptance criteria
- [ ] The UI matches the mockup's structure: nested topics, lock on private ones, breadcrumb header, task strip on every topic, new-topic dialog.
- [ ] Old deep links (`/c/<group jid>`) open General; a server without topics still works.
- [ ] Nothing about a private topic is shown to anyone who cannot see it.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; the full web suite once, at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Mobile (T-0112), roles (T-0116), pinned messages (T-0114), chat prefs (T-0113), drag-to-reorder topics, per-topic notification settings beyond mute, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Data: zod API client for all T-0108/T-0109/T-0110 topic routes (list/create/patch/archive, members, AIs, `membersCanCreateTopics`, per-topic tools); `ChatSummary` gains optional `groupId`, `groupTitle`, `topic {id,glyph,kind,status,visibility,isGeneral,archived,owner,linkUrl,linkLabel}` (backward compatible). Store maps each visible topic to its own chat keyed by room JID (General keeps the group id); joins every topic room; refetches `/api/chats` on invite, on focus and every 60 s while visible; removed-while-open navigates to General with a short, name-free notice. Older servers (no `topics`) keep one row per group.
- Sidebar: group header row (avatar, title, "N topics", aggregated unread, newest time) with topics nested in a 1 px left rail, General first then by recency; raised glyph tile, ellipsis name, lock for private, preview, unread badge, selected-topic raised segment; chevron collapse persisted per group in localStorage (try/catch); "Archived (n)" toggle; search filters topics keeping the header; folders treat topics like their group; Up/Down/Enter keyboard nav.
- Header: `Group › Topic` breadcrumb, Private chip with lock, subtitle unchanged; kebab menu (Topic info, Search, Archive for managers, never General; no Mute entry — a no-op item is worse than none).
- TaskStrip on every topic: type chip (TOPIC/GENERAL/TASK/BUG/UI/ROUTINE), status chip (dot+text), owner, link chip (https-only, `noopener noreferrer`, hostname fallback); optimistic status/owner/link edits with rollback + inline error; non-https rejected inline.
- NewTopicDialog from the New-chat menu ("New topic", asks which group when several) and the header "+": name, type chips, Public/Private segmented with help text, private people list (creator ticked+locked) + own AIs in group with the "AIs only read…" note; create → POST topic → one AI add per tick → navigate. Entry hidden when no group qualifies.
- TopicPanel: visibility, private member list (Add/Remove for managers, Leave for members) / "All N members" for public, topic AIs (owner adds own, manager removes any), read-only AlwaysAllowedList filtered to the topic, tools count, Archive, Make public/private with the history-exposure confirmation dialog.
- GroupPanel: "Members can create topics" role=switch for owners/admins.
- Approvals: card confirm copy names the topic when in one ("in … only"); AlwaysAllowedList rows show `Group › Topic`; AI panel rules inherit this via the shared list.
- Mock mode: Dev team gets the 7 mockup topics with strips/owners/unread; create/patch/members/AIs/archive/visibility-confirm work in memory; dialog works; all existing mock behaviour kept.

### Files changed
- `packages/chat-core/src/types.ts`: `TopicKind/Status/Visibility/Owner/Info`, `ChatSummary.groupId/groupTitle/topic`.
- `apps/web/src/lib/api.ts` (+`api.topics.test.ts`, 18 tests): topic schemas/client, `chatEntryTopics`, `membersCanCreateTopics`, topicId/topicName on rules/approvals, per-topic tools.
- `apps/web/src/store/realStore.ts` (+`realStore.topics.test.tsx`, 7 tests): `summariesFor`, per-topic join/preview/refresh, 60 s + focus polling, removed-while-open navigation, topic actions (create/patch/AIs/members/leave/switch).
- `apps/web/src/store/store.ts`: `groupChats` (nested/sorted/searched), mock topic bundle wiring, mock store topic action stubs, `topicNotice`.
- New: `TopicRow.tsx` (TopicRow + GroupHeaderRow), `TopicKeyboardNav.tsx`, `TaskStrip.tsx` (+test, 6), `NewTopicDialog.tsx` (+test, 4), `TopicPanel.tsx` (+test, 6), `lib/topicsUi.ts`, `mock/topics.ts`.
- Edited: `ChatList.tsx`, `ChatHeader.tsx`, `ChatView.tsx`, `GroupPanel.tsx`, `NewChatButton.tsx`, `MessageBubble.tsx`, `ApprovalCard.tsx`, `AlwaysAllowedList.tsx`, `mock/api.ts` (+`api.topics.test.ts`, 6), `mock/index.ts`.
- Updated existing tests: `ChatList.test.tsx` (nested titles, topic search), `ChatShell.test.tsx` (bug-topic thread), `realStore.test.tsx`/`reload.test.tsx` (new ApiClient methods).
- New e2e: `TopicsMockE2E.test.tsx` (create private topic → sidebar with lock), `TopicsSidebar.test.tsx` (6).

### Commands run and real results
- `pnpm install`: pass (6.2 s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint clean).
- `pnpm typecheck`: pass (10/10 turbo tasks).
- `pnpm --filter @galena/web test --maxWorkers=2`: 65 files passed, 694 passed (46 s).
- `pnpm --filter @galena/chat-core test`: 10 files passed, 135 passed.
- `pnpm build`: pass (2/2 turbo tasks).
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any` in touched non-test source: no hits.
- Live visual check (own Vite on :5181, `?mock=1` deep links, Chrome screenshots): nested sidebar with lock/unread, bug-topic strip (BUG/In progress/Owner/PR #42 link), hiring private topic + kebab menu, topic panel (members/AIs/rules/tools/Make public/Archive), status menu with dots, new-topic dialog. Panel fetches fail when in-app navigation drops `?mock=1` (known gotcha 31) — verified via deep links.

### Problems, deviations from the spec, open questions
- The Claude artifact link is not fetchable from this environment (returns "user-generated and unverified" with no content), so the layout follows the text spec + ui-style.md tokens/recipes exactly instead of pixel-matching the boards.
- `listTopicApprovalRules(groupId)` reuses the existing per-group rules route filtered by topic (no `/topics/:id/approval-rules` route exists on the server); tools use the real `GET /api/topics/:id/tools`.
- NewTopicDialog's "asks which group when several": implemented (group picker when >1 eligible group); permission gating is best-effort client-side (shows entry when the detail hasn't loaded; the server enforces and the dialog reports failure).
- Image budget: 7 screenshots used (states captured once each after code was final).
- No `any`, no disable comments, no new dependencies.

### Round 2 (lead review fixes, 2026-09-30)
- Fix 2 done: the topic kebab's no-op Mute entry is removed (`ChatHeader.tsx` only; the per-chat mute flag is untouched). The kebab Search entry is intentionally left as-is on this base: per the review, on rebased `main` it must call the same `searchChat` action as the header's "Search in chat" button (one search path).
- Fix 1 (rebase onto `main`) is BLOCKED on permissions: `git rebase main` is rejected twice by the worker policy (`git rebase*` is a standing deny; `git merge`/`switch`/`push` are likewise denied), so the branch is still based on `5dc37b9` (pre-T-0117). No rebase, no merge, no branch switch was performed.
- Rebase conflict forecast (from `git diff HEAD main`, no checkout of `main`): resolving will need to keep BOTH features. Textual merges in `ChatList.tsx`, `store.ts`, `realStore.ts`, `api.ts` must keep topics UI + search plumbing; true conflicts: `ChatHeader.tsx` (topics kebab/breadcrumb/chips vs T-0117 `setSearchChat` header button — wire the kebab Search entry to the same `setSearchChat` + `galena:focus-search` action) and `mock/api.ts` (topics handlers vs `searchMessages`; note the search index iterates `mockMessages` only, so topic threads in `mockTopicMessages` won't be searchable unless the index also covers them). `NewTopicDialog.tsx`, `TaskStrip.tsx`, `TopicPanel.tsx`, `TopicRow.tsx`, `topicsUi.ts`, `mock/topics.ts`, `api.topics.test.ts`, `realStore.topics.test.ts` and the topic test files exist only on this branch and carry over. `ChatList.test.tsx`, `ChatShell.test.tsx`, `realStore.test.tsx`, `reload.test.tsx`, `mock/api.test.ts` were edited by both sides and need hand-merging. Verified on the server side that search `chatJid` values are already topic room JIDs (`chatJidFor`: groupchat rows use the room `owner`), so search hits in a topic open that topic's chat directly via `openAtMessage` + navigate — no JID remapping needed.

### Blocked / needs a decision
- The `git rebase main` step (review fix 1) needs the lead: the worker policy denies `git rebase*`. Either run the rebase + conflict resolution from the lead side, or grant a one-time allowance and I will finish it (resolve per the forecast above, re-run format:check, lint, typecheck, the full web suite `--maxWorkers=2` and build, and report real results).

---

## Review (written by Claude)

**Verdict:** Approved and merged. NOT yet checked in a real browser on Julio's real chats (no browser was connected during the night); it is covered by the mock-mode end-to-end test and the store/UI tests. Julio should look at the sidebar first thing.

### Findings
- Each topic is its own chat keyed by its room JID and General keeps the group id, so old deep links and search hits open the right chat; the 60 s and on-focus refresh and the "topic no longer available" flow are handled.
- The worker could not run `git rebase` (policy), so the lead rebased onto main (T-0117 search conflicted in `ChatHeader.tsx` and `mock/api.ts`): the topic menu "Search" and the header search button now share one action (`startChatSearch`); the no-op Mute entry is gone.
- Found and fixed on main while running the suite: T-0117's stalled-history test left an unhandled rejection that made the web suite exit 1.

### Follow-ups
- Live check in Helium: nested sidebar with the five groups, each showing its General topic; open a group, create a topic (public and private), the task strip, the topic panel, archive, and that search still opens hits.
- The mock search index does not cover topic threads.
- The kebab has no Mute (no per-topic mute API yet).
