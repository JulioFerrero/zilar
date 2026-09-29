---
id: T-0111
title: Topics (web): nested sidebar, topic view, task strip on every topic, new-topic dialog, members panel
status: planned
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
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Mobile (T-0112), roles (T-0116), pinned messages (T-0114), chat prefs (T-0113), drag-to-reorder topics, per-topic notification settings beyond mute, usage or cost tracking.

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
