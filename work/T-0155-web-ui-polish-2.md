---
id: T-0155
title: Web UI polish round 2 (Machines, Approvals, dialogs, text size, sticker nits)
status: planned
milestone: M5
branch: task/T-0155-web-ui-polish-2
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 0.5 day
---

# T-0155: Web UI polish round 2 (Machines, Approvals, dialogs, text size, sticker nits)

## Spec (written by Claude, do not edit)

### Why
After T-0152 and T-0153 the sticker pages, Connections, My AIs and Notifications look right. Not yet reviewed in a real browser: Machines (`/settings/machines`), Approvals (`/settings/approvals`), the chat header menus and dialogs (group settings, roles, topics, tools panel, invite links, pins, search), the login and welcome pages. Julio also saw that settings text is on the small side, and there are known small leftovers: the favorite star sits partly over the corner of each sticker, "Private" shows twice in a pack row (badge and subtitle), the Notifications card has no "Not supported" state (it keeps a separate page), `ApprovedMachineCard` has a wrong title and `AddMachineDialog` has stale copy.

### What to build
1. Audit with a real browser at 1280 px and 390 px wide on a spare dev port (`GALENA_API_URL=http://localhost:3188 pnpm --filter @galena/web dev --port 5174`; never 5173, 3000 or 8081; sign-in code is printed in the server log in development; if sign-in is rate limited, say so in the Report and use mock mode `VITE_GALENA_MOCK` if it exists). Open every page and dialog listed above and note what is cramped, left-stuck, overlapping, clipped at 390 px, or has icon-only buttons without a label/tooltip.
2. Fix what the audit finds in the web app only: spacing, widths, wrapping, overflow, focus rings, consistent button sizes and card style (reuse `SettingsShell`, the Stickers cards and the existing UI components; do not invent a second style).
3. Text size: raise the settings pages' body text to at least 14 px and secondary text to at least 13 px (tokens in `apps/web/src/index.css`; keep the chat view's own sizes).
4. The sticker leftovers: move the favorite star fully inside the tile corner (a small button with a background, not covering the sticker's center), show "Private/Shared" once per pack row, the Notifications "Not supported" state as a card, the `ApprovedMachineCard` title and the `AddMachineDialog` copy.
5. Update the tests that assert layout classes; add tests where behavior changed (the Not supported card, the single visibility label).
6. In the Report list every page you opened and what you changed, plus anything you found but left alone, with a screenshot path for before and after if you can save one.
7. Out of scope: server, mobile, behavior changes, new dependencies.

### Read first
`AGENTS.md`, `work/T-0152-web-sticker-ui.md` and `work/T-0153-web-settings-layout.md` (Reviews), `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/index.css`.

### Allowed files
`apps/web/src/**` (components, routes, styles, tests), `work/T-0155-web-ui-polish-2.md`. Not allowed: server, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2 <the test files of the components you touched and their neighbours>
```

### Acceptance
- Every page and dialog in the audit list is usable and readable at 1280 px and 390 px, with no clipped or overlapping content and every icon-only button labelled.
- The five sticker/notification leftovers are fixed with tests.
- The Report lists what was opened and changed.

## Report (written by the worker when done)

## Review (written by Claude)
