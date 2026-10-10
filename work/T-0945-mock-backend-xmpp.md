---
id: T-0945
title: "Mock backend F2: a fake XMPP core on createFakeXmppCore that serves the seed's history, echoes sends, and emits typing, reads, reactions, edits and deletes (docs/audit/mock-plan.md task F2)"
status: merged
milestone: M5
branch: task/T-0945-mock-backend-xmpp
model: auto
effort: default
depends_on: [T-0942]
estimate: 0.5 day
---

# T-0945: Mock backend F2, the fake XMPP core

## Spec (written by Claude, do not edit)

### Why
Task F2 of `docs/audit/mock-plan.md` (read section 2.4 and "Julio's answers"). This piece makes the real stores work in mock mode: they talk to an `XmppCore` (`packages/xmpp-core/src/types.ts:248`, the same interface `createXmppCore` returns at `packages/xmpp-core/src/index.ts:61`).

`createFakeXmppCore` (`packages/xmpp-core/src/testing.ts:32`) already records calls, injects failures (`:24`) and has an `emit` hub (`:19`). The seed's messages are in `packages/mock-backend/src/domains/messages/` (T-0939 and T-0942; the records are `ChatMessage` plus the reaction, correction and retraction stanzas).

### What to build
1. **`createMockXmppCore(data, options): XmppCore`,** in `packages/mock-backend/src/xmpp/` (a few files, each under 400 lines), built on `createFakeXmppCore` and keeping its `on` hub, `calls` and `failures`. The behaviour, as plan section 2.4 lists:
   - `connect`: status `online` and a `status` event; `me()` is `you@zilar.test`;
   - `joinRoom`, `leaveRoom` and `occupants` track rooms and emit `occupants`;
   - `sendMessage` appends to the thread in `MockData`, emits the reflected `message` (`outgoing: true`), and for a room, emits an incoming reply from a seeded member after a short delay (default 1.5 s, configurable, 0 disables it);
   - `loadHistory` serves the seed's pages with RSM (`HistoryPage.first`, `types.ts:152`), so scroll-back and `openAtMessage` work;
   - `sendReactions`, `sendCorrection` and `sendRetraction` mutate the thread and emit the matching `message` updates (`types.ts:40-84`);
   - `sendTyping` and `markDisplayed` emit `typing` and `displayed`;
   - `requestUploadSlot` returns a `data:` URL pair, so attachment and voice sends finish with no server.
2. **The backend member:** `createMockBackend()` gains `xmpp: (options) => XmppCore` (plan section 2.2), sharing the backend's `MockData`. Keep the package free of react and effect at runtime (risk R4); check what `createFakeXmppCore` imports.
3. **No app file changes, no tests.** Prove it in the Report with a throwaway script:
   - connect;
   - load the first two history pages of `dev-team@rooms.zilar.test`, and show the counts and the `first` cursor;
   - send a message, and show the reflected event and the room reply;
   - react, then edit, then delete it, and show each event.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` section 2.4, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/testing.ts`, `packages/xmpp-core/src/events.ts`, `packages/mock-backend/src/index.ts`, and `packages/mock-backend/src/domains/messages/`.

### Allowed files
`packages/mock-backend/**`, `work/T-0945-mock-backend-xmpp.md`.

T-0943 and T-0944 add HTTP domains to the same package in parallel. Keep your work in `src/xmpp/`, plus the one `xmpp` member in `src/index.ts`; if you need a mutator in `domains/messages/state.ts`, add it at the end of the file.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the script output for each item in step 3.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0945-mock-backend-xmpp`. No app files and no
committed tests were changed.

### What I built

- **`packages/mock-backend/src/xmpp/`** (new, `src/xmpp/` only):
  - `core.ts`: `createMockXmppCore(data, options): FakeXmppCore`, built on
    `createFakeXmppCore()` so its `on` hub, `calls` and `failures` survive. My
    overrides record into the same `calls` and honour `failures`, like the fake
    base. `MockXmppCoreOptions` extends `XmppCoreOptions` with `replyDelayMs`.
  - `history.ts`: `historyPage(thread, opts)` — the RSM paging the client-core
    history test's fake uses (`before` an id, newest `max`, `first` = the page's
    oldest id, `complete` when it is the oldest page).
  - `rooms.ts`: room members (the bare JIDs who posted in the room, viewer
    excluded), their occupants, and the round-robin member who replies.
  - `index.ts`: barrel.
- **`src/index.ts`**: `createMockBackend()` gains
  `xmpp: (options: MockXmppCoreOptions) => XmppCore` over the backend's shared
  `MockData` (the closure reads the current `data`, so it follows `reset()`).
  `createMockXmppCore` / `MockXmppCoreOptions` / `DEFAULT_REPLY_DELAY_MS` are
  re-exported.
- **`src/domains/messages/state.ts`**: the messages slice becomes a live getter
  plus one `appendMessage(chatJid, message)` mutator (replacement object/arrays,
  never mutation in place). **`src/state.ts`**: `MockData` declares the mutator.
  This is the "mutator at the end of the file" the task allows; the interface
  entry was needed for the core to call it in `strict` mode.

Behaviour, plan section 2.4: `connect` sets `online` and emits `status`; `me()`
is `you@zilar.test`; `joinRoom`/`leaveRoom`/`occupants` track rooms and emit
`occupants`; `sendMessage` appends to the `MockData` thread, emits the reflected
`message` (`outgoing: true`) and, for a room, an incoming reply from a seeded
member after `replyDelayMs` (default 1500, `0` disables); `loadHistory` serves
the seed with RSM; `sendReactions`/`sendCorrection`/`sendRetraction` append and
emit the matching `message`; `sendTyping`/`markDisplayed` emit `typing`/
`displayed`; `requestUploadSlot` returns a `data:` URL pair.

### Commands and real results

Throwaway probe (a temp `src/xmpp/probe.test.ts`, deleted before the gate):

`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/xmpp/probe.test.ts`
→ `Test Files 1 passed (1)`, `Tests 1 passed (1)`. Its stdout:

```text
[event] status online
1. connect -> status online | me you@zilar.test
[event] occupants dev-team@rooms.zilar.test 5
2. joinRoom -> occupants 5
3a. history page 1 -> count 3 | first dev-31 | complete false
3b. history page 2 (before page 1 first) -> count 3 | first dev-27 | complete false
4a. sendMessage -> ack {"id":"mock-msg-1"}
4b. reflected   -> {"id":"mock-msg-1","fromJid":"you@zilar.test","outgoing":true,"body":"Hello from the mock"}
4c. room reply  -> {"id":"mock-reply-2","fromJid":"dev-1@ai.zilar.test","fromNick":"Dev-1","outgoing":false,"body":"Sounds good."}
5.  reactions   -> {"id":"mock-reaction-3","fromJid":"you@zilar.test","outgoing":true,"reactions":{"targetId":"mock-msg-1","emojis":["👍","❤️"]}}
6.  correction  -> {"id":"mock-edit-4","fromJid":"you@zilar.test","outgoing":true,"body":"Hello from the mock (edited)","correction":{"targetId":"mock-msg-1"}}
7.  retraction  -> {"id":"mock-retract-5","fromJid":"you@zilar.test","outgoing":true,"retraction":{"targetId":"mock-msg-1"}}
[event] typing dev-team@rooms.zilar.test composing outgoing=true
[event] displayed dev-team@rooms.zilar.test mock-msg-1
8.  upload slot -> {"putUrl":"data:image/png;base64,","getUrl":"data:image/png;base64,","headers":{}}
9.  DM send -> message events (no reply) 1
10. calls recorded 12
```

`pnpm --filter @zilar/mock-backend typecheck` → clean (no output).

`pnpm gate` (from the repo root):

```text
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.4s)
PASS  lint  (0.4s)
PASS  typecheck  (1.5s)
PASS  effect  (0.4s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- One extra file beyond `src/xmpp/` and the `xmpp` member: `src/state.ts` gained
  the `appendMessage` declaration (the mutator's type). Both are inside the
  Allowed files.
- `core.ts` carries an `// effect-plain:` marker in its first lines because the
  real ratchet flags the new file's `async`/`await` and `setTimeout` (H1/H3),
  exactly as `http.ts` already does for its delay. The package still imports no
  Effect/React at runtime (only `@zilar/xmpp-core/testing`, whose imports are
  `./events` and `./types`, both Effect-free).

### Open questions

- None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The fake core:** `createMockXmppCore` in `packages/mock-backend/src/xmpp/`, on `createFakeXmppCore`. It connects and goes online, serves RSM history from the seed, and reflects a send with a room reply (`replyDelayMs`, default 1.5 s). It also emits reactions, corrections, retractions, typing and reads. `createMockBackend().xmpp` is the entry.
- **Size:** 456 lines added, with no file over 247, and only the package changed.
- **Nits for the cutover tasks:**
  - three methods record truncated args in `calls`;
  - a core created before `reset()` keeps the old `MockData` and its pending reply timers.
- **Check:** the gate passed.
