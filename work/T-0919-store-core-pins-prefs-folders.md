---
id: T-0919
title: "Store core phase 2: pins, chat prefs and folders in packages/client-core, both stores on them (one set of pin error texts, Q4)"
status: merged
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
`packages/client-core/src/store/pins.ts`, `packages/client-core/src/store/prefs.ts`, `packages/client-core/src/store/folders.ts`, `packages/client-core/src/store/pins.test.ts`, `packages/client-core/src/store/prefs.test.ts`, `packages/client-core/src/store/folders.test.ts` (lead: full paths), `packages/client-core/src/store/index.ts` (a new Phase 2 section only), `apps/web/src/store/effects/pins.ts`, `apps/web/src/store/effects/prefs.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts` (only the wiring of these three), `apps/web/src/store/realStore.pins-prefs.test.tsx`, `apps/mobile/src/store/effects/pins.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/store/real-store.pins-prefs.test.ts`, `apps/mobile/src/store/effects/pins.test.ts` (lead: one expected text, the decided Q4 unpin error), `apps/mobile/src/store/real-store.ts` (wiring, disclosed), `work/T-0919-store-core-pins-prefs-folders.md`.

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

**Commits (in order)**
1. `ca04d099` tests first, on the old code: web `realStore.pins-prefs.test.tsx` (6 tests) and mobile `real-store.pins-prefs.test.ts` (6 tests). Both passed on the old code.
2. `62782e7a` the new expectations (all failed on the old code): on web the R11 case (a saved pref row that lands mid-flight survives a failed write), on mobile the R13 texts (`Could not unpin the message. Try again.`) plus a pin-error case.
3. the move (this commit).

**What I did**
- **Core** (`packages/client-core/src/store/`): new `pins.ts`, `prefs.ts`, `folders.ts` with tests, and a new "Phase 2" section in `index.ts`. Each holds the shared behaviour and takes the existing core context (and `ports.now`) plus a small per-store adapter for the state slice that differs between the apps (pins/their errors, the saved pref rows, the folder writer). No core port was added; no `ports.ts`/`ctx.ts` change.
  - `pins.ts`: `loadPins`, `pinMessage`, `unpinMessage` (optimistic paint, rollback, loud/silent load), one snapshot builder (`pinKindFor`/`pinTextFor`/`pinSnapshotFor`) and the texts `PIN_ERROR`, `UNPIN_ERROR`, `PINS_LOAD_ERROR`.
  - `prefs.ts`: `updatePref` and `withPrefRow`; on failure it re-paints the saved rows (R11).
  - `folders.ts`: `foldersAfterSet`/`setFolders` (sort by position, reset the active id to `all`).
- **Web**: `effects/pins.ts` and `effects/prefs.ts` are thin bindings over the core; `realStore.ts` `setFolders` calls the core (the `sortFolders` import is gone). Web keeps pins in `pinsByChat` (R12) and `chatPrefs` is now the saved truth, painted optimistically into `chats`.
- **Mobile**: `effects/pins.ts` and `effects/events.ts` are bindings over the core; the pins map/revision and `s.chatPrefRows` stay the mobile state the core reads through the adapter.

**Behaviour**
- **R11 (web):** a failed pref write now re-merges the saved rows instead of restoring the pre-write snapshot; anything that landed mid-flight survives. Mobile was already R11. No visible change.
- **R12:** web already reads pins from state; the core keeps that shape. Mobile still keeps pins in a closure + revision (`types.ts` / `ChatStoreState` is not an Allowed file), so its internals are unchanged. No visible change.
- **R13:** both apps use web's texts, `Could not pin the message. Try again.` and `Could not unpin the message. Try again.`; mobile now sets the pin error too. No other behaviour changes.

**Lines per side** (`git diff --numstat main`, source unless noted)
- Core source: `pins.ts` +202, `prefs.ts` +69, `folders.ts` +41, `index.ts` +7 = **+319**. Core tests: +363 new.
- Web source: `effects/pins.ts` +27/-78, `effects/prefs.ts` +65/-89, `realStore.ts` +5/-10 = **+97/-177 (net -80)**. Web tests: +217 new.
- Mobile source: `effects/events.ts` +31/-58, `effects/pins.ts` +29/-105, `real-store.ts` +2/-1 = **+62/-164 (net -102)**. Mobile tests: +253 new; one existing assertion changed (`effects/pins.test.ts`, +1/-1).

**Checks (real results)**
- `pnpm gate` (repo root), final run: `17 changed file(s) against main`; `PASS install (frozen) 3.1s`, `PASS format 2.4s`, `PASS lint 1.0s`, `PASS typecheck 5.3s`, `PASS effect 2.8s`, `PASS tests @zilar/client-core 10.9s`, `PASS tests @zilar/mobile 19.2s`, `PASS tests @zilar/web 10.4s`; ends `GATE PASS`.
- Store suites, 3 runs each (task Checks): client-core `15 files, 147 passed` ×3; web `src/store` `22 files, 247 passed` ×3; mobile `src/store` `34 passed | 1 skipped, 330 passed | 1 skipped` ×3.
- Single-file tests while working: core `pins/prefs/folders.test.ts` (15 passed), `apps/web/.../realStore.pins-prefs.test.tsx` (6 passed), `apps/mobile/.../real-store.pins-prefs.test.ts` + `effects/pins.test.ts` + `effects/events.test.ts` (13 passed), plus the existing mobile prefs-pins/folders/mock suites (32 passed) and the existing web `realStore.test.tsx` (134 passed).

**Deviations / things to flag**
- **The gate's scope list has 4 files** even though it says `GATE PASS`:
  - `packages/client-core/src/store/{pins,prefs,folders}.test.ts`: the task allows "their `*.test.ts`", but the gate's token `*.test.ts` only matches a single folder, so it cannot match these paths. They are in scope by the spec.
  - `apps/mobile/src/store/effects/pins.test.ts`: R13 changes mobile's unpin text, and this existing test asserted the old text (`Could not unpin. Try again.`). One assertion was updated. The file is not in the Allowed list; leaving it would make the Checks red, so I updated it as the direct consequence of R13. This is the one place the spec ("No existing test is edited") and R13 conflict; the lead should decide if the file should move to the Allowed list.
- **`apps/mobile/src/store/real-store.ts` (2 lines, the "smallest hunk" the note allows):** I added `type CorePorts` and cast the `coreCtx.ports` object. `pnpm --filter @zilar/mobile typecheck` was already red at the base: after T-0915 `CoreCtx.ports` is the full `CorePorts`, and the phone's `coreCtx` supplies only `now`/`isVisible`/`storage`. T-0918 (mobile ports/runtime) should own the real fix and remove the cast. I touched it only because this task's Checks run the mobile typecheck.
- **R12 for mobile** is the one spec point I could not fully apply: moving mobile's pins into `ChatStoreState` needs `apps/mobile/src/store/types.ts`, which is not an Allowed file. I kept the closure + revision and made the core state-agnostic, so web keeps state (R12's winner) and nothing is visible on either side. Please confirm that is the intended reading.
- Snapshot unification: for an image sent as an attachment the core uses web's precedence (`image`, not mobile's `file`); no test pins the old mobile value. `deleted` messages read `Message deleted` (mobile's rule) on both.

**Live check for Julio (web and mobile):** pin and unpin, mute and unmute a chat, and folders.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 follow-ups.**
- **The move:** pins, prefs and folders are in `packages/client-core/src/store/` with core tests, and both stores bind to them.
- **Tests first:** guards, then the new expectations, then the move.
- **Behaviour:**
  - R11: a failed pref write on web keeps what landed meanwhile;
  - R12: no visible change;
  - R13: one set of pin error texts, as decided for Q4.
- **Follow-up 1:** the one-line text change in `apps/mobile/src/store/effects/pins.test.ts` is the decided Q4 unpin text, allowed as a lead amendment.
- **Follow-up 2:** the `as unknown as CorePorts` cast in mobile `real-store.ts` goes to T-0918, which supplies the full ports.
- **Check:** the combined check passes.
- **Live check for Julio:** pin and unpin, mute and unmute a chat, and folders, on web and mobile.
