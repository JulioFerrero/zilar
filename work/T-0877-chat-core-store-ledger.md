---
id: T-0877
title: "chat-core gets the store message-ledger helpers both stores copy: forwarding payloads, reaction/mention equality, edits, user localpart"
status: todo
milestone: M5
branch: task/T-0877-chat-core-store-ledger
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0877: chat-core gets the store message-ledger helpers both stores copy: forwarding payloads, reaction/mention equality, edits, user localpart

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding I-F6 / A-F6 (the verbatim part) in `docs/audit/simplify-2026-10-09/`.
- **Verbatim copies:** `forwardedPayloadFor` and `forwardedUiFieldsFor` are identical in `apps/web/src/store/effects/send.ts:340-363` and `apps/mobile/src/store/real-store.ts:1249-1272`.
- **Near copies:** `mapMentions` (web `realStore.ts:1211`, mobile `real-store.ts:522`), `ingestEdit` (web `:508`, mobile `:587`) and `userLocalpartOf` (web `:990`, mobile `:1288`).
- **Shared names:** `reactionChips`, `reactionsEqual`, `mentionsEqual`, `finishedTurnOrder`, `coreKind`, `authorOfChatMessage`, `editUpdateFor`, `applyReactionUpdate` and `applyEditUpdate`. In all, 64 store functions (about 760 lines per side) are verbatim copies.
- **Drift:** web restores the first-seen text on a reverted edit (`baseTextFor`); mobile has no base-text map.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Start with the byte-identical functions: forwarding, reaction and mention equality, `reactionChips` and `finishedTurnOrder`. Move them into `packages/chat-core/src/store/` (pure, with explicit arguments instead of closures over `get()`/`myJid()`), with unit tests, and make both stores import them.
2. Then take the near copies only where the difference is trivial. Where behaviour differs (the edit base-text map, for example), keep each store's behaviour and list it.
3. Both stores' test suites (about 16k lines) must pass unchanged. Count the lines removed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/chat-core/src/**`, `apps/web/src/store/**`, `apps/mobile/src/store/**`, `work/T-0877-chat-core-store-ledger.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: Julio checks forwarding, reactions and edits on web and the phone.

---

## Report (written by the worker when done)

## Review (written by Claude)
