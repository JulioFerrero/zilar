---
id: T-0916
title: "Core echo re-applies pending edits and reactions: an edit made between the ack and the echo keeps its new text (web bug on main), and the mobile wrapper goes"
status: todo
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

## Review (written by Claude)
