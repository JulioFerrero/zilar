---
id: T-1245
title: "Delivered tick step 3b, DMs: when a delivered mark moves forward, the server tells the author's online devices at once — an ejabberd admin send_stanza of a bodiless headline from the author's own JID to each online resource, <delivered xmlns='urn:zilar:delivered:0' chat=… until=…/>; xmpp-core accepts it only from the own bare JID and client-core applies it"
status: merged
milestone: M5
branch: task/T-1245-delivered-live-notice
model: auto
effort: default
depends_on: [T-1229, T-1238]
estimate: 0.5 day
---

# T-1245: Delivered tick, the live notice to the sender (DMs)

## Spec (written by Claude, do not edit)

### Why
- **Today:** T-1238 (merged) makes the receiving app confirm delivery over HTTP. The server stores it forward-only (`putChatDelivery`, `apps/server/src/chats/deliveries.ts:104-125`, called from `putDeliveredMark` through the `markDelivered` handler, `apps/server/src/chats/api.ts:362-375`), and the sender's app applies `deliveredUntil` (`applyDeliveredUntil`, `packages/client-core/src/store/delivered.ts`). But the sender sees it **only on the next chat-list refresh**.
- **Why not a stanza from the push component:** the server can send stanzas as a component, but `mod_block_strangers` drops stanzas from anyone outside the receiver's roster (`deploy/ejabberd/ejabberd.yml:293-298`, `drop: true`, `allow_transports: false`). A component JID isn't in anyone's roster.
- **The path that works:** a message **from the author's own JID** is never a stranger. The ejabberd HTTP API allows every command for the admin (`deploy/ejabberd/ejabberd.yml:162-174`, `what: '*'`), including `send_stanza`. The admin client (`apps/server/src/xmpp/admin/client.ts`) has `userResources(localpart)` (`:154`) but no send method yet.

### What to build
1. **Admin client:** `sendStanza(from: string, to: string, stanza: string)` on the ejabberd `send_stanza` command, following the existing methods' call/check shape (`client.ts:257-263`).
2. **Server** (a new `apps/server/src/chats/delivered-notice.ts`, called from the `markDelivered` path):
   - **Detect a moved mark:** make `putChatDelivery` report whether the row moved (`RETURNING delivered_id`, or a row count). Only a moved mark notifies.
   - **DMs only in this task:** the author is the peer, so the author's bare JID is `bare` and the author's chat id for this DM is the **confirmer's** bare JID. For a room, do nothing; note it in the Report.
   - **Send to each online resource** from `userResources(authorLocalpart)`, using full JIDs. Never send to the bare JID, so nothing is queued offline:
     `<message type='headline' from='<author bare>' to='<author full>'><delivered xmlns='urn:zilar:delivered:0' chat='<confirmer bare>' until='<archive id>'/><no-store xmlns='urn:xmpp:hints'/></message>`.
     The archive id is a string, with no `BigInt`.
   - **Best effort and non-blocking:** fork it after the HTTP answer or ignore errors, and log a warn with ids only. The HTTP answer must not wait on ejabberd.
   - **Push:** the headline has no `<body>`. Check from ejabberd's mod_push docs or source whether a bodiless headline to an online or hibernated session publishes a push with our `notify_on: messages` (`ejabberd.yml:272-276`). Cite what you found. If you can't confirm that it doesn't, also skip resources whose session is hibernated, if `userResources` exposes that; otherwise report it.
3. **xmpp-core:** parse `<delivered xmlns='urn:zilar:delivered:0'/>` in a headline **only when the `from` bare JID equals my own bare JID** (anything else is ignored), and emit a `deliveredMark` event `{ chatJid, until }`. Wire it through the stanza router (`packages/xmpp-core/src/core-effect/stanza-router.ts`), following how the `displayed` event is emitted.
4. **client-core:** subscribe next to `displayed` (`packages/client-core/src/store/lifecycle.ts:315`), so `deliveredMark` calls `applyDeliveredUntil(ctx, chatJid, until)` and stores `deliveredUntil` on that chat's summary. `lifecycle.ts` is at 400 lines: put the handler in `delivered.ts` and add at most 1 line to `lifecycle.ts`, or move an existing subscription out to make room (cite it).
5. **Tests** (message pipeline), up to 3:
   - in `packages/xmpp-core/src/stanza.test.ts`: a `<delivered/>` headline from my own bare JID parses, and one from anyone else doesn't;
   - in `packages/client-core/src/store/delivered.test.ts`: a `deliveredMark` event moves my `sent` messages at or below `until` to `delivered`;
   - in `apps/server/src/chats/deliveries.test.ts`: a moved mark calls the admin `sendStanza` once per online resource of the author, and an unmoved mark calls nothing (fake admin client).

### Read first
`AGENTS.md`, `docs/plan/delivered-tick.md`, `work/T-1229-delivered-server.md`, `work/T-1238-delivered-clients.md`, `apps/server/src/chats/deliveries.ts`, `apps/server/src/chats/api.ts:340-390`, `apps/server/src/xmpp/admin/client.ts`, `packages/xmpp-core/src/core-effect/stanza-router.ts`, `packages/client-core/src/store/delivered.ts` and `packages/client-core/src/store/lifecycle.ts`.

### Allowed files
`apps/server/src/app.ts` (the one line `createChatsApi(...)` at `:358` only, net zero lines; lead), `apps/server/src/test-support.ts` (the `FakeAdminClient` only; lead), `apps/server/src/xmpp/admin/types.ts`, `apps/server/src/chats/delivered-notice.ts`, `apps/server/src/chats/deliveries.ts`, `apps/server/src/chats/deliveries.test.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/xmpp/admin/client.ts`, `apps/server/src/xmpp/admin-client.ts`, `packages/xmpp-core/src/**`, `packages/client-core/src/store/delivered.ts`, `packages/client-core/src/store/delivered.test.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/ctx.ts`, `packages/mock-backend/src/xmpp/**`, `work/T-1245-delivered-live-notice.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/delivered.test.ts --reporter=dot
pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's live check after deploy:** the emulator's Claude Test sends to `@julio` (Julio OK'd it) while Julio's web app is open on another chat. Within seconds, with no reload, the emulator's bubble turns into the grey double tick.

---

## Report (written by the worker when done)

**Status: review.** Done. Round 1 stopped on scope (commit `57cbd1b1c`); the lead added `apps/server/src/app.ts` (one line), `apps/server/src/test-support.ts` (the fake) and `apps/server/src/xmpp/admin/types.ts` to Allowed files, and this round builds the whole feature.

### What I built

1. **Admin client (`xmpp/admin/types.ts`, `xmpp/admin/client.ts`).** `sendStanza(from, to, stanza)` on the ejabberd `send_stanza` command, following the existing methods: a `parseJid` helper validates both JIDs (a full JID with a resource is allowed), then `call('send_stanza', { from, to, stanza })` + `expectMutationResult`. `mod_admin_extra` declares `send_stanza` with `result = {res, rescode}`, the same `0 | ''` shape `MutationResultSchema` already decodes for `change_password`/`kick_session`.
2. **`chats/delivered-notice.ts` (new, Effect).** `buildDeliveredHeadline` builds the bodiless `<message type='headline'>` with `<delivered xmlns='urn:zilar:delivered:0' chat=… until=…/>` and `<no-store xmlns='urn:xmpp:hints'/>` (attributes XML-escaped). `notifyDelivered` resolves `userResources(authorLocalpart)` and sends one stanza per resource to `authorBare/resource` (never the bare JID), best effort: a per-resource failure is swallowed, a resolve failure is caught, and a failure is logged with ids only (`{ chatJid, until }`). It returns an `Effect`; the caller `Effect.runFork`s it after the HTTP answer.
3. **`chats/deliveries.ts`.** `putChatDelivery` now reports whether the row moved (added `RETURNING delivered_id`; `rows.length > 0`; the forward-only `ON CONFLICT … WHERE` is unchanged). `putDeliveredMark` returns `DeliveredNotice | undefined`: the max archive id, and only when the write actually moved **and** the scope is a DM. A room, an unmoved mark and a missing archive all return `undefined` (groups do nothing in this task, per the spec; noted below).
4. **`chats/api.ts`.** `ChatsApiDependencies` gains an optional `adminClient`; `markDelivered` runs `Effect.runFork(notifyDelivered({ adminClient, logger, notice }))` only when a notice came back, so the 204 never waits on ejabberd.
5. **`app.ts`.** The one allowed line now passes `adminClient` (net zero lines; 583 before and after).
6. **`xmpp-core`.** `DELIVERED_NAMESPACE`; a new `types-delivered.ts` joins the event map and the `XmppCore.on` overload through module merging (like `types-ack.ts`), re-exported from `types.ts`/`index.ts`. `decode.ts` parses `<delivered/>` in a **headline** only when `bareJid(from)` equals `ctx.me` (anything else is ignored), before the chat-kind guard so the bodiless stanza is not dropped; `DeliveredMarkEvent { chatJid, until }` lands on `DecodedStanza.deliveredMark` (`parse-context.ts`). `stanza-router.ts` emits `deliveredMark` next to `displayed`.
7. **`client-core`.** `delivered.ts` gains `handleDeliveredMark` (calls `applyDeliveredUntil`, then stores the mark on the chat summary forward-only via `storeDeliveredUntil`); `lifecycle.ts` subscribes to `deliveredMark` next to `displayed`.
8. **`test-support.ts`.** `FakeAdminClient.sendStanza` records to `sentStanzas`, next to the existing `onlineResources`/`setOnlineResources`.

### Tests (message pipeline)

- `packages/xmpp-core/src/stanza.test.ts`: a `<delivered/>` headline from my own bare JID parses; one from anyone else does not.
- `packages/client-core/src/store/delivered.test.ts`: `handleDeliveredMark` moves my sent messages at or below the mark to `delivered`, keeps `read`, leaves later messages `sent`, stores the summary mark, and never moves it back.
- `apps/server/src/chats/deliveries.test.ts`: a moved DM mark returns `{ authorBare, chatJid, until }`, `notifyDelivered` sends exactly one stanza per online resource (from the author's own bare JID to each full JID, with the exact `<delivered/>` payload), and a repeated/unmoved mark returns `undefined` and sends nothing.

### Commands and results

- `pnpm install` — OK (`Done in 11.8s using pnpm v10.32.1`; unrelated peer warning `@types/react-dom` vs `@types/react`).
- `pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --maxWorkers=2 --reporter=dot` — **82 passed**.
- `pnpm --filter @zilar/client-core exec vitest run src/store/delivered.test.ts --maxWorkers=2 --reporter=dot` — **7 passed**.
- `pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts --maxWorkers=2 --reporter=dot` — **5 passed** (4 pre-existing + the new one).
- `pnpm gate` (repo root) — **GATE PASS**:
  ```
  gate: 21 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (6.1s)
  PASS  effect  (4.1s)
  PASS  tests @zilar/client-core  (3.6s)
  PASS  tests @zilar/server  (12.7s)
  PASS  tests @zilar/xmpp-core  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- One mid-run correction worth knowing: `Effect.catchAll` is not in this Effect 4 build (the codebase uses `Effect.catch`); the gate's `effect` step also forced the new server file to be Effect rather than plain.

### mod_push: does a bodiless headline publish a push?

**No.** With our config (`deploy/ejabberd/ejabberd.yml:272-276`: `include_sender: false`, `include_body: false`, `notify_on: messages`), `mod_push` builds no summary for a message without a body, and messages-only mode drops a summary-less stanza:
- source `src/mod_push.erl` (`notify/7`): `case {make_summary(...), mod_push_opt:notify_on(...)}` matches `{undefined, messages}`, logs "Suppressing notification for stanza without payload" and returns `ok`; and `make_summary/3` returns `undefined` for the `{false, false}` include pair (our config) and for any message whose `get_body_text/1` is `none` (a bodiless headline).
- docs (`docs.ejabberd.im`, `mod_push`, `notify_on`): "If this option is set to 'messages', notifications are generated only for actual chat messages with a body text (or some encrypted payload)."

So no hibernated-session workaround is needed. `userResources` also returns only resource strings (no hibernation flag, in `admin/client.ts` and `test-support.ts`), so it could not be done anyway; recorded here as the spec asked.

### Security checklist

- Secrets/tokens: none; the only new log is `{ chatJid, until }` (ids only), and the stanza carries ids only.
- Write scoped: the delivery upsert still keys `(user_id, chat_jid)`; the notice only runs after a successful, access-checked, forward-only write.
- Atomic: the forward-only `ON CONFLICT … WHERE` is unchanged; no check-then-insert was added.
- Effect before permission: access is checked by `chatAccessForMark` before `putDeliveredMark`, and notify runs after it.
- 404 parity: unchanged (no new route); the chats routes stay in the 401 sweep.
- Trust: xmpp-core accepts a `delivered` headline **only** when `from`'s bare JID is my own, so no peer can move my ticks; the stanza is server-controlled (admin `send_stanza`).
- Audit: none touched.

### Deviations and notes

- **Groups do nothing** (DM-only, per spec §2). `putDeliveredMark` returns `undefined` for a room scope, so no notice is sent; the group path is unchanged.
- **`lifecycle.ts` line budget.** The file was exactly 400, so the import + the one subscription line would have pushed it to 402. Instead of moving an unrelated subscription (which would ripple into non-Allowed files), I compressed the 3-line re-export comment above the `export { … }` block to one line (net zero; still 400). Behaviour is unchanged; cited here as the spec asked.
- **`mock-backend/src/xmpp/**` is Allowed but untouched.** The fake core's `on` is generic; subscribing to `deliveredMark` needs no fake emission, and the spec's tests do not use mock mode.
- **Push citation** lives in `delivered-notice.ts`'s header comment too.
- Every touched source file is at most 400 lines (`app.ts` unchanged at 583; `test-support.ts` is exempt from `max-lines` in `.oxlintrc.json`).

### Open questions

- None blocking. The lead's live check (the emulator sends to `@julio` while Julio's web is open on another chat → the bubble turns into the grey double tick within seconds) is the acceptance test against a real ejabberd; I did not run it.

### Rebase onto T-1236

`git rebase main` conflicted in `apps/server/src/chats/api.ts` (both sides added an import: T-1236 `deleteOwnHandlers`, T-1245 the notice import). Kept both sides: T-1236's `deleteOwnHandlers(deps)` wiring and the `adminClient` dependency stay, and the notice call moved out of the handler into `markDeliveredAndNotify(deps, input)` in `delivered-notice.ts` (it wraps `putDeliveredMark` plus the forked `notifyDelivered`). The `markDelivered` handler is now one `await markDeliveredAndNotify(deps, {...})`; `api.ts` no longer imports `putDeliveredMark`, and is 396 lines (≤ 400). The file is `git add`ed; I did not run `rebase --continue`.

- `pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts src/chats/delete-own.test.ts --reporter=dot`
  ```
  Test Files  2 passed (2)
       Tests  8 passed (8)
  ```
- `pnpm --filter @zilar/server exec tsc --noEmit -p tsconfig.json` — exit 0, no output.

### Round 1 (fix round)

Fixed: 1 should-fix finding. No must-fix, no nits.

- **Finding 1** (`packages/xmpp-core/src/stanza/decode.ts:214`): `parseDeliveredMark` compared `bareJid(from) !== me`, which is case-sensitive, while the server lowercases everywhere; a bound JID arriving with a different case than `ctx.me` dropped its own live notice. It now compares case-insensitively with `normalizeJid` from `@zilar/protocol` (re-exported through `packages/xmpp-core/src/jid.ts`). Test added inside the existing delivered test in `packages/xmpp-core/src/stanza.test.ts`: a headline from `BOB@Zilar.Localhost` (against `ctx.me = bob@zilar.localhost`) is parsed, while one from another JID stays ignored.

Tests run: `pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --maxWorkers=2 --reporter=dot` — 84 passed. `pnpm gate` (repo root) — **GATE PASS** (22 changed files; install, format, lint, typecheck, effect, tests @zilar/client-core, tests @zilar/server, tests @zilar/xmpp-core; scope inside Allowed files; migration OK).

Disagreements: none. The other findings (2–7) were no-finding assessments; left as they are.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (4 nits).**
- **The change:** after `PUT /chats/:jid/delivered` moves the mark, the server sends a bodiless headline through the admin `send_stanza`, from the author's own bare JID to each online resource of the author: `<delivered xmlns='urn:zilar:delivered:0' chat until/>` plus `<no-store/>`. xmpp-core accepts it **only** when the `from` bare JID equals the logged-in user (`parseDeliveredMark`), so nobody else can move my ticks; client-core runs `applyDeliveredUntil`.
- **Push:** mod_push sends no push for a bodiless stanza under `notify_on: messages`. The worker cited `mod_push.erl` `notify/7` and the docs.
- **Rebase onto T-1236:** both sides kept; the notice moved into `delivered-notice.ts`, so `api.ts` is 396 lines; `app.ts` changes only the one `createChatsApi` line (net zero).
- **Lead's checks after rebasing onto main:**
  - server `deliveries` + `delete-own` tests: 8 passed;
  - client-core `delivered`: 7 passed;
  - xmpp-core `stanza`: 84 passed;
  - tsc on server, web and mobile: 0 errors.
- **Next:** the live check after deploy (Claude Test on the emulator sends to @julio; the bubble turns grey double tick live once Julio's device is online).
