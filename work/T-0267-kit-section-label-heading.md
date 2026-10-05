---
id: T-0267
title: "Kit: SectionLabel is a real heading (web h2 by default, mobile accessibilityRole header)"
status: merged
milestone: M5
branch: task/T-0267-kit-section-label-heading
model: auto
effort: low
depends_on: [T-0264, T-0265]
estimate: 0.1 day
---

# T-0267: SectionLabel as a heading

## Spec (written by Claude, do not edit)

### Why
The T-0265 review found that the web `SectionLabel` renders a `<p>`. Pages that moved from `<h2>` headings to it (Notifications in T-0253, Contact requests in T-0265) lost their heading semantics, which screen readers use to jump between sections.

### Verified facts (do not re-derive)
- Web: `apps/web/src/components/ui/card.tsx` lines 23-30: `SectionLabel({ children })` renders `<p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">`. It is used in `apps/web/src/routes/NotificationsPage.tsx` and `apps/web/src/routes/RequestsPage.tsx`.
- Mobile: `SectionLabel` is in `apps/mobile/src/components/ui/card.tsx` (T-0264), used by `apps/mobile/src/app/(tabs)/settings.tsx`.
- `apps/web/src/components/ui/kit.test.tsx` is being changed by T-0263, so do not edit it: put the new web test in a new `apps/web/src/components/ui/card.test.tsx`.

### What to build
1. Web: `SectionLabel({ children, as = 'h2' })` with `as?: 'h2' | 'h3' | 'p'`, the same classes, and `m-0` so the heading adds no margin. Test it in the new `card.test.tsx` (the default is an h2, and `as="h3"` works). Check that the Notifications and Requests page tests still pass, and add one assertion in `apps/web/src/routes/RequestsPage.test.tsx` that the "Incoming" heading is found by `getByRole('heading', { name: /incoming/i })`.
2. Mobile: `SectionLabel` sets `accessibilityRole="header"`. Add a test in `apps/mobile/src/components/ui/kit.test.tsx`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/card.tsx`, `apps/mobile/src/components/ui/card.tsx`.

### Allowed files
`apps/web/src/components/ui/card.tsx`, `apps/web/src/components/ui/card.test.tsx` (new), `apps/web/src/routes/RequestsPage.test.tsx`, `apps/mobile/src/components/ui/card.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `work/T-0267-kit-section-label-heading.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot card RequestsPage NotificationsPage
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit
pnpm gate
```

### Acceptance
- Section labels are headings on both apps, with no visual change.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
- Web: `SectionLabel` now takes `as?: 'h2' | 'h3' | 'p'` (default `'h2'`) and renders that
  element with the existing classes plus `m-0`, so the heading adds no margin.
- Mobile: `SectionLabel` now passes `accessibilityRole="header"` to its `Text`.
- Added `apps/web/src/components/ui/card.test.tsx` (default h2, `as="h3"`).
- Added a `SectionLabel` header test to `apps/mobile/src/components/ui/kit.test.tsx`.
- Added `getByRole('heading', { name: /incoming/i })` assertion to `RequestsPage.test.tsx`.

### Files changed
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/card.test.tsx` (new)
- `apps/web/src/routes/RequestsPage.test.tsx`
- `apps/mobile/src/components/ui/card.tsx`
- `apps/mobile/src/components/ui/kit.test.tsx`
- `work/T-0267-kit-section-label-heading.md`

### Commands and real results
- `pnpm install`: done, 13 workspace projects, no lockfile change.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot card RequestsPage NotificationsPage`:
  6 files passed, 37 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit`: 1 file passed, 7 tests passed.
- `pnpm gate`: `install (frozen)` PASS, `format` PASS, `lint` PASS, `typecheck` PASS,
  `tests @zilar/mobile` PASS, `tests @zilar/web` PASS,
  `scope: every changed file is inside the Allowed files`, ends with `GATE PASS`.

### Problems / deviations
- None. No dependencies added; `pnpm-lock.yaml` untouched.

### Open questions
- None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (0 findings).
- On web, `SectionLabel` is an h2 by default and takes `as`.
- On mobile, it sets `accessibilityRole="header"`.
- The Requests test finds the "Incoming" heading by role.
