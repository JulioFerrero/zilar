---
id: T-0016
title: "@galena/xmpp-core — shared XMPP client (token login, rooms, DMs, history, receipts, payloads)"
status: todo
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
