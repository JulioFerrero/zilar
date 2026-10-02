---
id: T-0025
title: Real-use fixes 1 — list status stuck on "sending", live chat-list updates (group invites + roster pushes), big-emoji sender name
status: merged
milestone: M1
branch: task/T-0025-real-use-fixes-1
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0024]
estimate: 1 day
---

# T-0025: Real-use fixes, round 1

## Spec (written by Claude, do not edit)

### Goal
Fix what Julio hit on his **first real use** of Zilar (see the Review of `work/T-0024-web-real-data.md`):
1. **The list status is stuck:** after sending, the message bubble shows ✓, but the chat-list row keeps the 🕐 "sending" icon.
2. **The chat list doesn't update live:**
   - when someone adds you to a group, it doesn't appear until you reload
   - the same goes for a new contact, when someone accepts your invite
3. **Polish** (from the T-0022 review): hide the sender name above a big-emoji message, as Telegram does.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0024-web-real-data.md`: the Review (the findings are these bugs)
- `apps/web/src/store/realStore.ts` and its tests
- `packages/xmpp-core/src/**`: events, the presence and message parsing
- `apps/server/src/groups/**`, `apps/server/src/contacts/**`, `apps/server/src/xmpp/admin-client.ts`
- ejabberd 26.07 docs: `mod_muc_admin` command **`send_direct_invitation`**, XEP-0249 (direct MUC invitations), and roster pushes (RFC 6121 §2.1.6, `iq type="set"` with `jabber:iq:roster` sent by the server)

### Allowed files
- `apps/web/**`
- `packages/xmpp-core/**` (additive API only)
- `apps/server/src/groups/**`, `apps/server/src/contacts/**`, `apps/server/src/xmpp/admin-client.ts` and their tests, plus `apps/server/src/test-support.ts`
- `pnpm-lock.yaml`

**The dev stack is already running** (Julio is using it). You may run integration tests **against the running stack** at `127.0.0.1`. **Never** run `pnpm infra:up`, `infra:down` or `infra:reset`, and never stop any running process. Copy `infra/.env` if you need it (the lead has placed one in your worktree).

### What to build
1. **The list status fix (web):**
   - When a message's status changes (`sending` → `sent` → `read`, including through `displayed` markers), update the chat summary's `lastMessage` too, when it's the same message (match by id or by the optimistic temp id → server id).
   - Tests:
     - after an optimistic send, when the echo arrives, the list row's status becomes `sent`
     - a displayed marker makes it `read`
     - the bubble and the list always agree
2. **Group invites (server → XMPP):**
   - When members are added to a group (on create and through `POST /api/groups/:id/members`), after setting affiliations, send a **XEP-0249 direct invitation** from the room to each new member through the admin API (`send_direct_invitation`: check the exact argument names in the 26.07 docs).
   - Best effort: a failure is logged as a warning, and it must never fail the request.
   - Admin client method plus unit tests with a fake `fetch`. Service tests: the invites are sent to exactly the new members, never to the creator.
3. **`xmpp-core` events (additive):**
   - `on('invited', cb: (e: { roomJid, fromJid?, reason? }) => void)`: parse `<message><x xmlns='jabber:x:conference' jid='…'/></message>`. Accept only when the room JID is on `rooms.<domain>` and the sender is on our domains. Ignore otherwise.
   - `on('roster', cb: (e: { jid, subscription, name? }) => void)`: handle **roster pushes** (`<iq type='set'><query xmlns='jabber:iq:roster'>`) only when they come from our own server (no `from`, or `from` equal to our bare JID or domain):
     - **reply with an empty `iq type='result'`** (required by RFC 6121)
     - emit the event
     - reject pushes from anyone else with an `iq` error
   - Unit tests for both, including spoofed senders.
4. **Live refresh (web store):**
   - On `invited` or `roster`, refetch `/api/chats` (debounced about 500 ms), join any new group rooms, load their last message, and show the new chat at the top of the list.
   - Tests with a fake `XmppCore` emitting both events.
5. **Big emoji (web):** don't render the sender name above big-emoji messages in groups. Only the avatar.

### Integration check (you run it against the running stack)
A script or integration test (gated by `ZILAR_XMPP_INTEGRATION=1`) that:
- creates a user and a group through the server's service functions or the admin client
- confirms a connected client receives `invited` when added to a group
- confirms a connected client receives `roster` when a contact is added

Paste the output in the Report.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass.
- [ ] Every test above exists and passes. The integration check output is in the Report.
- [ ] Only allowed files touched. The running stack was never stopped or reset.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## Report (written by the worker when done)

### What I did

**1. List status fix (web).**
`apps/web/src/store/realStore.ts` now keeps an alias map between an optimistic local id and its server id, and a single `updateMessageStatus` helper updates both the open conversation and the chat-list `lastMessage` when the ids refer to the same message. Statuses are monotonic (`sending → sent → read`), so a late echo or a late send confirmation never downgrades a message the peer already read. The `.then` after `sendMessage` now links the returned id and advances the status (previously only the bubble changed, which is the reported bug), and `handleDisplayed` goes through the same helper.

**2. Group invites (server → XMPP).**
`apps/server/src/xmpp/admin-client.ts` got `sendDirectInvitation(roomId, users, options?)` (`send_direct_invitation`, args `room`, `service`, `password`, `reason`, `users`; omitted password/reason become `none`, per the 26.07 docs). `apps/server/src/groups/service.ts` sends a XEP-0249 invitation to exactly the new members after the affiliations are set, on **create** and on `POST /api/groups/:id/members` (only `toAdd`), never the creator/actor. It is best effort: a failure is logged and never fails the request.

**3. `xmpp-core` events (additive).**
- `on('invited', …)`: `parseDirectInvitation` accepts a `<message><x xmlns='jabber:x:conference' jid='…'/></message>` only when the room is on `rooms.<domain>` and the sender is on our domain or the MUC domain; otherwise it is ignored.
- `on('roster', …)`: `parseRosterPush` handles `<iq type='set'><query xmlns='jabber:iq:roster'>` only from our own server (no `from`, our bare JID or our domain); it replies with an empty `iq type='result'` and emits one event per item. A push from anyone else gets an `iq type='error'` (`forbidden`) and emits nothing.
- `InvitedEvent`, `RosterEvent`, `RosterSubscription` exported from the package index; `buildRosterResult` / `buildRosterError` added to `stanza.ts`.

**4. Live refresh (web store).**
`on('invited')` and `on('roster')` schedule a debounced (500 ms) `/api/chats` refetch that keeps existing previews/unread/presence, puts new chats at the top, joins new group rooms and loads their last message. The timer is cleared on `stop()`.

**5. Big emoji (web).** `MessageBubble` computes `bigEmoji` before `showSender` and hides the sender name above a big-emoji group message; the avatar still renders.

**Integration check:** `packages/xmpp-core/src/integration-invites.test.ts` (gated by `ZILAR_XMPP_INTEGRATION=1`) creates two users and a room with the admin client, connects one client, pushes a roster item and sends a direct invitation, and asserts both events arrive. Output is pasted below; it was run against the already-running dev stack, which was not stopped or reset.

### Files changed

- **web:** `src/store/realStore.ts`, `src/store/realStore.test.ts`, `src/components/MessageBubble.tsx`, `src/components/MessageContent.test.tsx`.
- **server:** `src/xmpp/admin-client.ts`, `src/xmpp/admin-client.test.ts`, `src/groups/service.ts`, `src/groups/routes.ts`, `src/groups/groups.test.ts`, `src/test-support.ts`.
- **xmpp-core:** `src/namespaces.ts`, `src/types.ts`, `src/stanza.ts`, `src/client.ts`, `src/index.ts`, `src/events.test.ts` (new), `src/core.test.ts`, `src/integration-invites.test.ts` (new), `tsconfig.json` (exclude the new integration file from the main typecheck, like the two existing ones).
- `work/T-0025-real-use-fixes-1.md` (status + this Report). No other file was touched.

### Commands run and real results

- `pnpm install`: PASS — "Done in 7.9s" (lockfile up to date).
- `pnpm format:check`: PASS — "All matched files use Prettier code style!" (after `pnpm format`).
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (233 files, 127 rules).
- `pnpm typecheck`: PASS — 8/8 tasks successful.
- `pnpm test`: PASS — 8/8 tasks successful. `@zilar/web` **71 passed** (17 files); `@zilar/xmpp-core` **114 passed, 3 skipped** (the three live-integration files); `@zilar/server` **155 passed** (16 files). New tests: xmpp-core `events.test.ts` 12 + `core.test.ts` 4 + 1 gated integration; server admin-client +3, groups +3; web realStore +7, MessageContent +2.
- `pnpm build`: PASS — 2/2 tasks successful (web `dist/assets/index-*.js` 565.92 kB).
- `ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test integration-invites`: PASS — 1/1 (1.1 s) against the running stack:
  ```
  PASS  the invited client connects
  PASS  roster push received (jid=inv-alice-…@zilar.localhost, subscription=both, name=Alice)
  PASS  direct invitation received (roomJid=inv-…@rooms.zilar.localhost,
        fromJid=inv-…@rooms.zilar.localhost, reason=Join the room)
  Test Files  1 passed (1)   Tests  1 passed (1)
  ```

### Problems, deviations from the spec, open questions

- **The warning logger is a `console.warn` fallback.** `app.ts` builds `createGroupsRoutes` without a logger and is **not** in this task's Allowed files, so I made `GroupsRoutesDependencies.logger` optional (`InviteLogger`) and defaulted it to `console.warn`. The failure path is tested (a spy on `console.warn`). If you want the real pino logger, `app.ts` needs one line (`createGroupsRoutes({ …, logger })`); tell me and I'll do it in a follow-up.
- **`sendDirectInvitation` is optional on `EjabberdAdminClient`.** The interface change broke the schema-generation noop stub in `apps/server/src/auth/cli-config.ts`, which is outside Allowed files. To keep "Only allowed files touched" true I marked the interface member optional and added `FullEjabberdAdminClient = Required<EjabberdAdminClient>` as the concrete factory return type, so every real caller sees it as required. If you prefer the method required, `cli-config.ts` needs one noop line.
- **Integration scope.** The integration test creates the users/room and sends the invite through the admin client (which the spec allows), so it verifies the ejabberd wire format and the client's parsing/replies end to end. The automatic "add member → invite" wiring is covered by the server unit tests, not by a live server-service run.
- **Observed invitation sender.** ejabberd sends the XEP-0249 message with `from` = the room bare JID on the MUC domain, so `invited.fromJid` is the room (accepted because the sender may be on the MUC domain). Contacts' presence still only resolves real bare JIDs on the user domain.
- No new dependencies. No secrets logged. The dev stack was never stopped or reset.

### Blocked / needs a decision

- Nothing blocked. Two optional follow-ups are listed above (wire the pino logger in `app.ts`, or make the admin-client method required and add the noop line in `cli-config.ts`).

### Round 2 (findings 1-3)

**Finding 1 — my own typing/displayed is ignored in groups.**
- `handleTyping` and `handleDisplayed` now drop events whose `fromJid` is my own bare JID (`me.jid`). The MUC's chat-state reflection no longer shows "me typing", and my own displayed marker no longer marks a message read (only a peer's marker does).
- Tests: own typing reflected from a group is ignored while a peer's still shows; own displayed marker leaves the message `sent` while a peer's marker makes it `read`.

**Finding 2 — sender names never fall back to a JID localpart.**
- `senderNameFor` now resolves in the order from the review: "You" → contact name → `fromNick` → group member name (`GET /api/groups/:id`, cached per chat) → room occupant nick (matched by `realJid`, or by occupant JID for an unresolved sender) → DM title → **"Someone"**. The `message.fromJid.split('@')[0]` fallback is gone, so a raw localpart can no longer be rendered.
- Added `getGroup(groupId)` to `lib/api.ts` and the `ApiClient` seam. Group ids are remembered from `/api/chats`; members are loaded once per chat when a group is joined (boot), opened, created, or seen for the first time through a refresh or a typing event.
- Tests: a group member who is not a contact types and the name shows ("Luis"); an unknown group sender shows "Someone"; a sender with no member row but a room occupant shows the occupant nick ("Pablo").

**Finding 3 — cleanup.**
- `sendDirectInvitation` is now a required method on `EjabberdAdminClient`; `FullEjabberdAdminClient` and the `?.` call are removed; the noop `sendDirectInvitation` was added to `apps/server/src/auth/cli-config.ts`.
- `createGroupsRoutes` takes a required `logger: InviteLogger`; `app.ts` passes the real pino `logger`; the groups service inputs require a logger; the `console.warn` fallback is gone. The "invitation cannot be sent" test now asserts the captured pino output instead of spying on `console.warn`.

**Files changed (round 2).**
- web: `src/store/realStore.ts`, `src/store/realStore.test.ts`, `src/lib/api.ts`.
- server: `src/app.ts`, `src/auth/cli-config.ts`, `src/xmpp/admin-client.ts`, `src/groups/routes.ts`, `src/groups/service.ts`, `src/groups/groups.test.ts`.
- `work/T-0025-real-use-fixes-1.md` (this Round 2 note). No other file was touched.

**Commands run and real results (round 2).**
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (233 files, 127 rules).
- `pnpm typecheck`: PASS — 8/8 tasks successful.
- `pnpm test`: PASS — 8/8 tasks successful. `@zilar/web` **76 passed** (17 files; `realStore` 22), `@zilar/xmpp-core` **114 passed, 3 skipped**, `@zilar/server` **155 passed**.
- `pnpm build`: PASS — 2/2 tasks successful.
- `ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test integration-invites`: PASS — 1/1 against the still-running stack:
  ```
  PASS  the invited client connects
  PASS  roster push received (jid=inv-alice-…@zilar.localhost, subscription=both, name=Alice)
  PASS  direct invitation received (roomJid=inv-…@rooms.zilar.localhost,
        fromJid=inv-…@rooms.zilar.localhost, reason=Join the room)
  Test Files  1 passed (1)   Tests  1 passed (1)
  ```

**Problems, deviations, open questions (round 2).**
- Group members are matched to a sender by the JID localpart, which the provisioning layer defines as the user id lowercased (`localpartFor`). It is used only as a cache key and never displayed; an id that needs the hashed localpart falls through to the occupant nick or "Someone".
- The occupant lookup is the fallback for a member missing from the cached list or for an unresolved sender JID.
- `nick(me)` still falls back to the localpart only when a user has an empty display name; the sign-up flow enforces a name, so this is not expected in practice.
- No new dependencies. The dev stack was not stopped or reset.

### Round 3 (finding 1)

**The own-typing/own-displayed filter now works when the sender is unresolved.**
- `TypingEvent` and `DisplayedEvent` gained an `outgoing: boolean` field (additive). `parseTyping` and `parseDisplayed` set it from `sender.outgoing`, so a reflection that `resolveSender` leaves as the full room JID (`room@rooms.domain/nick`, `resolved: false`) is still marked outgoing.
- The store drops `typing` and `displayed` when `event.outgoing === true` **or** `isOwnSender(event.fromJid)`, with a comment explaining why an own chat state or marker can arrive at all (the MUC reflects it). The JID check stays as the DM belt-and-braces path.
- Tests:
  - xmpp-core `core.test.ts`: an unresolved reflection from our own nick (`room@rooms.domain/bob` after joining as `bob`) comes out of both parsers with `outgoing: true`.
  - web `realStore.test.ts`: a fake core emitting `{ fromJid: 'team@rooms.zilar.test/mynick', outgoing: true }` is ignored for typing (no typing state) and for displayed (the message stays `sent`).
- Existing `stanza.test.ts` DM assertions gained the new `outgoing: false` field.

**Files changed (round 3).**
- xmpp-core: `src/types.ts`, `src/stanza.ts`, `src/stanza.test.ts`, `src/core.test.ts`.
- web: `src/store/realStore.ts`, `src/store/realStore.test.ts`.
- `work/T-0025-real-use-fixes-1.md` (this Round 3 note). No other file was touched.

**Commands run and real results (round 3).**
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (233 files, 127 rules).
- `pnpm typecheck`: PASS — 8/8 tasks successful.
- `pnpm test --force`: PASS — 8/8 tasks. `@zilar/xmpp-core` **115 passed, 3 skipped**; `@zilar/web` **78 passed**; `@zilar/server` **155**; protocol 132, chat-core 50, mobile 48, agent-drivers 19, devtools 9.
- `pnpm build`: PASS — 2/2 tasks successful.
- `ZILAR_XMPP_INTEGRATION=1 … vitest run src/integration.test.ts src/integration-invites.test.ts`: PASS — 2/2 against the running stack, including "typing and displayed markers arrive" and the invite/roster events.

**Problems, deviations, open questions (round 3).**
- None. `outgoing` is additive on both events; the event types are only produced by `xmpp-core` and consumed by the store.
- No new dependencies. The dev stack was not stopped or reset.

---

## Review (written by Claude)

**Verdict:** Round 3: **approved**. Merging.

### What the lead verified in round 3
- **Uncached** run of every check in the worktree. My first attempt was worthless:
  turbo replayed the worker's own cache and finished in seconds, so I re-ran with
  `--force`. Real timings: `test` 53 s, `build` 32 s, `typecheck` 6 s,
  `format:check` 2 s, `lint` exit 0. All PASS. The test counts moved exactly with
  the new code (web 76 -> 78, xmpp-core 114 -> 115), which is the proof the new
  tests actually executed rather than being cached.
  Final counts: web 78, xmpp-core 115 passed / 3 skipped, server 155, protocol
  132, mobile 48, chat-core 50, agent-drivers 19, devtools 9.
- **Live against the running stack:** `integration.test.ts` and
  `integration-invites.test.ts` re-run by the lead with
  `ZILAR_XMPP_INTEGRATION=1`: **2/2 passed** (messages, payloads, typing,
  displayed, reconnect with a fresh token, MAM, XEP-0249 invitations and roster
  pushes), without stopping or resetting anything.
- **Protocol-truth probe.** I wrote a throwaway probe (never committed, deleted
  after) that connected one real client to a real room and asked the server what
  it reflects back for my own chat state. The result is worth recording, because
  it partly corrects the reasoning in the round-3 review:

  ```
  typing:    fromJid = <me>@zilar.localhost   outgoing = true   (resolved)
  displayed: fromJid = <me>@zilar.localhost   outgoing = true   (resolved)
  ```

  So against ejabberd 26.07 the reflection of my own state **is** resolved to my
  bare JID, and the round-2 `isOwnSender` check would usually have caught it. The
  round-3 `outgoing` flag is therefore hardening, not the thing that rescues the
  common path. It still matters, for two concrete reasons:
  1. `Me.jid` is `z.string().nullable().optional()` in `apps/web/src/lib/api.ts`,
     and the store initialises `me: undefined` until `GET /api/me` resolves. While
     it is null or missing, `isOwnSender` returns false and the bug is back.
     `outgoing` comes from the sender resolution and does not depend on it.
  2. The unresolved branch of `resolveSender()` is reachable whenever our own
     occupant is not yet in the roster, and there the JID check can never match.

  The fix is deterministic in both cases, and it is the right place to fix it.
- Scope: every path in `git diff main...HEAD` is inside the Allowed files. No new
  dependencies, no `any`, no `@ts-ignore`, no `console.*` in the code. The
  worktree is clean and nothing untracked is being merged.

### Findings
- None outstanding. Findings 1, 2 and 3 from round 1, and finding 1 from round 3,
  are all resolved and verified.

### What the lead verified in round 2
- Re-ran every check in the worktree myself, without trusting the Report:
  `format:check`, `lint`, `typecheck`, `test` and `build` **all PASS**. The test
  counts match your Report exactly: `@zilar/web` 76, `@zilar/xmpp-core` 114
  passed / 3 skipped, `@zilar/server` 155, plus protocol 132, mobile 48,
  chat-core 50, agent-drivers 19 and devtools 9.
- Scope: every path in `git diff main...HEAD` is inside the Allowed files,
  including the two added to the allow-list in round 1.
- No new dependencies (`pnpm-lock.yaml` and every `package.json` untouched), no
  `any`, no `@ts-ignore`, no `console.*` left in the code.
- Finding 1 (own typing/displayed), finding 2 (the name ladder ending at
  "Someone", with the JID-localpart fallback deleted) and finding 3 (required
  `sendDirectInvitation` and the real pino logger, `console.warn` gone) are
  genuinely done, and the new tests assert behaviour through the store rather
  than the mock's internals. All accepted.

### Findings
1. **The own-typing filter silently no-ops when the sender is not resolved**
   (`packages/xmpp-core/src/stanza.ts`, `apps/web/src/store/realStore.ts`).
   `isOwnSender()` compares `fromJid` to `me.jid` exactly. But the last branch
   of `resolveSender()` for a `groupchat` returns `jid: input.from` when the
   sender cannot be resolved to a real JID, that is, the **full room JID**
   `team@rooms.zilar.test/mynick`, with `resolved: false` and
   `outgoing: true` (the nick matches `myNick`).

   That `outgoing` is computed correctly and then thrown away: `parseTyping`
   and `parseDisplayed` copy only `sender.jid` into the event, and neither
   `TypingEvent` nor `DisplayedEvent` has an `outgoing` field. The store then
   compares `team@rooms.zilar.test/mynick` with `me@zilar.test`, gets
   `false`, and shows me typing to me: finding 1 still reproducing whenever
   occupant resolution misses, such as a reflection arriving before our own
   occupant is in the roster.

   Your test only covers the resolved case (`fromJid: 'me@zilar.test'`), which
   is why it passes. Fix it at the source instead of guessing in the store:
   - Add `outgoing: boolean` to `TypingEvent` and `DisplayedEvent`, set from
     `sender.outgoing` in `parseTyping` and `parseDisplayed`. This is additive,
     so it stays inside the Allowed files.
   - In the store, drop `typing` and `displayed` when `outgoing === true`
     **or** `isOwnSender(fromJid)`. Keep the JID check as a belt-and-braces
     path for DMs.
   - Tests: a fake core emitting
     `{ fromJid: 'team@rooms.zilar.test/mynick', outgoing: true }` must still
     be ignored for both events, and an xmpp-core unit test that an unresolved
     reflection from our own nick comes out with `outgoing: true`.

   While you are there, a short comment on why an own chat state or marker can
   arrive at all (the MUC reflects them) will stop the next reader from
   "simplifying" the check away.

2. *(No change needed.)* The `nick(me)` localpart fallback and using the
   localpart as a cache key in `userLocalpartOf` are both fine: sign-up
   requires a display name and the localpart is never rendered. Putting the
   occupant fallback before "Someone" is the right order.

### Follow-ups
- None new. The pre-existing board follow-ups stand.

After round 3, the lead will live-test against the running stack with the test
accounts (own typing in a group, an unknown group sender, a group invite
appearing live) before merging.

<details><summary>Earlier rounds</summary>

**Round 1: changes requested**

Verified by the lead: every check passes (web 71, xmpp-core 114 + 3 skipped, server 155 tests). The diff is within the Allowed files. The code is good:
- the alias map with monotonic statuses is the right fix for the stuck list status
- the roster-push spoof handling and the RFC 6121 result are correct
- the invite parsing only triggers a server-authoritative `/api/chats` refetch, never a direct join, so a hostile invitation can't pull the client into a room

Round 2 adds **two bugs Julio hit live** while this task was running, plus the cleanup you offered.

### Findings
1. **Your own typing is shown to you in groups** (Julio, live). The MUC reflects your chat states back to you, and `handleTyping` doesn't ignore them. Ignore `typing` **and** `displayed` events whose `fromJid` is my own bare JID (`me.jid`). An own displayed marker, reflected in a group, must not mark someone else's message as read. Tests for both, with a fake core emitting events from `me.jid`.
2. **Names fall back to the raw JID localpart** (Julio, live: typing showed "a string of numbers and letters"). `senderNameFor` only knows contacts and `fromNick`, and typing events carry no nick. Fix:
   - Resolve names in this order:
     1. "You" for yourself
     2. a contact's name
     3. the message's `fromNick`
     4. the group member's name from `GET /api/groups/:id` (load the members when a group chat is joined or opened, and cache them per chat)
     5. the xmpp-core occupant whose `realJid` matches (its nick)
     6. the DM title
     7. finally **"Someone"**
   - **Never show a JID localpart.** Use it in typing (list + header) and in sender names.
   - Tests: typing from a group member who is not a contact shows their name; an unknown sender shows "Someone".
3. **Cleanup (your open questions: yes to both).** `apps/server/src/app.ts` and `apps/server/src/auth/cli-config.ts` are now allowed, for these changes only:
   - Make `sendDirectInvitation` **required** on `EjabberdAdminClient` and add the noop to `cli-config.ts`. Remove `FullEjabberdAdminClient` and the `?.` call.
   - Pass the real pino `logger` to `createGroupsRoutes` in `app.ts`. Make the logger required in the groups routes and service inputs, and remove the `console.warn` fallback.

After round 2, the lead will live-test it against the running stack with the test accounts.

</details>

