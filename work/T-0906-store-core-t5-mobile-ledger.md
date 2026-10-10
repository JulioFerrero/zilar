---
id: T-0906
title: "Store core T5: the mobile store on the core ledger, tests first, with the group echo race fix (linkAckToServer) and received @mentions (Q1)"
status: merged
milestone: M5
branch: task/T-0906-store-core-t5-mobile-ledger
model: auto
effort: default
depends_on: [T-0904]
estimate: 1 day
---

# T-0906: Store core T5, mobile on the core ledger

## Spec (written by Claude, do not edit)

### Why
This is task T5 of `docs/STORE_CORE_PLAN.md` (section 6, "T5: mobile on the core ledger, tests first (mobile)"). Follow it, with two changes since the plan was written.
- **Line numbers moved.** The lead located each function by name on main on 2026-10-10 (`apps/mobile/src/store/real-store.ts`, 1,805 lines):
  - the ledger, from `aliasRoot` (`:354`) and `linkLocalToServer` (`:384`) up to the shared mutators;
  - `updateMessageStatus` `:887`;
  - `markStickerFailed` `:918`;
  - `markAttachmentFailed` `:931`;
  - `updateMessageAttachment` `:955`;
  - `updateMessageVoice` `:1039`;
  - `forwardOriginFor` `:1101`;
  - `senderNameFor` `:1163`;
  - `toUiMessage` `:1280`.

  Use the names, and check the lines yourself.
- **The group echo race.** T-0904 found it and fixed it on web: when the room's echo arrives before `sendMessage` resolves, the ack overwrote the room's stanza id. The core ledger now has `linkAckToServer(chat, localId, serverId)`. Mobile has the same race:
  - the echo stores its id at `real-store.ts:1434-1435`;
  - the acks overwrite it at `apps/mobile/src/store/effects/send.ts:71-76` (`acknowledge`, used by text, sticker and forward), `:166-167` (attachment) and `:250-251` (voice).

### What to build
1. **Tests first, on the old code**, in a new file `apps/mobile/src/store/real-store.ledger.test.ts`. Commit 1 holds what must not change:
   - alias linking through the echo;
   - a pending edit resolved when the target loads;
   - a retraction stripping `localUri`.
2. **Commit 2:** the new expectations, failing on the old code:
   - R1-R4 from the plan (Q1 is decided yes: received @mentions are highlighted on mobile, see plan section 8);
   - a group send whose echo arrives before `sendMessage` resolves, then a reaction that names the stanza id;
   - a DM case that keeps today's behaviour.
3. **The move:** `real-store.ts` replaces its ledger, the shared mutators, the sender names and `toUiMessage` with the core ledger, as plan T5 lists. It keeps the mobile-only upload mutators, `forwardOriginFor` (until T10) and the group-id and member helpers. The ack sites in `effects/send.ts` call `linkAckToServer`.
4. **Facades:** `createRealChatStore` and its exports stay. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0906/`; use `@/test/wait` helpers, never raw `setTimeout(resolve, 0)`), `docs/STORE_CORE_PLAN.md` sections 2.3, 6 and 8, `packages/client-core/src/store/ledger.ts` with its test, the Report of `work/T-0904-store-core-t3-ledger.md`, and `apps/mobile/src/store/real-store.ts`.

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/real-store.ledger.test.ts`, `packages/client-core/src/store/ledger.ts` (only if mobile needs a small, tested extension; say why), `packages/client-core/src/store/ledger.test.ts`, `work/T-0906-store-core-t5-mobile-ledger.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/client-core typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
ZILAR_SMOKE_DIR=<scratchpad>/T-0906/smoke ZILAR_ROUTES="/ /settings" pnpm phone:smoke task/T-0906-store-core-t5-mobile-ledger
```
Run the mobile `src/store` tests 3 times. The guards are listed in plan T5.

### Acceptance
- The Checks pass, 3 runs, and the phone smoke is clean.
- The two test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and every behaviour difference.
- Live check for Julio: on the phone, received @mentions are highlighted, and reactions, edits, forwards, voice and attachments work in groups and DMs.

---

## Report (written by the worker when done)

**Commits:** `cdb45b38` tests first, old code, 3 pass (echo alias, pending edit, retraction strips `localUri`); `a5f2fd42` tests first, new expectations, 3 failed on old code (R1 mentions, R2 corrected mention name, group echo race) plus 1 DM case passing; `18e9e5e1` the move.

**Lines per side:** mobile `real-store.ts` 1805 -> 957 (+76 / -924). core `ledger.ts` +12 / -1, `ledger.test.ts` +19. New `real-store.ledger.test.ts` 7 tests.

**What moved:** aliases, server/origin ids, authors, base texts, edits, reactions, mentions, sender and reactor names, `toUiMessage`, status, attachment, voice, sticker and attachment-failed mutators, restore helpers: now `createMessageLedger` in `real-store.ts`. Kept: upload mutators, `markVoiceFailed`, `clearAttachmentFailure`, `forwardOriginFor`, group id and member helpers.

**Core ledger changes (allowed, small):** `reset()` (mobile `stop()` cleared the maps; tested in `ledger.test.ts`), `refreshReactions` exported (the echo path calls it), `LedgerState.me` made optional (mobile's state has it optional).

**Behaviour differences:** R1 and R2 (received mentions highlighted, member names); R3 (reverted edit restores first-seen text) and R4 (id link moves origin/author/base-text maps); `updateMessageVoice` now replaces the voice meta and no longer clears the failure flag (a retry clears it first); group acks keep the room stanza id when the echo came first (the race fix); DMs unchanged.

**Differences from the plan:**
- `effects/send.ts` is NOT changed and `effects/runtime.ts` (not Allowed) holds the `StoreHelpers` type with `linkLocalToServer(localId, serverId)`. So `real-store.ts` passes `linkAck` as `h.linkLocalToServer`: it finds the chat that holds the message and calls `linkAckToServer(chat, ...)`. A cleaner follow-up: one line in `runtime.ts` plus the 3 sites in `send.ts` passing the chat.
- The ledger restores base text when no edit state exists, so a local bubble without a base text would lose its text. `setChatMessage` in `real-store.ts` now also records the base text (web's send does the same).
- R3 and R4 have no store-level observable case on mobile (every path re-writes the maps in the same call); they are covered by the core ledger tests, not by a mobile test.

**Checks:** mobile `src/store` 3 runs: 315 passed, 1 skipped (pre-existing) each; client-core 77 passed; web `src/store` 219 passed; mobile and client-core typecheck clean; prettier and oxlint clean on changed files. Phone smoke on emulator: PASS `/` and `/settings`, both screenshots viewed, normal.

Not run: `pnpm gate` (wave mode), no live check of mentions on a device.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **The move:** mobile is on the core ledger, and `real-store.ts` went from 1,805 to 957 lines.
- **Tests first:** what must not change, then the new expectations, then the move.
- **Behaviour:**
  - Q1: received @mentions are highlighted under the member name;
  - R3 and R4;
  - the group echo race is fixed on mobile, and DMs are unchanged.
- **`linkAck`:** the helper is passed from `real-store.ts` so that `runtime.ts` stays untouched. That is fine for now. T7 shrinks `StoreHelpers` and can switch the 3 ack sites in `effects/send.ts` to `linkAckToServer` directly.
- **Tests:** existing tests are unedited, the mobile store tests pass 3 runs, and the phone smoke is clean.
- **Check:** the combined check passes.
- **Live check for Julio:** on the phone, received @mentions are highlighted, and reactions in groups name the right message.
