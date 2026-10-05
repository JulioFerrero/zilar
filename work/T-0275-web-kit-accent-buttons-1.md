---
id: T-0275
title: "Web kit migration 8: hand-rolled accent buttons on Connections, Integrations and Stickers pages become the kit Button"
status: todo
milestone: M5
branch: task/T-0275-web-kit-accent-buttons-1
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0275: accent buttons on the kit Button, batch 1

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ui-kit-audit.md` line 437 proposes a gate check that fails on `bg-accent px-` outside `apps/web/src/components/ui/`. Today 24 files still hand-roll that flat accent pill. The kit primary is `Button` in `apps/web/src/components/ui/button.tsx`:
- the default variant is `key-primary`;
- sizes are `sm`, `default` and `lg`;
- other variants are `outline` and `ghost`.

T-0265 already did this swap on the Requests, Blocked and Folders pages (for example `<Button type="button" size="sm">Accept</Button>`). This task does the same on three more pages.

### Verified facts (do not re-derive)
Hand-rolled accent buttons (`rounded-full bg-accent px-… text-accent-foreground hover:bg-accent/90`):
- `apps/web/src/routes/ConnectionsPage.tsx`: lines 137, 151, 168 and 390;
- `apps/web/src/routes/IntegrationsPage.tsx`: lines 131, 280, 443 and 578;
- `apps/web/src/routes/StickersPage.tsx`: lines 338, 367, 532 and 577.

`StickersPage.tsx:77` is a `VisibilityBadge` `<span>`, not a button. Leave it unchanged.

Each page has a test next to it (`*.test.tsx`), and none of the tests query by class name.

### What to build
1. Every element listed above becomes the kit `Button` (`import { Button } from '@/components/ui/button'`):
   - keep `type`, `onClick`, `disabled`, aria attributes, `data-testid` and the text;
   - size: `py-2 text-[15px]` becomes `size="lg"`; `py-1.5 text-[14px]` becomes `size="default"`; `py-1 text-[13px]` becomes `size="sm"`;
   - keep layout-only classes such as `shrink-0` through `className`, and drop the colour, padding, radius and font classes;
   - if one of them is an `<a>` or a router `Link`, use `<Button asChild>` around it.
2. Tests:
   - existing tests keep passing unchanged, or are changed only where they relied on the old markup;
   - add one assertion per page that a migrated button renders with `data-slot="button"`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `work/T-0265-web-kit-people-pages.md` (Report), and the three pages with their tests.

### Allowed files
`apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `work/T-0275-web-kit-accent-buttons-1.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage IntegrationsPage StickersPage
pnpm gate
```

### Acceptance
- `grep -n 'bg-accent px-' apps/web/src/routes/{Connections,Integrations,Stickers}Page.tsx` prints only `StickersPage.tsx:77`. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The other 21 files with `bg-accent px-`, and the gate check itself.

---

## Report (written by the worker when done)

## Review (written by Claude)
