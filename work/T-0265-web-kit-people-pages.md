---
id: T-0265
title: "Web kit migration 4: Blocked people, Contact requests and Chat folders pages use Card, SectionLabel, StateMessage and the kit Button"
status: todo
milestone: M5
branch: task/T-0265-web-kit-people-pages
model: auto
effort: low
depends_on: [T-0253]
estimate: 0.3 day
---

# T-0265: three settings pages on the kit

## Spec (written by Claude, do not edit)

### Why
This is audit step 4 (settings pages), continuing T-0253, which did the Notifications page. Each of these pages builds its own bordered row boxes, headings, empty and loading lines, and row buttons.

### Verified facts (do not re-derive)
- **Kit:** `apps/web/src/components/ui/card.tsx` (`Card`, `SectionLabel`), `apps/web/src/components/ui/state-message.tsx` (`StateMessage` with `kind: 'empty' | 'loading' | 'error'`, `title`, `hint?`, `action?`) and `apps/web/src/components/ui/button.tsx` (`Button` with `variant` and `size`; `NotificationsPage.tsx` uses `variant="outline" size="sm"` since T-0253). T-0253 is the model: it put each section in one `Card` with `divide-y divide-divider` rows and `SectionLabel` headings.
- **`apps/web/src/routes/BlockedPage.tsx`:**
  - loading and empty lines at lines 55-58;
  - each person is a separate bordered `li` box (lines 60-91: `rounded-xl border border-border bg-surface`, Avatar 36, name plus @handle, a hand-rolled rounded-full Unblock button);
  - the error is shown with `role="alert"` (lines 92-96);
  - test: `apps/web/src/routes/BlockedPage.test.tsx`.
- **`apps/web/src/routes/RequestsPage.tsx`:** sections "Incoming" (an `h2` at line 74, rows at 75-79) and "Sent" (an `h2` at line 116, rows at 117-121), with the same bordered `li` boxes. Test: `apps/web/src/routes/RequestsPage.test.tsx`.
- **`apps/web/src/routes/FoldersPage.tsx`:** the list is already one bordered `ul` (line 113). Test: `apps/web/src/routes/FoldersPage.test.tsx`.

### What to build
1. **BlockedPage and RequestsPage:**
   - each list becomes one `Card` with rows split by `divide-y divide-divider` (no box per row);
   - section headings become `SectionLabel` (keep the section `aria-label`s);
   - loading and empty states use `StateMessage` with the same sentences;
   - row action buttons (Unblock, Accept, Decline, Cancel) become the kit `Button` (`variant="outline" size="sm"`, with Accept as the primary variant if it is primary today), with the same labels and busy texts.
2. **FoldersPage:** its list uses `Card`, and any empty or loading line uses `StateMessage`.
3. Texts, roles and behaviour stay the same. Update tests only where they relied on removed markup; queries by role and text should keep working.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/card.tsx`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/NotificationsPage.tsx` (the T-0253 pattern), and the three pages.

### Allowed files
`apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/BlockedPage.test.tsx`, `apps/web/src/routes/RequestsPage.tsx`, `apps/web/src/routes/RequestsPage.test.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/routes/FoldersPage.test.tsx`, `work/T-0265-web-kit-people-pages.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot BlockedPage RequestsPage FoldersPage
pnpm gate
```

### Acceptance
- No `rounded-xl border border-border bg-surface` row boxes remain in the three files. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The kit components themselves, and the other settings pages.

---

## Report (written by the worker when done)

## Review (written by Claude)
