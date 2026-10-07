---
id: T-0476
title: "Web kit batch: panel rows on ListRow (Pinned messages, Group background), archived-topics toggle on ghost Button; ListRow gains ariaLabel + focus ring"
status: merged
milestone: M5
branch: task/T-0476-web-kit-panel-rows
model: auto
effort: low
depends_on: [T-0467]
estimate: 0.25 day
---

# T-0476: panel rows onto the kit

## Spec (written by Claude, do not edit)

### Why
This is the web kit cleanup Julio picked (2026-10-07), from batch 1 "W-chat-chrome" in `docs/audit/ui-kit-leftovers.md` (W3). Three hand-rolled controls move onto the kit.

`ChatHeader.tsx:143` (the title button wrapping the name and status block) stays as it is: it is a full-row composite, the same reason the audit keeps `PinnedBanner`.

### Verified facts (do not re-derive)
- **`ListRow`** (`apps/web/src/components/ui/list-row.tsx`) takes `{ icon?, title, subtitle?, trailing?, chevron?, onClick?, href?, danger? }`.
  - With `onClick` it renders a `<button>` with `rowClass` (lines 64-67: `flex w-full items-center gap-3 px-3 py-2.5 text-left` plus a hover background).
  - It has **no `aria-label` prop and no focus-visible style**.
  - The icon goes in a 32 px `key-icon` tile.
  - Kit tests are in `apps/web/src/components/ui/kit.test.tsx`.
- **`PinsSection`** (`apps/web/src/components/PinsPanel.tsx:152-168`): a raw `<button aria-label="Open pinned messages, {count} pinned">` with a `Pin` icon, the text "Pinned messages" and a mono count. It is tested in `apps/web/src/components/PinnedMessages.test.tsx` (lines 374, 399, 425 click it by that name).
- **The group background row** (`apps/web/src/components/GroupPanel.tsx:567-578`): a raw `<button>` with an `Image` icon and "Group background" (T-0466). It is tested in `apps/web/src/components/GroupPanel.test.tsx`.
- **The archived-topics toggle** (`apps/web/src/components/TopicRow.tsx:297-305`): a raw `<button aria-expanded>` reading "Archived ({n})". It is tested in `apps/web/src/components/TopicsSidebar.test.tsx` (around line 151).
- **`Button`** (`apps/web/src/components/ui/button.tsx`) has variants including `ghost` and sizes including `sm`, and accepts `className`.

### What to build
1. **`ui/list-row.tsx`:**
   - add an optional `ariaLabel?: string`, applied to the `<button>` or `Link`;
   - add a keyboard focus style to the interactive row: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40` (the same ring the hand-rolled rows used).
   
   Extend `kit.test.tsx`: `ariaLabel` names the button.
2. **`PinsPanel.tsx` `PinsSection`:** use `ListRow` with:
   - `icon={<Pin />}`;
   - `title="Pinned messages"`;
   - `trailing={String(count)}`;
   - `ariaLabel={\`Open pinned messages, ${count} pinned\`}`;
   - `onClick={onOpen}`.
   
   Keep the `<section aria-label="Pinned messages">` wrapper.
3. **`GroupPanel.tsx`:** the group background row becomes `ListRow` with `icon={<Image />}`, `title="Group background"`, `chevron` and `onClick`.
4. **`TopicRow.tsx`:** the archived toggle becomes `<Button type="button" variant="ghost" size="sm" aria-expanded={archivedOpen} onClick={onToggleArchived} className="w-full justify-start text-muted-foreground">`, with the same text.
5. **Tests:** the existing tests keep passing with the same accessible names. Add one assertion each in `PinnedMessages.test.tsx` (the row shows the count) and `GroupPanel.test.tsx` (the row is a button named "Group background").

### Read first
`AGENTS.md`, `docs/audit/ui-kit-leftovers.md` (W3, batch 1), `apps/web/src/components/ui/list-row.tsx`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/PinsPanel.tsx:140-170`, `apps/web/src/components/GroupPanel.tsx:560-580`, `apps/web/src/components/TopicRow.tsx:285-320`.

### Allowed files
`apps/web/src/components/ui/list-row.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/PinnedMessages.test.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/TopicsSidebar.test.tsx`, `work/T-0476-web-kit-panel-rows.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit PinnedMessages GroupPanel TopicsSidebar
pnpm gate
```

### Acceptance
- The three controls use the kit (`ListRow` and the ghost `Button`) with the same accessible names.
- `ListRow` supports `ariaLabel` and shows a focus ring.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Moved three hand-rolled controls onto the kit and taught `ListRow` two things.

1. `apps/web/src/components/ui/list-row.tsx`
   - Added optional `ariaLabel?: string`, applied to the `<button>` and the router `<Link>` (not the plain div).
   - Interactive rows (with `onClick` or `href`) now carry `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`, the same ring the hand-rolled rows used.
2. `apps/web/src/components/PinsPanel.tsx` `PinsSection`: the raw `<button>` is now a `ListRow` (`icon={<Pin />}`, `title="Pinned messages"`, `trailing={String(count)}`, `ariaLabel={\`Open pinned messages, ${count} pinned\`}`, `onClick={onOpen}`). The `<section aria-label="Pinned messages">` wrapper is unchanged.
3. `apps/web/src/components/GroupPanel.tsx`: the group background row is now a `ListRow` (`icon={<Image />}`, `title="Group background"`, `chevron`, `onClick`), keeping the `<section aria-label="Group background">` wrapper. Added the `ListRow` import.
4. `apps/web/src/components/TopicRow.tsx`: the archived toggle is now `<Button type="button" variant="ghost" size="sm" aria-expanded={archivedOpen} onClick={onToggleArchived} className="w-full justify-start text-muted-foreground">` with the same "Archived ({n})" text. `Button` was already imported.
5. Tests:
   - `kit.test.tsx`: added "uses ariaLabel as the button name".
   - `PinnedMessages.test.tsx`: added "shows the pin count on the info row", which renders `PinsSection` (under `AuthProvider` + `ChatStoreProvider`) with one seeded pin and asserts the `1` count inside the row.
   - `GroupPanel.test.tsx`: the "shows the control to an owner or admin" test now asserts the row's `tagName` is `BUTTON`.

### Files changed
- `apps/web/src/components/ui/list-row.tsx`
- `apps/web/src/components/ui/kit.test.tsx`
- `apps/web/src/components/PinsPanel.tsx`
- `apps/web/src/components/PinnedMessages.test.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/GroupPanel.test.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `work/T-0476-web-kit-panel-rows.md`

### Commands and results
- `pnpm install`: ok (done, warnings only about a mobile peer dependency).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit PinnedMessages GroupPanel TopicsSidebar`: 4 files passed, 106 tests passed.
- `pnpm gate` (from repo root):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (20.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (11.5s)
  PASS  tests @zilar/web  (37.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec / notes
- The spec asked for the count assertion in `PinnedMessages.test.tsx`. The existing tests in that file click `PinnedBanner`'s "List" button, which happens to share the accessible name `Open pinned messages, N pinned`; no existing test rendered `PinsSection`. I therefore added a dedicated test that renders `PinsSection` directly (wrapped in `AuthProvider` + `ChatStoreProvider`, since `ChatStoreProvider` needs auth) and asserts the count. This stays inside the Allowed files and keeps the existing assertions untouched.
- `TopicsSidebar.test.tsx` was listed as Allowed but needed no change: the existing `getByRole('button', { name: /Archived \(1\)/ })` assertion passes against the new ghost `Button` unchanged.

### Problems
None.

## Review (written by Claude)

Approved (lead, 2026-10-07). ListRow gains ariaLabel and a focus-visible ring. PinsSection and the Group background row use ListRow, and the archived-topics toggle uses a ghost Button; accessible names are unchanged. Pre-review clean.
