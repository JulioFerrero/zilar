---
id: T-1837
title: "Web 'In this topic' panel matches WebTopic.dc.html: AIs then People, each a counted section of grouped 44 px rows (AI: badge, 'yours'/'Marta's', a ⋯ menu with memory and Remove; person: '(you)', an Owner crown, a ⋯ Remove for managers), then the Tools and routines row"
status: merged
milestone: M5
branch: task/T-1837-web-topic-panel-board
model: auto
effort: default
depends_on: [T-1836]
estimate: 40 min
---

# T-1837: The web topic panel follows its board

## Spec (written by Claude, do not edit)

### Why
**The lead compared the live panel ("ai test › cards test", 2026-10-17) with `docs/design/mockups/topic-people/WebTopic.dc.html:84-125`.** The board's panel goes:
1. the Add key;
2. **AIs** (count on the right);
3. **People** (count on the right), each list one grouped card of 44 px rows;
4. the Tools and routines row;
5. Mute and Leave.

**The live panel differs:**
- the order is Members, Topic, "AIs in this topic";
- the rows are loose, 32 px avatars with visible "Remove" pills and a brain key;
- the AI row reads "Added by you" where the board says "yours".

Julio's rule (10-16, "design looks nice, app is ugly"): UI matches the board.

### Facts (read by the lead on 2026-10-17)
- **The board** (`WebTopic.dc.html`):
  - **Sections:**
    - `.sec` (`:37`): 12 px, weight 600, muted; the label on the left and the count on the right in mono, weight 400.
    - `.group` (`:32`): `#111` surface, `#1f1f1f` border, 12 px radius.
    - `.row` (`:33`): min-height 44 px, padding `0 8px 0 10px`, 1 px `#1a1a1a` divider, 14 px text, 10 px gap.
    - Avatar: 28 px (`:34`).
  - **AI row** (`:93`): avatar, name plus the `AI` badge, then "yours" (12 px, muted), then a ⋯ key `aria-label="Deepseek options"`.
  - **People rows** (`:99-102`): the avatar, then the name with a muted " (you)". The owner gets a crown icon, `role="img" aria-label="Owner"`.
- **The web pieces:**
  - **`TopicPanel.tsx`** (365 lines) renders, in order:
    - Add (`:214-221`);
    - `TopicMembersSection` (`:223-233`);
    - the "Topic" link/done section (`:238-254`);
    - `TopicAisSection` (`:256-265`);
    - the memory dialog;
    - rules, roles, `TopicToolsRow` (`:291-298`), pins, the danger zone;
    - `TopicMuteLeave`.
  - **`aiOwnerName(aiId)`** (`:161-170`) returns "you", a member's name or "someone".
  - **`panels/TopicMembersSection.tsx`** (93 lines):
    - `<h2>Members</h2>`;
    - rows `flex items-center gap-2 rounded-xl px-2 py-1.5`, with `EntityAvatar size={32}`;
    - a mono role badge for non-members (`:76-80`);
    - `RemoveMemberButton` for managers (`:81-83`).
  - **`panels/TopicAisSection.tsx`** (88 lines):
    - `<h2>AIs in this topic</h2>`;
    - rows with "Added by {owner}";
    - a Brain key that opens the memory dialog;
    - `RemoveAiButton` when `canRemove` (`:43-86`).
  - **The button helpers:** `RemoveMemberButton` and `RemoveAiButton` (`panels/TopicActionButtons.tsx:16,84`) each run a `useAction` with an inline failure.
  - **The kit:**
    - grouped cards in the group panel use `divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface` (`group-info/GroupInfoRoot.tsx:198`, `group-info/TopicsSection.tsx:180`);
    - the ⋯ menu is `Menu`/`MenuItem` from `ui/menu.tsx:54,110` (Base UI; `trigger` prop);
    - `AiBadge` is in `AiBadge.tsx:4`.

### Steps
1. **`TopicPanel.tsx`:** move `TopicAisSection` (and the memory dialog) above `TopicMembersSection`. Move `TopicToolsRow` right after the members section.
   - Keep everything else, in its current order, after the tools row.
   - Pass `ownerLabelOf`: "yours" for me, else `"<Name>'s"`, else nothing. Use it in place of "Added by …".
   - Keep the file at most 400 lines.
2. **`TopicAisSection.tsx`:**
   - **Header:** a row with "AIs" on the left and the count (`font-mono font-normal`) on the right, at 12 px, weight 600, muted.
   - **The list:** one grouped card, using the group panel's classes above. Each row is `min-h-[44px] gap-2.5 pl-2.5 pr-2`, with `EntityAvatar size={28}`, the name plus `AiBadge`, and the owner label at 12 px, muted.
   - **The ⋯ key:** `aria-label="<Name> options"`, opening a `Menu` with "What <Name> remembers" (opens the memory dialog) and, when `canRemove`, "Remove from topic". Keep the existing remove call and its inline failure; move the logic out of the button if needed.
   - **The empty and loading lines** stay as they are, under the header.
3. **`TopicMembersSection.tsx`:**
   - **Header:** "People" with the member count, same style as step 2. General keeps its "Everyone in … can read and write here." line and shows no count.
   - **Rows:** the same grouped card and 44 px rows, with 28 px avatars and the name plus a muted " (you)".
   - **Role marks:** the group owner gets a lucide `Crown` (size 15, muted, `role="img" aria-label="Owner"`); an admin keeps the mono "admin" badge.
   - **Managers:** they get a ⋯ key `aria-label="<Name> options"` with "Remove from topic" on other people's rows. The board shows no remove; this keeps the manager action without a visible pill.
4. **No other files.** No tests (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/panels/TopicAisSection.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `apps/web/src/components/panels/TopicActionButtons.tsx`
- `work/T-1837-web-topic-panel-board.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In web mock mode,** a topic's panel shows Add, then AIs, then People: counted sections with grouped 44 px rows and 28 px avatars, "yours" on your AI, a crown on the owner, and a ⋯ menu instead of the pills.
- **Then** come the Tools and routines row and the rest.
- **Remove and memory** still work from the menus.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/components/TopicPanel.tsx`** — moved the sections into the board's order: Add, `TopicAisSection` and the memory dialog, `TopicMembersSection`, `TopicToolsRow`, then the Topic link/done section, rules, roles, pins, danger zone and mute/leave unchanged. Replaced `aiOwnerName` ("Added by …") with `aiOwnerLabel`: `yours` for my AI, `"<Name>'s"` for another member's, `undefined` when the owner is unknown. Updated the panel's doc comment. 365 lines.
- **`apps/web/src/components/panels/TopicAisSection.tsx`** — heading is now `AIs` with the count in mono on the right (12 px, 600, muted). The rows are one grouped card (`divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface`), each `min-h-[44px] gap-2.5 pl-2.5 pr-2` with a 28 px avatar, the name plus `AiBadge`, the owner label at 12 px muted, and a `⋯` key labelled `<Name> options`. The menu holds "What <Name> remembers" (opens the memory dialog) and, when `canRemove`, "Remove from topic" (destructive). Loading/error/empty lines stay under the header. 146 lines.
- **`apps/web/src/components/panels/TopicMembersSection.tsx`** — heading is `People` with the member count (no count on General). Rows use the same grouped card and 44 px row shape with 28 px avatars, a muted " (you)", a lucide `Crown` (`size-[15px]`, muted, `role="img" aria-label="Owner"`) for the owner and the mono `admin` badge for admins. Managers get the `⋯` key only on other people's rows, with "Remove from topic" in the menu. General keeps its "Everyone in … can read and write here." line. 156 lines.
- **`apps/web/src/components/panels/TopicActionButtons.tsx`** — removed the visible `RemoveMemberButton`/`RemoveAiButton` pills and moved their `useAction` + inline failure into `useRemoveMember`/`useRemoveAi`, called by each row so two rows can still run at once and a row ignores a second click while it waits. Added the shared `TopicOptionsKey` (spreads the Base UI trigger props, so the menu opens). Add buttons unchanged. 140 lines.
- No other files changed; no tests added (UI task).

### Checks run

- `pnpm install` — done in 13.7s.
- Targeted `pnpm exec prettier --write` on the four changed code files — formatting only.
- `pnpm gate` (first run) — `FAIL lint`: `TopicActionButtons.tsx:6:38 Type 'TopicAi' is imported but never used`. Removed the unused import and reran.
- `pnpm gate` (final) — ended with `GATE PASS`:
  ```
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.0s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did not start the web app or click through mock mode: starting a dev server is a background job, which AGENTS.md forbids. The UI was verified by typecheck/lint only; it needs Julio's live look.

### Notes for the lead

- The board shows no remove pills, so the manager action now lives in the `⋯` menu, as the spec asked. The menu only appears when there is an action (manager and not me, or every AI row, whose menu always has the memory item).
- The AI owner label is omitted when the group detail has not loaded the owner yet, instead of falling back to "someone" (spec: "else nothing").
- General shows `People` without a count and keeps the "Everyone in … can read and write here." line.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `18d44830c`.
- **Checked in web mock mode on the branch** (vite on 5179, "Checkout button hidden on Safari"), against `WebTopic.dc.html`. The panel shows:
  - Add, then **AIs 1** (Dev-1, AI badge, "yours", ⋯);
  - **People 4** (crown on the owner, the "admin" badge, ⋯ on the others);
  - Tools and routines, then the rest.
- **The ⋯ menu** opens "What Dev-1 remembers" and "Remove from topic".
- **Files stay under 400 lines** (TopicPanel 364).
