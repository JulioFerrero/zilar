---
id: T-0095
title: Mobile kill switch — Stop and Resume an AI from the AI list (M4/M5, mobile)
status: todo
milestone: M4
branch: task/T-0095-mobile-kill-switch
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0080, T-0056]
estimate: 0.5 day
---

# T-0095: Stop / Resume an AI on the phone

## Spec (written by Claude, do not edit)

### Goal

The kill switch (T-0080) exists on the server and the web app (`stopAi`/`resumeAi`, the AI panel). Mobile only *shows* `stopped` in the AI row. An owner must be able to hit the brakes from the phone: in the AI list, the actions sheet gets **Stop** (when the AI is `active`) or **Resume** (when it is `stopped`), and the row shows a clear "Stopped" state. This is a safety feature, so it must be honest about failures and never look done when it is not.

### Server contract (already merged; do not change)
- `POST /api/ais/:id/stop` → 200 with the public AI (`status: 'stopped'`); already stopped → 409 `not_active`? **Read `apps/server/src/ais/routes.ts` and `service.ts` for the exact codes** (stop of an AI that is not `active`, resume of an AI that is not `stopped`, e.g. still provisioning `disabled`) and handle each: a 409 means "the AI changed under you": reload the list and show a short message.
- Both need the session bearer token like the other AI calls in `lib/ais-api.ts`.

### What to build
1. `lib/ais-api.ts`: `AisApi` gets `stopAi(id): Promise<PublicAi>` and `resumeAi(id): Promise<PublicAi>`, implemented with the same `withToken` pattern and the existing type guard for the response. Keep the parser tolerant of unknown fields (the server also sends `machineId`; do not require it).
2. `components/ais/ai-actions-sheet.tsx`: show **Stop** for `active` AIs and **Resume** for `stopped` AIs; nothing for `disabled` (provisioning). New props `onToggleRun` (or two props, your choice) and `busy`. While a request is in flight the button is disabled and shows "Stopping…" / "Resuming…". Stop is not destructive enough for a confirm dialog (it is reversible) — no confirm. Accessibility labels: `Stop AI` / `Resume AI`.
3. `app/ais/index.tsx`: wire it; on success replace that AI in the list state with the returned AI and close the sheet; on failure keep the sheet open, show the error text inline in the sheet (use `describeAisError`), and on a 409 also reload the list. Guard against double taps with a ref like `deletingRef`.
4. `components/ais/ai-row.tsx`: a `stopped` AI shows a clearly visible "Stopped" pill (today it prints the raw status string for anything not active); `disabled` keeps its current look labelled "Setting up". Make sure the row is still readable in light and dark mode, using the existing theme tokens only.
5. Tests (Vitest; mobile has no component renderer, so test the **logic**): put the decision logic in a small pure module, e.g. `components/ais/run-state.ts` (`runAction(ai) → 'stop' | 'resume' | null`, `runStateLabel(status)`), and test it; test `stopAi`/`resumeAi` in `ais-api.test.ts` with a fake fetch: correct method and URL, bearer token, parses the returned AI, maps a 409 to `AisApiError` with the server's code. Note the mobile Vitest setup cannot resolve the `@/` alias for component modules: keep testable logic in modules that import with relative paths only.

### Read first
- `AGENTS.md` (mandatory), `apps/mobile/AGENTS.md` or README if present
- `apps/mobile/src/lib/ais-api.ts`, `ais-api.test.ts`, `components/ais/ai-actions-sheet.tsx`, `ai-row.tsx`, `errors.ts`, `use-ais-api.ts`, `app/ais/index.tsx`, `delete-confirm.tsx` (how busy and errors are shown)
- `apps/web/src/components/ais/AiPanel.tsx` (how web words Stop/Resume and handles `not_active`) and `apps/server/src/ais/routes.ts`
- `docs/LEAD_PLAYBOOK.md` gotchas on mobile (no `@/` in tested modules, no zod in mobile)

### Allowed files
- `apps/mobile/src/lib/ais-api.ts`, `ais-api.test.ts`
- `apps/mobile/src/components/ais/` (sheet, row, a new `run-state.ts` and its test)
- `apps/mobile/src/app/ais/index.tsx`
- `work/T-0095-mobile-kill-switch.md`

**Not allowed:** server, web, packages, new dependencies, anything native (`ios/`, `app.json`), other mobile screens.

### Live check
Lead runs the mobile tests and typecheck; a simulator run is only done if the iOS build is already available (do not use simulators DB167CD4 or A3E0C081). Otherwise say so in the Report.

### Acceptance criteria
- [ ] Stop and Resume are reachable from the AI list; a `disabled` AI offers neither.
- [ ] A failed request never changes the list; a 409 reloads it.
- [ ] Double taps cannot send two requests.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test
```

### Out of scope
- Stopping from a chat screen, room-level stop, push notifications.

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
