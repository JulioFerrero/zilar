---
id: T-2147
title: "Web (machines, integrations, avatar crop): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2147-web-folds-3
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2147: Fold single-use web files (machines, integrations, avatar crop)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `2386ee84d`. Each mover has exactly one production importer, the host, and no test imports it. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) |
| --- | --- |
| `components/machines/machineRowOps.ts` (54) | `routes/MachinesPage.tsx` (579) |
| `components/settings/integrationErrors.ts` (38) | `routes/IntegrationsPage.tsx` (478) |
| `components/settings/useIntegrationSave.ts` (37) | `routes/IntegrationsPage.tsx` (478) |
| `lib/avatar-crop.ts` (49) | `components/AvatarUploader.tsx` (499) |

All paths are under `apps/web/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or exceed 650 lines. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same markup, class names, aria labels, focus order and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/web/src/store/**`;
  - `apps/web/src/lib/api.ts`;
  - `apps/web/src/lib/api/**`.
- No new tests.
- Product lines go down by at least 15.

### Allowed files
- `apps/web/src/components/AvatarUploader.tsx`
- `apps/web/src/components/machines/machineRowOps.ts`
- `apps/web/src/components/settings/integrationErrors.ts`
- `apps/web/src/components/settings/useIntegrationSave.ts`
- `apps/web/src/lib/avatar-crop.ts`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/MachinesPage.tsx`
- `work/T-2147-web-folds-3.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 15.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (web mock): /settings/machines (approve, rows), /settings/integrations (save errors), the profile avatar crop.

---

## Report (written by the worker when done)

### What I did

Folded all four movers into their only importers; no logic, markup, class names, aria labels or
effects changed.

| Row | Result |
| --- | --- |
| `components/machines/machineRowOps.ts` (54) → `routes/MachinesPage.tsx` | folded — host 579 → 623 lines, mover deleted, net **−10** |
| `components/settings/integrationErrors.ts` (38) + `components/settings/useIntegrationSave.ts` (37) → `routes/IntegrationsPage.tsx` | folded both — host 478 → 543, movers deleted, net **−10** |
| `lib/avatar-crop.ts` (49) → `components/AvatarUploader.tsx` | folded — host 499 → 537, mover deleted, net **−11** |

Total source lines across the touched files: 178 insertions, 209 deletions → **−31**.

What moved:
- `machineRowOps.ts`: `ConfirmingState`, `ConfirmKind`, `EMPTY_CONFIRMING`, `clearFailure`,
  `failureText`, `useMachineAction` are now non-exported declarations below `MachinesPage`; the
  host imports `ApiError`, `machineErrorMessage`, `shownFailure`, `ApiFailure`, `ActionControls`,
  `ActionState`, `UseActionOptions` and `HttpClient` directly.
- `integrationErrors.ts` and `useIntegrationSave.ts`: `PageStatus`, the three tagged errors,
  `friendlyError`, `IntegrationSave`, `useIntegrationSave` are non-exported declarations below the
  last card. `shownFailure` is imported from `@/lib/effect/use-action` (the re-export was dropped),
  and `Data`, `Effect`, `useAction`, `ActionState` and `ApiFailure` are imported at the top.
- `avatar-crop.ts`: constants, `CropSource`/`CropArea`/`CropState`, `INITIAL_CROP_STATE` and
  `exportDrawArgs` are non-exported declarations at the end of `AvatarUploader.tsx`. Its header
  comment (“No DOM here, so the crop math runs in Vitest without a browser”) was dropped because
  the file is no longer DOM-free; the “why” comments on the crop state and draw args were kept.

No duplicate declarations appeared; nothing was skipped.

### Checks run

- `pnpm install`: done, 17 workspace projects, 1 deprecated subdependency (`uuid@7.0.3`), one
  existing peer-dependency warning in `apps/mobile`.
- `pnpm gate` (from the repo root):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (2.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (0.9s)
  PASS  effect  (0.9s)
  SKIP build @zilar/server (no server, package or manifest change)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  It warned only about the soft 400-line limit (537, 543, 623 lines), which the spec accepts for
  these hosts.
- No single test files were run: the spec says no new tests, this is UI code, and the gate
  reported no nearby test files for `@zilar/web`.

### Notes for the lead

- Lead web-mock check: `/settings/machines` (approve, deny, rename, revoke, delete rows),
  `/settings/integrations` (save success and error lines for all three cards), profile avatar crop
  (drag, zoom, save as WebP/PNG).
- All three hosts stay below the 650-line cap: 623, 543 and 537.
- `AvatarUploader.tsx` still declares its crop helpers after the component, as the spec asked
  (“below the host's main export”).


## Review (written by Claude)

Approved; the pre-review was clean. Net −31, all four rows folded:
- `machineRowOps` → `MachinesPage`;
- `integrationErrors` and `useIntegrationSave` → `IntegrationsPage`;
- `avatar-crop` → `AvatarUploader`.

**Comments:** one header line ("No DOM here, so the crop math runs in Vitest") was dropped. It no longer applies now that the math lives in the component file.

**Web mock check:**
- `/settings/machines` shows the pairing code with Approve and Deny, plus the revoked row.
- `/settings/integrations` renders, and Save shows "Saved — a test email is on its way".
- `/settings/profile` renders.
- No page errors.
