# Zilar: features and changes

Everything that exists in the repository today, grouped by area, with the task that built it. Status is stated honestly. New here? Start with the [user guide](USER_GUIDE.md) — every screen with a screenshot.

| Mark | Meaning |
|---|---|
| ✅ **Live** | Used or clicked through on the real stack (server + ejabberd + Postgres + LiteLLM) by Julio or the lead |
| 🟡 **Merged** | Merged with green checks (format, lint, typecheck, tests, build) and reviewed line by line; the live check is still open (steps in [`LIVE_CHECKS_2026-09-29.md`](LIVE_CHECKS_2026-09-29.md)) |
| 🧭 **Planned** | Specified, not built yet |

Task ids (`T-0042`) point to `work/T-XXXX-*.md`: the spec, the worker's report and the lead's review. The running board is [`work/BOARD.md`](../work/BOARD.md).

## 1. Chat

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Real-time DMs and group chats | XMPP (ejabberd) with history (MAM), typing, read receipts, unread divider, replies, big emoji | web, mobile, server | ✅ Live | T-0003, T-0016, T-0020, T-0022, T-0024, T-0027 |
| No random disconnects | Own XEP-0198 inbound counter (two `xmpp.js` bugs worked around), stress-tested | shared lib | ✅ Live | T-0021 |
| Live chat list | Invites and roster pushes update the list without reload | web, mobile | ✅ Live | T-0025 |
| @mentions in groups | XEP-0372 references, `@` picker, chips, highlight when it is you | web | 🟡 Merged | T-0053 |
| Reactions | XEP-0444: quick bar, chips, history-safe, DMs and groups | web | 🟡 Merged | T-0059 |
| Edit and delete for everyone | XEP-0308 corrections and XEP-0424 retractions, "edited" label, tombstones, sender-only | web | 🟡 Merged | T-0061 |
| Attachments | Images and files via XEP-0363 upload, paste, drag-and-drop, retry; images auto-load only from Zilar's own upload host | web | 🟡 Merged | T-0065 |
| Loading is never "empty" | Skeletons, inline errors with Retry, reloaded chats load their history | web, mobile | ✅ Live (web) · 🟡 (mobile) | T-0042, T-0057, T-0067 |
| Safe rich text | Markdown in AI replies (safe subset, no HTML, no images, `http/https/mailto` links only) | web, mobile | 🟡 Merged | T-0049, T-0064 |
| Topics in groups | Each group has topics (public or private) with General first; members-only rooms, a task strip with owner and status, new-topic dialog, topic panel; AIs are per topic. Web and mobile | server, web, mobile | 🟡 Merged | T-0108, T-0109, T-0110, T-0111, T-0112, T-0130 |
| Chat preferences | Per-user mute, archive and pin for chats and topics | server, web | 🟡 Merged | T-0113 |
| Message search | Across DMs, groups and topics through a read-only archive role; prefix and typo tolerant; results jump to the message | server, web, mobile | 🟡 Merged | T-0117, T-0138, T-0142 |
| Pinned messages | Banner and list in chats, groups and topics (20-pin cap); same banner and list on mobile | server, web, mobile | 🟡 Merged | T-0114, T-0135 |
| Invite links | Shareable join links with expiry, max uses and revoke; join page; same on mobile | server, web, mobile | 🟡 Merged | T-0115, T-0136, T-0140 |
| Group roles | Named roles with private-topic access and approver rights; member chips; same on mobile | server, web, mobile | 🟡 Merged | T-0116, T-0137 |
| Smarter search | Prefix match, accent folding, typo tolerance | server | 🟡 Merged | T-0142 |
| Web push and installable app | PWA (installable, offline fallback) plus push notifications behind `PUSH_*`; mute-aware, dismiss-on-read | server, web | 🟡 Merged (needs HTTPS + VAPID keys on a real deploy) | T-0119 |
| Stickers | User-made packs (PNG/WebP, size-checked), sticker panel, sending and rendering; same on mobile | server, web, mobile | 🟡 Merged | T-0120, T-0143 |
| Sticker creator and favorites | Make packs from photos, star favorites, reorder the panel | server, web | 🟡 Merged | T-0121 |
| GIFs | GIF search and sending through a privacy proxy; sent GIFs stored by us; off until `GIF_PROVIDER` + `GIF_API_KEY` are set | server, web | 🟡 Merged (needs Julio's provider key) | T-0122 |
| Channels | One-way feeds: only admins post, subscribers read-only | server, web, mobile | 🟡 Merged | T-0124, T-0144 |
| Tool host approval | New sites a tool wants to contact need one approval per tool; runs use declared ∩ approved hosts; approvals happen through the AI's card | server, web | 🟡 Merged (off by default) | T-0132 |
| Model side of AI tools | Tool guide in the turn, several model rounds per turn, "working on it" progress line | server | 🟡 Merged (not tried against a real model yet) | T-0106 |
| Tools and Routines UI | Tool list, read-only source, version history with revert, Run now, routines with plain-words schedules, pause/resume/delete | web | 🟡 Merged | T-0107 |
| Voice messages | Record and play on web (server converts to AAC/M4A, sent as an attachment); the phone mic button is still a stub | server, web | 🟡 Merged (web) · 🧭 Planned (mobile, T-0154) | T-0154 |
| Telegram sticker import | Bring your Telegram packs (needs a bot token in the server config) | server | 🟡 Merged (not yet tried with a real bot) | T-0123 |
| Mobile GIFs | Render, search and send GIFs on the phone (needs the GIF provider key in the server env) | mobile | 🟡 Merged (not yet on a device) | T-0148 |
| Push in the production deploy | ejabberd component, compose, wizard keys, doctor | deploy | 🟡 Merged (not yet on a real deploy) | T-0145 |
| Production storage safety | Sticker volume, backup/restore of both file stores, disk check, upload quotas | deploy, docs | 🟡 Merged (not yet on a real deploy) | T-0151 |
| Native iOS push | Push chain through Apple's servers (needs an Apple Developer account) | | 🧭 Planned | T-0005 |

## 2. Accounts and identity

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Invite-only sign-up | 6-digit email codes (hashed, gated, rate-limited), cookie and bearer sessions | server, web, mobile | ✅ Live | T-0015, T-0017, T-0024, T-0026 |
| Server-made XMPP accounts | JWT-only login, no passwords on the chat server, members-only rooms | server | ✅ Live | T-0003, T-0017 |
| Contacts from invites | Roster and nicknames follow invites | server | ✅ Live | T-0020 |
| Session in the OS keychain | Mobile stores the session securely | mobile | ✅ Live | T-0026 |

## 3. AIs

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Create and manage AIs | One-screen New AI, in-chat panel (name, persona, limits, model), My AIs, two-step delete | web, mobile | ✅ Live (web) · 🟡 (mobile) | T-0030, T-0032, T-0037, T-0039, T-0052 |
| Bring your own keys | Provider keys encrypted at rest (AES-256-GCM), Test/Remove, per-AI private LiteLLM model | server, web | ✅ Live | T-0028, T-0033 |
| Hard spending caps | Every AI gets a LiteLLM virtual key capped in money; cap enforced before the call | server | ✅ Live | T-0007, T-0030 |
| Costs and daily limit | Today and 30-day spend in the panel, soft daily limit before each turn, 80% budget notice | web, server | ✅ Live (costs) · 🟡 (notice) | T-0058, T-0066 |
| AIs answer in chat | Every active AI is online over XMPP; the owner's DMs get replies; honest failure texts | server | ✅ Live | T-0034, T-0050 |
| Streaming replies | Drafts stream over SSE and reveal smoothly, then hand over to the final message with no jump | server, web, mobile | ✅ Live (web) · 🟡 (mobile) | T-0041, T-0043, T-0044, T-0045, T-0056 |
| Shape an AI by chat | The owner says "be more concise": `update_persona` / `revert_persona`, one-step undo, owner DM only | server | 🟡 Merged | T-0040 |
| AIs in groups | Add your AI to a room, it answers @mentions from humans (rate-limited, never AI-to-AI) | server, web | 🟡 Merged | T-0054, T-0055 |
| Home machine | Assign an AI to one of your machines; revoking the machine unassigns | server, web | 🟡 Merged | T-0091 |

## 4. Safety: enforced in code, not in prompts

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Kill switch | Stop an AI at once: in-flight replies dropped, its XMPP session leaves, actions and routines all refuse; Resume brings it back | server, web, mobile | 🟡 Merged | T-0080, T-0083, T-0095 |
| Audit log | Append-only (database trigger refuses updates and deletes), recorder, owner and group-admin read routes, Activity sections | server, web | 🟡 Merged | T-0079, T-0083, T-0084, T-0086 |
| Approvals | Stored requests with args hash, expiry, atomic single-use decisions, sweeper for expired ones; owner (or group admin) only | server | 🟡 Merged | T-0073, T-0087 |
| Approval cards | Approve / Deny in chat, live refresh, pending count in the menu, Approvals inbox | web, mobile | 🟡 Merged | T-0076, T-0081, T-0082, T-0097 |
| Action gateway | Adapters with tiers 0/1/2, pure policy, canonical args hash, exactly-once execution of the stored args, stuck-action recovery | server | 🟡 Merged | T-0090, T-0092, T-0096 |
| `request_action` tool | The AI asks the gateway; ids come from the session, never from the model; groups: admins and owners only | server | 🟡 Merged | T-0093, T-0098 |
| "Always allow here" | Approve-always is a per-chat standing rule (personal chat or one group), revocable, audited; never for actions with a cost; **creating a group rule needs a group admin** | server, web | 🟡 Merged | T-0099, T-0100, T-0101 |
| Route authorization sweep | A test that walks every `/api` route and proves it answers 401 without a session (four allowlisted) | server | ✅ Tested | T-0088 |
| Git proxy spike | Token lifecycle and `agent/<ai>/*` branch rule; fails closed on unparseable pushes (real GitHub App still to be wired) | server | 🟡 Merged | T-0009 |

## 5. Machines and runners

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Machines registry | Single-use hashed pairing codes, proof of key possession, approve, deny, revoke | server, web | 🟡 Merged | T-0068, T-0070 |
| Runner app and hub | A small program you install pairs to the server and connects over a WebSocket tunnel (`wss://` supported); revoke drops it; off by default | runner, server | 🟡 Merged | T-0071, T-0072, T-0075, T-0077 |
| Desks and the docker driver | Sandboxed computers for AIs | runner | 🧭 Planned | plan §11 |

## 6. AI-built tools and routines (the "every morning post gold, S&P 500 and BTC" feature)

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Tool sandbox | Model-written JavaScript runs in QuickJS/WebAssembly inside a worker thread with time, memory, output and fetch limits; the only door out is a GET-only, HTTPS-only `fetch` to an exact host allowlist with DNS pinning and a private-address guard | server | 🟡 Merged | T-0102 |
| Versioned tools store | Each tool belongs to one AI in one chat; append-only history with a message per version, revert is a new version, manual run, read routes, audit without code or output | server | 🟡 Merged | T-0103 |
| Routines scheduler | A stored tool plus a schedule that posts as the AI; hourly minimum, exactly-once slots, auto-pause after 3 failures, pinned to the sites a human approved; behind `ROUTINES_ENABLED` | server | 🟡 Merged (off by default) | T-0104 |
| Tool and routine actions | `tool.save`, `tool.run`, `routine.schedule` through the gateway, wired to the sandbox behind `TOOLS_ENABLED`; scheduling needs an approval card that lists the sites and can never be "always allowed"; results reach the model as untrusted text | server | 🟡 Merged (off by default) | T-0105 |
| Keyless web tools | Guarded fetch, Wikipedia, prices, feeds, best-effort search for AIs, behind `WEB_TOOLS_ENABLED` | server | 🟡 Merged (off by default) | T-0125 |

## 7. Design and clients

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Web app | React, Vite, Tailwind; dark skeuomorphic design system (Geist, depth primitives, floating panels) | web | ✅ Live | T-0018, T-0046, T-0047, T-0062 |
| Mobile app | Expo (SDK 57, React Native 0.86), Expo Router, iOS-verified; same design language | mobile | ✅ Live (chat) | T-0011, T-0019, T-0023, T-0048 |
| Mock mode | `?mock=1` on web (dev builds only), `EXPO_PUBLIC_ZILAR_MOCK` on mobile, for design and demos without a server | web, mobile | ✅ | T-0063, T-0069 |
| Mobile boot check | `pnpm --filter @zilar/mobile boot:ios`: pods, deps, own Metro, passes only when the JS app really runs | mobile | ✅ | T-0031 |

## 8. Platform and engineering

| Feature | What it does | Where | Status | Tasks |
|---|---|---|---|---|
| Monorepo | pnpm + Turborepo; apps and shared packages | repo | ✅ | T-0001, T-0012 |
| Local infrastructure | Postgres 18 with pgvector, ejabberd, LiteLLM in Docker Compose; `pnpm infra:up`, `infra:smoke`, `xmpp:e2e` | infra | ✅ Live | T-0002 |
| Server foundation | zod config, redacted logs, JSON errors, request ids, Drizzle migrations at startup, PGlite tests | server | ✅ Live | T-0014 |
| Protocol | Versioned payload schemas for rich messages (cards, progress, attachments, approvals) | package | ✅ | T-0013 |
| Server configuration reference | Every env var, flag, migration, background job and health check | docs | ✅ | T-0094 → [`SERVER_CONFIG.md`](SERVER_CONFIG.md) |
| Self-hosted install | Production images and compose (Caddy, Coolify; config baked into images, no bind mounts), SMTP sign-in codes, `./deploy/zilar init/up/doctor/backup/restore/create-admin`, bare-metal guide ([`INSTALL_DOCKER.md`](INSTALL_DOCKER.md)) | deploy | 🟡 Merged (wizard proven live on scratch containers) | T-0126, T-0128, T-0129, T-0127 |
| Built by an AI team | A lead Claude writes specs and reviews every diff; workers implement in isolated worktrees; the `lead` CLI launches, supervises, reviews and merges; a fail-closed permission policy guards what workers may run | devtools | ✅ | T-0038, T-0051 → [`LEAD_PLAYBOOK.md`](LEAD_PLAYBOOK.md) |
| Mobile parity (chat prefs, pins, invites, roles, search, channels, stickers) | Per-user mute/archive/pin, pinned banner, invite links, roles, message search, channels, stickers — same features as web | mobile | 🟡 Merged (not run on a simulator or device yet) | T-0135, T-0136, T-0137, T-0138, T-0139, T-0140, T-0143, T-0144, T-0147 |

## Timeline

| Date | What landed |
|---|---|
| 2026-09-27 | Monorepo, protocol, infrastructure, server foundation, invite-only auth, XMPP with JWT login, chat core, web and mobile shells, first agent driver |
| 2026-09-28 | Web and mobile on real data (**M1**), provider connections, AIs on the server (**M2**), streaming replies, persona by chat, AIs in groups, reactions, edit and delete, redesign, costs and limits |
| 2026-09-29 | Attachments, audit log, kill switch, machines and runner hub (**M3**), approvals, action gateway, "always allow" rules (**M4**), tool sandbox and tools store |
| 2026-09-30 | Topics (server, web, mobile), chat preferences, message search, routines scheduler and tool adapters, keyless web tools, production images, SMTP mailer, install wizard, invite links, group roles, pinned messages, stickers, channels, tools UI, tool host approval, mobile parity |
| 2026-10-01 | Web push + PWA, smarter search, GIFs, sticker creator, model side of AI tools, mobile stickers and channels |
