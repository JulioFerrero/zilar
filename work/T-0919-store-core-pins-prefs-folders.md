---
id: T-0919
title: "Store core phase 2: pins, chat prefs and folders in packages/client-core, both stores on them (one set of pin error texts, Q4)"
status: todo
milestone: M5
branch: task/T-0919-store-core-pins-prefs-folders
model: auto
effort: default
depends_on: [T-0915]
estimate: 1 day
---

# T-0919: Store core phase 2, pins, prefs and folders

## Spec (written by Claude, do not edit)

### Why
This is the first item of phase 2 in `docs/STORE_CORE_PLAN.md` (section 9). The behaviour rows are in section 2.3:
- **R11:** on a failed pref write, mobile re-merges the saved rows and keeps what landed meanwhile; web restores the pre-write snapshot. The plan picks mobile.
- **R12:** web keeps pins in an atom and mobile keeps them in a closure plus a revision. The plan picks web: selectors read state.
- **R13:** the pin and unpin errors. Web shows "Could not pin the message. Try again." and "Could not unpin the message. Try again." (`apps/web/src/store/effects/pins.ts:115,149`). Mobile shows only an unpin error, "Could not unpin. Try again." (`apps/mobile/src/store/effects/pins.ts:219`). Q4 is decided yes, so both apps use web's texts.

The files:
- web `apps/web/src/store/effects/pins.ts` (169 lines) and `effects/prefs.ts` (225);
- mobile `apps/mobile/src/store/effects/pins.ts` (246) and `effects/events.ts` (194; prefs and folders);
- the shared folder sorting `sortFolders` already in `@zilar/chat-core`.

### What to build
1. **Tests first,** committed on the old code:
   - web: a new `apps/web/src/store/realStore.pins-prefs.test.tsx`;
   - mobile: a new `apps/mobile/src/store/real-store.pins-prefs.test.ts`.

   They cover pin, unpin, a pin list refresh, a pref write that succeeds, a pref write that fails, and a folder set. Then one commit with the new expectations: R11 on web, and R13's texts on mobile, including a pin error.
2. **Core:** new `packages/client-core/src/store/pins.ts`, `prefs.ts` and `folders.ts` with tests, plus their lines in a new "Phase 2" section of `index.ts`. Use the existing core ctx and ports.
3. **Both stores** bind to them. Keep the facades and the existing tests unedited.
4. **Behaviour:** R11, R12 (no visible change) and R13. Nothing else changes.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2.3, 4, 8 and 9, `packages/client-core/src/store/*`, and the four store files above with their tests.

### Allowed files
`packages/client-core/src/store/pins.ts`, `packages/client-core/src/store/prefs.ts`, `packages/client-core/src/store/folders.ts`, their `*.test.ts`, `packages/client-core/src/store/index.ts` (a new Phase 2 section only), `apps/web/src/store/effects/pins.ts`, `apps/web/src/store/effects/prefs.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts` (only the wiring of these three), `apps/web/src/store/realStore.pins-prefs.test.tsx`, `apps/mobile/src/store/effects/pins.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/store/real-store.pins-prefs.test.ts`, `work/T-0919-store-core-pins-prefs-folders.md`.

T-0918 changes the mobile polling, lifecycle, ports, runtime and `real-store.ts` in parallel. If you must touch `apps/mobile/src/store/real-store.ts` or `runtime.ts` for wiring, keep it to the smallest hunk and say so in the Report.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the store tests 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and lists R11 and R13.
- Live check for Julio: pin and unpin, mute and unmute a chat, and folders, on web and mobile.

---

## Report (written by the worker when done)

## Review (written by Claude)
