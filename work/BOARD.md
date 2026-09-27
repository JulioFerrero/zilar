# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## M0: Foundations

The name and stack are confirmed. T-0001 and T-0002 are ready to start. Claude writes the specs for the other tasks as their dependencies finish.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|
| [T-0001](T-0001-monorepo.md) | Monorepo scaffold: pnpm + Turborepo, TypeScript strict, lint, Vitest, CI | **todo** | v4-pro | – | Start here |
| [T-0002](T-0002-dev-infra.md) | Dev infrastructure: docker-compose with Postgres, ejabberd, LiteLLM (pinned) | **todo** | v4-pro | T-0001 | No MinIO (plan D21) |
| T-0003 | Spike S1: ejabberd WebSocket, groups, history, account creation through the API, token login | planned | v4-pro | T-0002 | Plan §23 |
| T-0004 | Spike S2: `@xmpp/client` in Expo (connect, reconnect, background) | planned | v4-pro | T-0003 | Risky; Claude reviews closely |
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |
| T-0006 | Spike S4: OpenCode `serve` in Docker, prompt, event stream, permission request/reply | planned | v4-pro | T-0001 | |
| T-0007 | Spike S5: LiteLLM virtual keys with budgets, adding a user's own key | planned | v4-flash | T-0002 | |
| T-0008 | Spike S6: runner tunnel prototype over one WebSocket (engine API, model traffic, preview URL) | planned | v4-pro | T-0006 | Risky; Claude reviews closely |
| T-0009 | Spike S8: GitHub App tokens and a git proxy that only allows `agent/<ai>/*` pushes | planned | v4-pro | T-0001 | |
| T-0010 | Voice message spike: record on web, convert with ffmpeg, local Whisper transcript | planned | v4-flash | T-0002 | Plan §6.7 |
| T-0011 | Expo app scaffold in the monorepo (Expo Router, NativeWind, React Native Reusables, dev build) | planned | v4-pro | T-0001 | Plan §17.2 |

## Done

(none yet)
