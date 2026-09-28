# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## Active (M1 complete; next: M2 AIs that talk)

Claude runs the workers (DeepSeek V4.1 Flash, MiMo-V2.6-Flash, Muse Spark 1.3; **no V4 Pro**, Julio 2026-09-28) through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../galena-T-XXXX`. Watch a worker live with `cd ../galena-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|
| [T-0028](T-0028-connections-ui.md) | Connections: provider API keys encrypted at rest, `/api/connections`, Settings → Connections screen | changes requested (round 2 running) | v4.1-flash | T-0007 | Round 1: menu entry + back button, honest 503 when unconfigured, HKDF instead of scrypt, trim keys, safe Remove, 429 mapping. Lead runs the gated live test after round 2. Watch: `cd ../galena-T-0028 && opencode2 -s ses_f18ca6a9affeWKUC4q5RKlN6Ty` |
| [T-0029](T-0029-flaky-web-tests.md) | Fix the three load-sensitive `apps/web` tests | **approved, waiting for Julio to merge** | v4.1-flash | | Per-test commented timeouts; verified by the lead with 2 forced full-suite runs under a CPU burner. |
| [T-0008](T-0008-runner-tunnel-spike.md) | Spike S6: runner tunnel over one WebSocket (engine API, model traffic, preview URL) | in progress | muse-spark-1.3 | T-0006 | New package `packages/runner-tunnel` only. Decides the M3 design. Watch: `cd ../galena-T-0008 && opencode2 -s ses_f18ca69fbffeB8AWtuJJ4Bp5mb` |
| [T-0031](T-0031-mobile-boot-check.md) | Mobile boot check: build, launch and watch the iOS app; fail on native/bundle errors | in progress | mimo-v2.6-flash | | Would have caught the T-0026 `ExpoSecureStore` crash. Uses the iPad simulator + Metro 8082. Watch: `cd ../galena-T-0031 && opencode2 -s ses_f18ca6963ffeD4I0UTRes2oAWy` |
| T-0030 | M2: Create-AI wizard (reserved by the T-0028 spec) | planned | | T-0028 | Spec after T-0028 merges; it touches the same server files. |
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |

## Follow-ups

- Deployment: set Better Auth `advanced.ipAddress` for the real proxy (from the T-0015 review).
- OAuth (Google/Apple/GitHub): first-time users must carry the invite through the redirect (from the T-0015 review).
- M2 gateway needs `store_model_in_db` (or an equivalent config) so a user's own provider key can be **registered**, not only forwarded per request. Found by the T-0007 spike; it is an `infra/**` change and needs its own task.
- **Real GitHub App wiring for the git proxy (needs Julio's GitHub account).** T-0009 proved the token lifecycle and the `agent/<ai>/*` branch rule with fakes. Still unproven: that GitHub accepts the App JWT and mints an installation token, and the pkt-line ref parsing against a real `git` client. A worker cannot create the App, so this needs a human.
- `apps/mobile/ios/` is generated and gitignored: after any native dependency change, run `pod install` (T-0031 automates the check).

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
| [T-0007](T-0007-litellm-virtual-keys.md) | **Spike S5: LiteLLM hard-capped virtual keys work** — cap enforced pre-flight (429), revocation and user-key forwarding proven live; cap is server-owned (2 rounds) | 2026-09-28 |
| [T-0026](T-0026-mobile-auth.md) | **Mobile sign-in for real**: invite, email code, name; session in the OS keychain. Verified live against the server with codes redacted. First slice of mobile on real data | 2026-09-28 |
| [T-0027](T-0027-mobile-real-data.md) | **Mobile on real data** — real DMs and groups via xmpp-core; gated live integration verified by the lead. **M1 complete** | 2026-09-28 |
| [T-0009](T-0009-git-proxy.md) | Spike S8: GitHub App tokens + git proxy allowing only `agent/<ai>/*` pushes; fails closed on unparseable pushes (2 rounds) | 2026-09-28 |
