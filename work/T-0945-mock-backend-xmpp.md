---
id: T-0945
title: "Mock backend F2: a fake XMPP core on createFakeXmppCore that serves the seed's history, echoes sends, and emits typing, reads, reactions, edits and deletes (docs/audit/mock-plan.md task F2)"
status: todo
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

## Review (written by Claude)
