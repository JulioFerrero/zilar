---
id: T-0906
title: "Store core T5: the mobile store on the core ledger, tests first, with the group echo race fix (linkAckToServer) and received @mentions (Q1)"
status: todo
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

## Review (written by Claude)
