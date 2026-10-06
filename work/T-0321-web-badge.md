---
id: T-0321
title: "Web kit migration: unread count pills use the kit Badge"
status: todo
milestone: M5
branch: task/T-0321-web-badge
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0321: unread pills on the kit Badge

## Spec (written by Claude, do not edit)

### Why
The kit `Badge` (`apps/web/src/components/ui/badge.tsx`) exists, but app code never uses it. Four places hand-roll the same pill with the same classes. This task moves them to `Badge`, so the pill is defined in one place.

### Verified facts (do not re-derive)
- **`Badge`** (`apps/web/src/components/ui/badge.tsx`):
  - props: `count`, `max` (default 99) and `muted`;
  - it renders nothing when `count <= 0` and shows `${max}+` above `max`;
  - its classes are `inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold`, plus `bg-badge-muted text-foreground` when muted or `key-primary` otherwise;
  - it has no `aria-label` and no `className` prop. Its tests are at `apps/web/src/components/ui/kit.test.tsx:17-38`.
- **Hand-rolled pills:**
  - `apps/web/src/components/ChatListItem.tsx:135-144`: `aria-label={`${chat.unread} unread`}`, muted when `chat.muted`, extra classes `ml-auto flex shrink-0`;
  - `apps/web/src/components/TopicRow.tsx:129-138`: the same as ChatListItem;
  - `apps/web/src/components/TopicRow.tsx:253-268`: two group pills, `key-primary` for `unread` and `bg-badge-muted` for `mutedUnread`, with `aria-label={`${n} unread in ${groupTitle}`}` and `ml-auto flex shrink-0`;
  - `apps/web/src/components/MessageList.tsx:271-275`: the scroll-to-bottom count, `key-primary absolute -top-1 -right-1 flex … px-1`, with no aria-label (the IconButton's label already says the count).
- **Tests that read these pills:**
  - `apps/web/src/components/ChatList.test.tsx:42-43` (`getByLabelText('2 unread')`);
  - `apps/web/src/components/TopicsSidebar.test.tsx:34-35`;
  - `apps/web/src/components/ChatPrefs.test.tsx:253` (the labelled element's class contains `bg-badge-muted`).

  These must keep passing unchanged.
- Out of scope: the small menu counts in `ChatList.tsx:155-161` and `219-225`, which are a different size, and the machine, approval, AI and connection labels, which are text chips, not counts.

### What to build
1. **`Badge`:** add two optional props.
   - `label?: string`, rendered as `aria-label` on the span.
   - `className?: string`, merged last with `cn`.

   Add tests in `kit.test.tsx`: the label is applied, and the class is merged.
2. **ChatListItem:** replace the pill at lines 135-144 with `<Badge count={chat.unread} muted={chat.muted} label={`${chat.unread} unread`} className="ml-auto shrink-0" />`, keeping the `chat.unread > 0 ? … : own && …` branch as it is.
3. **TopicRow:**
   - the pill at lines 129-138: the same change;
   - the two group pills at lines 253-268: use `Badge`, keeping the `unread > 0` and `unread === 0 && mutedUnread > 0` conditions and the labels.
4. **MessageList:** the count at lines 271-275 becomes `<Badge count={pending} className="absolute -top-1 -right-1 px-1" />`.
5. Remove `cn` imports that become unused.
6. **Behaviour change** (intended; note it in the Report): counts above 99 now show `99+`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/kit.test.tsx:1-40`, and the four snippets above.

### Allowed files
`apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/MessageList.tsx`, `work/T-0321-web-badge.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ChatList TopicsSidebar ChatPrefs MessageList
pnpm gate
```

### Acceptance
- No `h-5 min-w-5 … rounded-full` count pill is left in `ChatListItem.tsx`, `TopicRow.tsx` or `MessageList.tsx`.
- The existing unread tests pass unchanged, and the new Badge tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
