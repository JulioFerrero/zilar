---
id: T-1211
title: "SG-5: when the server removes me from a room (my own unavailable MUC presence with status 307 kicked, 301 banned or 321 affiliation change), the core emits a 'removed' event and the store refreshes the chat list at once, so every device drops the group or topic (and runs the existing removed-while-open flow) instead of waiting up to 60 s"
status: merged
milestone: M5
branch: task/T-1211-muc-removal-event
model: auto
effort: default
depends_on: [T-1197]
estimate: 0.3 day
---

# T-1211: A removal reaches my other devices at once

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md` SG-5 (P1, confirmed). A removal propagates slowly.
- **The removal codes are never read:** no code parses the MUC status codes 321, 307 or 301. `parseMucPresence` (`packages/xmpp-core/src/stanza/parse-presence.ts:35-62`) only records availability, affiliation and role. `applyPresence` (`packages/xmpp-core/src/core-effect/presence.ts:70-76`) only drops the occupant from the roster.
- **So other devices learn of a removal late:** only when `/api/chats` is read again, on focus or the 60 s topic poll (`packages/client-core/src/store/polling.ts:15,82-98`).
- **Additions are already fast:** the `invited` and `roster` events call `ctx.fx.scheduleChatsRefresh()` (`packages/client-core/src/store/lifecycle.ts:319-320`; the hook is declared at `packages/client-core/src/store/ctx.ts:102`). The refresh keeps only the server's rows, and the existing removed-while-open flow handles an open chat that disappears.
- **Sizes:** `lifecycle.ts` is 396 lines, and the core's events are in `packages/xmpp-core/src/events.ts` (65 lines).

### What to build
1. **xmpp-core, parse:** `MucPresence` (`packages/xmpp-core/src/stanza/parse-context.ts:32`) gains `statusCodes?: number[]`, read from every `<x xmlns="http://jabber.org/protocol/muc#user"><status code/>` in `parseMucPresence`.
2. **xmpp-core, the core:** in `presence.ts`, when a presence is **unavailable**, carries status **110** (self-presence), and also **307, 301 or 321**, emit a new `removed` event `{ roomJid }`, registered in `events.ts`. Keep the existing roster drop.
3. **client-core:** subscribe to `removed` and call `ctx.fx.scheduleChatsRefresh()`. To keep `lifecycle.ts` at most 400 lines, add the listener next to the `invited` and `roster` lines; if it doesn't fit, move those three listeners into `packages/client-core/src/store/online.ts` or a new small file, and say which.
4. **Check** that ejabberd sends status 321 to the removed user's own sessions when the server sets their affiliation to `none`. Find how groups remove a member (`apps/server/src/groups/members.ts` and the room-sync helpers) and whether that path changes the affiliation in the room. Write what you found in the Report. If the server never touches the room affiliation on removal, say so: then this event fires only for kicks, and the server side is a follow-up.
5. **Test** (permissions and the message pipeline), 1, in `packages/xmpp-core/src/stanza.test.ts`: an unavailable self-presence with codes 110 and 321 parses to `statusCodes` containing both. A core-level emit test is optional, if the existing test setup makes it cheap.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (SG-5), `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/stanza/parse-context.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/events.ts`, `packages/client-core/src/store/lifecycle.ts:285-330` and `apps/server/src/groups/members.ts`.

### Allowed files
`packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/stanza/parse-context.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/events.ts`, `packages/xmpp-core/src/stanza.test.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/online.ts`, `work/T-1211-muc-removal-event.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- `packages/xmpp-core/src/stanza/parse-context.ts`: `MucPresence` gains `statusCodes?: number[]`.
- `packages/xmpp-core/src/stanza/parse-presence.ts`: `parseMucPresence` reads every
  `<x xmlns="http://jabber.org/protocol/muc#user"><status code/>` into `statusCodes`
  (non-integer codes ignored).
- `packages/xmpp-core/src/events.ts`: new `RemovedEvent { roomJid }`, registered in
  `EventPayloadMap`; `XmppCore.on('removed', ...)` overload added via module
  augmentation (same pattern as `types-ack.ts`), so `types.ts` stays untouched.
- `packages/xmpp-core/src/core-effect/presence.ts`: in `applyPresence`, when a presence
  is unavailable, carries status 110 plus 307/301/321, and the nick matches the nick
  this client joined the room with (`joinedRooms`), emit `removed { roomJid }`.
  The existing roster drop is unchanged. A voluntary leave cannot fire it:
  `leaveRoom` deletes the `joinedRooms` entry first.
- `packages/client-core/src/store/lifecycle.ts`: added the `removed` listener next to
  the `invited`/`roster` lines (all three call `ctx.fx.scheduleChatsRefresh()`).
  `lifecycle.ts` is now 399 lines (was 396), still under 400. Nothing moved to `online.ts`.
- `packages/xmpp-core/src/stanza.test.ts`: new `parseMucPresence: status codes` test:
  an unavailable self-presence with codes 110 and 321 parses to `statusCodes [110, 321]`.

### Server-side check (spec item 4)
- Group removal (`apps/server/src/groups/members.ts:147-180`): `removeGroupMember` calls
  `adminClient.setAffiliation(group.roomLocalpart, <target jid>, 'none')` inside the same
  transaction that deletes the `group_members` row, then calls `syncGroupTopicRooms`.
- Topic removal (`apps/server/src/topics/room-sync.ts:61-74`): `syncTopicRoom` sets
  affiliation `'none'` for every JID that is no longer wanted (the removed member's
  `topic_members` row was already deleted, so `desiredMembers` excludes them).
- So both the group room and every topic room DO change the removed user's affiliation
  to `none`. Per XEP-0045, in a members-only room this makes the room send the removed
  user's own sessions an unavailable presence with status 110 + 321, which is exactly
  what the new `removed` event listens for. No server follow-up needed; audit
  (`docs/audit/social-graph-audit.md:236-240`) already records these call sites.

### Commands and real results
- `pnpm install`: done, 11.4 s.
- `pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot`:
  1 file, 81 passed (80 existing + 1 new).
- `pnpm --filter @zilar/xmpp-core exec tsc --noEmit`: clean.
- `pnpm --filter @zilar/client-core exec tsc --noEmit`: 3 errors, all in
  `src/store/send/retry-text.ts` (85, 109, 125: `outboxFailed` called with 8 args,
  signature takes 9). Pre-existing: reproduced with my changes stashed.
  Cause: `main` already specs this as T-1213 ("urgent: retry-text outboxFailed args",
  commit `4b7a412d8`) — another worker's fix is pending. `retry-text.ts` is outside
  my Allowed files, so I did not touch it; `lifecycle.ts` (my file) typechecks clean.
- `pnpm gate` (repo root): `PASS install`, `PASS format`, `PASS lint`,
  `FAIL typecheck` (only the pre-existing T-1213 errors above),
  `scope: every changed file is inside the Allowed files`,
  `migration: every added migration continues from the base`, `GATE FAIL`.
  The gate did NOT reach tests because typecheck failed first; the single-test
  run above is my test evidence.
- Line counts: `events.ts` 81, `parse-context.ts` 95, `parse-presence.ts` 128,
  `core-effect/presence.ts` 167, `lifecycle.ts` 399 — all at most 400.

### Deviations / open questions
- No core-level emit test: the existing xmpp-core test setup has no cheap
  `createPresence` harness (the spec made it optional), so I tested the parse
  only, plus typecheck of the emit path.

### Security checklist
- No secrets/tokens in logs or code (room JIDs only in the event, no message text).
- No deletes/updates touched; the event only schedules a chat-list refresh.
- No caps/uniqueness rules, no permission checks (read-only client path), no new
  routes, no audit entries.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **xmpp-core:**
  - `MucPresence.statusCodes` is parsed from `muc#user` `<status/>`;
  - an unavailable self-presence (110 plus 307, 301 or 321, with the nick this client joined with) emits `removed { roomJid }`;
  - a voluntary leave can't fire it.
- **client-core:** `removed` calls `scheduleChatsRefresh()`, next to `invited` and `roster`. `lifecycle.ts` is 399 lines.
- **The server side was checked:** group and topic removal set the affiliation to `none` (`groups/members.ts:147-180`, `topics/room-sync.ts:61-74`), so ejabberd sends 321 and the event fires on real removals.
- **Lead checks:**
  - the lead rebased onto main after T-1213, with the branch diff unchanged; the packet was current for the HEAD before the rebase;
  - xmpp-core stanza 81 of 81;
  - `tsc` gives 0 errors for xmpp-core, client-core, web and mobile.
- **Still to do:** the live check with test accounts (remove a member and their other device drops the group at once).
