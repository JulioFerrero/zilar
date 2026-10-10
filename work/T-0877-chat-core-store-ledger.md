---
id: T-0877
title: "chat-core gets the store message-ledger helpers both stores copy: forwarding payloads, reaction/mention equality, edits, user localpart"
status: merged
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
`packages/chat-core/src/**`, `apps/web/src/store/**`, `apps/mobile/src/store/**`, `apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/ais/ais.test.ts`, `apps/mobile/src/components/ais/errors.ts`, `apps/mobile/src/components/ais/form.ts`, `apps/mobile/src/components/ais/limits.ts`, `apps/mobile/src/components/ais/models.ts`, `apps/mobile/src/components/ais/templates.ts`, `apps/mobile/src/components/settings/profile-logic.ts`, `apps/mobile/src/components/stickers/sticker-native.ts`, `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/lib/chat-prefs.test.ts`, `apps/mobile/src/lib/chat-prefs.ts`, `apps/mobile/src/lib/chat.ts`, `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/gifs.ts`, `apps/mobile/src/lib/routines-format.test.ts`, `apps/mobile/src/lib/routines-format.ts`, `apps/mobile/src/lib/use-smooth-text.ts`, `apps/server/src/handles/rules.ts`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/components/ais/aiForm.ts`, `apps/web/src/components/ais/errors.ts`, `apps/web/src/components/ais/limits.ts`, `apps/web/src/components/ais/models.ts`, `apps/web/src/components/ais/templates.ts`, `apps/web/src/lib/attachments.ts`, `apps/web/src/lib/chatPrefs.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/handles.ts`, `apps/web/src/lib/routines.ts`, `apps/web/src/lib/sticker-images.ts`, `apps/web/src/lib/useSmoothText.ts`, `packages/protocol/src/handles.test.ts`, `packages/protocol/src/handles.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/jid.test.ts`, `packages/protocol/src/jid.ts`, `packages/xmpp-core/src/jid.ts` (lead: carried by the merge of T-0876, which contains T-0874 and T-0875), `work/T-0877-chat-core-store-ledger.md`.

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

- Added `packages/chat-core/src/store/ledger.ts` (exported from the chat-core index): `forwardedPayloadFor`, `forwardedUiFieldsFor`, `mentionsEqual`, `reactionsEqual`, `reactionChips` (explicit `{ aliasRoot, myJid, reactorName }` lookups), `userLocalpartOf(mine, fromJid)`. Unit tests in `ledger.test.ts` (8 new).
- Web (`realStore.ts`, `effects/send.ts`) and mobile (`real-store.ts`) import them. `reactionChips` and `userLocalpartOf` stay as 3-line local wrappers that pass the closures, so call sites are unchanged.
- Lines removed from the apps: 219 deleted, 18 added (net -201); chat-core gained about 130 source and 90 test lines.
- Tests, 3 of 3 runs, all green: chat-core 182 (174 before, +8); web `src/store` 222 in 17 files; mobile `src/store` 315 passed, 1 skipped (unchanged). Web and mobile typecheck, chat-core typecheck, oxlint and prettier clean. Load average was 120-225 during runs.
- Behaviour differences: none.
- Spec facts that were wrong or left alone: `finishedTurnOrder` is a plain array (web `ctx.finishedTurnOrder`), not a function, so nothing to move. Not moved: `mapMentions` (web takes chatId and falls back to a member name, mobile does not), `ingestEdit`, `editUpdateFor`, `applyReactionUpdate`, `applyEditUpdate`, `coreKind`, `authorOfChatMessage` (they close over each store's own state, and web keeps the `baseTextFor` map that mobile lacks). Line numbers in the spec had moved.
- Did not run `pnpm gate` (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Six store helpers moved to `chat-core/store/ledger.ts`, with 8 new tests, for a net −201 lines in the apps. The state-dependent helpers stay in each store, as reported. The combined wave 4 check passes. Live check for Julio: forwarding, reactions and edits.
