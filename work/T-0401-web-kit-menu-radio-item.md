---
id: T-0401
title: "Web kit: a MenuRadioItem (role menuitemradio) in the menu kit; the task strip status and owner menus use it"
status: todo
milestone: M5
branch: task/T-0401-web-kit-menu-radio-item
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0401: kit MenuRadioItem

## Spec (written by Claude, do not edit)

### Why
The kit `Menu` already handles `menuitemradio` in its keyboard navigation (`apps/web/src/components/ui/menu.tsx:31`), but the kit has no radio item. TaskStrip hand-rolls four of them.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/menu.tsx`:**
  - exports `Menu` (line 42) and `MenuItem` (line 169), which takes `{ onSelect, icon?, destructive?, disabled?, ariaLabel?, children }`;
  - `MenuItem` renders `<button type="button" role="menuitem" … className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50', destructive && 'text-danger')}>`;
  - the focus query at line 31 already includes `[role="menuitemradio"]:not([disabled])`.
- **`apps/web/src/components/TaskStrip.tsx`:** `Menu` is imported at line 7. The four hand-rolled radio items are `<button type="button" role="menuitemradio" aria-checked=… onClick=… className="flex w-full items-center (gap-2) px-3 py-2 text-left text-[13px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none">`:
  - line 266: status options, with a coloured dot `span` and `STATUS_LABEL[option]`;
  - line 306: owner "Unassigned"-style item (`aria-checked={topic.owner === null}`, `chooseOwner(null)`);
  - line 318: member owners (`{member.name}`);
  - line 333: AI owners (`{member.name} (AI)`).
- **Tests:** `apps/web/src/components/TaskStrip.test.tsx`, `apps/web/src/components/ui/menu.test.tsx` and the fixture `apps/web/src/components/ui/menu.fixture.tsx`.

### What to build
1. **In `menu.tsx`,** export `MenuRadioItem({ checked, onSelect, disabled?, ariaLabel?, className?, children })`:
   - it renders `<button type="button" role="menuitemradio" aria-checked={checked} …>`;
   - its classes are MenuItem's base classes merged with `className`.
2. **TaskStrip:** use it for the four items above, keeping:
   - `aria-checked`, the handlers and the children;
   - their compact size, by passing `className="text-[13px]"`.
3. **Fixture:** add a radio-group example to `menu.fixture.tsx`.
4. **Test:** add a case to `menu.test.tsx` checking the role, `aria-checked` and `onSelect`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ui/menu.fixture.tsx` and `apps/web/src/components/TaskStrip.tsx:235-350`.

### Allowed files
`apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ui/menu.fixture.tsx`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/TaskStrip.test.tsx`, `work/T-0401-web-kit-menu-radio-item.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu TaskStrip
pnpm gate
```

### Acceptance
- No `role="menuitemradio"` `<button` remains in `TaskStrip.tsx`.
- `MenuRadioItem` has a fixture and a test.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
