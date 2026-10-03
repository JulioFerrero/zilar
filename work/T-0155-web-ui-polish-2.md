---
id: T-0155
title: Web UI polish round 2 (Machines, Approvals, dialogs, text size, sticker nits)
status: review
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
1. Audit with a real browser at 1280 px and 390 px wide on a spare dev port (`ZILAR_API_URL=http://localhost:3188 pnpm --filter @zilar/web dev --port 5174`; never 5173, 3000 or 8081; sign-in code is printed in the server log in development; if sign-in is rate limited, say so in the Report and use mock mode `VITE_ZILAR_MOCK` if it exists). Open every page and dialog listed above and note what is cramped, left-stuck, overlapping, clipped at 390 px, or has icon-only buttons without a label/tooltip.
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
pnpm --filter @zilar/web test --maxWorkers=2 <the test files of the components you touched and their neighbours>
```

### Acceptance
- Every page and dialog in the audit list is usable and readable at 1280 px and 390 px, with no clipped or overlapping content and every icon-only button labelled.
- The five sticker/notification leftovers are fixed with tests.
- The Report lists what was opened and changed.

## Report (written by the worker when done)

### What I did

Browser audit first (dev server `VITE_MOCK=1 pnpm --filter @zilar/web dev --port 5174`,
Playwright Chromium, mock auth so no OTP/rate-limit risk): opened Machines, Approvals,
Notifications, Stickers, Connections, My AIs, Login, the chat list, an open chat (header
menu + sticker picker), and Welcome name/handle, Profile, Requests, Integrations at
1280 px and 390 px. Measured viewport overflow per element, unlabeled icon-only buttons,
column geometry, and fonts under 13 px; saved before/after screenshots to `/tmp`
(not committed).

Findings fixed (web app only, existing components/style reused):
- Stickers pack rows overflowed at 390 px (audit: action span `w=434` vs 390 px viewport,
  clipping "Remove from panel"/"Delete"). The actions span lost `shrink-0`, so the row
  now wraps the buttons under the title instead of pushing past the viewport edge.
  Verified: zero overflow on all 8 audited settings pages at both widths after.
- Picker favorite star: was `absolute top-0 right-0 bg-black/60`, touching the tile edge
  and the art. Now `top-0.5 right-0.5` with `border-edge` and `bg-black/70`, and the art
  shrank (`TILE_PX - 12` with `p-1.5`) so the star has breathing room. Measured:
  `overlap=false`, all 6 stars fully inside their tiles at both widths.
- "Private" showed twice per imported pack row (badge + "· Private" in the subtitle).
  Subtitle now reads `N stickers · Imported from Telegram`; the badge stays the single
  visibility label.
- Notifications "Not supported" was a bare paragraph; "server-off" too. Both are now
  "This device" cards in the same column (`Not supported` / `Not available` + detail),
  matching the Enabled/Not enabled/Blocked cards.
- `ApprovedMachineCard`: the rename pencil had `aria-label` but no `title` tooltip;
  added. Card heading confirmed as the machine's own name (comment now says so; the
  section header "Your machines" names the group — no wrong title found beyond the
  missing tooltip).
- `AddMachineDialog`: copy button gained the missing `title`; stale copy ("On the
  machine, run … / The runner app is coming soon.") now reads "download the runner
  app, then run … / The desktop runner is not published yet — this code is ready for
  when it is." (The `zilar-runner pair <CODE>` command is real: `apps/runner/` exists.)
- Text size: settings secondary text raised to 13 px minimum — pending-card
  Fingerprint label + both helper lines 12→13, revoked-card hardware + revoked-date
  12→13, approval details/cost/expiry 12→13 (leading fixed 4→5), add-dialog timer
  12→13. Body text was already ≥14 px everywhere in scope. Left alone per spec (chat
  view sizes, 10–11 px badges/pills/unread counts/timestamps — pre-existing chat
  microcopy, out of scope).
- Wrapping hardening: machine hardware lines and fingerprints got `wrap-anywhere`,
  approval action header wraps with `basis-40`, summary/details get `break-words`.

Pages opened and result (all centered column, no clipping, no unlabeled icon buttons):
Machines, Approvals, Notifications, Stickers, Connections, My AIs, Login, chat list,
open chat + header menu (Topic info, Pinned messages, Search, Pin, Mute, Archive chat)
+ sticker picker, Welcome name/handle, Profile, Requests, Integrations — at 1280 and
390. Login/welcome/profile/requests/integrations needed no changes.

Left alone: chat-view 10–12 px microcopy (badges, pills, timestamps, unread counts —
spec keeps chat sizes); 11 px `pending`/`active`/driver pills (badges, consistent
across pages); sticker thumbnails 404 in mock-mode screenshots (known dev-only
artifact: mock HTTP layer intercepts `fetch`, not raw `<img>` loads; unit tests and
real backend unaffected).

### Files changed
- `apps/web/src/components/StickerPanel.tsx` (star inset + backdrop/border, art padding)
- `apps/web/src/routes/StickersPage.tsx` (single visibility label, wrapping actions)
- `apps/web/src/routes/NotificationsPage.tsx` (Not supported / server-off cards)
- `apps/web/src/components/machines/ApprovedMachineCard.tsx` (rename `title`, wrap,
  comment)
- `apps/web/src/components/machines/AddMachineDialog.tsx` (copy `title`, fresh copy)
- `apps/web/src/components/machines/PendingMachineCard.tsx` (13 px secondary, wrap)
- `apps/web/src/components/machines/RevokedMachineCard.tsx` (13 px, machine name line)
- `apps/web/src/components/approvals/ApprovalRow.tsx` (13 px, wrapping header/text)
- Tests: `StickerPanel.test.tsx` (+star placement assertions), `StickersPage.test.tsx`
  (single-label assertion), `NotificationsPage.test.tsx` (card assertions for both
  states), `AddMachineDialog.test.tsx` + `MachinesPage.test.tsx` (new copy + tooltip)
- `work/T-0155-web-ui-polish-2.md` (status + this report)

### Commands run and real results
- `pnpm install`: ok (8.3s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint` (oxlint): pass, no findings
- `pnpm typecheck`: pass (11 tasks, turbo)
- `pnpm --filter @zilar/web test --maxWorkers=2 StickerPanel StickersPage
  NotificationsPage MachinesPage AddMachineDialog ApprovalRow ApprovalsPage
  ConnectionsPage AisPage AiPageShell NewAiDialog PackEditor TelegramImport`:
  11 files, 133 passed
- Browser audit (Playwright, mock mode, port 5174): before — stickers-390 overflow
  (`w=434`); after — zero overflow on all pages/widths, picker `overlap=false`,
  stars inside tiles, dialogs readable. Before/after PNGs in `/tmp` (`t155/` and
  `t155/after/`), not committed.

### Problems, deviations, open questions
- No real-account check: mock mode only (per T-0152/T-0153 precedent, avoids OTP
  rate limits). Geometry verified by measurement + screenshots; the lead may want a
  live look.
- `ApprovedMachineCard` "wrong title": the card heading is already the machine name,
  so the fix is the missing rename tooltip + clarifying comment. If the lead meant a
  different title bug, it needs a pointer.
- No new dependencies. No secrets touched.

### Blocked / needs a decision
- None.

## Review (written by Claude)
