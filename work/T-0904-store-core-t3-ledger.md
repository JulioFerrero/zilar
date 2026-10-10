---
id: T-0904
title: "Store core T3: the message ledger (ids, aliases, edits, reactions, mentions) in packages/client-core, the web store on it"
status: merged
milestone: M5
branch: task/T-0904-store-core-t3-ledger
model: auto
effort: default
depends_on: [T-0902]
estimate: 1 day
---

# T-0904: Store core T3, the message ledger

## Spec (written by Claude, do not edit)

### Why
This is task T3 of `docs/STORE_CORE_PLAN.md` (section 6, "T3: the message ledger in core (core + web)"). Follow it exactly. It is the largest move of the split, and its risk is medium: the ledger reads back its own writes (`refreshEdits`, `migrateReactionTargets`).

The lead re-checked the cited lines on 2026-10-10:
- the ledger block in `apps/web/src/store/realStore.ts` runs from `:182` (`messageAliases`) to about `:1203`;
- `apps/web/src/store/effects/ctx.ts` has 140 lines;
- `MobileMessage` is at `apps/mobile/src/lib/types.ts:35-38`.

This branch starts from `task/T-0902-store-core-t1-rows`. T-0903 (T2) runs in parallel and edits `apps/web/src/store/effects/runtime.ts` and its own section of the core index.

### What to build
1. **Core:**
   - new `packages/client-core/src/store/ledger.ts` with `createMessageLedger({ get, set, contacts, memberName, occupantNick, mediaToken })`, over the `LedgerState` and `StoreMessage` types the plan defines;
   - new `packages/client-core/src/store/ledger.test.ts`;
   - one line in the T3 section of `packages/client-core/src/store/index.ts`.
   - `packages/chat-core/src/store/ledger.ts` (T-0877) stays where it is; the core ledger uses it.
2. **Web:** `apps/web/src/store/realStore.ts` replaces the ledger block with the core ledger. In `apps/web/src/store/effects/ctx.ts`, `Kernel` becomes the ledger type plus the few helpers left. The facades and every export of `realStore.ts` stay.
3. **Behaviour:** only R5 (mobile's `linkLocalToServer`) lands, with a new core test. Nothing else changes on web.
4. **Tests first** for any ledger path the plan marks as uncovered. Section 7 lists:
   - an echo before the send resolves;
   - two identical texts in a row;
   - the echo of a reply.

   Add them as new core tests on the ledger, and commit them before the move, run against the web code through the facade.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0904/`), `docs/STORE_CORE_PLAN.md` sections 2, 4, 6 and 7, `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/ctx.ts`, and `packages/chat-core/src/store/ledger.ts`.

### Allowed files
`packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/ledger.test.ts`, `packages/client-core/src/store/*.test.ts` (new test files only), `packages/client-core/src/store/index.ts` (T3 section only), `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/*.ts` (only the import of moved helpers), `apps/web/src/store/realStore.ledger.test.tsx` and `apps/web/src/store/effects/send.ts` (lead, round 1: real-store tests and the group echo race fix), `work/T-0904-store-core-t3-ledger.md`.

T-0902's files are carried by the base branch: `packages/client-core/package.json`, `packages/client-core/src/store/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/constants.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/polling.ts`, `work/T-0900-deps-catalog.md` and `work/T-0902-store-core-t1-rows.md`.

Do not touch `apps/web/src/store/effects/runtime.ts`: T-0903 changes it.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run `src/store/realStore.test.tsx`, `realStore.forward.test.tsx` and `realStore.topics.test.tsx` 3 times.

### Acceptance
- The Checks pass, and no existing test is edited.
- The tests-first commits come before the move.
- The Report gives the lines per side and lists every behaviour difference (R5 only).
- Live check for Julio: edits, reactions, mentions, forwards and send failures on web.

---

## Report (written by the worker when done)

**Commits, in order**
1. `4307b639` core `ledger.ts` copied from `realStore.ts:182-1203` (web not switched yet) + the T3 index line.
2. `a4317a52` tests first: `ledger.test.ts` with the three uncovered paths (echo before `sendMessage` resolves, two identical texts in a row, echo of a reply), passing on the copied code.
3. `6f57aa46` the move: `realStore.ts` and `ctx.ts` on the core ledger. No test edited.
4. `b129a762` R5 with its core test (the test failed before the code change: `expected undefined to be 'server-1'`).

**Lines per side** (`git diff --numstat` from the branch base `50013b3c`)
- core: `ledger.ts` +1172, `ledger.test.ts` +321, `index.ts` +1.
- web: `realStore.ts` +26 / -1097 (1550 -> 479 lines), `effects/ctx.ts` +9 / -67.

**What moved**: everything from `messageAliases` to `listFor`: aliases, server and origin ids, authors, base texts, edits, reactions, mentions, `withEdits`, previews, reply quotes, sender and reactor names, `toUiMessage`, `sanitizeIncomingVoice`, and every message mutator. `createMessageLedger({ get, set, memberName, occupantNick, mediaToken })` over `LedgerState`; messages are `StoreMessage` (UiMessage + `localUri`, `uploadProgress`), and a retraction strips those two fields. Web keeps `rememberGroupIds`, `nick` and a `removeFailedMessage` wrapper that drops the kept attachment bytes, then calls the ledger (same order as before). `Kernel` is now `MessageLedger` plus `rememberGroupIds` and `nick`. `ctx.messageAuthors`, `messageOriginIds` and `messageBaseTexts` are the ledger's maps, so sign-out still clears them (`lifecycle.ts` not touched).

**Behaviour differences**
- R5 only: `linkLocalToServer` also files the server id under the alias root (mobile `real-store.ts:384-391`). On web it changes `wireTargetFor` only when the local id is not its own alias root.
- The retraction strip of `localUri` / `uploadProgress` does nothing on web, which never sets them.

**Where I went off the plan**
- No `contacts` dep: both apps read `state.contacts` (web `realStore.ts` before the move, mobile `real-store.ts:1167`), so the ledger reads `LedgerState.contacts`.
- The ledger does not import `ChatMessage` from `@zilar/xmpp-core`. With that import, `client-core` typecheck fails on xmpp-core's `@xmpp/client` imports (no ambient types; web adds `packages/xmpp-core/src/types/xmpp.d.ts` in its tsconfig). `packages/client-core/tsconfig.json` is not in Allowed, and oxlint rejects a `/// <reference path>`. So `ledger.ts` declares `LedgerStanza` with the fields it reads; web passes `ChatMessage` to it and typechecks. T6 needs xmpp-core types in core anyway: it should add that include to `packages/client-core/tsconfig.json` and replace `LedgerStanza` with `ChatMessage`.
- Tests first: a new web test file is not in Allowed, so the three paths are core tests. A harness drives the ledger with the same calls, in the same order, as `send.ts` (`sendText`, `linkSent`) and `incoming.ts` (`handleOutgoingEcho`, `handleMessage`). They ran on the code copied verbatim from web before web switched over.
- `groupMemberNameFor` now computes the localpart before it reads the member map. Both steps are pure, so nothing changes.

**Checks** (wave mode, no `pnpm gate`)
- `pnpm --filter @zilar/client-core exec vitest run --reporter=dot`: 66 passed (61 before + 5 new).
- `pnpm --filter @zilar/web exec vitest run --reporter=dot src/store`: 214 passed before the move, 214 after.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot`: 185 files, 1918 passed.
- `realStore.test.tsx`, `realStore.forward.test.tsx`, `realStore.topics.test.tsx` 3 times: 166 passed each run.
- `pnpm --filter @zilar/client-core typecheck`, `pnpm --filter @zilar/web typecheck`: clean.
- `prettier --check` and `oxlint` on the 5 changed source files: clean.

### Round 1

**Commits:** `e9f14bdd` merges main (one conflict, my T3 line in `packages/client-core/src/store/index.ts`). `ac303db4` adds `apps/web/src/store/realStore.ledger.test.tsx`, with the group case failing. `00649949` is the fix.

**The bug (already on main, so not caused by this task):** I ran the new test file in a separate checkout of main and got the same failure. In a group, when my own echo arrived before `sendMessage` resolved, the echo stored the room's stanza id as the wire target (`incoming.ts` `handleOutgoingEcho`). Then `linkSent` (`send.ts`) overwrote it with the ack's sender-generated id. A reaction then named the origin id instead of the stanza id that XEP-0444 asks for in groups. When the ack came first, the echo wrote last, so the right id won: the result depended on arrival order.

**Fix:** a new ledger function, `linkAckToServer(chat, localId, serverId)`. In a group it does nothing when a server id is already stored for the local id or its alias root; otherwise it is `linkLocalToServer`. `linkSent` in `send.ts` takes the chat and calls it, for all five pipelines (text, sticker, attachment, voice, forward). The echo keeps calling `linkLocalToServer`, so the stanza id wins in groups whichever comes first. DMs are unchanged: the ack's id is still linked either way. That is pinned by the core test "links the ack id in a DM whichever came first" and by the DM cases of the web file. My core echo-before-resolve test had pinned the bug (`'origin-1'`); it now asserts `'stanza-1'`.

**New web file** `realStore.ledger.test.tsx`, through `createRealChatStore` and the existing fakes, with `flushTasks` from `@/test/wait`. Its cases: a DM echo before the ack; a group echo before the ack; a group echo after the ack; two identical texts with acks out of order; the echo of a reply next to the same text without a reply. Each ends with one bubble per send, in `sent` (the unechoed plain reply stays `sending`), and a reaction that names the right server id.

**Mobile has the same race** (not changed). The echo files the echo's id: `apps/mobile/src/store/real-store.ts:1434-1435` (`linkMessageIds(localId, ui.id)`, `linkLocalToServer(localId, ui.id)`). Every ack then overwrites it with the sender-generated `sent.id`:
- `acknowledge` at `apps/mobile/src/store/effects/send.ts:71-76`, used by stickers `:294`, forwards `:322` and text `:389`;
- attachments `:166-167`;
- voice `:250-251`.

`linkLocalToServer` at `real-store.ts:384-391` overwrites unconditionally, and `wireTargetFor` (`:396`) reads it. So a mobile group reaction to a message whose echo beat its ack names the origin id. T5 adopts the core ledger: switching those ack sites to `linkAckToServer(chat, ...)` fixes it. A tests-first case is needed: a group send whose echo arrives before `sendMessage` resolves, then `react`, and `sendReactions` must name the stanza id.

**Checks, round 1**
- `realStore.ledger.test.tsx` 3 times: 5 passed each run.
- `realStore.test.tsx`, `realStore.forward.test.tsx`, `realStore.topics.test.tsx`: 166 passed.
- Full web suite: 187 files, 1925 passed.
- client-core: 69 passed.
- Both typechecks clean. `prettier --check` and `oxlint` on the changed files clean.

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 1.**
- **The move:** the web message ledger moved to `packages/client-core/src/store/ledger.ts`. Web `realStore.ts` went from 1,550 to 479 lines, and no existing test was edited.
- **Round 1, new tests:** `realStore.ledger.test.tsx` drives the uncovered paths through the real web store.
- **Bug found, already on main:** in a group, an echo that arrived before the send resolved got its stanza id overwritten by the ack's origin id. A reaction then named the wrong id.
- **The fix:** it went in tests first, as `linkAckToServer` across all five send pipelines. DMs are unchanged, and the core test that pinned the bug now asserts the stanza id.
- **Mobile has the same race,** at `apps/mobile/src/store/effects/send.ts:71-76,166-167,250-251`. T5 carries the fix, tests first.
- **Follow-up for T6:** add the `@xmpp/client` types include to `packages/client-core/tsconfig.json`, and use `ChatMessage` in place of `LedgerStanza`.
- **Check:** the combined check passes.
- **Live check for Julio:** reactions, edits, mentions, forwards and send failures on web, in groups and DMs.
