---
id: T-0119
title: Installable web app (PWA) with web push notifications
status: planned
milestone: M5
branch: task/T-0119-pwa-web-push
model: meta/muse-spark-1.3-contributor
depends_on: [T-0118, T-0113]
estimate: 3 days
---

# T-0119: PWA and web push

## Spec (written by Claude, do not edit)

> **This spec is an outline.** T-0118 (the spike) decides the exact design. **The lead rewrites the sections marked (SPIKE) from `docs/PUSH_SPIKE.md` before this task is launched**; a worker must not start while any (SPIKE) marker is left.

### Why
D28: an installable Galena that notifies you like a native chat app, on desktop, Android and iOS (iOS only for an installed PWA, 16.4+). Notifications honour mute (T-0113), private topics (T-0108) and the kill switch.

### Parts
1. **Installable app** (web): `manifest.webmanifest` (name Galena, standalone display, dark theme color `#000000`, background `#0a0a0a`, start URL `/`), icons 192/512 (+ maskable) and `apple-touch-icon` as **PNG files committed under `apps/web/public/icons/`**, generated once from an SVG mark with macOS `sips` (document the exact commands in `apps/web/public/icons/README.md`; no new dependency), `<meta name="theme-color">`, and an **Install** entry in the main menu when the browser offers `beforeinstallprompt` (and a short "Add to Home Screen" hint on iOS Safari). A service worker (`apps/web/public/sw.js`, hand-written, no build plugin) that: takes control without caching API or WebSocket traffic (no offline mode in this task; a tiny offline page for navigation failures only), handles `push` and `notificationclick`. It must not break `vite dev` or the production build (test both).
2. **Push service** (SPIKE): server-side component and data model as recommended by the spike: table `push_subscriptions` (`id`, `user_id`, endpoint hash, encrypted keys or the raw subscription as the spike decides, `user_agent` label, `created_at`, `last_used_at`, `failed_at`), routes to add/list/remove devices, the XEP-0357 component from the spike promoted to production code under `apps/server/src/push/`, gated by `PUSH_ENABLED` (default false) and the VAPID env names from the spike, documented in `docs/SERVER_CONFIG.md`.
3. **What gets sent** (SPIKE): the notification says who and where (`Ana` in `Acme Web › Bug: checkout…`) and, **only when the user's "Show message previews" setting is on**, the first 120 characters of the text; a private topic's name is only ever sent to a user who can see that topic (re-check at send time, not at subscribe time). Muted chats and chats muted through their group send nothing (T-0113). A stopped AI's messages never exist, so nothing to do there.
4. **Settings UI**: Settings → Notifications: enable on this device (asks the browser permission only from a click), the device list with Remove, "Show message previews" toggle (server-stored per user), a "Send a test notification" button (rate limited), and clear states for "blocked in browser settings" and "not supported".
5. **Click-through**: `notificationclick` focuses an existing window or opens `/c/<chatJid>`; the app clears the notification when the chat is read; the app badge (`navigator.setAppBadge`) shows total unread (excluding muted) where supported.
6. Cleanup: expired subscriptions (404/410 from the push service) are deleted; a device that never receives anything for 90 days is listed as inactive.

### Read first
- `AGENTS.md`; `docs/PUSH_SPIKE.md` (from T-0118) and its Review; `work/T-0113-chat-prefs.md`; `work/T-0108-topics-server.md` (visibility)
- `apps/web/index.html`, `vite.config.ts`, `apps/web/src/main.tsx`, the settings pages (`routes/*Page.tsx`), `components/ChatList.tsx` (menu)

### Allowed files
- `apps/web/**` (public, src, `index.html`, `vite.config.ts` only if needed), `apps/server/src/push/**` (new; promotes the spike), `apps/server/src/db/schema.ts` + migration, `apps/server/src/{app,index,config}.ts` (+ tests), `authz-sweep.test.ts`, `infra/ejabberd/ejabberd.yml` (the spike lines made permanent, per the spike)
- `docs/SERVER_CONFIG.md`, `work/T-0119-pwa-web-push.md`

**Not allowed:** mobile, other packages, dependencies beyond those the spike added.

### Tests
Manifest and icons exist and are valid JSON/PNG; service-worker logic as pure modules with fakes (payload → notification, click routing, mute/private filtering); server: subscription CRUD and authorization (own devices only), send-time visibility and mute checks, expired-subscription cleanup, rate limits, no message text in logs; web: settings states, install hint logic, badge helper.

### Live check (the lead, with Julio in Helium)
Steps written after the spike; include iOS Add to Home Screen.

### Acceptance criteria
- [ ] The app installs; a DM to an offline user shows a notification that opens the chat.
- [ ] Muted chats and private topics the user cannot see never notify; previews respect the setting.
- [ ] Off by default (`PUSH_ENABLED=false`); no secrets committed; no message text in logs.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
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
