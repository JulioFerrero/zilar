---
id: T-1249
title: "Web: the group panel (members, Add members, Leave group, Make owner, Delete group) is reachable from every group topic — a 'Group info' item in the chat header menu and a link in the topic panel; today it only opens for a group with no topic, which never happens"
status: merged
milestone: M5
branch: task/T-1249-web-group-panel-reachable
model: auto
effort: default
depends_on: [T-1243]
estimate: 0.2 day
---

# T-1249: Make the group panel reachable on the web

## Spec (written by Claude, do not edit)

### Why
The lead found this on the local web mock while checking T-1243.
- **The panel can't open:** `ChatView.tsx` passes `onOpenGroupPanel` only when `chat.kind === 'group' && chat.topic === undefined` (`apps/web/src/routes/ChatView.tsx:188-190`). Every group has a General topic (`apps/server/drizzle/0019_general-topics.sql`), so the group panel (`apps/web/src/components/GroupPanel.tsx`, rendered at `ChatView.tsx:238`) never opens.
- **What's unreachable:** everything in `GroupMembersSection` (`apps/web/src/components/GroupMembersSection.tsx`): the member list with roles, Add members, Remove and Leave group (T-1183), Make owner (T-1190), and Delete group (T-1243).
- **What shows instead:** the header menu shows "Topic info" (`apps/web/src/components/ChatHeader.tsx:206`), and the header click opens the topic panel (`ChatHeader.tsx:73`).

### What to build
1. **`ChatView.tsx`:** pass `onOpenGroupPanel` for every chat with `chat.groupId !== undefined`, keeping the topic panel as the header-click default for topics (`ChatHeader.tsx:73` unchanged).
   - Render `GroupPanel` with the chat it needs: check whether `GroupPanel` (`:43-46`, `groupInfo(chat.id)`, `:159-163`) works when given a topic chat, or needs the group's General topic chat. Pass the General chat if so (it's found from `chats` by `groupId` and `topic.isGeneral`), and cite what you chose.
2. **`ChatHeader.tsx`:** add a "Group info" menu item (lucide `Users`) above "Topic info" when `onOpenGroupPanel` is set.
3. **The topic panel:** if it has a header with the group name (`Familia › General`), make the group name a button that opens the group panel. Find the component and cite it; skip this if it would push a file over 400 lines.
4. **Keep every touched file at most 400 lines.** No tests (UI).

### Read first
`AGENTS.md`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/GroupPanel.tsx` and `apps/web/src/components/GroupMembersSection.tsx`.

### Allowed files
`apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/topic/**`, `work/T-1249-web-group-panel-reachable.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the local web mock (Familia, owned by "You"):** the header menu shows Group info, which opens the panel with the members, Add members, and Delete group with the typed-name confirm. In Dev team, as a non-owner, it shows Leave group.

---

## Report (written by the worker when done)

### What I did
1. **`ChatView.tsx`** — added a `chats` store selector and computed `groupChat`:
   a group with no topic keeps its own row; a topic row resolves to the group's
   General topic (found in `chats` by `groupId` + `topic.isGeneral === true`,
   falling back to the open row). `onOpenGroupPanel` is now passed to
   `ChatHeader` whenever `groupChat !== undefined` (i.e. every group chat,
   topics included), and `GroupPanel` is rendered from that `groupChat`
   (still excluded for `chatKind === 'channel'`, which keeps `ChannelPanel`).
   The header click for topics still defaults to the topic panel
   (`ChatHeader.tsx` `openPanel` precedence is unchanged).
   - **Which chat and why:** I pass the group's **General topic chat**, not the
     open topic row. `GroupPanel` reads `groupInfo(chat.id)` (works for any row
     of the group, since `publish` fills every row — `groupMembers.ts:83-96`,
     `:124-126`) and resolves the General room itself for the header ball
     (`GroupPanel.tsx:159-163`). Passing General also gives the panel the
     group's Pins section rather than the topic's. Because the General row's
     `title` is the topic name (`"General"`, `drizzle/0019_general-topics.sql`),
     `GroupPanel` now shows the group title from `chat.groupTitle ?? chat.title`
     (`GroupPanel.tsx:164-178`); this also covers legacy topic-less group rows.
2. **`ChatHeader.tsx`** — imported lucide `Users`, built one `groupInfoItem`
   `MenuItem` (label `Group info`, or `Channel info` when `isChannel`, since the
   channel panel shares the `group` panel slot at `ChatView.tsx:255`), and
   placed it first in both menus: above `Topic info` in the topic menu, and at
   the top of the non-topic menu. It only appears when `onOpenGroupPanel` is set.
3. **Topic-panel group-name link — skipped.** The header with `Familia › General`
   is `apps/web/src/components/panels/TopicHeader.tsx:30-35`, which is **outside
   the Allowed files** (Allowed: `TopicPanel.tsx`, `topic/**`; `TopicHeader.tsx`
   lives in `panels/`, and no `topic/**` file renders this header). Per AGENTS.md
   I may only edit Allowed files, so I did not touch it. `TopicPanel.tsx` cannot
   turn the static `<span>` into a button without a new `TopicHeader` prop.

### Files changed
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `work/T-1249-web-group-panel-reachable.md`

All touched files stay under 400 lines (ChatView 268, ChatHeader 367,
GroupPanel 352).

### Commands run
- `pnpm install` — done, 16 workspace projects, no errors (one pre-existing
  peer-dependency warning).
- `pnpm gate` (run 1) — `FAIL format` on `GroupPanel.tsx` (my `Avatar` was
  wrapped manually). Fixed by putting it back on one line.
- `pnpm gate` (run 2), from the repo root:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files were run: the gate reports "no nearby test files" for
  `@zilar/web` and the spec says no tests (UI).

### Deviations / notes
- The menu label is `Channel info` instead of `Group info` for channels; the
  spec only names groups and channels share the same `group` panel slot, so a
  literal "Group info" there would mislabel the channel panel. Groups show
  `Group info` exactly as asked.
- I changed `GroupPanel`'s header to show `chat.groupTitle ?? chat.title` because
  passing the General chat would otherwise title the panel "General".
- Point 3 of the spec is skipped (see above); it is not verifiable from the web
  mock after this change.

### Open questions
- Is a follow-up allowed for `panels/TopicHeader.tsx` to add the group-name
  button (point 3), or should that stay out of T-1249?

### Security checklist
- UI-only change; no route, auth, secret, delete or update logic touched.

### Round (fix round 1)
- **Finding 1 (should-fix, fixed).** `ChatView.tsx`'s `groupChat` gate now
  falls back to `chat.kind === 'group'` when `chat.groupId` is absent, so a
  legacy topic-less group row (which `summaryFor` never gives a `groupId` or
  `groupTitle`) regains the header menu item and the panel. The earlier Report
  claim ("a legacy group with no topic keeps its own row") was wrong for such
  rows; this round corrects it. Commit
  `T-1249: fix finding 1 - fall back to chat kind for legacy group rows`.
  Prettier reflowed the `find` expression; I fixed that formatting in the same
  commit.
- **Finding 2 (nit, not touched).** `initialPanel` (`ChatView.tsx:34`) still
  uses the old `kind === 'group' && topic === undefined` condition, so a
  `?panel=group` deep link on a topic row is still `undefined`. It is a nit in a
  line this round does not otherwise change, so I left it as instructed. The
  menu path (finding 1) is fixed.
- **Finding 3 (follow-up, not touched).** `panels/TopicHeader.tsx` is outside
  the Allowed files; the spec's point 3 stays a follow-up.
- **Tests added: none.** Finding 1's behaviour lives in a UI component
  (`ChatView.tsx`); the spec says "No tests (UI)" and AGENTS.md says UI code gets
  no tests. A web test file would also fall outside the Allowed files. The gate
  reports `SKIP tests @zilar/web (no nearby test files)`.
- **Gate (re-run after the fix):**
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (1 nit, 1 follow-up).**
- **The change:** `ChatView` passes `onOpenGroupPanel` for every chat with a `groupId`, `ChatHeader` gets a "Group info" menu item, and `GroupPanel` resolves the group's chat.
- **Lead's check on the local web mock (Familia, owned by You):**
  - the header menu now shows "Group info" above "Topic info";
  - the panel lists the members (You as owner, Sofía with Make owner and Remove), Add members, "To leave, make someone else the owner first." and Delete group;
  - Delete group shows "Delete Familia for everyone? All topics and messages go away. This can't be undone." with the name field, and the button stays disabled until the name is typed;
  - Cancel works.
- **Follow-up:** the group name in `TopicHeader` as a button to the panel.
