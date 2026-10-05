---
id: T-0212
title: Mobile: pause, resume and delete a routine on the AI screen
status: merged
milestone: M5
branch: task/T-0212-mobile-routine-actions
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0189]
estimate: 0.5 day
---

# T-0212: Routine actions on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". T-0189 added a read-only Routines section to the phone's AI edit screen; web also lets the owner pause, resume and delete a routine. This is T-0189c of `docs/audit/mobile-parity-gaps.md` section 7.1.

### What the person sees
On each routine row of the AI edit screen, to the right of the text (or under it when the row is narrow):
- `Pause` (outline, small) when the routine is `active`; `Resume` when it is `paused` or `needs_approval`. While the call runs the label reads `Pausing…` / `Resuming…`.
- `Delete` (outline, small). Pressing it turns into two buttons: `Delete` (destructive) and `Cancel` (ghost); the destructive one runs the delete and reads `Deleting…` while it runs. A deleted routine leaves the list.
- While any action runs, every action button on the section is disabled.
- After a pause or resume the row shows the routine the server returned.
- Under the list: `This routine needs re-approval. Ask the AI to schedule it again.` (muted) when the server answers code `needs_approval`; `You may not change this routine.` (danger) on 403 or 404; `Could not update the routine. Try again.` (danger) on anything else, including network errors. Never show server text. A new action clears the previous message.
- Accessibility labels as on web: `Pause <title>`, `Resume <title>`, `Delete <title>`, `Confirm deleting <title>`.

### Verified facts (do not re-derive)
- Server: `POST /routines/:id/pause` (`apps/server/src/routines/routes.ts` line 101) and `POST /routines/:id/resume` (line 119) answer the routine; resume of a routine paused for `hosts_changed` or awaiting re-approval answers 409 with code `needs_approval`. `DELETE /routines/:id` (line 137) answers 204 with no body; a stranger gets 404.
- Web: `pauseRoutine`, `resumeRoutine`, `deleteRoutine` in `apps/web/src/lib/tools.ts` lines 236-254; the row actions and messages in `apps/web/src/components/tools/RoutinesSection.tsx` lines 125-164 (the `mutate` helper and the three messages) and 213-280 (the buttons). On mobile the last message is the fixed sentence above, not the server text.
- Mobile after T-0189: `ToolsApi` in `apps/mobile/src/lib/tools-api.ts` (line 55, `listAiTools`, `listAiRoutines`), `ToolsApiError` (line 60), `createToolsApi` (line 233); the mock `apps/mobile/src/mock/tools.ts`; the section `apps/mobile/src/components/ais/routines-section.tsx` (138 lines: `loadAiRoutines` line 31, `RoutinesSectionContent` line 68, `RoutinesSection` line 107); its tests `apps/mobile/src/components/ais/routines-section.test.tsx`. The request helper already treats an empty body as `null` (`response.json().catch(() => null)`), so a 204 is fine.

### What to build
1. `apps/mobile/src/lib/tools-api.ts`: add `pauseRoutine(id): Promise<Routine>`, `resumeRoutine(id): Promise<Routine>`, `deleteRoutine(id): Promise<void>` to `ToolsApi` and to `createToolsApi` (paths above, `encodeURIComponent` on the id, routine parsed with the existing parser).
2. `apps/mobile/src/mock/tools.ts`: the three functions on the mock (pause sets `status: 'paused'` and `pausedReason: 'user'`; resume of the `failures` routine sets `active`; make one mock routine answer `needs_approval` on resume so the hint can be seen).
3. `apps/mobile/src/components/ais/routines-section.tsx`: the buttons, the two-step delete, busy state and the three messages above. Put the error-to-message mapping in a pure exported function `routineActionMessage(error): { kind: 'hint' | 'error'; text: string }`.
4. Tests: `apps/mobile/src/lib/tools-api.test.ts` (the three calls: method, path, parsing; delete with a 204); `apps/mobile/src/components/ais/routines-section.test.tsx` (Pause swaps the row to paused; Resume; `needs_approval` shows the hint; 403 and 404 show `You may not change this routine.`; a network error shows the fixed sentence; Delete asks first, Cancel keeps the row, confirm removes it; buttons disabled while busy); `routineActionMessage` for each case.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx`, `apps/web/src/components/tools/RoutinesSection.tsx` (lines 125-284).

### Allowed files
`apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/lib/tools-api.test.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx`, `work/T-0212-mobile-routine-actions.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api routines-section
pnpm gate
```

### Acceptance
- The owner can pause, resume and delete routines from the AI screen with web's labels and messages; no server text is shown.
- Nothing else on the screen changes; no server, web or package change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Tool actions (run, revert, delete), the activity feed, group routines.

---

## Report (written by the worker when done)

Implemented pause/resume/delete routine actions on the phone's AI edit screen.

What I did:
- `apps/mobile/src/lib/tools-api.ts`: added `RoutineActionsApi` (`pauseRoutine`, `resumeRoutine` returning the parsed `Routine`; `deleteRoutine` accepting the empty 204) plus the combined `AiToolsApi` type. `createToolsApi` serves all five methods with `encodeURIComponent` ids. Deviation from the spec: the three mutations live in `RoutineActionsApi` instead of directly on `ToolsApi`. Reason: `ToolsApi` stubs in `apps/mobile/src/components/ais/tools-section.test.tsx` and the `useToolsApi`/`[id].tsx` wiring are outside my Allowed files; extending `ToolsApi` broke their typecheck. The read-only sections keep depending on `ToolsApi`; the routines section and both factories use `AiToolsApi`.
- `apps/mobile/src/mock/tools.ts`: stateful mock with pause (sets `paused`/`user`), resume (the `failures` routine returns to `active`; the new third routine `routine-3`, `needs_approval` with `hosts_changed`, throws 409 `needs_approval`), delete (removes; 404 when missing).
- `apps/mobile/src/components/ais/routines-section.tsx`: Pause/Resume/Delete buttons per row (wrapping row so buttons drop under the text when narrow), two-step delete (`Delete` destructive + `Cancel` ghost, `Deleting…` while running), `Pausing…`/`Resuming…` labels, every action button disabled while any action runs, and the three fixed messages under the list via the exported pure `routineActionMessage`. List transitions go through the exported `applyRoutineAction` (pause/resume swaps the server row, delete removes it, failure keeps the list with the message; success clears the previous message).
- Tests: 6 new `tools-api` cases (pause/resume method+path+parsing, invalid resume body, 409 code, delete 204, no-session 401); 15 new section cases (`routineActionMessage` per case, `applyRoutineAction` pause/resume/needs_approval/403/404/network/delete, button labels and wiring, two-step delete incl. Cancel, disabled-while-busy, hint/error lines).

Commands and real results:
- `pnpm install`: ok (11.5s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api routines-section`: 2 files, 38 tests passed.
- `pnpm prettier --write` on my 3 flagged files (gate format step had flagged them).
- `pnpm gate`: `PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Problems / deviations:
- Spec deviation above (`RoutineActionsApi` + `AiToolsApi` instead of extending `ToolsApi`; plus a documented `as AiToolsApi` cast in `RoutinesSection` because `useToolsApi` still declares `ToolsApi`). No behavior change: at runtime both factories serve all five methods.
- Mock gained a third routine (`Hosts changed digest`, `needs_approval`), so the mock list is 3 routines; updated the two `toHaveLength(2)` assertions.

Security checklist: no secrets/tokens in code or logs; fixed user-facing sentences only (server text never shown); no new routes; client-side only, deletes scoped by routine id server-side (verified in `apps/server/src/routines/routes.ts`: manager check, stranger gets 404).

## Review (written by Claude)

**Verdict:** Approved, clean pre-review (paid Muse after the free listing hit its rate limit). Pause, resume and two-step delete on each routine row, server-returned row swapped in, row removed only after a successful delete, fixed sentences only (no server text). The worker's first turn ended on the rate limit before committing; the lead switched the session in place and it committed after a GATE PASS. Emulator smoke PASS on home; the AI screen is not reachable with the test account (no AI). Follow-up: F1 widen `RoutinesSection`'s prop to `AiToolsApi` and drop the `as` cast (needs `use-tools-api.ts`). Accepted nit: F2 double tap before re-render (a ref guard like the Save button would fix it).
