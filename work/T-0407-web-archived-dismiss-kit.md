---
id: T-0407
title: "Web kit: the chat list's Archived disclosure and the chat view's Dismiss notice use the kit Button"
status: merged
milestone: M5
branch: task/T-0407-web-archived-dismiss-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0407: Archived disclosure and Dismiss on the kit

## Spec (written by Claude, do not edit)

### Why
These two come from `docs/audit/ui-kit-leftovers.md` (batch 3). The other two rows of that batch, the ChatHeader title button and the PinnedBanner jump, are content rows and stay raw.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ChatList.tsx:396-407`:**

  ```
  <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}
    className={cn('flex shrink-0 items-center gap-2 px-3 py-2 text-left text-[13px] text-muted-foreground hover:text-foreground', isWide && 'rounded-[12px]')}>
  ```

  It contains `<Archive className="size-4" aria-hidden="true" />` and `<span className="flex-1">Archived ({archived.length})</span>`.
- **`apps/web/src/routes/ChatView.tsx:105-112`:** `<button type="button" aria-label="Dismiss notice" onClick={() => storeApi.getState().dismissTopicNotice()} className="shrink-0 rounded-full px-2 py-1 text-[13px] text-muted-foreground hover:bg-surface-raised …">Dismiss</button>`.
- **`apps/web/src/components/ui/button.tsx`:** `Button` with `variant="ghost"` and `size="sm"`; `cn` merges `className`.
- **Tests:**
  - `apps/web/src/components/ChatList.test.tsx`;
  - `apps/web/src/routes/ChatShell.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx`.

  Keep `aria-expanded`, the labels and the texts.

### What to build
1. **ChatList:**
   - use `<Button type="button" variant="ghost" size="sm" aria-expanded={showArchived} …>`;
   - pass `className={cn('w-full justify-start gap-2 text-[13px] font-normal text-muted-foreground hover:text-foreground', isWide && 'rounded-[12px]')}`;
   - keep the icon and the `flex-1` text span.
2. **ChatView:** use `<Button type="button" variant="ghost" size="sm" aria-label="Dismiss notice" className="shrink-0 rounded-full text-[13px] text-muted-foreground" …>Dismiss</Button>`.
3. Import `Button` where it is missing.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the two files around the lines above.

### Allowed files
`apps/web/src/components/ChatList.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/routes/ChatShell.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0407-web-archived-dismiss-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatList ChatShell ChatView
pnpm gate
```

### Acceptance
- Both controls are kit `Button`s with the same labels, texts and `aria-expanded`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/ChatList.tsx`: replaced the raw `<button>` for the Archived disclosure with the kit `<Button type="button" variant="ghost" size="sm">`. Kept `aria-expanded={showArchived}`, the `onClick` toggle, the `Archive` icon, and the `flex-1` "Archived (n)" span. New className: `cn('w-full justify-start gap-2 text-[13px] font-normal text-muted-foreground hover:text-foreground', isWide && 'rounded-[12px]')`. `Button` was already imported (line 21), so no import change.
- `apps/web/src/routes/ChatView.tsx`: replaced the raw Dismiss `<button>` with `<Button type="button" variant="ghost" size="sm" aria-label="Dismiss notice" className="shrink-0 rounded-full text-[13px] text-muted-foreground">`, keeping the `onClick` and the "Dismiss" text. Added `import { Button } from '@/components/ui/button';`.

No changes outside the Allowed files. No deviations from the spec.

### Commands and real results
- `pnpm install` → Done (exit 0).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatList ChatShell ChatView` → Test Files 5 passed (5), Tests 49 passed (49).
- `pnpm gate` → 
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (16.4s)
  PASS  lint  (1.2s)
  PASS  typecheck  (10.6s)
  PASS  tests @zilar/web  (28.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `work/T-0407-web-archived-dismiss-kit.md`

### Blocked / needs a decision
None.

### Open questions
None.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. Both controls are ghost `sm` kit Buttons, and `aria-expanded`, the labels and the texts are kept.
