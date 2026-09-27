# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## M0: Foundations

Claude runs the DeepSeek V4.1 Flash workers through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../galena-T-XXXX`. Watch a worker live with `cd ../galena-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|

| [T-0003](T-0003-xmpp-accounts-rooms.md) | Spike S1: accounts via admin API, JWT token login, rooms, MAM history (end-to-end script) | **in-progress** | v4.1-flash | T-0002, T-0013 | Only infra-using task running |
| T-0004 | Spike S2: `@xmpp/client` in Expo (connect, reconnect, background) | planned | v4-pro | T-0003 | Risky; Claude reviews closely |
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |
| T-0007 | Spike S5: LiteLLM virtual keys with budgets, adding a user's own key | planned | v4-flash | T-0002 | |
| T-0008 | Spike S6: runner tunnel prototype over one WebSocket (engine API, model traffic, preview URL) | planned | v4-pro | T-0006 | Risky; Claude reviews closely |
| T-0009 | Spike S8: GitHub App tokens and a git proxy that only allows `agent/<ai>/*` pushes | planned | v4-pro | T-0001 | |
| T-0010 | Voice message spike: record on web, convert with ffmpeg, local Whisper transcript | planned | v4-flash | T-0002 | Plan §6.7 |
| [T-0011](T-0011-mobile-scaffold.md) | Expo app scaffold (SDK 57, Expo Router, NativeWind, React Native Reusables) | **in-progress** | v4.1-flash | T-0001, T-0012 | Plan §17.2 |

## Done

| ID | Title | Merged |
|---|---|---|
| [T-0001](T-0001-monorepo.md) | Monorepo scaffold | 2026-09-27 |
| [T-0012](T-0012-tooling-cleanups.md) | Tooling cleanups from the T-0001 review | 2026-09-27 |
| [T-0013](T-0013-protocol-payloads.md) | Protocol v0 payload schemas (2 review rounds: fixed javascript:/data: link injection) | 2026-09-27 |
| [T-0002](T-0002-dev-infra.md) | Local dev infrastructure: Postgres 18 + pgvector, ejabberd 26.07, LiteLLM 1.102.1; `pnpm infra:up` / `infra:smoke` | 2026-09-27 |
| [T-0006](T-0006-opencode-driver.md) | `@galena/agent-drivers` + OpenCode v2 driver (2 rounds; live-tested with DeepSeek: permission flow, no replay) | 2026-09-27 |
