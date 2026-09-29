---
id: T-0119
title: Installable web app (PWA) with web push notifications
status: planned
milestone: M5
branch: task/T-0119-pwa-web-push
model: meta/muse-spark-1.3-contributor
depends_on: [T-0118, T-0113]
estimate: 4 days
---

# T-0119: PWA and web push

## Spec (written by Claude, do not edit)

> **Rewritten by the lead from `docs/PUSH_SPIKE.md` (T-0118 verdict GO, 2026-09-29).** The spike code is preserved on the branch `spike/T-0118-push` (`apps/server/src/push-spike/**`, `apps/web/public/push-spike/**`); promote it from there (`git show spike/T-0118-push:<path>`), do not re-invent it. Start with the live gate in part 2.

### Why
D28: an installable Galena that notifies you like a native chat app, on desktop, Android and iOS (iOS only for an installed PWA, 16.4+). Notifications honour mute (T-0113), private topics (T-0108) and the kill switch.

### Parts
1. **Installable app** (web): `manifest.webmanifest` (name Galena, standalone display, dark theme color `#000000`, background `#0a0a0a`, start URL `/`), icons 192/512 (+ maskable) and `apple-touch-icon` as **PNG files committed under `apps/web/public/icons/`**, generated once from an SVG mark with macOS `sips` (document the exact commands in `apps/web/public/icons/README.md`; no new dependency), `<meta name="theme-color">`, and an **Install** entry in the main menu when the browser offers `beforeinstallprompt` (and a short "Add to Home Screen" hint on iOS Safari). A service worker (`apps/web/public/sw.js`, hand-written, no build plugin) that: takes control without caching API or WebSocket traffic (no offline mode in this task; a tiny offline page for navigation failures only), handles `push` and `notificationclick`. It must not break `vite dev` or the production build (test both).
2. **Push service** (from the spike). Gate first: **prove on a live ejabberd (local infra) that a MUC/Sub event for a subscribed user with no session produces the XEP-0357 notification IQ at our component** (write the proof as a script or test under `apps/server/src/push/` and put the result in the Report). If it does not, stop, set `status: blocked` and explain in the Report; the lead then decides between a MAM-polling component and other options. If it does:
   - **Rooms**: topic and group rooms are created with `allow_subscription: true` (change `createRoom` options in `xmpp/admin-client.ts`/`topics/rooms.ts` and add a one-time reconcile for existing rooms via `change_room_option`); every member with a push device is subscribed to the rooms they may see (`subscribe_room` admin command), kept in sync by the same `desiredMembers` logic as affiliations (removing a member or making a topic private unsubscribes them). A private topic's room only ever holds its members.
   - **Component**: promote the spike's `component.ts` (XEP-0114, `@xmpp/component`) into `apps/server/src/push/`, started by the server only when `PUSH_ENABLED=true`; loopback listener + secret in `infra/ejabberd/ejabberd.yml` (macro/`CHANGE_ME` placeholder, real secret from `infra/.env`, never committed); `mod_push` stays with **`include_sender` and `include_body` both false** (the spike turned them on for its proof only); enable `mod_push_keepalive`.
   - **Data**: table `push_subscriptions` (`id`, `user_id`, `node` unique, `endpoint`, `p256dh`, `auth` stored encrypted with a server key `PUSH_STORAGE_KEY` (AES-256-GCM, zod-validated env), `user_agent` label, `created_at`, `last_used_at`, `failed_at`), routes to add/list/remove own devices, VAPID env names `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, `PUSH_COMPONENT_JID`, `PUSH_COMPONENT_SECRET`, all documented in `docs/SERVER_CONFIG.md`.
   - **Browser enable**: ejabberd needs the `<enable/>` IQ from the user's own XMPP session (no admin shortcut). Add a small raw-IQ sender to `packages/xmpp-core` (enable/disable push, with tests) and call it from the web app after the subscription is stored.
   - Since ejabberd's summary carries no message text (bodies off), the component looks up what to show itself: it reads the newest archived message for the room from the chat archive (read-only, like T-0117) or, if the spike shows that is not workable, shows a generic "New message in <chat>" without text; the Report says which.
3. **What gets sent**: the notification says who and where (`Ana` in `Acme Web › Bug: checkout…`) and, **only when the user's "Show message previews" setting is on**, the first 120 characters of the text. Payload JSON is encrypted end to end by `web-push` (the relay sees ciphertext), capped at 3000 bytes. A private topic's name is only sent to a user who can see that topic (re-check at send time with `canSeeTopic`, not at subscribe time). Muted chats and chats muted through their group send nothing (T-0113). Expired subscriptions (404/410) are deleted; the component answers every ejabberd publish IQ with `result` even when it drops the notification (ejabberd disables a push pair after an error IQ). A stopped AI's messages never exist, so nothing to do there. No message text or endpoint URL in logs.
4. **Settings UI**: Settings → Notifications: enable on this device (asks the browser permission only from a click), the device list with Remove, "Show message previews" toggle (server-stored per user), a "Send a test notification" button (rate limited), and clear states for "blocked in browser settings" and "not supported".
5. **Click-through**: `notificationclick` focuses an existing window or opens `/c/<chatJid>`; the app clears the notification when the chat is read; the app badge (`navigator.setAppBadge`) shows total unread (excluding muted) where supported.
6. Cleanup: expired subscriptions (404/410 from the push service) are deleted; a device that never receives anything for 90 days is listed as inactive.

### Read first
- `AGENTS.md`; `docs/PUSH_SPIKE.md` (from T-0118) and its Review; `work/T-0113-chat-prefs.md`; `work/T-0108-topics-server.md` (visibility)
- `apps/web/index.html`, `vite.config.ts`, `apps/web/src/main.tsx`, the settings pages (`routes/*Page.tsx`), `components/ChatList.tsx` (menu)

### Allowed files
- `apps/web/**` (public, src, `index.html`, `vite.config.ts` only if needed), `apps/server/src/push/**` (new; promotes the spike), `apps/server/src/db/schema.ts` + migration, `apps/server/src/{app,index,config}.ts` (+ tests), `authz-sweep.test.ts`, `infra/ejabberd/ejabberd.yml` (the spike lines made permanent, per the spike)
- `packages/xmpp-core/src/**` (raw push enable/disable IQ + tests), `apps/server/src/{xmpp/admin-client.ts,topics/rooms.ts,groups/service.ts}` (room options and subscription sync only)
- `docs/SERVER_CONFIG.md`, `work/T-0119-pwa-web-push.md`

**Not allowed:** mobile, other packages, dependencies except `web-push`, `@types/web-push`, `@xmpp/component` (the spike's list, versions as on the spike branch).

### Tests
Manifest and icons exist and are valid JSON/PNG; service-worker logic as pure modules with fakes (payload → notification, click routing, mute/private filtering); server: subscription CRUD and authorization (own devices only), send-time visibility and mute checks, expired-subscription cleanup, rate limits, no message text in logs; web: settings states, install hint logic, badge helper.

### Live check (the lead, with Julio in Helium)
1. Local infra up with `PUSH_ENABLED=true`; log in as Ana in Helium, Settings → Notifications → Enable on this device, allow the browser prompt. 2. Close the Galena tab. 3. From a second account, message Ana in a DM, then in a group topic. 4. Both show a system notification (sender + place; text only when previews are on); click opens that chat. 5. Mute the topic, message again: nothing. 6. Make the topic private without Ana: nothing. 7. Remove the device in settings; message again: nothing and no server error. 8. iOS: Add to Home Screen, then repeat 1 to 4 (needs the real HTTPS address).

### Acceptance criteria
- [ ] The app installs; a DM to an offline user shows a notification that opens the chat.
- [ ] Muted chats and private topics the user cannot see never notify; previews respect the setting; group and topic messages notify (not only DMs).
- [ ] Off by default (`PUSH_ENABLED=false`); no secrets committed; no message text in logs.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Offline mode, background sync, native (APNs/FCM) push, mobile app changes, per-topic sounds, usage or cost tracking.

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

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
