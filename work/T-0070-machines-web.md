---
id: T-0070
title: Machines page (web) — add a machine with a pairing code, approve or deny new machines, rename, revoke, delete
status: todo
milestone: M3
branch: task/T-0070-machines-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0068, T-0069]
estimate: 1 day
---

# T-0070: Machines page (web)

## Spec (written by Claude, do not edit)

### Goal

M3 brings bring-your-own-compute (`docs/PROJECT_PLAN.md` §11.2, §11.5). The server already has the machines API (T-0068): an owner mints a pairing code, a runner registers with it, and the owner approves. This task gives the owner the screen for it: **Settings → Machines**.

The runner app does not exist yet, so the page must say honestly that the machine side is coming: the instructions show the code and the command `galena-runner pair <CODE>` as "coming soon", not as something that works today.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/machines/routes.ts` and `service.ts` (**read only**): the exact request and response shapes, status codes and error codes. The responses: `GET /api/machines` → `{ machines: [...] }`? Check whether the list is wrapped or a bare array, and `POST /api/machines/pairing-codes` → `{ code, expiresAt }`.
- `apps/web/src/routes/ConnectionsPage.tsx` and `AisPage.tsx`, `components/ais/AiPageShell.tsx` (page frame), `components/ais/AiPanel.tsx` (a two-step delete pattern to reuse), `components/ChatList.tsx` (the main menu with Connections / My AIs)
- `apps/web/src/lib/api.ts` (`request`, zod schemas, error handling) and `mock/api.ts` (the standalone mock layer from T-0069: extend it, do not fork it)
- `docs/design/ui-style.md` §4 (keys, wells, raised pills), §5, §6 and §7, plus `docs/PROJECT_PLAN.md` §11.2–§11.4, §11.5 (the Machines screen sketch)

### Allowed files (under `apps/web/`)
- `src/lib/api.ts` (add the machines calls and schemas), plus its test
- `src/routes/MachinesPage.tsx` (new), `src/routes/AppRoutes.tsx` (one route: `/settings/machines`)
- `src/components/machines/**` (new: cards, the add dialog, the approval card, confirm)
- `src/components/ChatList.tsx` (one new menu item **Machines**, between Connections and My AIs), plus its test
- `src/mock/api.ts` (machines routes and seed data), plus its test
- `work/T-0070-machines-web.md`

**Not allowed:** `apps/server/**`, `packages/**`, mobile, `docs/**`, chat and store files. No new dependencies.

### What to build

1. **API client (`lib/api.ts`).** Zod schemas and functions for: `listMachines`, `createPairingCode`, `approveMachine`, `denyMachine`, `revokeMachine`, `renameMachine`, `deleteMachine`. Machine shape from the server (T-0068): `id`, `name`, `status` (`pending | approved | revoked`), `os`, `osVersion`, `arch`, `cpu`, `cores`, `ramGb`, `diskFreeGb`, `drivers`, `fingerprint`, `createdAt`, `approvedAt`, `lastSeenAt` (nullable dates as ISO strings) and, once T-0071 lands, `online` (make it **optional, default false** in the schema so this task works before T-0071 merges). Error handling as in the other calls (`ApiError` with the server's `error.code`).
2. **The page (`/settings/machines`)** in the `AiPageShell` frame, title "Machines", subtitle "Computers where your AIs can work".
   - **Add machine** primary key at the top right. It opens a dialog:
     - it calls `createPairingCode`, shows the code large in Geist Mono as `K7QX-M2PA`, a **Copy** key (feedback "Copied", clipboard failure handled), a countdown "Expires in 9:41" (updates each second, stops at 0 and then shows "Code expired" with a **New code** key), and the line "On the machine, run `galena-runner pair K7QX-M2PA`" followed by a muted "The runner app is coming soon".
     - Errors from the server (`pairing_code_limit`, rate limit, network) show as an inline message.
     - The dialog closes with Esc, the ✕ or Done, and nothing lingers (timers cleared).
   - **Sections:** **Waiting for approval** (pending machines first, if any), then **Your machines** (approved), then **Revoked** (collapsed under a disclosure, only if any). An empty state when there are no machines: "No machines yet. Add one to let your AIs work on your own computers."
   - **Pending card ("New machine")** : name, `os osVersion · arch · cpu · N cores · X GB RAM`, drivers, the **fingerprint** in mono with the help text "Check that this matches what the runner shows", and two keys: **Approve** (primary) and **Deny** (danger, with the two-step confirm pattern). A short muted warning: "Only approve a machine you just paired yourself."
   - **Approved card:** name (with an inline rename: click the pencil, Enter saves, Esc cancels, 1–64 characters), a status pill (`Online` green dot, or `Offline`, or `Never connected` when `lastSeenAt` is null; use `lastSeenAt` as "Last seen 5 min ago" when offline), the hardware line, drivers as small pills, the fingerprint. Actions in a small menu or two keys: **Revoke** (danger, two-step confirm: "Revoke julio-mbp? It will disconnect and must be paired again with a new code." with **Revoke** and **Cancel**).
   - **Revoked card:** muted, name, "Revoked <date>", a **Delete** key (two-step).
   - Loading: skeleton cards (with a short delay so fast loads don't flash), an inline error with **Retry** if listing fails (not an empty state). `loading`, `error` and `empty` are three different states.
   - Actions update the list optimistically or re-fetch, but a failed action shows an inline error on that card and leaves the card as it was. Disable a card's keys while its action is in flight.
3. **Menu:** "Machines" in the main menu (`ChatList.tsx`) navigating to `/settings/machines`, with the same styling as its neighbours.
4. **Mock layer (`mock/api.ts`).** Machines routes in the standalone mock: seed 3 machines (1 pending, 1 approved online, 1 revoked), `POST /machines/pairing-codes` → a fixed-format code and an expiry 10 minutes ahead, and approve/deny/revoke/rename/delete mutating the in-memory list with the same status rules as the server (409 for invalid transitions). Keep the 150 ms delay.
5. **Accessibility and motion:** every icon key has an `aria-label`; the dialog is `role="dialog"` with focus moved in and restored on close; the countdown does not spam screen readers (update an `aria-live="off"` text, announce only "Code expired"); reduced motion honored; 44 px touch targets at 390 px width; no horizontal scroll at 390×844.

### Tests (Vitest, no network; use the mock layer or fetch fakes as the AI page tests do)
- `lib/api.ts`: each call's path, method and body; the schema accepts a server-shaped response and `online` missing; a 409 becomes an `ApiError` with its code.
- Page: loading skeleton then list; error with Retry; the three sections; empty state; approve moves a card to "Your machines"; deny and revoke need the second click; a failed action leaves the card and shows the error; rename saves on Enter and cancels on Esc.
- Add dialog: shows the code, the copy key (with a fake clipboard), the countdown with fake timers, the expired state and **New code**, Esc closes and clears timers.
- Menu: the new item navigates.
- Mock layer: the seeded routes and state transitions (including 409s).

### Visual check
Run your own Vite (`cd apps/web && (GALENA_API_URL=http://localhost:3188 pnpm exec vite --port 52xx --strictPort > $TMPDIR/vite.log 2>&1 & echo $! > $TMPDIR/vite.pid)`; never plain `pnpm dev`, never ports 3000, 3188, 5173, 8081), open `/settings/machines?mock=1` (no server needed since T-0069), and check at 1440×900 and 390×844: the list with all three kinds of card, the add dialog, a confirm, the empty state (`?mock=1` plus an empty seed if you add one; optional). Screenshots max 8, downscaled with `sips -Z 900`; save to `work/screenshots/T-0070/`. **Stop the server you started** (`kill $(cat $TMPDIR/vite.pid)`).

### Acceptance criteria
- [ ] The owner can add a machine (code, copy, countdown), approve or deny a pending one, rename, revoke and delete, and every destructive step asks twice.
- [ ] Loading, error and empty are different states.
- [ ] The instructions never claim the runner works today.
- [ ] Works in mock mode with no server, at both widths.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Placing AIs on machines, availability schedules, limits, desks, live CPU/RAM meters, the runner app, mobile.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
