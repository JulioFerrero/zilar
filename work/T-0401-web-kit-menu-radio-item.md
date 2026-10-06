---
id: T-0401
title: "Web kit: a MenuRadioItem (role menuitemradio) in the menu kit; the task strip status and owner menus use it"
status: merged
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

### What I did
- `apps/web/src/components/ui/menu.tsx`: added `MenuRadioItemProps` and `MenuRadioItem`. It renders `<button type="button" role="menuitemradio" aria-checked={checked} …>` with MenuItem's base classes (`flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50`) merged with `className`, plus `disabled`, `ariaLabel`, `onSelect` and `children`.
- `apps/web/src/components/TaskStrip.tsx`: replaced the four hand-rolled `role="menuitemradio"` buttons (status options, "No owner", member owners, AI owners) with `MenuRadioItem`, keeping `aria-checked`, handlers, children and `className="text-[13px]"`.
- `apps/web/src/components/ui/menu.fixture.tsx`: added an `OpenRadioMenu` example exposing a `RadioGroup` fixture alongside `Default`.
- `apps/web/src/components/ui/menu.test.tsx`: added a case asserting the radio role, `aria-checked="true"`, the merged custom class and that `onSelect` fires on click.

### Files changed
- `apps/web/src/components/ui/menu.tsx`
- `apps/web/src/components/ui/menu.fixture.tsx`
- `apps/web/src/components/ui/menu.test.tsx`
- `apps/web/src/components/TaskStrip.tsx`
- `work/T-0401-web-kit-menu-radio-item.md`

`TaskStrip.test.tsx` is allowed but needed no change; its existing `menuitemradio` queries pass unchanged.

### Commands and results
- `pnpm install`: done, no errors (peer-dependency warning for `@types/react-dom` in `apps/mobile` pre-existed).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu TaskStrip`: **4 test files passed, 25 tests passed**.
- `pnpm gate`: **GATE PASS**. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.4s)`
  - `PASS  format  (26.2s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (12.7s)`
  - `PASS  tests @zilar/web  (71.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Acceptance
- No `role="menuitemradio"` `<button` remains in `TaskStrip.tsx` (grep: no matches).
- `MenuRadioItem` has a fixture and a test.
- `pnpm gate` ended with `GATE PASS` and listed no file outside the Allowed files.

### Deviations / notes
- The hand-rolled items used `hover:bg-surface-raised focus-visible:bg-surface-raised`; per the spec, `MenuRadioItem` reuses MenuItem's base classes, so these now use `hover:bg-list-hover focus-visible:bg-list-hover`. The only per-item class TaskStrip passes is `text-[13px]` for compact size, as specified.
- No open questions.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean (0 findings). I read the diff:
- `MenuRadioItem` (`menu.tsx:206`) uses the MenuItem base classes plus `className`;
- the four TaskStrip radios keep their `checked` logic, handlers and text, and pass `text-[13px]`.

The hover colour changes from `surface-raised` to `list-hover`, the same as every other kit menu. That is accepted.
