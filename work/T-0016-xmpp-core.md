---
id: T-0016
title: "@galena/xmpp-core — shared XMPP client (token login, rooms, DMs, history, receipts, payloads)"
status: review
milestone: M1
branch: task/T-0016-xmpp-core
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0003, T-0013]
estimate: 2 days
---

# T-0016: `@galena/xmpp-core`

## Spec (written by Claude, do not edit)

### Goal
Build the **one** XMPP client library that both the web app and the mobile app use to chat. It hides XMPP behind a small, typed, event-based API:
- connect with a short-lived JWT from our server, and **fetch a fresh token on every reconnect**
- join group rooms, send and receive messages in rooms and DMs
- load history (MAM)
- typing indicators and read markers
- Galena's structured payloads (`@galena/protocol`), in both directions

It must run in **browsers** (the web app) and **React Native** (the mobile app), so no Node-only APIs.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`: §6 (the chat layer, especially §6.1 XEPs, §6.2 identity, §6.3 our extension and encoding)
- `work/T-0003-xmpp-accounts-rooms.md`: the whole file, especially how login works: SASL PLAIN with a JWT as the password, JIDs `<localpart>@galena.localhost`, rooms `<id>@rooms.galena.localhost`, members-only and persistent, MAM on
- `packages/devtools/src/xmpp-e2e.ts` and `packages/devtools/src/xmpp-client.d.ts`: working `@xmpp/client` usage and ambient types. Reuse and improve them.
- `packages/protocol/src/payload.ts` (`encodePayload`, `decodePayload`)
- `@xmpp/client` docs (credentials function, reconnect, stream management), and `@xmpp/test` (mock client for unit tests)

### Allowed files
- `packages/xmpp-core/**` (new package `@galena/xmpp-core`)
- `pnpm-lock.yaml`

**Not allowed:** everything else. Other workers are editing the apps and the server.

**Docker:** you **may** use the dev stack for the integration test (`pnpm infra:up` / `infra:down`). You're the only worker using it right now. Don't run `infra:reset`.

### Allowed dependencies
- `@xmpp/client`, `@xmpp/xml` (if needed separately)
- Dev: `@xmpp/test`
- The integration test may import `apps/server/src/xmpp/*` by relative path, as the devtools e2e does.

### Public API (implement exactly this surface; add types as needed)
```ts
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface XmppCoreOptions {
  service: string;                                   // e.g. ws://127.0.0.1:5280/ws
  domain: string;                                    // e.g. galena.localhost
  getToken: () => Promise<{ jid: string; token: string }>; // called for EVERY (re)connect
}

export interface ChatMessage {
  id: string;              // archive stanza-id when known (XEP-0359), else the message id
  chatJid: string;         // bare JID of the room or of the DM peer
  kind: 'groupchat' | 'chat';
  fromJid: string;         // real bare JID of the sender (rooms are non-anonymous) or occupant JID if unknown
  fromNick?: string;       // MUC nickname
  body?: string;
  payload?: Payload;       // decoded with decodePayload; invalid payloads are dropped (body kept)
  replyTo?: { id: string; to?: string };            // XEP-0461
  timestamp: Date;         // from <delay/> or archive, else receive time
  outgoing: boolean;       // sent by me (incl. carbons / reflections)
}

export interface XmppCore {
  status(): ConnectionStatus;
  me(): string | undefined;                          // my bare JID once online
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  joinRoom(roomJid: string, nick: string): Promise<void>;           // history via MAM, not MUC history (maxstanzas=0)
  leaveRoom(roomJid: string): Promise<void>;
  sendMessage(to: string, kind: 'groupchat' | 'chat', text: string,
              opts?: { payload?: Payload; replyTo?: { id: string; to?: string } }): Promise<{ id: string }>;
  loadHistory(chatJid: string, kind: 'groupchat' | 'chat',
              opts?: { before?: string; max?: number }): Promise<{ messages: ChatMessage[]; complete: boolean; first?: string }>;
  sendTyping(to: string, kind: 'groupchat' | 'chat', state: 'composing' | 'paused'): void;   // XEP-0085
  markDisplayed(chatJid: string, kind: 'groupchat' | 'chat', messageId: string): void;         // XEP-0333
  on(event: 'status', cb: (s: ConnectionStatus) => void): () => void;
  on(event: 'message', cb: (m: ChatMessage) => void): () => void;
  on(event: 'typing', cb: (e: { chatJid: string; fromJid: string; state: 'composing' | 'paused' | 'active' }) => void): () => void;
  on(event: 'displayed', cb: (e: { chatJid: string; fromJid: string; messageId: string }) => void): () => void;
  on(event: 'error', cb: (e: { message: string }) => void): () => void;
}
export function createXmppCore(opts: XmppCoreOptions): XmppCore;
```

### Requirements
- **Token login:**
  - Use `@xmpp/client`'s **credentials function**, so each (re)connect calls `getToken()` again. JWTs expire after ≤ 10 minutes.
  - **Never log the token.**
  - After a failed login, the status goes back to `offline` with an `error` event. Don't loop forever on bad credentials.
- **After login:**
  - send initial presence
  - enable **carbons** (XEP-0280)
  - rely on stream management (XEP-0198), which xmpp.js enables automatically
  - rejoin joined rooms after a reconnect
- **Payloads:**
  - Outgoing payloads go into `<agent xmlns="urn:galena:agent:0">` as the JSON text from `encodePayload`.
  - Incoming ones go through `decodePayload` (**never throws**). An invalid payload is dropped, and the message still arrives with its body.
- **Robustness against hostile input:**
  - Ignore stanzas from other domains than `domain` / `rooms.<domain>`.
  - Cap `body` at 64 KiB.
  - Never crash on malformed stanzas. Unit-test at least 5 malformed cases.
- **History:**
  - MAM (`urn:xmpp:mam:2`) with RSM paging (`before`, `max`, default 50).
  - For rooms, the query goes to the room JID. For DMs, to your own archive with `with=<peer>`.
  - Return messages oldest first.
- **Identity:** rooms are **non-anonymous** (`anonymous: false` in the ejabberd room defaults, set by Claude).
  - Take the real sender JID from the MUC `<x xmlns='http://jabber.org/protocol/muc#user'><item jid=…/>` when present.
  - Mark `outgoing` when the sender's bare JID equals `me()`, including room reflections of your own messages and carbons.
- **No Node-only APIs** (no `Buffer` from `node:`, no `fs`). The package must typecheck with `lib: ["ES2023", "DOM"]` and **no** `node` types. That's a signal it'll work in browsers and React Native.
- **Types for `@xmpp/client`:** move and extend the ambient declarations from devtools into this package, `src/types/xmpp.d.ts`. No `any`.

### Tests
- **Unit tests (Vitest)** with `@xmpp/test` or a small fake:
  - the credentials function is called again on reconnect, and its result is used
  - an outgoing message XML has the right `type`, `id`, body, the payload element and the reply element
  - incoming parsing, for:
    - a groupchat with a real JID
    - a DM
    - a carbon (sent and received)
    - a delayed message
    - an archived result (MAM `<result>` forwarding)
    - a payload that's valid, invalid, oversized, or missing
    - a reply
    - typing states
    - displayed markers
  - the domain filter
  - at least **5 malformed stanzas** that must not throw
- **Integration test** `src/integration.test.ts`:
  - It's skipped unless `GALENA_XMPP_INTEGRATION=1`.
  - Against the dev stack, using the server's admin client and `issueXmppToken`, it:
    - creates 2 users and a room
    - connects both through `createXmppCore`
    - joins, sends text and a payload message (e.g. a `progress` payload) and receives both
    - sends typing and displayed markers
    - disconnects and reconnects one client (a fresh token is fetched: assert `getToken` was called twice)
    - loads room history (all messages, oldest first) and DM history
  - Run it with the dev stack up and paste the output in the Report.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo (the integration test is skipped by default).
- [ ] `GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test` passes against the dev stack. Output in the Report.
- [ ] The package typechecks without Node types.
- [ ] Only allowed files touched. No token in any log.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:up && GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test; pnpm infra:down
```

### Out of scope
- UI, React hooks (a later task), push notifications, file uploads, message edits and deletes, reactions.
- Server endpoints (the XMPP token endpoint is T-0017).

---

## Report (written by the worker when done)

### What I did

- **`packages/xmpp-core` (new package `@galena/xmpp-core`)** — the one shared XMPP client both apps use. Public surface is exactly the one in the spec (`createXmppCore`, `ConnectionStatus`, `XmppCoreOptions`, `ChatMessage`, `XmppCore`); extra supporting types are exported too.
  - `src/index.ts` — `createXmppCore(options)`.
  - `src/client.ts` — the implementation: status machine, credentials function, rejoin/carbons/presence on login, stanza routing, join/leave, send, history, typing and displayed markers.
  - `src/stanza.ts` — build and parse XMPP stanzas (messages, payload, reply, typing, displayed, MUC presence, carbons); `src/mam.ts` — MAM query builder, RSM `<fin>` parsing and page ordering; `src/jid.ts`, `src/text.ts` — JID helpers and the 64 KiB body cap; `src/namespaces.ts` — the namespaces. `src/types.ts` — public types; `src/types/xmpp.d.ts` — ambient types for `@xmpp/client` (moved from devtools and extended with `credentials`, `status`, `reconnect`, `listener` overloads; no `any`).
- **Token login** — the credentials provider calls `getToken()` on **every** authentication (so every reconnect gets a fresh JWT) and passes `{ username: localpart, password: token }` with `PLAIN`. A `getToken` failure or a SASL failure emits an `error` event, sets status `offline` and calls `stop()` so it does **not** loop forever. Error messages are checked for the last token and redacted (`[redacted]`); the token is never logged.
- **After login** — initial `<presence/>`, carbons enabled (XEP-0280), and every room in the joined set is rejoined (rooms are kept so a reconnect rejoins them). Stream management is left to `@xmpp/client`.
- **Messages** — payloads go into `<agent xmlns="urn:galena:agent:0">` as the `encodePayload` JSON; incoming ones go through `decodePayload` (never throws) and an invalid payload is dropped while the body is kept. `replyTo` from XEP-0461, typing from XEP-0085, displayed markers from XEP-0333. Body is capped at 64 KiB (truncated on a code point boundary). Events from domains other than `domain` / `rooms.<domain>` are ignored.
- **History** — MAM (`urn:xmpp:mam:2`) with RSM (`before`, `max`, default 50): rooms query the room JID, DMs query my own archive with `with=<peer>`. Messages come back oldest first (descending pages are reversed). `complete`/`first` come from the RSM `<fin>`.
- **Unit tests (Vitest, 62 tests)** with a small fake `@xmpp/client` (the spec allows a fake instead of `@xmpp/test`): credentials called again per connect with the result used; outgoing message XML; incoming groupchat/DM/carbons (sent+received)/delayed/MAM-archived/valid+invalid+oversized+missing payload/reply/typing/displayed; domain filter; body cap; and 7 malformed stanzas that must not throw. Plus core tests: status lifecycle, reconnect, SASL failure, token failure, rejoin, join/leave, send, markers, history (ordering/complete/first/error).
- **Integration test `src/integration.test.ts`** — skipped unless `GALENA_XMPP_INTEGRATION=1`; uses the server's admin client and `issueXmppToken` by relative path, like the devtools e2e.
- **`tsconfig.json`** uses `lib: ["ES2023", "DOM"]` and `types: []`, and excludes the integration test, so the library itself typechecks with no Node types (verified: `tsc --listFiles` lists 0 `@types/node` files). The integration test is checked by `tsconfig.integration.json` (`types: ["node"]`).

### Files changed

- New package `packages/xmpp-core/`: `package.json`, `tsconfig.json`, `tsconfig.integration.json`.
- New sources: `src/index.ts`, `src/client.ts`, `src/stanza.ts`, `src/mam.ts`, `src/jid.ts`, `src/text.ts`, `src/namespaces.ts`, `src/types.ts`, `src/types/xmpp.d.ts`.
- New tests: `src/stanza.test.ts`, `src/mam.test.ts`, `src/core.test.ts`, `src/integration.test.ts`.
- Modified: `pnpm-lock.yaml` (the new package; a transitive optional-peer entry for `ws` under react-native), and this task file (status + Report).
- **Runs from outside git (not committed):** a local `infra/.env` (git-ignored) needed for the dev stack. No secret is committed.

### Commands run and real results

- `pnpm install`: PASS. `pnpm install --frozen-lockfile`: PASS (lock up to date).
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors … 82 files with 127 rules".
- `pnpm typecheck`: PASS — turbo "7 successful, 7 total". `@galena/xmpp-core` runs `tsc --noEmit && tsc --noEmit -p tsconfig.integration.json`, both clean.
- `pnpm test`: PASS — turbo "7 successful, 7 total". `@galena/xmpp-core`: **62 passed, 1 skipped** (integration skipped by default). Per file: `stanza.test.ts` 35, `mam.test.ts` 10, `core.test.ts` 17.
- `pnpm build`: PASS — turbo "2 successful, 2 total" (web, mobile). `xmpp-core` exports TS source like `@galena/protocol`, so it has no build step.
- No-Node-types check: `tsc --noEmit --listFiles -p packages/xmpp-core/tsconfig.json` → 0 `@types/node` files, `lib.dom.d.ts` present, `integration.test.ts` not listed.
- `pnpm infra:up`: PASS after one environment fix (see below) — Postgres, ejabberd and LiteLLM all "Healthy". `pnpm infra:smoke`: PASS 5/5.
- `GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test`: PASS — 4 files, **63 passed**.
- `pnpm infra:down`: PASS — containers and network removed, volumes kept.

Integration output (room `core-mujzvc39ach8@rooms.galena.localhost`):

```
integration room: core-mujzvc39ach8@rooms.galena.localhost

PASS  both clients connect with a JWT
PASS  both clients join the members-only room
PASS  text and payload messages arrive live
PASS  typing and displayed markers arrive
PASS  a direct message arrives
PASS  reconnect fetches a fresh token (getToken called twice)
PASS  room history comes back oldest first (2 messages, complete=true)
PASS  DM history comes back (1 messages)
```

### Problems, deviations from the spec, open questions

1. **`@galena/protocol` is a new workspace dependency.** The spec's public API uses `Payload`, `encodePayload` and `decodePayload`, so the package needs it. It is a workspace package, not a new external dependency; the allowed-deps list only named the external XMPP packages.
2. **`@xmpp/test` is not used.** The spec allows "`@xmpp/test` or a small fake"; I wrote a small fake client (`core.test.ts`) and did not add the dependency, so there is no unused package.
3. **`XmppCoreOptions` has no MUC domain,** so the client derives `mucDomain = "rooms." + domain`, matching the T-0003 defaults. Say the word if it should be configurable.
4. **(finding) ejabberd 26.07 does not put the MUC `<x xmlns='…muc#user'><item jid=…/>` on groupchat messages.** I verified the raw stanza: a live room message contains only `<archived>`, `<stanza-id>` and `<occupant-id>`, no `item jid`. So `fromJid` falls back to the occupant JID for real rooms (the integration test asserts that). The "real sender JID from the item when present" path is implemented and unit-tested, and will be used when the item is present. Because plan §6.2 requires people to be identified by their **real** JID, a later task (chat-core) will have to build the room roster from presence to resolve occupants to real JIDs. Flagging it because the spec's identity note implies messages carry the real JID.
5. **`connect()` resolves on the first `online` and rejects on a fatal auth error or after a 15 s timeout;** transient failures keep the auto-reconnect running and move the status to `reconnecting`. The spec did not define these semantics.
6. **The 64 KiB cap truncates** an over-long body (on a code point boundary) rather than dropping the message.
7. **History ordering** reverses a page only when the server clearly returned the newest first (first timestamp > last); equal timestamps keep server order.
8. **`loadHistory` `first`** is the RSM `<first>` id of the page, meant to be passed back as `before`.
9. **Integration typechecking** lives in `tsconfig.integration.json` because the test must import the Node-only server module; the library tsconfig excludes it so "no Node types" stays honest.
10. **Dev-stack environment note (no code impact).** `infra/.env` was not present in this worktree, so I created the git-ignored file locally. Two containers (`ejabberd`, `litellm`) were running with a stale `.env`, so I recreated them once with `up -d --force-recreate` (no volumes removed, `infra:reset` not run); after that all three services were healthy and `pnpm infra:up` passed. Nothing about this is committed.

### Blocked / needs a decision

- Nothing blocked. The one thing worth a decision is finding 4: whether the client should also expose the room presence roster (so consumers can map occupant → real JID), or whether that belongs entirely to the later `chat-core` task.

### Round 2

Finding 1 (resolve real sender JIDs via the MUC occupant roster) is implemented.

**What I changed**

- `src/types.ts` — `ChatMessage` gains `fromResolved: boolean` and `occupantId?: string`; new `Occupant` and `OccupantsEvent` types; `XmppCore` gains `occupants(roomJid)` and `on('occupants', …)`.
- `src/stanza.ts` — `parseMucPresence` parses a MUC presence (join/leave, real JID, occupant-id, affiliation, role) and only accepts a stanza that comes from `rooms.<domain>` and carries a nick; `occupantIdOf`; `resolveSender` resolves in the spec's order (a JID on the message → the message's occupant-id → the nick against the roster → keep the occupant JID) and computes `outgoing` from the resolved real JID or from my own nick in the room; `ParseContext` gains `rosterFor`/`myNickFor`; typing and displayed `fromJid` use the same resolution.
- `src/client.ts` — per-room occupant rosters keyed by occupant JID (`room/nick`); `occupants(roomJid)`; an `occupants` event on every roster change; rosters are cleared when leaving a room, on disconnect/SASL failure, and before rejoining after a reconnect (so the server's fresh presence burst rebuilds them). Roster data is only trusted from rooms we joined and only from the MUC domain, so another sender cannot claim an identity.
- `src/index.ts` — exports `Occupant` and `OccupantsEvent`.

**What ejabberd returns for real JIDs (raw stanzas from the dev stack)**

- Presence for another occupant, sent by the room, carries both the occupant-id and the real full JID:
  `<presence from="<room>/alice"><occupant-id xmlns="urn:xmpp:occupant-id:0" id="…"/><x xmlns="…muc#user"><item jid="alice@galena.localhost/probe-a" role="moderator" affiliation="owner"/></x></presence>`
- A **live** groupchat message has **no** `muc#user` item: only `<archived>`, `<stanza-id>`, `<occupant-id>` and `<body>`. Live resolution therefore uses the occupant-id (or the nick).
- A **MAM-archived** groupchat message **does** include the real JID: `<x xmlns="…muc#user"><item jid="alice@galena.localhost/probe-a"/></x>`, plus `<stanza-id>`, `<occupant-id>` and a forwarded `<delay>`. So history resolves through the message's own JID (priority 1) and also carries an occupant-id.

**Tests**

- Unit — new `src/presence.test.ts` (18): presence parsing (join, leave, nick change, affiliation/role, occupant-id), ignoring non-room / wrong-domain / no-nick / non-join-leave presence, `occupantIdOf` namespace check, resolution via message JID, then occupant-id, then nick, then unresolved, `outgoing` by real JID or nick, and a DM sender treated as already resolved. `src/core.test.ts` +5: roster tracking + `occupants` event, live resolution through the roster, leave removes an occupant, spoofed presence from a non-room sender or an unjoined room is ignored, and the roster is dropped on disconnect and rebuilt after a reconnect.
- Integration — Bob's `occupants(roomJid)` lists alice and bob; Alice's **live** message has `fromJid === alice's bare JID` and `fromResolved: true`; the **archived** message has the same; the DM is resolved.

**Checks (all pass, integration against the dev stack)**

- `pnpm format:check` PASS; `pnpm lint` PASS (0 warnings, 0 errors, 83 files); `pnpm typecheck` PASS (7/7); `pnpm test` PASS (7/7; `@galena/xmpp-core` **85 passed + 1 skipped**); `pnpm build` PASS (2/2).
- No-Node-types: `tsc --noEmit --listFiles -p packages/xmpp-core/tsconfig.json` → 0 `@types/node` files, `integration.test.ts` not listed.
- `pnpm infra:up` all three services healthy; `GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test` → 5 files, **86 passed**; `pnpm infra:down` → containers and network removed, volumes kept.

Full integration output:

```
integration room: core-muk0d7lcoi0u@rooms.galena.localhost

PASS  both clients connect with a JWT
PASS  both clients join the members-only room (roster: alice, bob)
PASS  text and payload messages arrive live (fromJid=core-alice-muk0d7lcoi0u@galena.localhost, fromResolved=true, occupantId=g20AAAAgtomhkci5okSzUrDMS22ExnzYD/HlM4CTVfeU3BxVu/g=)
PASS  typing and displayed markers arrive
PASS  a direct message arrives
PASS  reconnect fetches a fresh token (getToken called twice)
      history sender: fromJid=core-alice-muk0d7lcoi0u@galena.localhost fromResolved=true fromNick=alice occupantId=g20AAAAgtomhkci5okSzUrDMS22ExnzYD/HlM4CTVfeU3BxVu/g=
PASS  room history comes back oldest first (2 messages, complete=true)
PASS  DM history comes back (1 messages)
```

**Notes**

- `Occupant.affiliation` and `role` are optional because a leave or an unusual presence may omit them; an available presence from ejabberd always carries both.
- `occupants()` lists who is **present now** (from presence), not the full member list; membership is affiliations, which this library does not query.
- The old round-1 note that "real JIDs need a later task" is resolved: this library now does the resolution.

---

## Review (written by Claude)

**Verdict (round 1): changes requested.** This is a strong library:
- the exact public API
- a fresh token per connect, with no loop on bad credentials
- a clean `lib: ES2023 + DOM` build with no Node types
- 62 unit tests, and 8/8 integration steps against the real server

Finding 4 is important for plan §6.2 ("people are identified by their real JID"), and the fix belongs **in this library**: resolving identity is protocol-level work, not UI work.

### Findings
1. **(must fix) Resolve real sender JIDs in rooms.**
   - Track each joined room's **occupants from MUC presence**. In non-anonymous rooms, ejabberd's presence carries `<x xmlns='http://jabber.org/protocol/muc#user'><item jid=… affiliation=… role=…/>` and `<occupant-id xmlns='urn:xmpp:occupant-id:0' id=…/>`.
   - Keep, per room: occupant JID (room/nick) → `{ realJid (bare), nick, occupantId, affiliation, role, available }`.
   - For groupchat messages (live **and** from MAM), resolve `fromJid` to the **real bare JID**, in this order:
     1. a real JID in the message itself, if ejabberd provides one (check MAM results for non-anonymous rooms and report what you see)
     2. the message's `occupant-id` looked up in the roster
     3. the nick looked up in the roster
   - Add `occupantId?` and `fromResolved: boolean` to `ChatMessage`. When nothing resolves, keep the occupant JID and set `fromResolved: false`.
   - **Security:** only trust roster data from presence sent **by the room itself** (`from` on `rooms.<domain>`). Never accept identity claims from other senders.
   - **Public API:** `occupants(roomJid): Occupant[]`, plus an event `on('occupants', cb: (e: { roomJid, occupants }) => void)` fired when the roster changes. The UI needs this for "3 members, 1 online".
   - `outgoing` for room messages must use the resolved real JID, or your own nick in the room.
   - **Tests:**
     - unit: presence parsing (join, leave, nick change if simple, affiliation and role); resolution through occupant-id, then nick, then unresolved; spoofed presence from a non-room sender is ignored
     - **integration:** Bob sees Alice's messages with `fromJid === alice's bare JID` and `fromResolved: true`, both live and in room history, and `occupants()` lists both users
2. **(accepted)**
   - the `@galena/protocol` workspace dependency
   - a hand-written fake instead of `@xmpp/test`
   - the derived MUC domain
   - `connect()` semantics with a 15 s timeout
   - body truncation on a code-point boundary
   - the history-ordering heuristic
   - the separate integration tsconfig
3. **(note)** Dev-stack handling (a local `.env`, one `--force-recreate`, no reset) was fine.

