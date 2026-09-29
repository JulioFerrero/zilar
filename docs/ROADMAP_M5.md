# Roadmap M5: a Telegram-like chat with topics, private topics, stickers and AI teammates

Decisions D25 to D29 in [`PROJECT_PLAN.md`](PROJECT_PLAN.md). Visual spec: the Claude artifact "Galena Topics Mockup" (https://claude.ai/artifact/YKvuBAcmXzRdiyx83eppSd). Every task below has a full spec in `work/T-XXXX-*.md` (status `planned`); the lead launches them one wave at a time.

## The tasks

| # | Task | What Julio gets | Needs | Schema? |
|---|---|---|---|---|
| T-0108 | Topics, server | Groups become lists of topics; public or private; one XMPP room per topic; task strip data | none | yes |
| T-0109 | AIs in topics | An AI reads only the topics it was added to | T-0108 | yes |
| T-0110 | Topic-scoped approvals, rules, tools | "Always allow here", approvals and tools belong to one topic; private topics leak nothing | T-0108, T-0109 | yes |
| T-0111 | Topics, web | The nested sidebar, task strip on every topic, new-topic dialog, topic panel (as in the mockup) | T-0108 to T-0110 | no |
| T-0112 | Topics, mobile | Topics list and topic screen on the phone | T-0111 | no |
| T-0113 | Mute, archive, pin chats | The Telegram basics, synced across devices | T-0108 | yes |
| T-0114 | Pinned messages | Banner at the top of a chat or topic | T-0108 | yes |
| T-0115 | Invite links | "Join by link" for groups | T-0108 | yes |
| T-0116 | Group roles | Designers/Devs roles: private-topic access and approver rights | T-0108, T-0110, T-0111 | yes |
| T-0117 | Message search | Find messages across everything you may see | T-0108 | no |
| T-0118 | Web push spike | Proof that notifications work through ejabberd | none | no |
| T-0119 | PWA and web push | Installable Galena with notifications | T-0118, T-0113 | yes |
| T-0120 | Stickers | User-made packs, sticker panel, sending | none | yes |
| T-0121 | Sticker creator | Make packs from photos, favorites, discover | T-0120 | yes |
| T-0122 | GIFs | GIF search and sending, private (no provider tracking) | T-0120; **provider key from Julio** | no |
| T-0123 | Telegram sticker importer | Bring your Telegram packs | T-0120, T-0121; **bot token from Julio** | yes |
| T-0124 | Channels | One-way feeds, only admins post | T-0108, T-0115 | yes |
| T-0104 to T-0107 | Routines, AI tool actions, model side, tools UI | "Every morning post gold, S&P and BTC" | T-0110 (T-0104, T-0105 specs are updated for topics; T-0106, T-0107 are written after T-0105) | T-0104 yes |
| T-0128 | SMTP mailer | Sign-in codes by real email; production installs cannot start without it (found in T-0126) | none | no |
| T-0126 | Production images and compose | Docker Compose and Coolify install, Caddy HTTPS (D30, easy install) | none | no |
| T-0127 | Install wizard, backup, bare metal | `./galena init`, backup/restore, systemd guide | T-0126 | no |
| T-0125 | Web tools for AIs | `web.price` (gold, S&P, BTC), Wikipedia, feeds, page reading and a best-effort search, all keyless (no SearXNG/Exa for now) | T-0105 | no |

## Order for tonight

Rules of the night (the laptop nearly died last time): **at most two workers at a time; every worker runs the full test suite once, at the end, with `--maxWorkers=2`; only one task that changes the database schema at a time** (two parallel migrations collide); the lead reviews every diff line by line, security code twice, then merges and restarts the server after each server merge; all workers use `meta/muse-spark-1.3-contributor` only.

| Wave | Runs | Why this pairing |
|---|---|---|
| 1 | T-0108 (schema) with T-0118 (spike, no schema) | The core, plus the only task that answers an open question |
| 2 | T-0109 | Depends on 1 |
| 3 | T-0110 | Depends on 1 and 2; the riskiest review (scope of approvals) |
| 4 | T-0111 (web) with T-0104 (routines, schema) | Web and server do not collide |
| 5 | T-0112 (mobile) with T-0113 (schema + web) | Different apps |
| 6 | T-0114 with T-0105 | Pins (schema) and tool actions (no schema) |
| 7 | T-0115, then T-0116 with T-0117 | Links, then roles and search |
| 8 | T-0120, then T-0121 with T-0122 | Stickers, then the creator and GIFs |
| 9 | T-0119 (after the spike's GO), T-0123, T-0124 | The rest |

Realistically, one night reaches waves 1 to 5. The lead writes T-0106 and T-0107 after T-0105 merges, and rewrites the marked sections of T-0119 after the spike.

## Things only Julio can provide (none blocks waves 1 to 5)

- **GIF provider and API key** (T-0122): the code sits behind a port; start with Giphy, key in `infra/.env` as `GIF_API_KEY`.
- **Telegram bot token** (T-0123): create a bot with @BotFather, put the token in `infra/.env` as `TELEGRAM_BOT_TOKEN`.
- **A real HTTPS address** for push on real devices (T-0119): Web Push needs HTTPS (localhost is fine for development). That is the Coolify deployment.
- Apple developer account, only later, for native push and TestFlight.

## Decisions the lead made in the specs (change any of them by telling the lead)

1. **Group owners and admins do not see private topics they were not added to.** They can create private topics and add people. If a private topic loses all its members it is archived.
2. **Making a private topic public exposes its history to the whole group**, so it needs an explicit confirmation.
3. **The scope of approvals, "always allow" rules and tools is (AI, topic)**, not the whole group. "Always allow here" applies to one topic. Existing group data moves to the group's General topic.
4. **Every topic is its own XMPP room**, and the group's existing room becomes its General topic.
5. Plain members create topics only if the group allows it (off by default).
6. Stickers: static PNG or WebP only, at most 512 KiB and 512 px, checked by their bytes. Imported Telegram packs are private, for personal use.
7. GIFs: the browser never talks to the provider; a sent GIF is stored by us as an attachment.
8. Channels: the room is moderated by the chat server, so subscribers cannot post even with a modified client.
9. Search reads ejabberd's message archive through a read-only database role, restricted to chats the caller may see.
10. Roles are labels with two powers (private-topic access and approver rights), not a full permission matrix.
