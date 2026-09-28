# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## M0: Foundations

Claude runs the DeepSeek V4.1 Flash workers through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../galena-T-XXXX`. Watch a worker live with `cd ../galena-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|

| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |
| [T-0027](T-0027-mobile-real-data.md) | Mobile on real data: real DMs and groups via xmpp-core, history, typing, receipts, live updates. **Last piece of M1** | todo | v4-flash | T-0004, T-0024, T-0025, T-0026 | Unblocked by T-0004 + T-0026. Must not touch metro.config.js |
| [T-0009](T-0009-git-proxy.md) | Spike S8: GitHub App tokens + a git proxy that only allows `agent/<ai>/*` pushes | todo | v4-pro | T-0001 | M3. No real GitHub App available; pure logic spike. Branch restriction is the point |
| T-0008 | Spike S6: runner tunnel prototype over one WebSocket (engine API, model traffic, preview URL) | planned | v4-pro | T-0006 | Risky; Claude reviews closely. Queued: collides with T-0007/T-0009 on apps/server |

## Follow-ups

- Deployment: set Better Auth `advanced.ipAddress` for the real proxy (from the T-0015 review).
- OAuth (Google/Apple/GitHub): first-time users must carry the invite through the redirect (from the T-0015 review).

## Done

| ID | Title | Merged |
|---|---|---|
| [T-0001](T-0001-monorepo.md) | Monorepo scaffold | 2026-09-27 |
| [T-0012](T-0012-tooling-cleanups.md) | Tooling cleanups from the T-0001 review | 2026-09-27 |
| [T-0013](T-0013-protocol-payloads.md) | Protocol v0 payload schemas (2 review rounds: fixed javascript:/data: link injection) | 2026-09-27 |
| [T-0002](T-0002-dev-infra.md) | Local dev infrastructure: Postgres 18 + pgvector, ejabberd 26.07, LiteLLM 1.102.1; `pnpm infra:up` / `infra:smoke` | 2026-09-27 |
| [T-0006](T-0006-opencode-driver.md) | `@galena/agent-drivers` + OpenCode v2 driver (2 rounds; live-tested with DeepSeek: permission flow, no replay) | 2026-09-27 |
| [T-0011](T-0011-mobile-scaffold.md) | Expo app (SDK 57, React Native 0.86, Expo Router, NativeWind + React Native Reusables); runs in the iOS simulator, light and dark | 2026-09-27 |
| [T-0014](T-0014-server-foundation.md) | Server foundation: zod config, redacted pino logs, JSON errors, request ids, Drizzle + migrations, PGlite tests | 2026-09-27 |
| [T-0003](T-0003-xmpp-accounts-rooms.md) | XMPP: server-created accounts, JWT-only login (non-admin), members-only rooms, MAM history; `pnpm xmpp:e2e` 12/12 (2 rounds) | 2026-09-27 |
| [T-0015](T-0015-auth-invites.md) | Auth: invite-only sign-up, 6-digit email codes (hashed, gated, rate-limited), cookie + bearer sessions, trusted origins (2 rounds) | 2026-09-27 |
| [T-0019](T-0019-mobile-chat-shell.md) | Mobile: Telegram-like chat list and chat screen with mock data; screenshots in `apps/mobile/screenshots/` | 2026-09-27 |
| [T-0018](T-0018-web-chat-shell.md) | Web: Telegram-like chat shell + `@galena/chat-core` (2 rounds) | 2026-09-27 |
| [T-0016](T-0016-xmpp-core.md) | `@galena/xmpp-core`: JWT reconnect, rooms, DMs, MAM, typing, receipts, payloads, real-JID resolution via occupant roster (2 rounds) | 2026-09-27 |
| [T-0017](T-0017-xmpp-provisioning.md) | Server: XMPP account on sign-up, chat token endpoint, profile name; live end-to-end invite → code → sign-in → token → XMPP online | 2026-09-27 |
| [T-0022](T-0022-web-ui-polish.md) | Web polish: new-chat button, unread divider, typing, message menu and reply, big emoji, safe links, green online dot | 2026-09-27 |
| [T-0021](T-0021-sm-ack-bug.md) | Fixed random disconnects: our own XEP-0198 inbound counter (2 xmpp.js 0.14 bugs), stress-tested 3× with 0 server closes | 2026-09-27 |
| [T-0020](T-0020-contacts-groups-chats.md) | Server: contacts from invites (roster, nick refresh), groups (MUC), `GET /api/chats` (2 rounds) | 2026-09-27 |
| [T-0024](T-0024-web-real-data.md) | **Web on real data**: invite, email code, name; real DMs and groups via xmpp-core. **Julio used it live.** | 2026-09-28 |
| [T-0023](T-0023-mobile-ui-polish.md) | Mobile polish: switch to `@galena/chat-core`, typing, unread divider, long-press menu + swipe to reply with haptics, big emoji, safe links (2 rounds) | 2026-09-28 |
| [T-0025](T-0025-real-use-fixes-1.md) | Real-use fixes 1: list status stuck on sending, live list updates (XEP-0249 invites + roster pushes), big-emoji sender name; no JID localparts in names; own typing/markers ignored in groups (3 rounds) | 2026-09-28 |
| [T-0004](T-0004-expo-xmpp-spike.md) | **Spike S2: xmpp.js works in Expo on iOS** — proven on device with 2 inline shims + a Metro stub, no new packages. Unblocks mobile on real data (2 rounds) | 2026-09-28 |
- **`brew reinstall ffmpeg` — needed from Julio (from the T-0010 review).** Homebrew's ffmpeg 8.1 is linked against a `libx265.215.dylib` that no longer exists, so `ffmpeg` and `ffprobe` cannot start on this machine and `/api/voice` returns 500. The code is merged and fine; voice messages cannot be exercised until this is run.
- **Load-sensitive web tests (broadened at the T-0027 review).** Three `apps/web` tests time out at 5-6 s when the machine is busy: `MessageActions.test.tsx > opens on right-click and closes with Escape`, `TypingIndicator.test.tsx > shows typing in the list and header after two seconds, then hides it`, and `ChatShell.test.tsx > shows the header subtitle, date separators and grouped bubbles`. They pass in isolation (85/85) and together (9/9), so they are wall-clock-sensitive, not broken. They will make CI flaky. Needs a real fix (fake timers or a longer explicit timeout), not a retry.
- M2 gateway needs `store_model_in_db` (or an equivalent config) so a user's own provider key can be **registered**, not only forwarded per request. Found by the T-0007 spike; it is an `infra/**` change and needs its own task.
| [T-0007](T-0007-litellm-virtual-keys.md) | **Spike S5: LiteLLM hard-capped virtual keys work** — cap enforced pre-flight (429), revocation and user-key forwarding proven live; cap is server-owned (2 rounds) | 2026-09-28 |
| [T-0026](T-0026-mobile-auth.md) | **Mobile sign-in for real**: invite, email code, name; session in the OS keychain. Verified live against the server with codes redacted. First slice of mobile on real data | 2026-09-28 |
- **Real GitHub App wiring for the git proxy (needs Julio's GitHub account).** T-0009 proved the token lifecycle and the `agent/<ai>/*` branch rule with fakes. Still unproven: that GitHub accepts the App JWT and mints an installation token, and the pkt-line ref parsing against a real `git` client. A worker cannot create the App, so this needs a human.
