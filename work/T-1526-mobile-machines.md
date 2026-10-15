---
id: T-1526
title: "Phone Machines (approved Approvals canvas, PhoneMachines; twin of T-1518): large title, no subtitle; a new machine is a card with an amber dot, the code in a mono well (groups of 4) and Deny/Approve; other machines are plain rows (status dot, name, the AI's picture, chevron) that open a sheet with the details, Rename and Revoke; a 'Revoked' row with its count"
status: merged
milestone: M5
branch: task/T-1526-mobile-machines
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1526: Phone Machines

## Spec (written by Claude, do not edit)

### Why
Julio approved the Approvals canvas on 2026-10-15, including Machines. Read `docs/design/mockups/approvals/README.md` and `PhoneMachines.dc.html`. Web shipped as T-1518 (`apps/web/src/routes/MachinesPage.tsx`, `apps/web/src/components/machines/MachineListRow.tsx`, `PendingMachineCard.tsx`, the reference); this is the phone twin. **No status words:** a status is a dot.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/settings/machines.tsx` (172 lines):** `MachinesHeader`, then `PendingMachines`, `ApprovedMachines` (inline rename, Revoke) and `RevokedMachines` (a toggle plus Delete), then `AddMachineSheet` and a `ConfirmDialog` for revoke and delete (`:92-170`).
- **`apps/mobile/src/components/machines/machines-header.tsx` (38 lines):** Back, the title, the subtitle "Computers where your AIs can work." (`:28`), and an "Add machine" `IconButton`.
- **The other components:**
  - `pending-machines.tsx` (60 lines): Approve (`variant="default"`) and Deny;
  - `approved-machines.tsx` (109 lines): a "Your machines" `SectionLabel`, a `Card` and an inline rename editor;
  - `machine-card.tsx` (40 lines): the name plus `os osVersion · arch`, and actions.
- **The machine type** is the contract's `Machine` (`apps/mobile/src/lib/machines-api.ts:3`, `:21`): `online` is optional and `fingerprint` is the code the runner shows.
- **AIs:** the phone's `PublicAi` has `machineId` (`apps/mobile/src/lib/ais-api.ts`); the list is `useAisApi().api.listAis()` (`apps/mobile/src/components/ais/use-ais-api.ts:56`).
- **The kit:** `ActionSheet` and `ActionSheetItem` (`apps/mobile/src/components/ui/action-sheet.tsx`), `EntityAvatar` (`ai`), `IconButton` (40 px), `Button`.

### Steps
1. **Header:** Back on the left and Add on the right; under them the large title "Machines" (28 px, 600). No subtitle.
2. **A pending machine (`pending-machines.tsx`):** a card (`rounded-2xl border border-border bg-surface p-4`, gap 14) with:
   - an 8 px amber dot (`accessibilityLabel` "Waiting") and the name (15 px, 600);
   - the fingerprint in a 44 px mono well, shown in groups of 4 separated by spaces;
   - "Approve if the machine shows this code." (13 px, muted);
   - a row with Deny (`variant="outline"`, keeping today's flow) and Approve (primary), sharing the width.
3. **Every other machine in one rounded list** (new `apps/mobile/src/components/machines/machine-row.tsx`):
   - each approved machine is a pressable row (min height 52): an 8 px dot (green `bg-online`, "Online", or grey, "Offline"), the name (15 px, 500), a 24 px `EntityAvatar` of the first AI whose `machineId` is this machine (when there is one), and a `ChevronRight`;
   - the last row, when any machine is revoked: a muted `Ban` icon, "Revoked", the count in mono, and a chevron. It toggles today's revoked list under the card.
   - Load the AI list once on the screen; if it fails, show no pictures.
4. **The machine sheet** (new `apps/mobile/src/components/machines/machine-sheet.tsx`): pressing a row opens an `ActionSheet` whose header is the dot and the name, then:
   - the muted `os osVersion · arch` line;
   - the fingerprint (mono, groups of 4);
   - the assigned AI names, when any;
   - "Rename", which opens today's inline rename editor (in the sheet or the screen, whichever is simpler);
   - "Revoke" (red), which opens today's confirm.
5. **Remove** the "Your machines" section label, the per-row action buttons on the list, and any status word.
6. Keep every file under 400 lines.

### Not in scope
- web;
- the server;
- `AddMachineSheet`.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/components/machines/machines-header.tsx`
- `apps/mobile/src/components/machines/pending-machines.tsx`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/components/machines/revoked-machines.tsx`
- `apps/mobile/src/components/machines/machine-card.tsx`
- `apps/mobile/src/components/machines/machine-row.tsx` (new)
- `apps/mobile/src/components/machines/machine-sheet.tsx` (new)
- `work/T-1526-mobile-machines.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/settings/machines`:**
  - the large title;
  - office-linux as the amber card with `a1b2 c3d4 e5f6 0718` and Deny/Approve;
  - dev-mac as a row with a green dot and Dev-1's picture, which opens the sheet;
  - a "Revoked 1" row that toggles old-macbook.
- No status words.

---

## Report (written by the worker when done)

### What I did

Redesigned the phone Machines screen to match the approved `PhoneMachines.dc.html`.
No status words anywhere: a status is a dot.

- `machines-header.tsx`: Back left, Add machine right, and under them the large
  title "Machines" (28 px / 600). Removed the "Computers where your AIs can
  work." subtitle.
- `pending-machines.tsx`: one amber card per pending machine
  (`rounded-2xl border border-border bg-surface p-4`, gap 14) with an 8 px amber
  dot (`accessibilityLabel` "Waiting") and the name (15/600), the fingerprint in
  a 44 px mono well grouped in fours (`a1b2 c3d4 e5f6 0718`),
  "Approve if the machine shows this code." (13 px muted), and Deny (outline) /
  Approve (primary) as 44 px keys sharing the width. Today's Deny flow is kept
  (the button calls `onDeny` directly). Removed the "Waiting for approval"
  section label.
- `machine-row.tsx` (new): `MachineRow` is an approved machine row (min height
  52) with an 8 px dot (green `bg-online` / grey), the name (15/500), the first
  AI whose `machineId` is this machine as a 24 px `EntityAvatar`, and a
  `ChevronRight`; `RevokedToggleRow` is the last row (muted `Ban`, "Revoked",
  the count in mono, a chevron) that toggles the revoked list.
  `groupAisByMachine` groups the owner's AIs by home machine id.
- `machine-sheet.tsx` (new): the `ActionSheet` opened by a row. Its header is
  the dot and the name, then the muted `os osVersion · arch`, the fingerprint
  (mono, groups of four) and the assigned AI names; the items are Rename and
  Revoke (destructive).
- `approved-machines.tsx`: one `Card` list of `MachineRow`s plus the
  `RevokedToggleRow` when any machine is revoked. It holds the open-machine
  state and renders one `MachineSheet`. Rename reuses today's inline editor
  (TextField + Cancel / Save), shown in place of the row while renaming; it
  opens from the sheet. Removed the "Your machines" label and the per-row
  Rename / Revoke buttons.
- `revoked-machines.tsx`: keeps today's revoked list (each with Delete) but
  drops its own toggle button, which moved into the list's last row.
- `machines.tsx`: loads the owner's AIs once with `useQuery` +
  `useAisApi().api.listAis()` (the same pattern as `empty-chat.tsx`), groups them
  by machine, and passes them down; a failed AI read groups nothing, so the rows
  show no pictures. The revoked list renders under the card when its row is
  toggled open.

`machine-card.tsx` is unchanged and still used by the revoked list.

### Checks run

- `pnpm install` — done (the gate's frozen install passes).
- `pnpm gate` — first run failed `format` only (3 files); fixed with
  `pnpm exec prettier --write` on the 7 touched files; the second run passed:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.6s)
PASS  lint  (1.2s)
PASS  typecheck  (5.3s)
PASS  effect  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single tests were run: the task says none (UI) and the gate reports no nearby
test files for `@zilar/mobile`.

### Notes for the lead

- No tests (UI, per the spec).
- I checked the implementation against the mock seed
  (`packages/mock-backend/src/domains/machines/seed.ts` and
  `.../ais/seed.ts`): office-linux is pending with fingerprint
  `a1b2c3d4e5f60718` → `a1b2 c3d4 e5f6 0718`, dev-mac is approved and online
  with Dev-1 on it (`machineId: 'mach-approved'`), old-macbook is revoked
  (count 1). I did not run the phone smoke; the lead's smoke covers it.
- Deviations from the spec: none I know of. The revoked rows keep their Delete
  button (step 5's "per-row action buttons on the list" refers to the approved
  list); say the word if the revoked rows should also lose it.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with one nit (two copies of `groupFingerprint`, in `pending-machines.tsx` and `machine-sheet.tsx`); left as a follow-up.
- **Phone smoke** (`/settings/machines`, mock): PASS. The screenshot matches `Phone.dc.html`:
  - Back and + keys, and the large title with no subtitle;
  - the amber pending card for office-linux, with the code `a1b2 c3d4 e5f6 0718` in a mono well, the hint, and an outline Deny beside the primary Approve at equal width;
  - dev-mac as a lean row: a green dot, the Dev-1 picture and a chevron;
  - a "Revoked" row with count 1.
  
  No status words are visible.
- **Revoked rows keep Delete.** That is fine: they sit behind the Revoked row, and Delete is their only action.

