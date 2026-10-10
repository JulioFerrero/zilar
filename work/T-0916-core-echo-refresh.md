---
id: T-0916
title: "Core echo re-applies pending edits and reactions: an edit made between the ack and the echo keeps its new text (web bug on main), and the mobile wrapper goes"
status: merged
milestone: M5
branch: task/T-0916-core-echo-refresh
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0916: Core echo re-applies pending edits and reactions

## Spec (written by Claude, do not edit)

### Why
T-0914 found a bug that is on main, on web. If you edit (or react to) your own message after the send was acknowledged but before the server echo arrives, the echo shows the old text again.
- **The cause:** the outgoing echo path in `packages/client-core/src/store/incoming.ts` (238 lines) merges the optimistic id into the server id, but does not re-run `resolvePendingEdits`, `refreshEdits` and `refreshReactions` for that chat. The incoming path does re-run the first two, at `:150-151`.
- **Mobile's workaround:** mobile wraps the core handler in `apps/mobile/src/store/real-store.ts:548-557` (`handleMessage`). After an outgoing echo that is neither an edit nor a reaction, it runs `resolvePendingEdits`, `refreshEdits` and `refreshReactions`. Web has no such wrapper.

### What to build
1. **Tests first,** committed before the fix:
   - a new web test file `apps/web/src/store/realStore.echo-edit.test.tsx`: send, ack, edit, then echo, and the bubble keeps the edited text; the same for a reaction made between the ack and the echo;
   - a core case in `packages/client-core/src/store/incoming.test.ts`.

   Both fail on the old code.
2. **The fix:** in the core outgoing-echo path, after the id merge, call `k.resolvePendingEdits(chatId)`, `k.refreshEdits(chatId)` and `k.refreshReactions(chatId)`. Skip edit and reaction stanzas, as mobile's wrapper does.
3. **Mobile:** delete the wrapper in `apps/mobile/src/store/real-store.ts:548-557`, so mobile calls the core handler directly. Mobile's existing test for this case (in `apps/mobile/src/store/real-store.incoming.test.ts`, from T-0914) must still pass, unedited.
4. **Unchanged:** nothing else changes.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), the Report of `work/T-0914-store-core-t7a-mobile-incoming.md`, `packages/client-core/src/store/incoming.ts` with its test, and `apps/mobile/src/store/real-store.ts:540-560`.

### Allowed files
`packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/incoming.test.ts`, `apps/web/src/store/realStore.echo-edit.test.tsx`, `apps/mobile/src/store/real-store.ts` (only the wrapper at `:548-557`), `work/T-0916-core-echo-refresh.md`.

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

### Acceptance
- The Checks pass.
- The new tests fail before the fix and pass after.
- No existing test is edited.
- Live check for Julio: on web, edit a message right after sending it; the new text stays.

---

## Report (written by the worker when done)

**Commits:** `e3e8e0e3` tests first (new test files, run on the old code); the fix + the mobile wrapper removal (this commit).

**What I did**
- Tests first (committed before the fix):
  - `apps/web/src/store/realStore.echo-edit.test.tsx`: send, ack, edit, then echo keeps the edited text; send, ack, react, then group echo keeps the reaction.
  - `packages/client-core/src/store/incoming.test.ts`: two cases in "the outgoing echo re-applies edits and reactions (core)" (edit, group reaction), over the real ledger through an `ackedLocal` helper.
- `packages/client-core/src/store/incoming.ts`: `handleOutgoingEcho` now calls `k.resolvePendingEdits(chatId)`, `k.refreshEdits(chatId)` and `k.refreshReactions(chatId)` after the reconcile. A correction or a reaction-only stanza returns before `handleOutgoingEcho` (the two guards at the top of `handleMessage`), so this skips them exactly as mobile's wrapper did.
- `apps/mobile/src/store/real-store.ts`: deleted the `handleMessage` wrapper; `h.handleMessage` now calls the core handler directly (`handleMessage: (message) => handleCoreMessage(coreCtx, message)`).

**Files changed:** `incoming.ts` +7; `real-store.ts` +1/-14; `incoming.test.ts` (new cases, +46); `realStore.echo-edit.test.tsx` (new file). No existing test edited.

**Commands and real results**
- On the old code, the new files:
  - `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts`: 1 failed | 13 passed (14). The failure is "keeps an edit made after the ack when the echo arrives": received `[['srv-1','hello',undefined]]`, expected `[['srv-1','hello there',true]]`.
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.echo-edit.test.tsx`: 1 failed | 1 passed (2), the edit case (received `hello`, expected `hello there`).
- After the fix:
  - core `incoming.test.ts`: 14 passed (14).
  - web `realStore.echo-edit.test.tsx`: 2 passed (2).
  - mobile `real-store.incoming.test.ts` (unedited): 8 passed (8).
- `pnpm gate` from the repo root:
```
gate: 5 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/client-core
PASS  tests @zilar/mobile
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
GATE PASS
```

**Problems / deviations**
- The mobile edit is not literally confined to `:548-557`. Deleting the wrapper also required, inside the same file, (a) pointing `h.handleMessage` at the core handler and (b) dropping the now-unused `refreshReactions` from the ledger destructure (only the wrapper used it). Without these the file would not lint/typecheck.
- **The edit is the real regression; the reaction case was already correct on main.** The outgoing echo's `toUiMessage` re-attaches reaction chips alias-aware (`ledger.ts:1089`), while it does not apply edits, so a reaction made between the ack and the echo already survived. My reaction tests therefore pass before *and* after the fix. I kept them because the spec asks for the reaction case, and added `refreshReactions` for parity with mobile. Tell me if you want only fail-first tests and I will drop the reaction cases.
- Everything else is unchanged.

**Live check for Julio:** on web, send a message and edit it right after; the new text should stay.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 3 nits.**
- **The fix:** the core outgoing echo re-runs `resolvePendingEdits`, `refreshEdits` and `refreshReactions`, so on web an edit made between the ack and the echo keeps its new text. The fix was tests first: the edit case failed on the old code.
- **Mobile:** its wrapper is gone, and its T-0914 test passes unedited.
- **The reaction tests passed before the fix too,** because the echo already re-attaches reactions. My spec's premise was wrong, and keeping them is harmless.
- **Follow-up nit:** the comment at `packages/client-core/src/store/incoming.ts:88-91` says "the three the incoming path does", but that path runs two. Fix it in the next task that touches the file.
- **Check:** the combined check passes.
- **Live check for Julio:** on web, edit a message right after sending it.
