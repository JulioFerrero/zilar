---
id: T-1161
title: "UI-3/4/5 in the core incoming path: my own message from another device clears that chat's unread; 'last seen' comes from the presence <delay/> stamp (or stays as it was) and survives the 60 s refresh; group typing tracks each sender with its own timer"
status: merged
milestone: M5
branch: task/T-1161-incoming-unread-lastseen-typing
model: auto
effort: default
depends_on: [T-1149]
estimate: 0.4 day
---

# T-1161: Unread, last seen and typing in the incoming path

## Spec (written by Claude, do not edit)

### Why
`docs/audit/features-ui-audit.md` UI-3 (P1), UI-4 (P1) and UI-5, and fixes **F3**, **F4** and **F5**.
- **UI-3:** the carbon of my own message from another device goes through `handleOutgoingEcho` (`packages/client-core/src/store/incoming.ts:40-98`). It moves the chat to the top and sets `lastMessage`, but never clears `unread`. So after I reply from my phone, the web keeps its badge. When `localId` (`:51`) is undefined, the message wasn't sent from this device.
- **UI-4:** `handlePresence` (`incoming.ts:243-255`) stamps `lastSeenAt: now()` on every unavailable presence. `parse-presence.ts` ignores any `<delay stamp>` (`packages/xmpp-core/src/stanza/parse-presence.ts`; the audit cites `:38-46`, so re-check it). The 60 s chat refresh drops `lastSeenAt`: web `apps/web/src/store/effects/history.ts:118-127`, mobile `apps/mobile/src/store/effects/history.ts:185-194`. So the header says "last seen just now" for someone away for days, then nothing, then "just now" again.
- **UI-5:** `handleTyping` (`incoming.ts:181-211`) stores one name per chat (`:199`, `names: [name]`) with one timer per chat. In a group, two typers show as one, and A's `paused` clears B's line. Consumers already read `typing[chatId].names` and call `typingLabel(chat, names)` (`apps/web/src/components/ChatListItem.tsx:40,56`, `apps/web/src/components/ChatHeader.tsx:41`, `apps/mobile/src/components/chat/chat-header.tsx:49-51`; the label is in `packages/chat-core/src/chat-labels.ts`).

### What to build
1. **UI-3:** in `handleOutgoingEcho`, when `localId === undefined` (a message from another of my devices), call `recordRead(ctx, chatId, ui.id)`. That clears unread and the notifications. **Send no displayed marker.**
2. **UI-4:**
   - parse an optional `<delay xmlns="urn:xmpp:delay" stamp="…"/>` on presence into the presence event (`delayedAt?: number`), in `parse-presence.ts` and the event type;
   - in `handlePresence`, on `available: false`, set `lastSeenAt` to `delayedAt` when present. Without it, set `now` only when the chat was `online: true` before (a real transition); otherwise keep the previous value;
   - keep `lastSeenAt` in both 60 s refresh merges (web and mobile `history.ts`).
3. **UI-5:** keep the public state shape `typing[chatId] = { names: string[] }`, so no UI changes. Internally, keep one clearing fiber per **(chat, sender)**, with the key built from the chat and the sender JID.
   - `composing` adds or keeps the sender's name; `paused` or `active` removes only that sender; the timer removes only that sender;
   - a peer's message (`handleMessage`, the T-1149 clear) removes **that sender** in groups, and the whole chat in DMs;
   - make sure `typingLabel` renders 2 or more names sensibly ("A and B are typing", "3 people are typing"). If it doesn't, adjust it in `chat-labels.ts`.
   - `incoming.ts` stays at most 400 lines; if needed, move the typing helpers to a new `packages/client-core/src/store/typing.ts`.
4. **Tests** (the message pipeline), in `packages/client-core/src/store/incoming.test.ts`, at most 3:
   - an echo with no local id clears the chat's unread;
   - in a group, A and B composing give two names, and A's `paused` leaves B;
   - an unavailable presence with a delay stamp sets `lastSeenAt` to the stamp.

### Read first
`AGENTS.md`, `docs/audit/features-ui-audit.md` (UI-3, UI-4, UI-5), `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/incoming.test.ts`, `packages/client-core/src/store/reads.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/chat-core/src/chat-labels.ts`, `apps/web/src/store/effects/history.ts:110-130` and `apps/mobile/src/store/effects/history.ts:180-196`.

### Allowed files
`packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/typing.ts`, `packages/client-core/src/store/incoming.test.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/chat-core/src/chat-labels.ts`, `apps/web/src/store/effects/history.ts`, `apps/mobile/src/store/effects/history.ts`, `work/T-1161-incoming-unread-lastseen-typing.md`.

`packages/xmpp-core/src/types.ts` is near 400 lines: put the new field on the existing presence event type, at most 2 lines. In `apps/mobile/src/store/effects/history.ts` (384 lines), add at most 3 lines.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web:**
  - a reply sent from the phone clears the web badge;
  - a DM header shows a stable "last seen" across a minute;
  - two people typing in a group show both names.

---

## Report (written by the worker when done)

Done. UI-3, UI-4 and UI-5 in the core incoming path.

What I did:
- UI-3: `handleOutgoingEcho` now calls `recordRead(ctx, chatId, ui.id)` when
  `localId === undefined` (carbon from another device). Sends no displayed
  marker. (`packages/client-core/src/store/incoming.ts`)
- UI-4: `parseContactPresence` reads the `<delay xmlns="urn:xmpp:delay"
  stamp="..."/>` of an unavailable presence into a new `delayedAt?: number`
  on `PresenceEvent` (`types.ts`, 2 lines); `handlePresence` sets `lastSeenAt`
  from the stamp when present, otherwise re-stamps `now()` only on a real
  online-to-offline transition and keeps the previous value; both 60 s refresh
  merges (web and mobile `history.ts`, 1 line each) keep `lastSeenAt`.
- UI-5: new `packages/client-core/src/store/typing.ts` (95 lines) keeps one
  name slot and one clearing fiber per (chat, sender JID); the public state
  shape `typing[chatId] = { names }` is unchanged, no UI edits. `composing`
  adds/refreshes that sender, `paused`/`active` removes only that sender, the
  timer drops only that sender; a peer's message removes that sender in groups
  and the whole chat in DMs. `typingLabel` in `chat-labels.ts` now renders two
  names ("A and B are typing") and 3+ ("3 people are typing").
- Tests: 3 new tests in `incoming.test.ts` (echo with no local id clears
  unread; group A+B composing then A's paused leaves B; unavailable presence
  with delay stamp sets `lastSeenAt` to the stamp). Updated 2 existing typing
  tests to the per-sender fiber keys; all 19 pass.

Files changed:
- `packages/client-core/src/store/incoming.ts` (259 lines, was 255)
- `packages/client-core/src/store/typing.ts` (new, 95 lines)
- `packages/client-core/src/store/incoming.test.ts` (+3 tests)
- `packages/xmpp-core/src/stanza/parse-presence.ts` (118 lines)
- `packages/xmpp-core/src/types.ts` (+2 lines on the presence event type)
- `packages/chat-core/src/chat-labels.ts` (78 lines)
- `apps/web/src/store/effects/history.ts` (+1 line)
- `apps/mobile/src/store/effects/history.ts` (+1 line, now 385)

Commands and real results:
- `pnpm install`: done, 12.8s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts`: 19 passed.
- Manual probe `parseContactPresence` with a delay stamp: `{jid, available:false, delayedAt:1789891200000}`; bad stamp dropped; available presence has no `delayedAt`.
- Manual probe `typingLabel`: "Ana is typing", "Ana and Ben are typing", "3 people are typing", DM "typing".
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, effect, tests
  chat-core/client-core/mobile/web/xmpp-core all PASS; "scope: every changed
  file is inside the Allowed files".

Problems / deviations:
- `incoming.ts` keeps re-exporting `TYPING_CLEAR_MS` (now defined in
  `typing.ts`) so the apps' `export { TYPING_CLEAR_MS } from
  '@zilar/client-core/store'` keeps resolving; the spec's "internally one
  fiber per (chat, sender)" is kept, with keys `typing:<chat>:<senderJid>`.
  The mobile `events.ts` keeps its own `typing:<chat>` key only inside
  `clearTimers`, which runs from `stop()` after `closeStore()` already
  interrupts the store scope; per-sender fibers die with the scope, so no
  change was needed there (and `events.ts` is outside Allowed files).
- DM typing entry `{ names: ['Ana'] }` is unchanged, and the "paused clears
  the DM line when that peer messages" behaviour is preserved via
  `clearChatTyping`.
- Did not touch `packages/xmpp-core/src/core-effect/presence.ts`: the delay
  parse lives in `parseContactPresence`, which it already calls, so the stamp
  flows through with no edit.

Open questions: none.

Security checklist: no secrets/tokens in logs or code; no deletes/updates
outside per-chat scopes; no new routes, caps or audit entries; no permission
changes (all three fixes reuse the existing incoming-path handlers).

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits and 2 follow-ups.**
- **UI-3:** an echo with no local id (my other device) calls `recordRead`, with no displayed marker.
- **UI-4:** presence parses `<delay stamp>` into `delayedAt`. Unavailable uses it, or sets `now` only on a real transition, and both 60 s merges keep `lastSeenAt`.
- **UI-5:** per-sender typing slots and fibers in the new `typing.ts`, with the `names` shape unchanged. A peer message clears that sender in groups and the whole chat in DMs. `typingLabel` handles 2 or more names.
- **Tests:** 19 of 19 in the branch, run by the lead.
- **Sizes:** `types.ts` is 390, mobile `history.ts` 385.
- **Follow-ups:**
  - per-sender typing slots survive store reset/stop;
  - mobile `events.ts` `clearTimers` still uses the old `typing:<chat>` keys, with a stale comment;
  - assert no displayed marker in the echo test;
  - a `parse-presence` delay unit test.
