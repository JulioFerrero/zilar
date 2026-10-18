---
id: T-1999
title: "Message pipeline security: a live group message's sender comes only from the room (presence roster / occupant id), never from a muc#user item inside the message; carbons and MAM results are accepted only from the user's own account (or the queried room); a live message's own <delay> is ignored — with tests"
status: merged
milestone: M5
branch: task/T-1999-trust-live-sender
model: anthropic/claude-sonnet-5-5
effort: high
estimate: 60 min
---

# T-1999: Trust only the server for who sent a message

## Spec (written by Claude, do not edit)

### Why
On 2026-10-18 the lead's private security review (T-1987) found two ways to fake who sent a message. Both reach the web and phone clients, and the server's AI gateway, which uses the same decoder.
1. **Group messages.** A group member can add `<x xmlns='http://jabber.org/protocol/muc#user'><item jid='someone@domain'/></x>` to their own groupchat message. ejabberd relays it unchanged, and our decoder trusts that `item jid` before anything else.
   - Clients then show the message as someone else's.
   - The AI gateway treats the claimed person (for example the AI's owner) as the trigger, which unlocks the AI's computer.
   - ejabberd adds the real `item jid` only to archived (MAM) copies.
2. **Carbons.** A carbon (`<sent>` / `<received>`, XEP-0280) is unwrapped without checking the outer `from`. A forged carbon relayed through a shared room can fake a DM from anyone, including an owner's DM to their AI. XEP-0280 §11 requires the outer `from` to be the user's own bare JID.

Also: a sender's own `<delay stamp>` on a live message is used ahead of the server's stamp, so a member can back-date or future-date a message.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18; paths under `packages/xmpp-core/src/`)
- **`stanza/decode.ts`** (235 lines). `decodeMessageStanza` calls `unwrapMessage(stanza)` (`:42-43`) and then uses only `inner` for kind, `from` and the domain check (`:47-51`). `resolveSender({... itemJid: mucUserItem(inner)?.attrs['jid'], occupantId: occupantIdOf(inner), roster: ctx.rosterFor?.(roomJid) })` is at `:58-66`.
- **`stanza/resolve-sender.ts`** (133 lines). For groupchat, `if (input.itemJid !== undefined && input.itemJid !== '')` returns that JID as resolved (`:48-56`). This check runs before the occupant-id and roster lookups (`:58-…`).
- **`stanza/parse-context.ts`** (138 lines).
  - `unwrapMessage` (`:101-124`) takes `stanza.getChild('sent'|'received', CARBONS_NAMESPACE)` or the MAM `result`, then returns the forwarded inner message. It never checks `stanza.attrs['from']`.
  - It records `forwardedDelay` and, for MAM, `archiveId`.
- **`stanza/parse-fields.ts`** (194 lines). `:30` sets `const stamp = stanza.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'] ?? forwardedDelay;`, so the inner message's own delay wins.
- **Room rosters.** `core-effect/presence.ts` keeps them (`rosterFor`, `:26`, exposed at `:116`) from MUC presence, which carries the real JID in non-anonymous rooms.
- **No occupant id.** None of our ejabberd configs load `mod_muc_occupantid`, so live messages carry no `<occupant-id>` today, and the roster path does the work.
- **MAM.** Pending MAM queries are matched by a random `queryid` in `core-effect/stanza-router.ts:22-29`.
- **Gateway.** In the server's AI gateway, `apps/server/src/agents/gateway/group-turn-access.ts:46-60` decides `allowDesk` from `normBareJid(trigger.fromJid)`, and `apps/server/src/agents/gateway/dm-turn.ts:152-166` treats `bareJid(item.fromJid) === ownerBare` as the owner.
- **Tests.** `src/stanza.test.ts` and `src/mam.test.ts` exist.

### Steps
1. **Trust `item jid` only from the archive.** Pass whether the message came from a MAM result (the envelope has `archiveId`) into `resolveSender`.
   - Use `itemJid` only for a MAM result.
   - For a live groupchat message, ignore any `muc#user <item>` in it and resolve the sender from the occupant id or the room roster, as the code already does next.
   - If the sender can't be resolved, return it unresolved, the way the code does today when there is no roster entry.
2. **Carbons only from me.** In `unwrapMessage` (or in `decodeMessageStanza`, which has `ctx.me`), accept a carbon only when the outer `from` is absent or its bare JID equals `ctx.me`. Otherwise drop the carbon: decode the outer stanza as-is, so its own sender is shown, or decode nothing.
3. **MAM results only from me or the room.** Accept a MAM `result` only when the outer `from` is absent, equals `ctx.me`'s bare JID, or is a room JID on the MUC domain. Add the same check where `stanza-router.ts` matches pending queries, if that is the cleaner place.
4. **Ignore a live message's own delay.** For a live, non-forwarded message, ignore the message's own `<delay>`: use the server's forwarded delay when there is one, else the receive time. Keep `<delay>` for MAM and offline delivery, where the server adds it. Read how offline messages arrive first: ejabberd stamps them with `from` = the server domain, and that must keep working.
5. **Check the gateway end to end.** Confirm that the server's AI gateway builds its room rosters from presence through the same `core-effect` code, so group triggers still resolve to real JIDs after step 1. If the gateway has no roster, stop and say so in the Report, and don't break AI group turns.
6. **Tests** (in `src/stanza.test.ts` and `src/mam.test.ts`):
   - a live groupchat message with a forged `item jid` resolves to the roster's real JID, not the forged one;
   - the same element inside a MAM result from the room is trusted;
   - a carbon whose outer `from` is another user is not unwrapped;
   - a carbon from `me` is unwrapped;
   - a live message with its own past `<delay>` gets no back-dated time.
7. **Size.** Every file stays at or under 400 lines.

### Allowed files
- `packages/xmpp-core/src/stanza/decode.ts`
- `packages/xmpp-core/src/stanza/resolve-sender.ts`
- `packages/xmpp-core/src/stanza/parse-context.ts`
- `packages/xmpp-core/src/stanza/parse-fields.ts`
- `packages/xmpp-core/src/core-effect/stanza-router.ts`
- `packages/xmpp-core/src/stanza.test.ts`
- `packages/xmpp-core/src/mam.test.ts`
- `work/T-1999-trust-live-sender.md`

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The five new tests pass, existing tests pass, and the gate passes.
- After the deploy, the lead checks live that @Deepseek still answers a mention in "ai test › cards test", and that group messages still show the right senders.

---

## Report (written by the worker when done)

### What I did
- `stanza/resolve-sender.ts`: `resolveSender` takes `archived`; the `muc#user <item jid>` is used only when it is true. A live groupchat message now resolves through occupant id, then the room roster, then falls back to the unresolved occupant JID.
- `stanza/parse-context.ts`: `unwrapMessage(stanza, ctx)` now returns `forwarded` and `archived` flags. A carbon is unwrapped only when the outer `from` is absent or its bare JID equals `ctx.me` (no `me` yet means a carbon with a `from` is dropped). A MAM result is unwrapped only through the new exported `mamResultTrusted`: outer `from` absent, bare JID equal to `ctx.me`, or a bare room JID (no resource) on the MUC domain. A rejected wrapper is decoded as the outer stanza, which carries no body.
- `core-effect/stanza-router.ts`: `handleMamResult` also drops an untrusted result before decoding, so a rejected wrapper can't be pushed into a pending query as a live message.
- `stanza/parse-fields.ts` and `stanza/decode.ts`: `timestamp` uses the forwarded (server) delay, else the receive time. A message's own `<delay>` is used only for a non-forwarded DM whose delay has `from` equal to the server domain (how ejabberd stamps offline delivery).
- Tests: new ones in `stanza.test.ts` and `mam.test.ts`. Three existing tests in `stanza.test.ts` relied on the old behaviour (live item jid trusted, DM delay with no `from`), so I changed them to use a roster and a server-stamped delay.
- Step 5 (gateway): `apps/server/src/agents/gateway/sessions.ts` builds AI sessions with `createCore(...)` (an `XmppCore`) and calls `session.core.joinRoom(roomJid, aiName)`. That uses the same `core-effect` presence and `parseContext` (`rosterFor`) as the clients. So group triggers resolve through the roster as long as the room's presence carries real JIDs (non-anonymous). I only read the code; I did not run the gateway or a live room.

### Checks run
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts src/mam.test.ts`: 109 passed.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot`: 4 files, 158 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store`: 15 files, 187 passed.
- `pnpm gate`: install, format, lint, typecheck, effect, tests @zilar/xmpp-core all PASS; "scope: every changed file is inside the Allowed files"; "size: every changed source file is within 400 lines"; `GATE PASS`.

### Notes for the lead
- Delay is still forgeable in a DM. A sender can put `<delay from='<server domain>' stamp=...>` on a live DM and it is accepted, because I can't tell that apart from an ejabberd offline stamp. Live groupchat messages never use their own delay (the client joins with `maxstanzas=0`). If you want this closed, the server would have to strip or overwrite delays on relay.
- I did not check what ejabberd does when a forged `muc#user` element is already on a message that gets archived. If it adds a second `<x>` and doesn't replace the forged one, `mucUserItem` (first `x`) could still pick the forged item in the MAM copy. I trust the archive item as the spec says. That needs a live check.
- `stanza.test.ts` was already 1636 lines before this task (the 400-line rule applies to source; the gate's size check passed).
- No occupant ids are sent by ejabberd today, so the roster path is the only live resolver. A live groupchat message from a nick missing from the roster now shows as unresolved, where before it showed the item jid. This can happen briefly right after joining, before presence arrives.
- Not done: the post-deploy live check of @Deepseek in "ai test › cards test" (the lead does that).

## Review (written by Claude)

Approved. The pre-review was clean, with 2 follow-ups.
- **What changed.**
  - `item jid` is trusted only on archived results that passed `mamResultTrusted`.
  - Carbons are accepted only from the user's own bare JID.
  - MAM results are accepted only from the user's own account or a bare room JID on the MUC domain.
  - A message's own `<delay>` counts only when its `from` is the server domain.
- **Check for step 5 (by the lead).** The server's AI gateway builds its core with `createXmppCore` (`apps/server/src/agents/gateway.ts:3,70`), so it gets the same presence rosters. No client or the gateway decodes MUC/Sub events. ejabberd never adds `item jid` to live messages, so live senders were already resolved from the roster, and only the forged path is removed.
- **Live check after the deploy.** @Deepseek still answers a mention in "ai test › cards test", and group senders still show correctly.
- **Follow-ups:**
  - a DM `<delay from=domain>` can still be forged; this needs server-side stripping;
  - a live check that ejabberd's archive keeps one `<x>`, not two.
