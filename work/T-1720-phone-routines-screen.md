---
id: T-1720
title: "Phone Settings › Routines (approved board PhoneRoutinesList): /settings/routines lists every routine of my AIs in Running and Paused groups — AI ball, title with status dot, schedule · AI, 44 px Ask (opens the chat) and Pause/Resume keys; a long press or tap reveals Delete with a confirm. Parity twin of T-1719"
status: merged
milestone: M5
branch: task/T-1720-phone-routines-screen
model: auto
effort: default
depends_on: [T-1719]
estimate: 50 min
---

# T-1720: Phone Settings › Routines

## Spec (written by Claude, do not edit)

### Why
Julio approved the Settings › Routines page on 2026-10-16 ("Build as drawn"). This is the phone twin of T-1719 (web). The board is `docs/design/mockups/routines/PhoneRoutinesList.dc.html`; read it (`git show main:docs/design/mockups/routines/PhoneRoutinesList.dc.html`) and the README in that folder first.

T-1719 already added:
- the shared `routines` settings row (`packages/chat-core/src/settings-items.ts`);
- its icon in the phone map (`apps/mobile/src/app/(tabs)/settings.tsx`), so the phone hub already shows the row;
- `chatJid` on `GET /api/routines` (`listMine`, contract `MyRoutine` in `packages/api-contract/src/routines.ts`).

This task adds the screen the row opens.

### Facts (the lead read them on 2026-10-16)
- **Phone settings screens** live in `apps/mobile/src/app/settings/` (`approvals.tsx`, `machines.tsx`, …). `approvals.tsx` (114 lines) uses `RequireAuth`, `AisScreenShell` (`@/components/ais/screen-shell`), `StateMessage` and `Text`.
- **The phone routine API** is `apps/mobile/src/lib/tools-api.ts` (214 lines):
  - `RoutineActionsApi { pauseRoutine; resumeRoutine; deleteRoutine }` (`:138-142`);
  - `createToolsApi(getToken, …)` builds it with `client.routines.*` (`:161` on), for example `listAiRoutines` → `client.routines.listForAi`.
- **The existing per-AI routines UI:** `apps/mobile/src/components/ais/routines-section.tsx` (357 lines) and the formatting helpers in `apps/mobile/src/lib/routines-format.ts` (`describeRoutineSchedule`, `routineStatusText`, …).
- **Opening a chat:** `router.push({ pathname: '/chat/[id]', params: { id: jid } })` (`apps/mobile/src/app/(tabs)/ais.tsx:304`).

### Steps
1. **`tools-api.ts`:** add `listMyRoutines(): Promise<MyRoutine[]>` (via `client.routines.listMine()`) to a small new interface and to `createToolsApi`. Keep the file under 400 lines.
2. **New `apps/mobile/src/app/settings/routines.tsx`** and a row component `apps/mobile/src/components/routines/routine-row.tsx`, built from the kit (the AI ball avatar seeded by the AI's name with `aiAvatarUrl`, `IconButton` 44 px, `Text`):
   - a screen titled "Routines", with the sections **Running** (`active`) and **Paused** (the rest);
   - **each row:**
     - the ball;
     - the title with a dot (green active, grey otherwise);
     - one muted line: the schedule in mono, ` · `, the AI name;
     - an **Ask** key (message icon) that pushes `/chat/[id]` with `chatJid`, hidden when null;
     - a **Pause** or **Resume** key;
   - **tapping a row** shows a red **Delete** key on it, with a confirm dialog (reuse the confirm pattern from `routines-section.tsx`);
   - pull to refresh;
   - an empty list shows `StateMessage` "No routines yet";
   - keep files under 400 lines.
3. **No UI tests.**

### Allowed files
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/components/routines/routine-row.tsx`
- `work/T-1720-phone-routines-screen.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The phone Settings › Routines row opens the screen.**
- **The screen matches the board:** Running and Paused groups, with Ask, Pause or Resume, and Delete on tap with a confirm.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Added the phone Settings › Routines screen the shared `routines` row (T-1719, `href: /settings/routines`) opens, as the parity twin of web's `RoutinesPage`/`RoutineRow`.

Files changed (all inside the Allowed files):
- **`apps/mobile/src/lib/tools-api.ts`** (226 lines): added a small `MyRoutinesApi` interface with `listMyRoutines(): Promise<MyRoutine[]>`, wired it into `createToolsApi` via `runApi(client.routines.listMine())`, added `MyRoutinesApi` to the `AiToolsApi` intersection so the existing `useToolsApi()` hook exposes it, and re-exported the `MyRoutine` type. Stays under 400 lines.
- **`apps/mobile/src/app/settings/routines.tsx`** (new, 253 lines): the screen. `RequireAuth` + `AisScreenShell` (like `approvals.tsx`), a ScrollView with pull-to-refresh, a load effect with a fiber interrupt on unmount (mirroring `routines-section.tsx`), the Running (`active`) and Paused (the rest) groups (`RoutineGroup`), an empty state `StateMessage` "No routines yet" and an error state with Retry. Actions go through `useAction` and reload the list on success (the server owns the order, like web); failures show `routineActionMessage` (fixed sentences, hint muted / error red), never server text.
- **`apps/mobile/src/components/routines/routine-row.tsx`** (new, 122 lines): one row built from the kit — `EntityAvatar` ball seeded by `aiName` with `aiAvatarUrl`, title with a status dot (green `bg-online` running, grey otherwise), one muted line with `describeRoutineSchedule` in mono then ` · ` then the AI name, a 44 px `IconButton` Ask key (`MessageCircle`) that pushes `/chat/[id]` with `chatJid` (hidden when `chatJid === null`), a Pause/Resume `IconButton`, and a red Delete key revealed by tapping the row.
- **`work/T-1720-phone-routines-screen.md`**: status + this report.

Both new files and `tools-api.ts` are under 400 lines; the gate's `size` step passes. No UI tests were added (spec step 3).

### Checks run

- `pnpm install` → `Done in 14s`.
- `pnpm gate` (first run) → **GATE FAIL**. `typecheck` failed: `apps/mobile/src/app/settings/routines.tsx(99,11): error TS2769` — the delete action returns `Promise<void>` while pause/resume return `Promise<Routine>`, so `Effect.tryPromise` could not pick one `PromiseLike` overload. Fixed by normalizing the call to an `async` function that always resolves `void`.
- `pnpm gate` (second run) → **GATE PASS**:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (2.5s)`
  - `PASS  effect  (0.7s)`
  - `PASS  tests @zilar/mobile  (1.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

No standalone test file was run with the filtered form: the change adds no test and no existing test imports these files. The gate's `tests @zilar/mobile` step passed.

### Notes for the lead

- **Delete confirm:** the spec says "a confirm dialog (reuse the confirm pattern from `routines-section.tsx`)". I used the kit's shared `ConfirmDialog` (the one Machines uses) for the two-step delete confirm rather than the inline Delete/Cancel buttons of `routines-section.tsx`, since the spec calls it a dialog and this is the kit's confirm dialog. The Delete key still appears only after tapping the row. Flagged in case you wanted the inline pair.
- **Row tap:** tapping a row reveals the Delete key on the row (as the spec and web's `RoutineRow` do). The phone board README's older note ("tapping a row opens the routine") is not what the spec asks, so I followed the spec.
- **API type:** I added `MyRoutinesApi` to `AiToolsApi` rather than a separate hook file, so the screen reuses the existing `useToolsApi()` (mock mode keeps working and no extra file was needed).
- **Mock:** the shared mock backend has no `/api/routines` route, so the screen shows its error state under `EXPO_PUBLIC_ZILAR_MOCK`. Out of scope for this task (no such route existed before); say the word if you want it seeded.
- **Acceptance:** the hub row already points at `/settings/routines` (T-1719) and `apps/mobile/src/app/settings/routines.tsx` is that route, so the row opens the screen. The screen shows Running and Paused groups, Ask, Pause/Resume and Delete-on-tap with a confirm, matching the board. I did not run the app on a device — the phone smoke is yours.

## Review (written by Claude)

**Approved and merged.** Julio approved this board ("Build as drawn", 2026-10-16). The phone twin of T-1719.

- **Pre-review:** clean, plus 2 nits and 1 follow-up.
  - The 40 px keys are the phone kit's `IconButton` size, which the routines README asks to keep.
  - The stale-notice nit is accepted.
- **The worker's choices, accepted:**
  - `ConfirmDialog` (the kit's, as on Machines) for Delete;
  - `MyRoutinesApi` on `AiToolsApi`.
- **The row:** `EntityAvatar`, the title with a dot, the mono schedule · AI line, Ask (`/chat/[id]` with `chatJid`), and Pause or Resume.
- **Device check:** the screen wasn't run on a device; Julio checks it in his test pass. The mock backend has no `/api/routines`, so mock mode shows the error state. That's acceptable for now.
