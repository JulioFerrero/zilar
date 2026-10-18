---
id: T-2112
title: "Plan only: store phase 2 — pins, chat prefs, folders and group actions move into packages/client-core/src/store so web and phone share one copy; write docs/audit/store-phase2-plan.md with a task list, file:line facts and the expected line savings — no code change"
status: merged
milestone: M5
branch: task/T-2112-store-phase2-plan
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2112: Store phase 2 plan

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and the codebase must be easier for AIs and humans to read. `docs/STORE_CORE_PLAN.md` section 9 lists a phase 2 that never ran:
- pins, prefs and folders in core;
- groups, topics, channels, roles and invite links in core.

Both apps still keep their own store effects for these:

| Area | Web (`apps/web/src/store/effects/`) | Phone (`apps/mobile/src/store/effects/`) |
| --- | --- | --- |
| Pins | `pins.ts` (100 lines) | `pins.ts` (177) |
| Prefs | `prefs.ts` (204) | `user-state.ts` (111) |
| Groups | `groupActions.ts` (140), `groupCreate.ts` (142), `groupMembers.ts` (151), `groupSettings.ts` (217), `groupShared.ts` (65), `topics.ts` (173) | `group-actions.ts` (301), `group-membership-actions.ts` (47), `group-roles-actions.ts` (126), `group-settings-actions.ts` (35), `groups.ts` (280) |

The lead measured how alike the two sides are (normalised lines, `difflib` ratio): pins 0.15, history 0.10, send 0.13. So they are mostly the same behaviour written twice, not copies.

The shared store already exists in `packages/client-core/src/store/`: `pins.ts`, `folders.ts`, `prefs.ts`, `group-actions.ts`, `groups.ts`, `ports.ts` and the ledger. Since 2026-10-18 both apps also call one shared HTTP module per area (`packages/client-core/src/*-api.ts`, see `docs/ARCHITECTURE.md`).

### What to write
Write one file, `docs/audit/store-phase2-plan.md`. Read the code; do not change any.

1. **Inventory.** For each area (pins, prefs and chat prefs, folders, groups and members and roles and settings, topics):
   - what core already has (`packages/client-core/src/store/<file>.ts`, with exports and `file:line`);
   - what web adds on top, and what phone adds on top (`file:line`);
   - the differences that matter: real behaviour differences, not style. Mark each as "same behaviour, different code" or "real difference", and for a real difference say which side is right and why, citing code.
2. **Tasks.** List tasks of about 30–60 minutes each, in a safe order. For each task give:
   - the core functions it adds or extends;
   - the web and phone files that shrink or go;
   - the exact Allowed files (full repo paths);
   - the existing tests that cover it (`file`);
   - the expected net line change (an estimate from the inventory).
   - Never put two tasks on the same file at the same time; say which tasks can run in parallel.
3. **Risks.** Anything on the message hot path (send, ledger, incoming) is out of scope; say if a task would touch it. List what a lead must check by hand after each task: the web mock screens and the phone emulator screens by route.
4. **Total.** The expected line savings for the whole phase.

Keep the document under 400 lines. Use `file:line` for every claim.

### Allowed files
- `docs/audit/store-phase2-plan.md`
- `work/T-2112-store-phase2-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists, cites `file:line` for every claim, and gives non-overlapping tasks with savings estimates.
- No code changed.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/store-phase2-plan.md` (398 lines, under the 400-line limit) as a
read-only inventory and task plan. No code changed.

- Inventoried core, web and phone for pins, chat prefs, folders, groups/members/
  roles/settings/channels and topics, with `file:line` on every claim.
- Recorded two real phone bugs: channels cannot pin on the phone
  (`apps/mobile/src/store/effects/pins.ts:106-109` vs
  `apps/web/src/store/realStore.ts:89-94`), and phone prefs are loaded only at
  boot (`apps/mobile/src/store/effects/history.ts:45-54`).
- Planned four tasks: T1 prefs optimistic row, T2 pin permission rule,
  T3 one group write path plus topic failure hook, T4 one detail type/member
  mapper/join loop. T1–T3 use disjoint files and can run in parallel; T4 follows
  T3 because both edit `apps/mobile/src/store/effects/groups.ts`.
- Estimated net saving: about 260 lines after core additions (T3 is −186).

### Checks run

- `pnpm install`: done, 17 workspace projects, done in 19.3s.
- `pnpm gate`: `GATE PASS`. Summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (1.9s)
SKIP effect (no source files changed)
SKIP build @zilar/server (no server, package or manifest change)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- Single test files run: none. The change is docs-only, so there was no package
  test to run; gate skipped effect/build for the same reason.

### Notes for the lead

- Pins and folders are already shared: pins only lack the permission rule, and
  folders have no duplicated decision worth moving (four API call-then-set
  pairs). The plan deliberately gives folders no task.
- Roles and invite links have no duplicated store state: HTTP is already shared
  in `packages/client-core/src/groups-api.ts`, web calls it from components and
  only phone keeps caches. No task.
- Two decisions to confirm before T3/T4, written in §5 of the plan: one GET per
  group write (apply the returned detail, reload for `void` routes), and dropping
  the phone's extra eager `ensureGroupDetail` fork at boot.
- Follow-up not in this phase: phone never refreshes chat prefs after boot, so a
  pref changed on another device needs a restart. Fixing it adds a request.

## Review (written by Claude)

Approved; the pre-review was clean. `docs/audit/store-phase2-plan.md` (398 lines) gives four non-overlapping tasks worth about −260 net, with `file:line` facts. T3, one group write-then-reload path, is the main win (−186).
- **Lead decisions on §5:**
  1. Accepted: apply the returned detail when the route answers `GroupDetail`, and reload when it answers `void`.
  2. Accepted for T4, which runs last, after T3. The phone smoke must open a group and its info after boot.
  3. Accepted: role and invite wrappers stay.
- **T2** also fixes a real parity bug: the phone hides Pin in channels for owners and admins.
