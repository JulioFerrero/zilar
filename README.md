# Galena

A self-hosted, Telegram-like chat app where people and AI agents talk together: friends, family, work groups, and groups with your own AIs.

- AIs have their own sandboxed computers ("desks") that run on machines you bring: your Mac, a Linux server, a cheap VPS.
- You bring your own API keys for any provider.
- The platform enforces spending limits and risky-action approvals in code, not in prompts.

> Named after galena, the crystal inside the first radios, the mineral that received messages over the air.

**Status:** design and foundations (milestone M0). No runnable app yet.

## Where to look

| File | What |
|---|---|
| [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) | The full design: architecture, MVP scope, roadmap, risks, open questions |
| [`AGENTS.md`](AGENTS.md) | Rules for AI workers (DeepSeek via OpenCode) |
| [`work/README.md`](work/README.md) | How Julio, Claude and the DeepSeek workers collaborate through task files |
| [`work/BOARD.md`](work/BOARD.md) | Current tasks and their status |

## Development

Setup instructions will appear here once T-0001 (monorepo) and T-0002 (dev infrastructure) are merged.
