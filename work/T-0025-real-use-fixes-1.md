---
id: T-0025
title: Real-use fixes 1 — list status stuck on "sending", live chat-list updates (group invites + roster pushes), big-emoji sender name
status: todo
milestone: M1
branch: task/T-0025-real-use-fixes-1
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0024]
estimate: 1 day
---

# T-0025: Real-use fixes, round 1

## Spec (written by Claude, do not edit)

### Goal
Fix what Julio hit on his **first real use** of Galena (see the Review of `work/T-0024-web-real-data.md`):
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
A script or integration test (gated by `GALENA_XMPP_INTEGRATION=1`) that:
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
