---
id: T-1740
title: "Phone: the group's Tools and routines page gets Pause/Resume/Delete on routines (as web already has), and the last raw fetches stop sending cookies (T-1736 follow-up)"
status: merged
milestone: M5
branch: task/T-1740-phone-group-routines
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1740: Manage routines from the group page on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-16: "can't deleted routines or nothing". On his phone he opened the group's "Tools and routines" page, which only lists the routines. Web already offers Pause, Resume and Delete there.

### Facts (the lead read them on 2026-10-16)
- **The phone page is read-only:**
  - `apps/mobile/src/components/group-info/tools-page.tsx` (81 lines) shows the group's routines with `RoutinesSectionContent` and no `actions` (`:76`);
  - its header comment says "read only" (`:21-24`).
- **The phone already has the actions:**
  - `apps/mobile/src/components/ais/routines-section.tsx` (on the AI's page) wires `RoutineRowActions` (`:127-137`, `:333-344`), with confirm-before-delete, busy state, `applyRoutineActionEffect` and `run` (`:300-331`);
  - the calls are `pauseRoutine`, `resumeRoutine` and `deleteRoutine` by id (`apps/mobile/src/lib/tools-api.ts:139-141`).
- **Web shows the actions on the group scope,** hidden when the API would refuse (`canManage`): `apps/web/src/components/tools/RoutinesSection.tsx:55-90`.
- **The T-1736 follow-up:** these raw fetches still send the native cookie jar's cookie, because no `credentials: 'omit'` is set:
  - `apps/mobile/src/lib/chat-api.ts:113`;
  - `apps/mobile/src/lib/profile-api.ts:202`;
  - `apps/mobile/src/lib/directory-api.ts:144`;
  - `apps/mobile/src/lib/auth-api.ts:176`;
  - `apps/mobile/src/lib/use-client-version.ts:28`;
  - `apps/mobile/src/components/group-info/use-group-picture.ts:158`.
  - The docstring at `apps/mobile/src/lib/auth.ts:36-38` still says native fetch has no cookie jar.

### Steps
1. **The group page manages routines.**
   - In `tools-page.tsx`, pass `RoutineRowActions` to `RoutinesSectionContent`, reusing the same action logic as `routines-section.tsx`. Extract the shared hook (state, busy, confirm, `run`) into `apps/mobile/src/components/ais/use-routine-actions.ts`, so both pages use it.
   - Show the actions only when the routine's `canManage` (or the equivalent field web uses) allows them, as web does.
   - Update the header comment.
2. **No more cookies.** Add `credentials: 'omit'` to the six fetches above, and fix the `auth.ts` docstring.
3. **No tests** (UI). Each file stays under 400 lines.

### Allowed files
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/use-routine-actions.ts`
- `apps/mobile/src/lib/chat-api.ts`
- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/lib/directory-api.ts`
- `apps/mobile/src/lib/auth-api.ts`
- `apps/mobile/src/lib/auth-api.test.ts` (added by the lead: its `checkInvite` assertion pins the exact init)
- `apps/mobile/src/lib/use-client-version.ts`
- `apps/mobile/src/components/group-info/use-group-picture.ts`
- `apps/mobile/src/lib/auth.ts`
- `work/T-1740-phone-group-routines.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **On the phone,** the group's Tools and routines page can pause, resume and delete a routine (delete asks first), like the AI page and web.
- **The six fetches** send `credentials: 'omit'`.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- **Step 1, the group page manages routines.**
  - New `apps/mobile/src/components/ais/use-routine-actions.ts`: the shared action
    logic (`routineActionMessage`, `applyRoutineActionEffect`,
    `applyRoutineAction`, the message constants and types) plus the
    `useRoutineActions` hook (busy row, confirm-before-delete, one action at a
    time, the message under the list). The helpers moved here so the dependency
    stays one-way (`routines-section` -> `use-routine-actions`, no cycle).
  - `apps/mobile/src/components/ais/routines-section.tsx`: `RoutinesSection` now
    uses the hook and renders `RoutineRow`/`RoutinesSectionContent` only. It
    re-exports `routineActionMessage`, `RoutineAction` and `RoutineActionMessage`
    so `app/settings/routines.tsx` (outside the Allowed files) keeps compiling.
  - `apps/mobile/src/components/group-info/tools-page.tsx`: passes
    `RoutinesSectionContent` the hook's actions, only for a manager; a dead 403/404
    answer still shows the fixed line. The list is edited in place (pause/resume
    swap the row, delete drops it) and Retry reloads it. Header comment updated.
- **Step 2, no more cookies.** Added `credentials: 'omit'` to the six raw
  fetches: `lib/chat-api.ts:113`, `lib/profile-api.ts:202`,
  `lib/directory-api.ts:144`, `lib/auth-api.ts:176`, `lib/use-client-version.ts:28`,
  `components/group-info/use-group-picture.ts:158`. Fixed the `auth.ts` docstring
  (native fetch does keep a cookie jar; the client omits credentials) and the
  `checkInvite` comment that said the init "stays bare".
- **Step 3.** No new tests, as the Spec asks. Every file is under 400 lines.

### Checks run

- `pnpm install` — Done in 15.5s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`
  — 1 file passed, 7 tests passed.
- `pnpm exec prettier --write <the changed files>` — all already formatted
  (unchanged).
- `pnpm gate` (from the repo root) — summary:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Blocked / needs a decision — resolved

- Step 2 changes `checkInvite` in `apps/mobile/src/lib/auth-api.ts:176`, whose
  existing test pinned the exact init with `toHaveBeenCalledWith`, so the test
  had to change. The test file was outside the Allowed files, so I blocked; the
  lead added `apps/mobile/src/lib/auth-api.test.ts` to the Allowed files and I
  changed lines 73-75 to expect `credentials: 'omit'`. The single test and the
  gate are green.
- The lead also accepted the manager-gate deviation below.

### Notes for the lead

- **Deviation, manager gate.** The phone derives `canManage` from the chat store
  (`groupDetail(groupId)?.members` + `currentUserId`, through the existing
  `mayManageRoles`) instead of a prop: the mount that would pass the route's
  `isManager` is `group-info-pages.tsx:222`, which is outside the Allowed files.
  Same owner/admin rule as web's caller `isManager`, and the actions stay hidden
  until the group detail is loaded, so a non-manager never sees them.
- `apps/mobile/src/components/ais/tool-detail-loader.tsx:142` has a comment
  referring to `runningRef` "in routines-section.tsx"; that pattern now lives in
  `use-routine-actions.ts`. That file is outside the Allowed files, so I left the
  comment as is.
- Files changed (all inside the Allowed files): the new
  `.../ais/use-routine-actions.ts`, `.../ais/routines-section.tsx`,
  `.../group-info/tools-page.tsx`, `.../group-info/use-group-picture.ts`,
  `lib/chat-api.ts`, `lib/profile-api.ts`, `lib/directory-api.ts`,
  `lib/auth-api.ts`, `lib/auth-api.test.ts`, `lib/use-client-version.ts`,
  `lib/auth.ts`, and this task file.

## Review (written by Claude)

- **Accepted at `ca010f51f`.** The pre-review is clean (2 follow-ups) and the packet is current.
- **The group page:** the phone's group Tools and routines page now uses the shared `use-routine-actions.ts`, the same logic as the AI page, for Pause, Resume and Delete (delete asks first). The actions are hidden unless the viewer can manage roles (`mayManageRoles` on the group detail): the worker's accepted deviation, the same rule as web's `isManager`.
- **The block:** the lead added `auth-api.test.ts` to the Allowed files, because its `checkInvite` assertion pins the exact init.
- **Cookies:** six raw fetches now send `credentials: 'omit'`, and the `auth.ts` docstring is fixed.
- **Follow-ups:** `raw-request.ts` still has no `credentials: 'omit'`, and the `runningRef` comment in `tool-detail-loader.tsx:141-142` is stale.
