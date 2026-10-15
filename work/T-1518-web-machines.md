---
id: T-1518
title: "Web Machines (approved Approvals canvas, WebMachines): 'Add machine' in the header; a new machine is a card with an amber dot, its name, the code in a large mono well and Deny/Approve; other machines are plain rows (status dot, name, the AI's picture, chevron) that open the machine's details in a side sheet; a 'Revoked' row with its count"
status: merged
milestone: M5
branch: task/T-1518-web-machines
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1518: Web Machines

## Spec (written by Claude, do not edit)

### Why
Julio approved the Approvals canvas on 2026-10-15, including Machines. Read `docs/design/mockups/approvals/README.md` and `WebMachines.dc.html`.
- **A new machine** is a card with an amber dot, its name, its code in a large mono well, "Approve if the machine shows this code.", and Deny / Approve.
- **The other machines** are plain rows: a status dot (green online, grey offline), the name, the assigned AI's picture, and a chevron.
- **A "Revoked" row** carries its count.
- **OS, CPU and the sandbox chips** move to the machine's own page.
- **No status words.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/MachinesPage.tsx` (223 lines):**
  - `SettingsShell` with the subtitle "Computers where your AIs can work." (`:101-104`);
  - a "Waiting for approval" section with its own heading and `AddMachineButton` (`:129-153`), using `PendingRow`;
  - the approved machines as `ApprovedRow`s (`:155-170`), with `aiNames` from `aisByMachineId` (`:76`);
  - a "Revoked (n)" toggle button and `RevokedRow`s (`:177-210`).
- **`apps/web/src/components/machines/PendingMachineCard.tsx` (147 lines)** shows the fingerprint in a small mono `code` (`:66-68`), plus Approve and a two-step Deny.
- **`ApprovedRow.tsx` (77 lines)** wraps `ApprovedMachineCard.tsx` (251 lines), which holds the inline rename, the online dot, hardware, drivers, the fingerprint and a two-step Revoke.
- **The machine shape:** `Machine.online` is optional (`packages/api-contract/src/machines.ts:40`), and `machine.fingerprint` is the code the runner shows.
- **The kit:**
  - `SettingsShell` has an optional `subtitle` and an `action` slot (T-1503);
  - `Sheet` is a side panel (`apps/web/src/components/ui/sheet.tsx:23`, with `open`, `onClose` and `ariaLabel`);
  - `EntityAvatar`, `Button`, and the `well` class.

### What to build
1. **The page (`MachinesPage.tsx`):**
   - `SettingsShell` with the title "Machines", no subtitle, and as `action` a primary `Button` with `Plus` and the text "Add machine" (the `AddMachineDialog` that `AddMachineButton` opens today);
   - drop the section headings;
   - **then:** one pending card per pending machine; then one rounded list (`overflow-hidden rounded-xl border border-border bg-surface`, rows divided by `border-b border-divider`) holding every approved machine row, followed by the "Revoked" row when any machine is revoked.
2. **The pending card (`PendingMachineCard.tsx`):** `rounded-xl border border-border bg-surface p-4`, `gap-3.5`, holding:
   - an 8 px amber dot (`role="img"`, `aria-label="Waiting"`) and the name (15 px, 600);
   - the fingerprint in a 44 px mono well (16 px, `tracking-[0.08em]`, centred);
   - a row: "Approve if the machine shows this code." (13 px, muted, `flex-1`), Deny (secondary, keeping the two-step), Approve (primary).
3. **New `apps/web/src/components/machines/MachineListRow.tsx`:** a button row (min height 52, `px-4`) with:
   - an 8 px dot, green (`bg-online`, "Online") or grey (`bg-muted-foreground`, "Offline");
   - the name (15 px, 500, `flex-1`);
   - a 24 px `EntityAvatar` of the first assigned AI, when there is one (`ai`, by name);
   - a `ChevronRight`.
   
   Clicking it opens a `Sheet` (`ariaLabel` = the machine name) holding today's `ApprovedRow` card unchanged: rename, hardware, drivers, fingerprint, Revoke. A revoke closes the sheet.
4. **The "Revoked" row:** a muted row with a `Ban` icon, "Revoked", the count in mono 12 px, and a chevron. Clicking it toggles today's `RevokedRow` list under the card.
5. Keep every file under 400 lines.

### Not in scope
- the phone;
- the server;
- `AddMachineDialog`;
- the machine card's contents.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/routes/MachinesPage.tsx`
- `apps/web/src/components/machines/PendingMachineCard.tsx`
- `apps/web/src/components/machines/PendingRow.tsx`
- `apps/web/src/components/machines/MachineListRow.tsx` (new)
- `apps/web/src/components/machines/ApprovedRow.tsx`
- `apps/web/src/components/machines/ApprovedMachineCard.tsx`
- `apps/web/src/components/machines/RevokedMachineCard.tsx`
- `apps/web/src/components/machines/AddMachineButton.tsx`
- `work/T-1518-web-machines.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/machines?mock=1` at 1280 and 390 px:
  - "Add machine" is in the header;
  - a pending machine is the amber card with the code well and Deny/Approve;
  - the approved machines are rows with dots, which open the side sheet with their details;
  - the "Revoked" row shows its count and toggles the list.
- No status words, no horizontal scroll.

---

## Report (written by the worker when done)

### What I did

- **`MachinesPage.tsx`:** `SettingsShell` now has the title "Machines", no subtitle, and the primary "Add machine" key as its `action` (it opens the same `AddMachineDialog`). Section headings dropped. Rendering is: one pending card per pending machine, then one rounded list (`overflow-hidden rounded-xl border border-border bg-surface`) holding every approved `MachineListRow`, followed by the muted "Revoked" row when any machine is revoked; the existing `RevokedRow` list toggles below that card. The AI lookup now maps `machineId -> PublicAi[]` so each row gets the first AI (avatar) and each card still gets all the names (`ais === null` hides both, as before).
- **`PendingMachineCard.tsx`:** rebuilt to the approved design: an 8 px amber dot (`role="img"`, `aria-label="Waiting"`) + the name (15 px / 600); the fingerprint in a 44 px (`h-11`) mono well (16 px, `tracking-[0.08em]`, centred); then a row with "Approve if the machine shows this code." (13 px, muted, `flex-1`), Deny (secondary, two-step kept) and Approve (primary). The hardware line, driver chips and "Only approve…" line left the card. Kept the `hardwareLine` export that `ApprovedMachineCard` and `RevokedMachineCard` still import.
- **`MachineListRow.tsx` (new):** a button row (min height 52 px, `px-4`) with an 8 px dot (green `bg-online` "Online" / grey `bg-muted-foreground` "Offline"), the name (15 px / 500, `flex-1`, `truncate`), a 24 px `EntityAvatar` of the first assigned AI (`ai`, by name) when there is one, and a `ChevronRight`. Clicking opens a `Sheet` (`ariaLabel` = the machine name) holding today's `ApprovedRow` card unchanged. A revoke moves the machine out of the approved list, so the row and its `Sheet` unmount and the sheet closes.
- **`AddMachineButton.tsx`:** dropped the pill classes (`rounded-full px-5`) so it is the plain primary key (default variant, `size="lg"`) the header uses.

**Files changed:** `apps/web/src/routes/MachinesPage.tsx`, `apps/web/src/components/machines/PendingMachineCard.tsx`, `apps/web/src/components/machines/MachineListRow.tsx` (new), `apps/web/src/components/machines/AddMachineButton.tsx`, `apps/web/src/components/machines/ApprovedMachineCard.tsx`, `apps/web/src/components/machines/RevokedMachineCard.tsx`, `work/T-1518-web-machines.md`.

### Lead review fixes

1. **Fingerprint groups of 4:** `PendingMachineCard` now renders `groupFingerprint(machine.fingerprint)` (`a1b2 c3d4 e5f6 0718`). Display only — `machine.fingerprint` is untouched, so anything that copies or compares still gets the raw value. Added a small local `groupFingerprint` helper.
2. **Deny key:** changed from `variant="secondary"` to `variant="outline"`, matching `ApprovalCard.tsx`. The two-step confirm is unchanged.
3. **`ApprovedMachineCard` status pill removed:** online is now only the 8 px `bg-online` dot (`role="img"`, `aria-label="Online"`); offline is the grey dot (`role="img"`, `aria-label="Offline"`) plus the muted "last seen <relative>" text when `lastSeenAt` is known. No pill background, no status words. `lastSeenAt === null` shows just the dot. Dropped the now-unused `cn` import.
4. **`RevokedMachineCard` badge removed:** the "Revoked" pill is gone; the dated line "Revoked <date>" stays.

### Checks run

- `pnpm install`: done (reused, `+1137` packages, 15.7 s).
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (4.9s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- `pnpm gate` again after the lead review fixes (7 changed files, `ApprovedMachineCard.tsx` and `RevokedMachineCard.tsx` added to the Allowed files):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (3.3s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test file was run: the change is UI only and the nearest-test step reports "no nearby test files" (AGENTS.md / CLAUDE.md Hard rules). I did not run the web app, so the 1280/390 acceptance checks are still Julio's live check.

### Notes for the lead

- The `Sheet` has no built-in header, so `MachineListRow` renders its own slim header with a Close key; the `ApprovedRow` card inside is unchanged.
- The fingerprint is displayed grouped in fours (`a1b2 c3d4 e5f6 0718`) per the review; `machine.fingerprint` itself is still the raw value the runner shows, so nothing that copies or compares it changed.
- `PendingRow.tsx` is in the Allowed list but its props are unchanged, so I left it alone (no dead code).
- The amber dot uses `bg-amber-500` (#f59e0b, the mockup's amber); the palette has no amber token.
- The rounded list renders when there is at least one approved or revoked machine, so the "Revoked" row still shows if approved machines are empty.
- No visible status words were added: Online/Offline/Waiting live only in `aria-label`s.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `af189f0bb`, after one lead fix round: the code grouped in fours, an outline Deny, dot-only status in the sheet, and no "Revoked" badge.
- **Headless check (mock, dark, 1280 and 390 px):**
  - "Add machine" in the header;
  - office-linux as the amber card with `a1b2 c3d4 e5f6 0718`, the hint, Deny and Approve;
  - dev-mac as a row with a green dot, Dev-1's picture and a chevron. It opens the side sheet with the hardware, drivers, "AIs: Dev-1", the fingerprint and Revoke, with no status word;
  - the "Revoked 1" row toggles old-macbook ("Revoked Aug 10, 2026", Delete);
  - no horizontal scroll, 0 page errors.
