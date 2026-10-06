---
id: T-0334
title: "Web kit: Badge's accessible label follows the visible count (99+), not the raw number"
status: todo
milestone: M5
branch: task/T-0334-web-badge-label
model: auto
effort: low
depends_on: [T-0321]
estimate: 0.1 day
---

# T-0334: Badge label matches the shown count

## Spec (written by Claude, do not edit)

### Why
The doctor audit after T-0321 found an accessibility mismatch. `Badge` shows `99+` above `max`, but the callers pass a label built from the raw count, so a chat with 150 unread reads "150 unread" to a screen reader while the screen shows "99+". The label must follow the visible text. The lead's T-0321 spec caused this.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/badge.tsx`:**
  - props: `count`, `max` (default 99), `muted`, `label?: string` (rendered as `aria-label`) and `className`;
  - the visible text is `text = count > max ? `${max}+` : `${count}``.
- **The only `label` callers:**
  - `apps/web/src/components/ChatListItem.tsx:140`: `label={`${chat.unread} unread`}`;
  - `apps/web/src/components/TopicRow.tsx:134`: the same;
  - `apps/web/src/components/TopicRow.tsx:254`: `${unread} unread in ${groupTitle}`;
  - `apps/web/src/components/TopicRow.tsx:262`: `${mutedUnread} unread in ${groupTitle}`.
- **Tests:**
  - `apps/web/src/components/ui/kit.test.tsx:39` renders `<Badge count={2} label="2 unread" />`;
  - `apps/web/src/components/ChatList.test.tsx:42-43`, `apps/web/src/components/TopicsSidebar.test.tsx:34-35` and `apps/web/src/components/ChatPrefs.test.tsx:253` query by the labels `'2 unread'`, `'5 unread'`, `'3 unread in Dev team'` and `'3 unread'`. These must keep passing unchanged.

### What to build
1. **`Badge`:** replace `label?: string` with `labelSuffix?: string`.
   - When it is set, `aria-label` is `${text} ${labelSuffix}`, where `text` is the visible text (so `99+ unread`).
   - With no suffix, there is no aria-label.
2. **Callers:**
   - ChatListItem:140 and TopicRow:134 pass `labelSuffix="unread"`;
   - TopicRow:254 and 262 pass `labelSuffix={`unread in ${groupTitle}`}`.
3. **`kit.test.tsx`:**
   - update line 39 to `labelSuffix="unread"`, still expecting the label `2 unread`;
   - add a test: `<Badge count={150} labelSuffix="unread" />` has the label `99+ unread` and shows `99+`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/kit.test.tsx:17-50`, and the four call sites.

### Allowed files
`apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `work/T-0334-web-badge-label.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ChatList TopicsSidebar ChatPrefs
pnpm gate
```

### Acceptance
- The aria-label always matches the visible count, and the new 150 → `99+ unread` test proves it.
- The other unread tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
