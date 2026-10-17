---
id: T-1817
title: "Web topic panel lists the real members of a public topic (since T-1802 a public topic has its own members); only General keeps the 'everyone in the group' line"
status: merged
milestone: M5
branch: task/T-1817-web-public-topic-members
model: auto
effort: default
depends_on: [T-1802]
estimate: 20 min
---

# T-1817: Public topics list their members on web

## Spec (written by Claude, do not edit)

### Why
**Web mock mode on 2026-10-17:** the topic panel of a public topic ("Dev team › Checkout button hidden on Safari") says "Public topic · All 6 members" and "All 6 members of Dev team can read and write here."
- **That's no longer true:** since T-1757/T-1762 the reads, and since T-1802 the writes, a public topic has its own members. Only General is everyone.
- **The board lists them:** `docs/design/mockups/topic-people/WebTopic.dc.html` shows a public topic ("Financial") with its People list ("People 4": Julio (you), JULITO, claude_test, Marta).

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/TopicPanel.tsx`** (358 lines):
  - `isPrivate = topic.visibility === 'private'` (`:105`);
  - the header suffix (`:178-183`): `isPrivate` gives "· {n} members" from `membersState`, a public topic gives "· All {memberCount} members";
  - `<TopicMembersSection isPrivate={isPrivate} … allMembersText={`All ${memberCount} members of ${groupTitle} can read and write here.`} />` (`:220-230`).
- **`apps/web/src/components/panels/TopicMembersSection.tsx`** (93 lines): `isPrivate ? <list> : <p>{allMembersText}</p>` (`:46-90`).
- **The members already load for every topic:** `useListLoader({ load: () => listTopicMembers(topicId) … })` (`apps/web/src/components/panels/topicPanelOps.ts:49-55`). The server lists `topic_members` plus role holders for every non-General topic, and the whole group for General (`apps/server/src/topics/queries.ts:52-90`).

### Steps
1. **`TopicMembersSection`:** rename the prop `isPrivate` to `listsMembers`. `TopicPanel` passes `listsMembers={topic.isGeneral !== true}`, so every non-General topic shows the list. General keeps the line, now "Everyone in {groupTitle} can read and write here."
2. **The header suffix:** any non-General topic shows "· {n} members" from the ready `membersState`; General shows "· Everyone".
3. **Leave every other `isPrivate` use as it is** (roles section, danger zone, the Add dialog's candidates): those really are about private topics.
4. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `work/T-1817-web-public-topic-members.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In web mock mode, a public topic's panel lists its members, with remove for managers as for private topics.
- General says "Everyone in …".
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/components/panels/TopicMembersSection.tsx`: renamed the `isPrivate`
  prop to `listsMembers`, so the member list renders for every topic whose panel
  passes `true` (and the "everyone" line only for General). Updated the doc comment.
- `apps/web/src/components/TopicPanel.tsx`:
  - The Members section now gets `listsMembers={topic.isGeneral !== true}` and
    passes the line "Everyone in {groupTitle} can read and write here." as
    `allMembersText`.
  - The header suffix now shows `· Everyone` for General and
    `· {n} members` from the ready `membersState` for every other topic (private or
    public); it stays empty while the members are loading or failed.
  - Removed the now-unused `memberCount` constant (T-1492 comment included).
- Other `isPrivate` uses (roles section, danger zone, Add dialog candidates) are
  untouched, per the spec.

### Checks run

- `pnpm install`: completed, "Done in 26.1s using pnpm v10.32.1" (only the
  pre-existing `@types/react-dom` peer warning).
- `pnpm gate` (from the repo root), exit code 0:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (6.9s)
  PASS  effect  (1.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the spec says no tests (UI change) and the gate
  skipped `@zilar/web` because there are no nearby test files.

### Notes for the lead

- I didn't run the web app in mock mode (no browser session in this task); the
  acceptance items are covered by the code paths above and the gate.
- Changed files: `apps/web/src/components/TopicPanel.tsx`,
  `apps/web/src/components/panels/TopicMembersSection.tsx`, and this task file.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `7cc1df94a`.
- **`TopicMembersSection`** takes `listsMembers = topic.isGeneral !== true`, so a public topic lists its loaded members (with remove for managers). General says "Everyone in {group} can read and write here."
- **The header suffix** is "· {n} members" for a non-General topic and "· Everyone" for General.
- **The lead checks** the panel in local web mock mode on main right after this merge.
