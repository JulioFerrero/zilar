---
id: T-0275
title: "Web kit migration 8: hand-rolled accent buttons on Connections, Integrations and Stickers pages become the kit Button"
status: merged
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

### What I did
- **`ConnectionsPage.tsx`:** the Retry, two "Add a connection" and Save accent buttons are now the kit `Button` (`import { Button } from '@/components/ui/button'`). Sizes by the spec: `py-2 text-[15px]` → `size="lg"`, `py-1.5 text-[14px]` → `size="default"`. Kept `type`, `onClick`, `disabled` and the text; dropped the colour/padding/radius/font classes. The Cancel button (no `bg-accent`) and the `VisibilityBadge` span were left unchanged.
- **`IntegrationsPage.tsx`:** the Retry and three Save accent buttons are now the kit `Button` (Retry `size="lg"`, the three Save buttons `size="default"`), same handlers, `disabled={busy}` and busy labels. The hand-rolled `Remove` outline buttons were not in the spec (no `bg-accent`), so they are unchanged.
- **`StickersPage.tsx`:** Retry (`size="lg"`), Create pack (`size="default"`), the search submit (`size="lg"`) and Add (`size="sm"`, kept `className="shrink-0"`). The `Import from Telegram` and `Remove` outline buttons and the `VisibilityBadge` span are unchanged.
- **Tests:** added one assertion per page that a migrated button has `data-slot="button"` (Connections: `Add a connection`; Integrations: `Retry`; Stickers: `Retry`). No other test changes were needed; all existing queries are by role/text and keep matching.

### Files changed
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ConnectionsPage.test.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/IntegrationsPage.test.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/routes/StickersPage.test.tsx`
- `work/T-0275-web-kit-accent-buttons-1.md`

### Commands and results
- `pnpm install` — Done in 21.8s; it did **not** modify `pnpm-lock.yaml` (verified with `git status`).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage IntegrationsPage StickersPage` — `Test Files 3 passed (3)`, `Tests 33 passed (33)`.
- `grep -n 'bg-accent px-' apps/web/src/routes/{Connections,Integrations,Stickers}Page.tsx` — prints only `StickersPage.tsx:78` (the `VisibilityBadge` span; line moved from 77 to 78 by the added import). Matches the acceptance criterion.
- `pnpm gate` — `GATE PASS`:
  - `gate: 7 changed file(s) against main`
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / open questions
- `StickersPage.tsx` search button is `px-4 py-2 text-[14px]`, a hybrid not covered exactly by the spec's size rules (`py-2 text-[15px]` → `lg`, `py-1.5 text-[14px]` → `default`). I used `size="lg"` so its height matches the `py-2` input next to it in the same form. Flagging in case the lead prefers `size="default"`.
- For the `Add` button the spec said to keep layout-only classes such as `shrink-0` through `className`; the kit's base already includes `shrink-0`, so `className="shrink-0"` is redundant but kept to follow the spec literally. Happy to drop it.
- No security-sensitive code was touched (UI-only class/markup swap; no auth, routes, logging or audit changes).

## Review (written by Claude)

Approved: clean pre-review, no fix rounds.
- All 12 buttons are now the kit `Button`. `type`, handlers, `disabled` and texts are kept.
- The lead's grep finds only the `VisibilityBadge` span, now at line 78 because one import line was added.
- Two nits accepted:
  - the search button (`py-2 text-[14px]`) took `size="lg"` to match the input next to it;
  - `className="shrink-0"` is redundant with the kit base, but kept as the spec says.
