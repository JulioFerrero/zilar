# Message pipeline audit (2026-10-11)

Scope: connection lifecycle, sync after reconnect, sending and ticks, read state, push end to end
(web, mobile, client-core, xmpp-core, server push component, ejabberd). Code read today at
`771603445`; ejabberd behaviour taken from `mod_push.erl`, `mod_push_keepalive.erl` and
`mod_stream_mgmt.erl` on processone/ejabberd master (read today, no local copy). Nothing was run.

Severity: P0 messages lost / never delivered / never notified; P1 wrong state shown; P2 slow or degraded.
"confirmed" = traced in code; "suspected" = needs the runtime check named in the finding.

## 1. Summary

- MP-1 P0 mobile (known K1): a backgrounded app keeps an active XMPP session; messages land in a socket nobody shows, ejabberd sees the user online and never pushes. Confirmed.
- MP-2 P0 mobile (K3 answer): the first push wakes the app, the app resumes/reconnects, the session is active again and the rest of the burst goes silently into the socket; a reconnect that makes a new session never re-sends `<enable/>`, so that session can never trigger a push. Confirmed.
- MP-3 P0 both: group (MUC) messages never push to a user whose app is closed: ejabberd's MAM push path handles `chat` only, and an offline user is not a room occupant. Confirmed from ejabberd source.
- MP-4 P0 both: the "sent" tick means "written to the socket"; stream-management acks and failures are ignored, so a message the server never got shows as sent and is lost; a text that fails `NotOnline` stays "sending" for ever and is never resent. Confirmed.
- MP-5 P1 both (known K2 + more): nothing catches up after a reconnect: no MAM query for the open chat, previews only fill empty rows, `/api/chats` carries no preview or unread, rooms rejoin with `maxstanzas=0`. Confirmed.
- MP-6 P1 both: unread is client memory only: every launch starts at 0, mobile keeps no last-read map, no cross-device read sync. Confirmed.
- MP-7 P1 server: ejabberd `notify_on` defaults to `all`, so a typing state or presence to a pending session triggers a publish, and the archive scan then pushes the newest *unnotified* row, which can be an hour-old message. Bursts notify newest-first. Confirmed.
- MP-8 P1 web (suspected): after any reload the web session has no push pair, ejabberd's `drop_online_sessions` matches only by session id, so the stale pair gets a push for every DM while the tab is open and focused.
- MP-9 P1 both: there is no "delivered" state; "read" comes from XEP-0333 markers, and in a group the first reader marks the message read for the sender. Confirmed.
- MP-10 P1 both (suspected): a 401 on the token fetch during an automatic reconnect stops XMPP for good until the app restarts.
- MP-11 P2 mobile: the 5 s reconnect watchdog replaces the client with a new random resource, which abandons stream-management resume on slow networks and leaves a ghost pending session for 300 s. Confirmed.
- MP-12 P2 both: no XEP-0352 CSI; dead sockets are detected only by stream-management `ack_timeout` (60 s) because `mod_ping` has `timeout_action: none`, so every background push is at least 60 s late. Confirmed.
- MP-13 P2 mobile: a failed `<enable/>` on the first online is retried only on the next cold start. Confirmed.

## 2. Why only the first push of a burst (K3)

ejabberd has three push triggers (`mod_push.erl`, hook list in `start/2`):

1. `c2s_session_pending` (hook priority 50): when an active session goes pending (socket dead, or a stanza unacked for `ack_timeout`, default 60 s, `mod_stream_mgmt` defaults), it notifies **once**, with the first incoming chat message found in the unacked queue.
2. `c2s_stanza` on `c2s_handle_send`: notifies for every stanza sent to a session whose state has `push_enabled := true` **and** `mgmt_state := pending`.
3. `mam_message` on `store_mam_message`: for every archived `chat` message, notifies every push pair of the user except the pairs whose session id is currently online (`drop_online_sessions`: compares each pair's id with the `push_id` of the sessions in `ejabberd_sm`). `offline_message` skips archived messages ("Push notification was triggered via MAM").

`push_enabled` and `push_id` are per c2s session, set by the `<enable/>` the client sends on that session (`enable/4`, keyed by the session id from `ejabberd_sm:get_session_sid`). There is no close hook: a pair outlives its session until `<disable/>` or an error IQ (our component always answers `result`, `apps/server/src/push/component.ts:31-35`).

What the Android app does with that:

- Background, JS still running: the socket stays open (no AppState handler in `apps/mobile/src/store/effects/ports.ts:104-112`, no disconnect anywhere in `apps/mobile/src/store`), ejabberd routes each message to the session, `handleMessage` adds it to the store and bumps `unread` (`packages/client-core/src/store/incoming.ts:133-150`) but mobile has no `notifyIncoming` hook (`apps/mobile/src/store/effects/lifecycle.ts:81-145`, `apps/mobile/src/store/real-store.ts:169-182`), so nothing is shown. The MAM trigger drops the pair because its session is online. **No push at all** (K1).
- Doze freezes the JS thread: ejabberd's `<r/>` after the next message is never answered, 60 s later the session goes pending, trigger 1 fires once for the whole queue. **Push 1**, about a minute late.
- FCM high priority (`apps/server/src/push/fcm.ts:56`) gives the app a wake window; `onWake` only posts a local notification (`apps/mobile/src/lib/push/background.ts:87-108`), but the app's live xmpp.js client also runs its pending timers: keepalive reply timeout (`packages/xmpp-core/src/core-effect/lifecycle.ts:251-258`) or the SM `<r/>` timeout (`@xmpp/stream-management/index.js:168-171`) tear the socket down, `@xmpp/reconnect/index.js:12-30` reconnects after 1 s, `stream-feature.js:16-27` sends `<resume/>` (the id survives a `disconnect`, only `offline` clears it, `index.js:117-123`). The session is **active again** with the queued message replayed into the silent socket. Messages 2..n now arrive on an online session: trigger 2 needs `pending`, trigger 3 drops the online pair. **Nothing**, until the next 60 s ack timeout produces one more single notification.
- If the 5 s watchdog (`packages/xmpp-core/src/core-effect/config.ts:28-30`, `lifecycle.ts:75-102`) replaces the client before the resume completes, the new client binds a new random resource (`config.ts:88-90`) and nobody sends `<enable/>` on it: the mobile registration runs once per signed-in session on the first `online` (`apps/mobile/src/store/chat-store-provider.tsx:140-162`, `apps/mobile/src/lib/push/native.ts:108-122`). That session can never fire triggers 1 or 2. Trigger 3 keeps working for DMs only through the stale pair, and `onWake` skips it while the app is active (`background.ts:116`).

So the burst is not lost to FCM collapse (no `collapse_key`, `fcm.ts:52-58`), not to the server dedupe (`recentlyNotified` is per node and per origin id, `apps/server/src/push/delivery.ts:252-265`), and not to the mobile task. It is lost because the device goes back online between messages. Runtime check that settles it: count `push sent` / `push dropped` lines in the server log during a 3-message burst to a backgrounded phone. One line means the component got one IQ (this chain); three lines means the device side.

## 3. Findings by area

### A. Connection lifecycle

**MP-1 P0 mobile, confirmed (known K1).** Symptom: phone in background, sender sees one tick, receiver sees nothing until the app is reopened; push comes a minute later at best. Evidence: `deploy/ejabberd/ejabberd.yml:260-263` (`timeout_action: none`), `:252-253` (`resend_on_timeout: if_offline`, no `resume_timeout`/`ack_timeout`, so 300 s / 60 s defaults); mobile visibility port is only AppState `active` (`apps/mobile/src/store/effects/ports.ts:104-112`); no background handler; `connectXmpp` never disconnects (`packages/client-core/src/store/lifecycle.ts:304-371`). Repro: open the app, press home, have a contact send three messages. Fix: see F1.

**MP-11 P2 mobile, confirmed.** The reconnect watchdog waits 5, 8, 12, 20 s (`config.ts:28-30`) and `restartStuckClient` drops the client and creates a fresh one with a new random resource (`lifecycle.ts:86-102`, `core-effect.ts:182-194`, `config.ts:88-90`). The old session stays pending for 300 s with the user's bare-JID traffic duplicated into its queue, then the queue is dropped (`route_unacked_stanzas`: archived messages are dropped when another resource is online). Any stanza xmpp.js had queued for resume is failed (`stream-management/index.js:83-105`) and nobody listens (MP-4). Fix: F4 (watchdog not under 15 s on mobile, resource stable per install so a replacement kicks the ghost instead of doubling it).

**MP-12 P2 both, confirmed.** No CSI (`packages/xmpp-core/src/namespaces.ts` has no `urn:xmpp:csi`, no `mod_client_state` in either `ejabberd.yml`). Fine once F1 closes the socket in background.

**MP-10 P1 both, suspected.** `isFatalTokenError` treats any 401/403 from `getXmppToken` as bad credentials (`config.ts:123-127`), `authFailed` ends in `stopAfterFailure` (`core-effect.ts:154-158`, `lifecycle.ts:160-173`): `desiredOnline=false`, no retry. `scheduleConnectRetry` only guards the first token fetch (`client-core lifecycle.ts:307-311`); the per-reconnect fetch (`:320-330`) has no fallback. A short-lived session token or a refresh race during an automatic reconnect would leave the app "offline" until restart. Check: expire the bearer on the server while the app is connected, drop Wi-Fi for 10 s, watch the status. Fix: F7.

Web tab hidden: `webFlags.reconnectOnResume=false` (`apps/web/src/store/effects/portAdapters.ts:45`), focus only re-polls `/api/chats` (`:33-39`, `packages/client-core/src/store/polling.ts:82-98`). The socket stays open in a hidden tab and `notifyIncoming` shows an in-tab notification (`apps/web/src/store/effects/storeContext.ts:111-117`), so web background behaviour is acceptable; laptop sleep is MP-5.

### B. Message sync

**MP-5 P1 both, confirmed (known K2 and its siblings).** Symptoms: unread says 2, open chat shows 1; chat list preview stale after a reconnect; group messages missed during a gap appear only after reopening the chat. Evidence:
- `reconnect()` returns at `status === 'online'` even with a dead socket (`packages/client-core/src/store/lifecycle.ts:170-172`); wired from AppState active (`apps/mobile/src/store/effects/lifecycle.ts:99-102`, flag `apps/mobile/src/store/real-store.ts:167`).
- An automatic xmpp.js reconnect only reaches `subscribeToCore`'s status listener, which does `flushPending` and nothing else (`lifecycle.ts:281-286`); the resume path does `flushPending` + `joinGroups` (`:173-185`); only the first connect runs `loadPreview` for every chat (`:365-368`).
- `loadPreview` writes `lastMessage` only when the row has none (`packages/client-core/src/store/history.ts:178-184`), and `/api/chats` rows carry no preview and `unread: 0` (`packages/client-core/src/store/chat-rows.ts:64,129`, no `lastMessage` in that file).
- Rooms rejoin with `maxstanzas=0` (`packages/xmpp-core/src/stanza/build-outgoing.ts:226-231`, `core-effect/lifecycle.ts:293-298`) and no MAM query follows.
- `openHistory` does reload the newest page on every open (`history.ts:218-292`, callers `apps/mobile/src/store/effects/history.ts:381`, `apps/web/src/store/effects/history.ts:55`), which is why reopening "fixes" it; `buildMamQuery` has no `after` cursor (`packages/xmpp-core/src/core-effect/operations.ts:280-288`).
- SM resume replays what ejabberd queued, but only inside `resume_timeout` and only when the same client object reconnects (MP-11); once a chat message is queued, `mod_push_keepalive` leaves the 300 s default (`c2s_session_pending`: `_Msg -> State`).
Repro: open a DM, airplane mode 2 min, have the peer send 2 messages, airplane mode off. Fix: F3.

Duplicates and ordering: `openHistory` and `loadOlderPage` dedupe by `sameMessage` and sort (`history.ts:134-146, 257-276`), `handleMessage` filters the same id (`incoming.ts:142-146`), the echo path links local and server ids (`:54-67`). Carbons are enabled on every online (`core-effect/lifecycle.ts:292`). No duplicate or ordering bug found.

### C. Sending and ticks

**MP-4 P0 both, confirmed.** `MessageStatus` is `sending | sent | read | failed` (`packages/chat-core/src/types.ts:7`): no delivered. `sendText` sets `sent` when `sendMessage` resolves (`packages/client-core/src/store/send/text.ts:59-65`), and `sendStanzaEffect` resolves when xmpp.js `send` resolves, i.e. the socket write (`operations.ts:175-182`). `installStreamManagementAck` only patches `h` counters (`packages/xmpp-core/src/stream-management.ts:78-98`); the library's `ack` and `fail` events (`@xmpp/stream-management/index.js:90-105`) have no listener anywhere in xmpp-core or client-core. Consequences:
- A text written into a socket the OS already froze shows one tick; if the resume fails (after 300 s, or MP-11's client replacement) the library fails the queue and the message is gone while the bubble says sent.
- A text sent while `status !== 'online'` fails with `NotOnline`, is swallowed (`text.ts:67-68`), stays `sending` for ever; `pendingOutgoing` is only used to match echoes (`incoming.ts:49-52`), nothing resends. Voice and attachments do get `failed` + retry (`send/pipeline.ts:16-37`); texts do not.
Repro: airplane mode on, type and send, airplane mode off after 6 min. Fix: F4.

**MP-9 P1 both, confirmed.** "Read" comes from a XEP-0333 `displayed` sent on open and on an incoming message while the chat is active and visible (`history.ts:281-282`, `incoming.ts:172-178`, `polling.ts:65-80`); XEP-0184 receipts are not requested or parsed (no `urn:xmpp:receipts` in `packages/xmpp-core/src`). `handleDisplayed` marks the message read for any non-own sender (`incoming.ts:213-223`), so in a room the first reader turns the sender's tick to read. Nobody sends markers while backgrounded (correct: `isVisible()` guard). Fix: F8 (two-tick semantics need receipts).

### D. Read state

**MP-6 P1 both, confirmed.** Unread is computed only by `handleMessage` (`incoming.ts:150`) and cleared by `recordRead` (`packages/client-core/src/store/reads.ts:25-39`); fresh rows start at 0 (`chat-rows.ts:64,129`) and the refresh merge keeps the in-memory value (`apps/mobile/src/store/effects/history.ts:193`, `apps/web/src/store/effects/chatRows.ts:39`). Mobile has `storage: null` (`real-store.ts:158`), so even `lastRead` is lost on restart; web persists `lastRead` (`reads.ts:11-22`) but still boots every row at 0. Messages received while the app was closed are never unread, the unread divider (`packages/chat-core/src/messages.ts:129`) has no anchor, and reading on one device never clears the other. Badge: web syncs from the in-memory total (`apps/web/src/lib/push.ts:219-261`), so it is wrong by the same amount; mobile has no badge (`appHooks.syncBadge` no-op). Fix: F3 (server-side `lastMessage` + `unread` in `/api/chats` from the archive and a per-user last-read row), which also fixes the preview staleness in MP-5.

False "seen": `openChat` calls `recordRead` and `openHistory` sends `displayed` for the newest message with no visibility check (`history.ts:279-283`); on mobile a chat opened by a notification tap while the screen is locked would mark it displayed. Minor, note only.

### E. Push end to end

**MP-2 P0 mobile, confirmed.** See section 2. Additional evidence: the only `<enable/>` senders are `registerNativePush` (mobile, once per signed-in session, `chat-store-provider.tsx:149-154`) and `enableOnThisDevice` (web, user action only, `apps/web/src/lib/push/usePushEnable.ts:146-194`); `afterOnline` sends presence, carbons and room joins only (`core-effect/lifecycle.ts:290-299`). A failed enable on mobile is logged and left to the next launch (`native.ts:116-120`, MP-13). Fix: F1 + F2.

**MP-3 P0 both, confirmed from ejabberd source + config.** `mam_message` matches `chat` only; a `groupchat` message is archived in the room, not pushed. A user with no session is not an occupant, so the room routes nothing to them and `offline_message` never sees it. The server component can resolve room rows (`apps/server/src/push/candidates.ts:39-43, 45-104`) but is only ever driven by ejabberd's publish IQ. `deploy/ejabberd/ejabberd.yml:206-227` has no `allow_subscription` (no MUC/Sub). Pending sessions do get room pushes (trigger 2) for up to 72 h, but only until a chat message is queued (then 300 s). Repro: force-close the app, wait 6 min, have a group member post. Fix: F5.

**MP-7 P1 server, confirmed.** `mod_push` default `notify_on: all` and neither `ejabberd.yml` sets it (`deploy/ejabberd/ejabberd.yml:270-273`). Every stanza sent to a pending session (typing `composing`, presence, the keepalive wake 2 min before the 72 h timeout) publishes. The component ignores the summary and scans newest-first for the first origin id not in this node's `seen` set (`apps/server/src/push/archive-scan.ts:63-105`); a message received while online is never in `seen`, so a peer typing to a sleeping phone pushes that old message, and `onWake` fetches it by id and shows it as new (`background.ts:96-107`). Bursts: with N IQs and N rows landed, IQ 1 notifies the newest, IQ 2 the second newest, so the phone buzzes in reverse; the comment at `archive-scan.ts:36-40` ("a burst while offline buzzes once with the latest") is wrong, `notify` only carries skipped rows (`:84-94`). Fix: F6.

**MP-8 P1 web, suspected.** Because web never re-enables (above) and `drop_online_sessions` compares pair ids with online `push_id`s, a browser that enabled push, then reloaded, keeps a pair whose session is dead: every DM archived for the user pushes it, including while the reloaded tab is focused. `sw.js` shows every push (`apps/web/public/sw.js:71-86`) and `dismissChatNotifications` runs on the XMPP message, usually before the push lands (`reads.ts:37`). Check: enable web push, reload, receive a DM in the focused tab. Fix: F2 (re-enable on every session, and `<disable/>` of the previous pair on sign-out).

Mobile `onWake`: correct skip while active (`background.ts:116`); a missing session token drops the wake silently (`:88-91`) instead of a generic notification; the preview endpoint applies mute/visibility/preview rules (`apps/server/src/push/api-handlers.ts:141-199`). Tap routing (`apps/mobile/src/lib/push/tap.ts`) fine. T-1150 node reuse confirmed as context (`native.ts:94-146`).

## 4. Behaviour table

| Event | Today | Telegram-like target |
| --- | --- | --- |
| Web tab hidden 1 min | Socket open, messages arrive, in-tab notification, unread in memory. | Same. |
| Web tab hidden 1 h | Same; Chrome timer throttling tolerated by server pings every 60 s. If the socket dies, xmpp.js reconnects; no catch-up (MP-5), stale pair may double-notify (MP-8). | Reconnect + catch-up of open chat and previews; one notification source at a time. |
| App background 10 s | Session stays active, messages delivered silently, no push, unread bumps in memory (MP-1). | Keep socket ~10 s, then close; server pushes each message. |
| App background 10 min | JS frozen, socket "open" until the 60 s ack timeout; one push per pending transition (MP-2); groups only while pending (MP-3); a text sent just before may be lost while shown sent (MP-4). | Socket closed, every DM and group message pushes; resume replays or MAM catch-up on foreground; unsent texts retried. |
| Network drop (foreground) | Keepalive detects in 30+15 s, SM `<r/>` in 60 s; reconnect with resume if under 300 s and the watchdog did not replace the client (MP-11); otherwise queued sends lost (MP-4); open chat not re-synced (MP-5). | Detect in seconds, resume or MAM catch-up, pending sends resent with delivered ticks. |
| Laptop sleep (web) | Socket dies; on wake xmpp.js reconnects (resume only if < 300 s); no catch-up for the open chat (MP-5); DM pushes may arrive for the dead pair (MP-8). | Reconnect + catch-up; no desktop notification for an already-visible chat. |
| Token expiry mid-session | XMPP session continues; next reconnect fetches a fresh token; a 401 there stops XMPP for good (MP-10). | Refresh and retry before giving up; sign out only on a real auth failure. |

## 5. Fix plan (ordered by impact, then size)

Tests only where the pipeline is crucial; no UI tests. Every file stays under 400 lines
(`core-effect/lifecycle.ts` is 393 and `archive-scan.ts` 188, so new code goes in new files).

**F1. Mobile background lifecycle (closes MP-1, MP-12; enables MP-2's fix).** xmpp-core: new `packages/xmpp-core/src/core-effect/suspend.ts` with `suspend()` (stop the library reconnect driver and our watchdog/keepalive, end the socket without the framing `<close/>` so ejabberd keeps the session pending and pushes per stanza, keep the SM id) and `wake()` (start the driver, `connect()`, resume or fresh bind, emit `resumed | rebound`); expose both in `core-effect.ts`, `client.ts`, `types.ts`. client-core: `lifecycle.ts` `reconnect()` calls `wake()` instead of the `status === 'online'` check, then F3's catch-up. Mobile: `apps/mobile/src/store/effects/lifecycle.ts` subscribes to AppState `background` with a 10 s grace, `active` cancels it. ejabberd: `mod_stream_mgmt.resume_timeout: 600` in both yml files (longer resume window, still under keepalive's 72 h). Tests: `packages/xmpp-core/src/connection-resilience.test.ts` (suspend keeps the SM id, wake resumes, failed resume emits `rebound`), `packages/client-core/src/store/history.test.ts` (resume triggers catch-up).

**F2. Push pair on every session (closes MP-2 second half, MP-8, MP-13).** Mobile: `apps/mobile/src/lib/push/native.ts` exports `ensurePushPair` that reads the saved registration and sends `<enable/>`; `chat-store-provider.tsx` calls it on every `online` transition (not once) and after `wake` reports `rebound`. Web: new `apps/web/src/lib/push/sessionEnable.ts` that, when a device registration exists in `deviceStorage.ts`, sends `<enable/>` on every online; sign-out sends `<disable/>`. Test: `apps/mobile/src/lib/push/native.test.ts` (enable sent again after a second online).

**F3. Catch-up and server-side unread (closes MP-5, MP-6, K2).** xmpp-core: `after` cursor in `packages/xmpp-core/src/mam.ts` `buildMamQuery` and `LoadHistoryOptions`. client-core: new `packages/client-core/src/store/catch-up.ts`: on every online (status listener in `lifecycle.ts:281-286` and the resume path) query the open chat `after` its newest id and merge, and refresh every chat's preview (`loadPreview` overwrite when the id differs, new option). Server: `/api/chats` entries gain `lastMessage` and `unread` computed from the archive against a per-user `chat_reads(chat_jid, last_read_id)` row written by a new `PUT /api/chats/:jid/read` that the clients call from `recordRead`; `chat-rows.ts` maps both. Mobile stores `lastRead` in AsyncStorage (`real-store.ts:158`). Tests: `history.test.ts` (catch-up merges without duplicates, preview overwritten), one server test for the unread query.

**F4. Honest ticks and an outbox (closes MP-4, MP-11).** xmpp-core: `stream-management.ts` subscribes to the library's `ack` and `fail` events and emits `acked(id)` / `unacked(id)`; `config.ts` watchdog first step 15 s on mobile (option), resource derived from a per-install id (`XmppCoreOptions.resource` already exists, `types.ts:34-37`). client-core: `send/text.ts` keeps `sending` until `acked`; new `send/outbox.ts` stores `NotOnline`/`unacked` texts and resends them on the next online with the same origin id (ejabberd dedupes by origin id in MAM only, so the echo path `incoming.ts:40-98` must match by id, which `linkMessageIds` supports). Tests: `stream-management.test.ts` (ack → acked, fail → unacked), `send.test.ts` (offline text resent once online, failed after N).

**F5. Server-side group push (closes MP-3).** New `apps/server/src/push/group-notifier.ts`: poll the ejabberd archive every 3 s for `kind='groupchat'` rows newer than the last seen timestamp, resolve the room's members via `topics/access` (`canSeeTopic`) minus the sender, skip members with an online XMPP resource (`adminClient` `user_resources`), and for each device row of the rest call `deliverToDevice` (`delivery.ts:149-204`, already exported) with the row resolved by `resolveCandidate`; `recentlyNotified` dedupes against ejabberd's own publish for pending sessions. Wire in `apps/server/src/main.ts` beside the component. Test: `group-notifier.test.ts` with a fake archive and fake sender (sender skipped, online member skipped, each offline device once).

**F6. Precise triggers (closes MP-7).** `mod_push.notify_on: messages` in `deploy/ejabberd/ejabberd.yml` and `infra/ejabberd/ejabberd.yml`. `archive-scan.ts`: walk the unseen rows oldest-first within one publish and notify the oldest unnotified incoming row (so bursts arrive in order), and mark every evaluated older row; fix the comment at `:36-40`. Test: `delivery.test.ts` (three rows, three IQs → oldest first, no repeat).

**F7. Token failure during reconnect (closes MP-10).** `core-effect/config.ts` `isFatalTokenError` stays, but `core-effect/lifecycle.ts` `authenticateWithFreshToken` retries once after 2 s on 401 before setting `authFailed`; client-core `lifecycle.ts` turns a core that ends `offline` with `authFailed` into `scheduleConnectRetry` instead of silence, and only `goToLogin` after the retry ladder. Test: `connection-resilience.test.ts` (one 401 then success → online).

**F8. Delivered tick (closes MP-9).** `packages/chat-core/src/types.ts` adds `delivered`; xmpp-core requests XEP-0184 receipts in `buildMessage` and parses `<received/>` in `stanza/decode.ts`, emits `delivered`; the receiver answers from `stanza-router.ts` for every handled message (also after a resume replay); client-core `incoming.ts` maps `delivered`, `handleDisplayed` only upgrades in DMs; web and mobile tick icons gain the second check. Tests: `stanza.test.ts` (receipt request present, receipt parsed).
