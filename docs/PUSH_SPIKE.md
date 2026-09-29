# Push spike (T-0118): web push through ejabberd's mod_push

Spike, not a feature. Everything throwaway lives in
`apps/server/src/push-spike/` and `apps/web/public/push-spike/`, off by
default (`PUSH_SPIKE_ENABLED=false`). Decision: **GO** for T-0119.

## 1. Component connection: YES

`apps/server` can run as an XEP-0114 component with `@xmpp/component`
0.14.0 (same xmpp.js family as `xmpp-core`'s `@xmpp/client`; ISC licence;
no other library needed). The spike wires it in
`push-spike/component.ts`: `component({ service:
'xmpp://127.0.0.1:5347', domain: 'push.galena.localhost', password })`,
receives `<notification/>` publish IQs, answers each with IQ `result`, and
relies on the library's built-in reconnect. ejabberd side is one loopback
listener plus the push secret (marked `PUSH SPIKE (T-0118)` in
`infra/ejabberd/ejabberd.yml`); the port needs no Compose publishing
(loopback inside the dev network). Unit proof: `component.test.ts` drives
the handler with a fake component and a fake push endpoint
(publish → Web Push send → IQ result; 404/410 → subscription removed).

## 2. What ejabberd sends (from mod_push.erl source, 26.07)

- Enable is per-session and requires a live session:
  `enable()` looks up the sender's session and returns
  `item-not-found` without one — so **no admin-API shortcut**: the
  browser must send `<enable/>` over its own XMPP session.
- `node` is required; an empty node gets `feature-not-implemented`.
- The notification IQ comes `from` the bare server JID to the push JID:
  `<pubsub><publish node="…"><item><notification
  xmlns="urn:xmpp:push:0">[summary form]</notification></item></publish>`
  plus `<publish-options>` echoing the enable-time `secret`.
- The summary form (`urn:xmpp:push:summary`) carries at most
  `last-message-sender` (only with `include_sender: true`, default false)
  and `last-message-body` (with `include_body: true`, or a static Text,
  default `"New message"`). `message-count` is in the XEP example but
  **never set by the implementation**. No stanza id travels along.
- Triggers: offline messages, MAM-archived DMs (`mam_message` hook fires
  only for `chat` type — **groupchat/MUC is skipped**), and unacked
  stream-management queue entries when a hibernating session with push
  goes pending. Online sessions are filtered out (`drop_online_sessions`),
  so no double notify. MUC support needs `mod_muc` push wiring or polling
  MAM — open question for T-0119.
- `mod_push_keepalive` (not enabled in the spike): keeps the SM session up
  to `resume_timeout` (default 72 h) and re-arms normal timeout after the
  first push. Needed for the hibernating-session path in production.

## 3. Browser enable + subscription storage

Flow proven in `apps/web/public/push-spike/` (plain page + SW, outside the
app bundle): `GET /api/push-spike/config` (VAPID key) → `PushManager`
subscribe → `POST /api/push-spike/subscribe` (zod-validated, behind the
session) returns `{ jid, node }` → page sends `<enable
jid="push.…" node="spike-…"/>` over XMPP. Spike node is deterministic
(`spike-<fnv1a(userId)>`, one node per user); the subscription lives in an
in-memory Map keyed by node. Production stores a `push_subscriptions` row
`(user_id, node, endpoint, p256dh, auth, secret, created_at)`.

## 4. Web Push: verified properties

- `web-push` 3.6.7 (+ `@types/web-push`, MPL-2.0/MIT) does VAPID + RFC 8291
  encryption: `setVapidDetails(subject, pub, priv)` once,
  `sendNotification(sub, json, { TTL: 86400 })`. Keys generated with
  `web-push generate-vapid-keys` into git-ignored `infra/.env.push-spike`
  (mode 0600); only `PUSH_VAPID_*` / `PUSH_COMPONENT_SECRET` names in docs.
- **Privacy: YES, end-to-end.** The payload JSON is encrypted by
  `web-push` between our server and the browser; Google/Mozilla/Apple
  relays see only ciphertext. The SW decrypts and shows
  `{title, body, chatId}`; click opens `/chat/<id>`.
- Encrypted payload budget ≈ 4 KiB shared with headers; the spike caps at
  3000 bytes (`payload.ts`, truncation + test).
- iOS: installed PWA only, iOS 16.4+; Chrome/Firefox/Safari all support
  the standard flow. Headless proof covers unit level (fake endpoint);
  the Helium run below proves the browser end.

## 5. Mute + private topics

`buildPushPayload` drops when `muted || !visible || !chatId` (pure, unit
tested). The spike store has no `chat_prefs`/topic rows (T-0113/T-0108 are
planned), so it passes `muted: false, visible: true`. Production joins
`chat_prefs` (mute) and topic membership (D29: hidden = no name, no count,
no history → no push) at the send site in `component.ts`, before calling
the sender.

## 6. Latency, reliability, failure modes

- Observed (unit level, fake endpoint): publish → send → IQ result in
  <1 ms; suite timings in the Report. No live ejabberd run was possible
  from here (no Helium, infra requires local secrets).
- Failure modes handled: endpoint 404/410 → delete subscription and keep
  going; send error → log + still answer IQ result (never leave ejabberd
  hanging); component `error` → logged, library auto-reconnects.
- ejabberd auto-disables a (jid, node) pair after a publish IQ error
  (non-`wait` type), so the spike answers `result` even when it drops.

## Helium proof (5 steps, ~3 min)

1. `cp infra/.env.example infra/.env` (fill secrets), set the spike
   secret in `ejabberd.yml` (`CHANGE_ME_PUSH_COMPONENT_SECRET`) or a
   macro, `pnpm infra:up`, source `infra/.env.push-spike`, start the
   server with `PUSH_SPIKE_ENABLED=true`.
2. Log in as Ana in Helium, open `/push-spike/`, Enable push, keep the
   enable stanza shown. Close the tab (no session left).
3. From a second account, DM Ana.
4. Helium shows a system notification with sender + text; click opens
   the chat.
5. Expire check: remove the browser subscription, DM again, confirm the
   server drops the row and no error IQ breaks ejabberd.

## Production outline (T-0119)

Own the component in the server process (same `component.ts`, real store);
add migration `push_subscriptions`; add raw-IQ `<enable/>`/`<disable/>`
to `xmpp-core`; join `chat_prefs` + topic membership at send; enable
`mod_push_keepalive`; solve MUC/groupchat triggers; PWA manifest +
installed-SW instead of the spike page; expire/retry metrics.

## Deps + licences

`web-push` 3.6.7 (MPL-2.0) + `@types/web-push` 3.6.4 (MIT) +
`@xmpp/component` 0.14.0 (ISC). All allowed by the spec. Keep pinned;
`web-push` is in maintenance mode — fine for a relay client.

## Risks / unknowns

MUC/groupchat messages do not trigger `mod_push` via MAM today (DM-only
until proven otherwise); `message-count` does not exist; no stanza id in
the notification (join MAM for deep-link precision); iOS needs an
installed PWA; `web-push` maintenance mode; secret rotation for the
component password needs an ejabberd reload path.
