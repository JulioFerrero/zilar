# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## M0: Foundations

Claude runs the DeepSeek V4.1 Flash workers through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../galena-T-XXXX`. Watch a worker live with `cd ../galena-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|

| T-0004 | Spike S2: `@xmpp/client` in Expo (connect, reconnect, background) | planned | v4-pro | T-0003 | Risky; Claude reviews closely |
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |
| T-0007 | Spike S5: LiteLLM virtual keys with budgets, adding a user's own key | planned | v4-flash | T-0002 | |
| T-0008 | Spike S6: runner tunnel prototype over one WebSocket (engine API, model traffic, preview URL) | planned | v4-pro | T-0006 | Risky; Claude reviews closely |
| T-0009 | Spike S8: GitHub App tokens and a git proxy that only allows `agent/<ai>/*` pushes | planned | v4-pro | T-0001 | |
| T-0010 | Voice message spike: record on web, convert with ffmpeg, local Whisper transcript | planned | v4-flash | T-0002 | Plan §6.7 |
| [T-0017](T-0017-xmpp-provisioning.md) | Server: XMPP account on sign-up, `POST /api/xmpp/token`, `PATCH /api/me` name | **in-progress** | v4.1-flash | T-0003, T-0015 | M1; PGlite only |

## Follow-ups

- **T-0021 (must fix before real use):** the XEP-0198 stream-management ack miscount (xmpp.js over WebSocket) makes ejabberd close sessions: "Client acknowledged more stanzas than sent by server".
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
