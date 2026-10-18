---
id: T-2017
title: "Mock backend: a seeded long group chat (800 generated messages with replies, reactions, links, images and a few edits) and a history-page delay in app mock mode, so chat scroll performance can be measured on the emulator and web without a live sign-in"
status: merged
milestone: M5
branch: task/T-2017-mock-long-chat
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2017: A long mock chat for scroll measurements

## Spec (written by Claude, do not edit)

### Why
Julio reported a janky phone chat scroll on 2026-10-18. The scroll audit (`docs/audit/chat-scroll-perf.md` §5) says to measure with "one group chat with at least 600 messages (avatars, replies, reactions, links, images)".
- **Live data:** the lead may not sign the emulator in to the live server.
- **The mock:** today its longest thread is Ana's DM at about 28 messages (`packages/mock-backend/src/domains/messages/threads/ana.ts`).
- **What's needed:** a long mock chat that a mock build (`ZILAR_SMOKE_MOCK=1 pnpm phone:smoke …`) and the web mock (`?mock=1`) can open. This is a mock fixture: no app code changes and no tests.

### Facts (read by the lead on 2026-10-18; paths under `packages/mock-backend/src/`)
- **Thread seeds.** `domains/messages/threads/index.ts` (36 lines) maps a chat JID to its seed array, for example `'viernes@rooms.zilar.test': viernesMessages`.
- **Seed helpers.** `domains/messages/threads/shared.ts` exports `msg`, `ago`, `reaction`, `correction`, `retraction`, `JIDS` and `MockMessageSeed`.
- **Media.** `domains/messages/builders.ts` exports `file`, `image` and `voice`.
- **The group chat.** `domains/chats/seed.ts` lists the chat rows. The group "Viernes 🍻" is `groupRoomJid('g-viernes')` with 5 members (`:38-46`).
- **History paging.** `xmpp/history.ts` pages a thread 50 at a time (`DEFAULT_HISTORY_MAX = 50`) with a `before` cursor. `xmpp/core.ts:253-256` serves `loadHistory` through `startAsync(...)` (`:72`) with no delay.

### Steps
1. **A generated thread.** Add `domains/messages/threads/long.ts`. It builds **800** older messages with a deterministic loop, with no randomness that changes between runs:
   - senders rotate through the group's members and "you";
   - every 7th message replies to an earlier one, and every 5th gets one or two reactions;
   - every 11th has a link, every 25th is an `image(...)`, every 40th is a long multi-line text, and every 60th gets a `correction`;
   - timestamps step back a few minutes each, across about 10 days, so day separators appear.
2. **Where it lives.** Prepend it to an existing group thread, or add a new group chat named "Long chat". Pick whichever needs fewer seed changes **and leaves every existing test green**. If tests count the Viernes messages, use a new group. Write its chat JID and its route (`/chat/<jid>`) in the Report.
3. **History delay.** Add a `historyDelayMs` option to the mock backend, default `0`, so tests stay instant, and use it in `loadHistory`. Set it to **300** wherever the apps create the mock backend for app mock mode (web `?mock=1` and the phone mock build). Find those call sites with `git grep`, and add their files to Allowed files if needed.
4. **Keep files small.** Every source file stays at or under 400 lines, so keep the generator compact. No new tests.

### Allowed files
- `packages/mock-backend/src/domains/messages/threads/long.ts`
- `packages/mock-backend/src/domains/messages/threads/index.ts`
- `packages/mock-backend/src/domains/messages/threads/viernes.ts`
- `packages/mock-backend/src/domains/chats/seed.ts`
- `packages/mock-backend/src/domains/groups/state.ts`
- `packages/mock-backend/src/domains/groups/tables.ts`
- `packages/mock-backend/src/xmpp/core.ts`
- `packages/mock-backend/src/xmpp/history.ts`
- `packages/mock-backend/src/index.ts`
- `apps/web/src/mock/backend.ts`
- `apps/mobile/src/mock/backend.ts`
- `work/T-2017-mock-long-chat.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead opens the long chat in the web mock and in a phone mock build, and scrolls up through all 17 pages.

---

## Report (written by the worker when done)

### What I did

- Added `packages/mock-backend/src/domains/messages/threads/long.ts`: a deterministic
  generator for 800 messages (plus 240 reaction and 14 correction records, 1054
  archive records in total) spanning about 9.4 days. Senders rotate through the
  five Viernes members and you; multiples of 7 reply to 7 messages earlier,
  multiples of 5 get one reaction (multiples of 10 get two), multiples of 11 carry
  a link, 25s carry an `image(...)` payload, 40s are long multi-line text and 60s
  get a correction.
- Prepended it to the existing Viernes thread in
  `packages/mock-backend/src/domains/messages/threads/index.ts`
  (`[...longMessages, ...viernesMessages]`). This needed fewer seed changes than a
  new group: no chat row, group row or membership changes.
- Added `historyDelayMs` to the mock backend (`packages/mock-backend/src/index.ts`)
  and the fake core (`packages/mock-backend/src/xmpp/core.ts`), default `0`, used
  in `loadHistory`. App mock mode passes `300`:
  `apps/web/src/mock/backend.ts` and `apps/mobile/src/mock/backend.ts`.
- Added those two app files to the Allowed files list, as Step 3 instructs.
- No tests added, per the spec.

Chat JID: `viernes@rooms.zilar.test` (title "Viernes 🍻").
Routes: web `/c/viernes@rooms.zilar.test` (`/c/:chatJid`), mobile `/chat/[id]`
with `id = viernes@rooms.zilar.test`.

### Checks run

- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot`:
  2 test files passed, 7 tests passed.
- `pnpm gate` from the repo root: exit 0.

```text
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (0.8s)
PASS  typecheck  (4.0s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/web  (4.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The seeded Viernes thread now has 1092 archive records, so the pager serves
  22 pages of 50, not 17. Scrolling all the way up still exercises every page.
- The first generated message is about 12.4 days old and the last about 3 days
  old, so the backlog sits wholly before the existing Viernes messages (which
  start two days ago) and day separators appear.
- `pnpm gate` skipped the mock-backend tests because no test file sits next to the
  changed generator; the package's 7 tests were run directly and pass.
- I did not open the web or phone mock myself; that remains the acceptance step.


## Review (written by Claude)

Approved: a clean pre-review with 1 nit.
- **The long chat.** The mock "Viernes" group (`viernes@rooms.zilar.test`) now has 800 generated older messages, 1,092 records in all, served as 22 history pages of 50.
- **What the messages include:** replies, reactions, links, images, long texts and edits, spread over about 10 days.
- **Page delay.** App mock mode (web and phone) serves history pages after 300 ms. Tests keep 0.
- **Next.** The lead uses this chat for the before/after scroll measurement on the emulator.
