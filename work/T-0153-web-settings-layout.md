---
id: T-0153
title: Web settings pages layout (one centered shell, readable sizes, consistent cards)
status: planned
milestone: M5
branch: task/T-0153-web-settings-layout
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 0.5 day
---

# T-0153: Web settings pages layout

## Spec (written by Claude, do not edit)

### Why
After T-0152 the Stickers page is a centered column with cards and readable text. The other settings pages still look unfinished: on 2026-10-01 Connections (`/settings/connections`), My AIs (`/settings/ais`) and Notifications (`/settings/notifications`) render tiny text stuck to the left edge of a full-width empty page (Connections and Notifications have no column at all; My AIs has a narrow column floating in the middle with tiny text and unlabeled icon buttons). Machines (`/settings/machines`) and Approvals (`/settings/approvals`) were not looked at and probably have the same problem.

### What to build
1. One shared settings shell component (for example `apps/web/src/components/SettingsShell.tsx`, or extend `AiPageShell` if it already fits): back arrow + page title + one-line description in the header, a centered column (`mx-auto w-full max-w-2xl`, the same column Stickers uses via `SETTINGS_COLUMN`) with consistent padding on desktop and a 16 px gutter at 390 px wide, readable text (body at least 14 px), and the same card style as the Stickers page (border, radius, surface background). Move the Stickers page onto it too if that is a small change; otherwise leave Stickers as it is.
2. Apply it to Connections, My AIs, Notifications, Machines and Approvals. Use sections with a heading and a card per item; list rows get a readable title, a muted second line, and their actions as labeled buttons or icon buttons with a visible `aria-label` and a tooltip (`title`). Primary actions (Create AI, Add a connection, Enable on this device, Pair machine) sit in the section header as normal-size buttons.
3. Notifications: the "This device" card shows the state in words (Enabled / Not enabled / Blocked by the browser / Not supported) with the action next to it; a registration error shows as a readable inline message (not a tiny red line); the Devices list and the Message previews toggle and the Test button are cards in the same column.
4. Empty states: a short friendly sentence for each page (no devices, no connections, no AIs, no machines, nothing to approve).
5. Keep every existing behavior, route, label and test id. Update tests that assert layout classes; add a test per page that it renders inside the shell (title, description, column class).
6. Verify in a real browser at 1280 px and 390 px wide on the dev server (`GALENA_API_URL=http://localhost:3188 pnpm --filter @galena/web dev` on a spare port such as 5174; do NOT use 5173, 3000 or 8081). The sign-in is an email code printed in the server log in development; if the sign-in is rate limited, do not create more accounts: say so in the Report and leave the real-browser check to the lead. Never send messages on a real account.
7. Out of scope: server, mobile, protocol, new dependencies, behavior changes, the chat view, the picker.

### Read first
`AGENTS.md`, `work/T-0152-web-sticker-ui.md` (Review), `apps/web/src/routes/StickersPage.tsx` (the `SETTINGS_COLUMN` pattern), `apps/web/src/components/ais/AiPageShell.tsx`, the five route files, `apps/web/src/index.css` (tokens).

### Allowed files
`apps/web/src/routes/{Connections,Ais,Machines,Approvals,Notifications,Stickers}Page*.tsx`, `apps/web/src/components/ais/**`, `apps/web/src/components/SettingsShell*.tsx`, `apps/web/src/components/ui/**`, their tests, `work/T-0153-web-settings-layout.md`. Not allowed: server, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2 ConnectionsPage AisPage MachinesPage ApprovalsPage NotificationsPage StickersPage AiPageShell
```

### Acceptance
- All five settings pages use one centered column with readable text at 1280 px and 390 px; no page is stuck to the left edge.
- Every icon-only button has an `aria-label` and a `title`.
- Existing behavior and tests intact (layout assertions updated), new shell tests added.

## Report (written by the worker when done)

## Review (written by Claude)
