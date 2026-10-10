# Zilar: Project Plan

> **Status:** design phase, no code yet
> **Last updated:** 2026-09-27
> **Owner:** Julio
> **Name:** Zilar, the Basque word for silver.
> **Repo:** `JulioFerrero/zilar` (private)
>
> This document collects everything decided and researched so far, the proposed architecture, the MVP scope, the roadmap, the risks, and every open question. Anything marked **(proposal)** still needs Julio's OK.

---

## Table of contents

0. [Summary](#0-summary)
1. [Glossary](#1-glossary)
2. [Vision and requirements](#2-vision-and-requirements)
3. [Decisions made so far](#3-decisions-made-so-far)
4. [Will it work? Feasibility](#4-will-it-work-feasibility)
5. [Architecture overview](#5-architecture-overview)
6. [Chat layer (XMPP)](#6-chat-layer-xmpp)
7. [Accounts, workspaces and roles](#7-accounts-workspaces-and-roles)
8. [AIs, providers and budgets](#8-ais-providers-and-budgets)
9. [How AIs work together](#9-how-ais-work-together)
10. [The AI engine inside each desk](#10-the-ai-engine-inside-each-desk)
11. [Compute: bring your own compute (runners)](#11-compute-bring-your-own-compute-runners)
12. [Git and the code workflow](#12-git-and-the-code-workflow)
13. [Web search and browsing](#13-web-search-and-browsing)
14. [Memory](#14-memory)
15. [Security model](#15-security-model)
16. [Costs](#16-costs)
17. [Tech stack (proposal)](#17-tech-stack-proposal)
18. [Repository layout (proposal)](#18-repository-layout-proposal)
19. [Data model sketch](#19-data-model-sketch)
20. [Example flows](#20-example-flows)
21. [MVP scope](#21-mvp-scope)
22. [Roadmap and milestones](#22-roadmap-and-milestones)
23. [Things to verify early (spikes)](#23-things-to-verify-early-spikes)
24. [Prior art and competitors](#24-prior-art-and-competitors)
25. [Open questions for Julio](#25-open-questions-for-julio)
26. [Sources](#26-sources)

---

## 0. Summary

We are building a self-hosted, messenger-style platform where **people and AI agents work together in group chats**. It's a normal chat app for every part of life: friends, a partner, work groups, and groups with your AIs, all in one account and one chat list.

- **AI desks.** Each AI gets its own sandboxed computer, called a *desk*. It can clone repos, write, run and commit code, search the web, test apps and remember what it learns.
- **Bring your own compute.** Desks run on machines the users bring themselves: a Mac, a Linux server, a cheap VPS.
- **Hard limits.** The platform itself enforces spending and risky-action limits. We never rely on prompts for that.

| Layer | Choice |
|---|---|
| Chat | XMPP (ejabberd) with our own **React web app** and **React Native (Expo) mobile app** |
| Platform backend | A TypeScript **server** that owns accounts, AIs, context building, delegation, approvals, budgets and the audit log |
| AI engine | **OpenCode** running inside each desk, driven by the server through our own interface **(proposal)** |
| Compute | **Runners**, a small app anyone installs on any machine. It connects out to the platform and hosts desks. |
| Keys | **Bring your own API key** per AI. Real keys live only in the platform's LLM gateway (LiteLLM), and desks only get capped placeholder keys. |
| Who speaks | A cheap **listener AI** in each room reads everything and wakes the right AI. Expensive AIs sleep until needed. |

**Verdict:** this is feasible, and a real MVP is realistic. Each piece has been built and proven separately in 2025–2026. The work is integration and keeping the scope tight. See [§4](#4-will-it-work-feasibility).

---

## 1. Glossary

| Term | Meaning |
|---|---|
| **Workspace** | A company, a department or a group of friends. It contains members, rooms, AIs and machines. |
| **Room** | A group chat, which is an XMPP MUC room. |
| **AI** | An agent with a name, a personality, a model, an owner, a budget and tools. It is its own chat user. |
| **Desk** | An AI's sandboxed computer for one project: repo, shell, browser, memory folder. |
| **Runner** | Our app installed on a machine (Mac, Linux, VPS). It creates desks and carries their traffic to the platform. |
| **Driver** | A runner plugin that knows one way to create desks: Docker, gVisor, a VM, a macOS VM, a cloud service. |
| **Tool pack** | A set of extra tools a desk gets when its machine has something special, such as Xcode. |
| **Listener** | The cheap always-on AI in each room. It reads everything, wakes the right AI and keeps notes. |
| **Board** | Shared, structured state for a room: tasks, decisions, artifacts. |
| **Handoff** | One AI passing a task to another, in a structured format. |
| **Tier 0/1/2** | Risk levels of actions. Tier 2 needs human approval. |
| **Approval card** | An in-chat card with Approve and Deny buttons for a Tier 2 action. |
| **BYOK / BYOC** | Bring your own key / bring your own compute. |
| **JID** | An XMPP address, like `ana@example.com`. The *bare JID* has no device suffix. |
| **MUC / MAM** | Multi-User Chat (groups) and Message Archive Management (history sync). |
| **LLM gateway** | LiteLLM. It holds real provider keys and enforces per-AI budgets. |

---

## 2. Vision and requirements

These are Julio's requirements, quoted where possible.

1. **Messenger-style chat on web and phone.** Groups and DMs with other users *and* AIs.
2. **AIs with "little virtual PCs".** "Have repos, run scripts, edit files", "talk to each other", "save what they learn".
3. **General-purpose AIs**, "like any other AI agent can do, like you in Claude, OpenCode, Hermes": write code, research a topic, find bugs in a UI, and so on.
4. **Users are friends or companies** in the same department. "That doesn't mean we don't have security."
5. **Bring your own key, several providers.** "When creating the AI, the user needs to configure an API key for a platform." Example: Opus as a "boss AI" that delegates to DeepSeek worker AIs.
6. **Autonomous, with guardrails.** "The AIs need to be totally independent, but … if an AI has access to publishing ads in Google Ads, don't let the AI drop 1000 euros in a campaign."
7. **Cheap.** "I'm poor." Paying €100 a month for compute alone doesn't make sense.
8. **Always-listening cheap AIs.** "Some cheap AIs able to read all the chat all the time." When they see the boss or another AI is needed, they tag it.
9. **Bring your own compute.** A Docker image or app "that users can install in a Mac, Linux server, whatever and connects to the app". The admin sets which AI runs on which machine, for example a Linux server with a better CPU for multitasking and a Mac for QA on an iPhone. It must be "modular and simple to connect".
10. **First use case:** a team of developers, a PM and marketing people working together.
11. **A normal chat app for every part of life.** "Needs to work both ways, just like any chat app." Work groups, personal groups with friends, groups with my AIs, chatting with my girlfriend, all in one app.
12. **Easy for non-technical people** to register and log in.
13. **Who builds it:** Julio, Claude, and "a big team of DeepSeek agents". There's no deadline.
14. **First users:** Julio and his friends.

---

## 3. Decisions made so far

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Chat protocol | XMPP (ejabberd) with our own clients | Matrix was rejected: Julio used it for a week and the clients were bad. Owning the clients fixes the experience. XMPP gives us proven accounts, groups, history, presence, uploads and push. |
| D2 | Clients | React (web) and React Native (mobile) | Julio's choice. Both share TypeScript logic. |
| D3 | AI ownership | Both person-owned and workspace-owned AIs | Julio's answer |
| D4 | Approvals | The group admin approves risky actions, but can never go above the AI owner's hard limits | Julio's answer, plus protection for owners |
| D5 | Git host | Depends on the client. Start with GitHub. | Julio's answer |
| D6 | Who speaks | A cheap always-listening AI per room wakes or tags the other AIs | Julio's idea, backed by research ([§9.3](#93-the-listener-scribe)) |
| D7 | Compute | Bring your own compute (runners), with cloud only as an optional fallback | Cost and flexibility |
| D8 | Providers | Several providers, bring your own key per AI | Julio's answer |
| D9 | AI engine | Embed OpenCode in desks behind our own driver interface **(proposal)** | Multi-provider, TypeScript, HTTP API, approval hooks |
| D10 | First team | Developers, PM, marketing | Julio's answer |
| D11 | Runner assignment | The admin assigns AIs to machines. Machines report what they can do. | Julio's answer |
| D12 | App model | One account with a **personal side** (contacts, DMs, friend groups, personal AIs) and optional **workspaces** (work groups, admins, policies), in one chat list | Julio: "just like any chat app" |
| D13 | Login | No passwords by default: invite links, Continue with Google / Apple, email 6-digit code, passkeys later | Easy for non-technical people |
| D14 | Builders | Julio (product owner) + Claude (architect, lead, reviewer) + DeepSeek agents (implementers) | Julio's answer, see [§22.1](#221-how-we-build-it-julio--claude--deepseek-agents) |
| D15 | Hosting | Julio's personal Coolify server for the control plane, if it has enough free RAM | Julio: the server is personal |
| D16 | Budget | Not a constraint during development | Julio: "don't worry about that" |
| D17 | Pilot | Julio and his friends | Julio's answer |
| D18 | Name | **Zilar** | Julio's choice. Basque for silver. |
| D19 | Privacy model | **Cloud chats:** normal chats are stored on the server and readable by it (that's what lets AIs, sync and search work). **No end-to-end encrypted chats for now.** | Julio's decision |
| D20 | Stack | Confirmed: Vite + React web app, Hono + Drizzle + Postgres, Better Auth, pnpm + Turborepo, Expo for mobile ([§17.2](#172-mobile-react-native--expo)) | Julio: "I love the stack" |
| D21 | Object storage | **No MinIO:** its Docker images were deleted from Docker Hub in September 2026. File uploads use ejabberd's built-in upload for the MVP, Supabase Storage in production, and Garage or RustFS if we need S3 locally. | Research on 2026-09-27 |
| D22 | OpenCode service network access | Julio's OpenCode v2 service stays reachable on his home network (`hostname 0.0.0.0`, password-protected) | Julio: "keep it open". He uses it from his phone. |
| D23 | UI style | **Close to a classic messenger** in layout, patterns and feel, with no third-party brand assets. Source of truth: `docs/design/ui-style.md`. | Julio: "we need to be closer to what a classic messenger is"; more detail once he's used the app |
| D24 | UI depth | Vercel-dark look with skeuomorphic depth on buttons and bubbles; mockup in `docs/design/mockups/` | Julio, 2026-09-28. Source of truth: `docs/design/ui-style.md` |
| D25 | Topics in groups | **Forum style:** a group is a list of topics, each its own conversation with its own unread count. On desktop the topics are **nested under the group in the sidebar**; on mobile a group opens to its topics list. Topics and their metadata live in our database; XMPP stays the transport. | Julio, 2026-09-29, after the topics mockup |
| D26 | Task strip | **Every topic** carries a thin task strip under the header (type: bug, UI, task or routine; status; owner, a person or an AI; linked PR). It is not a board. AI progress, previews and approval cards live in the topic, so the main room stays quiet. | Julio, 2026-09-29 |
| D27 | Stickers, GIFs, importer | Stickers are **created by users** (packs). A **Telegram sticker importer** is a must-have for migration (later task). A **GIF section** is wanted. Open: GIF provider (with a proxy so users' IPs are not sent), and the copyright stance for imported packs (personal use). | Julio, 2026-09-29 |
| D28 | Product focus | Be a good **daily chat for humans first**, a classic messenger's flow (chats, groups, channels, topics, stickers, folders): PWA with web push, search, pinned messages, forwarding, media gallery, mute and archive, voice notes, invite links. Then workspaces and roles, then the AI coding flow. **No inbox and no "catch up" feature** (Julio: "I don't like that"). | Julio, 2026-09-29 |
| D29 | Public and private topics | **Discord-style access:** a topic is **public** (every group member) or **private** (only chosen people, roles or AIs). A private topic is hidden completely from everyone else: no name, no unread count, no history. **Each topic is its own XMPP room**, so the chat server itself enforces who receives a private topic's messages (one room per group could not). Our database owns group membership and topic membership and syncs it into the rooms. An AI reads only the topics it was added to. Roles (owner, admin, member, custom roles such as Designers) can grant topic access and can be the approvers for a topic. | Julio, 2026-09-29: "not all users in a group have access to all the tasks and channels" |
| D30 | Easy install (A), hosted service (B), open core | **A first:** anyone can install their own Zilar with **Docker Compose, a Coolify template, or on bare metal** (systemd, own Postgres/ejabberd), using published images, a setup wizard that generates every secret, and automatic HTTPS. **B later:** a hosted Zilar run as a service for family, friends and people who want to try it; **one shared instance for everyone** (new people, friends, work), like any messenger, not one instance per team. Same code for both. **Open core:** the whole product stays open source and free; a paid enterprise layer (SSO/SAML, audit export, retention rules, an admin console, support) can come later, never by removing free features. | Julio, 2026-09-30: "easy to install with coolify or docker, maybe bare metal; B for family and friends and people to try; run it as a service but also open source and free; the instance is for everyone" |
| D31 | AI cost on a hosted instance | AIs are **bring-your-own model key or endpoint** by default (the user's own provider, a local model, or a free provider such as OpenRouter's free models, which are weaker). A hosted service does not pay for users' AI usage. Chat itself is cheap: ejabberd on one small server handles hundreds of concurrent users. | Julio, 2026-09-30 |

---

## 4. Will it work? Feasibility

### Short answer

Yes. Nothing here needs a research breakthrough. Every building block exists:

| Need | Proven by |
|---|---|
| Chat server with groups, history, uploads, push | ejabberd (20+ years), the XMPP standards |
| Agents that code, run commands and pause for approval | OpenCode, Claude Agent SDK, Codex, Hermes, Goose, OpenHands |
| Workers on your own machines that connect out and run agent work | Cursor self-hosted cloud agents (GA March 2026; team pools including Macs for iOS in Sept 2026), OpenClaw nodes |
| Sandboxing | Docker, gVisor, VMs, Apple `container` (one light VM per container), Lume and Tart (macOS VMs) |
| Per-key LLM budgets across providers | LiteLLM, OpenRouter |
| Keeping credentials out of the agent's reach | Claude Code on the web (git proxy), Cloudflare Sandboxes, Docker Sandboxes, Claude in Slack |
| Several people and an agent in one thread | Claude in Slack ("Claude Tag"), Slack Code, Devin in Slack |
| A team of AIs in one group chat | Grok Bot (2–6 bots per group), Claude Code agent teams |

Nobody we found combines all of it: many humans, many AIs, a desk per AI, bring your own compute, bring your own key, and self-hosting. That gap is the opportunity. It also means we're first to hit some of the integration problems.

### What is genuinely hard

1. **Scope.** Four apps (web, mobile, server, runner) plus infrastructure is a lot for a small team.
   - *Mitigation:* a strict MVP ([§21](#21-mvp-scope)), and reuse instead of building: ejabberd, OpenCode, LiteLLM, Better Auth, Expo.
2. **Making several AIs work *well* together, not just run.**
   - Research shows multi-agent setups gain about 81% on work that splits into parallel parts, but lose 39–70% on step-by-step work.
   - The most common failures are repeating steps, not knowing when to stop, ignoring the spec and weak verification.
   - *Mitigation:*
     - small team shapes
     - one writer per area of the code
     - a reviewer or QA AI
     - hard hop limits
     - logging failures by category from day one
3. **Mobile and XMPP.** Keeping connections alive in the background and push notifications on iOS are the hardest client-side parts.
4. **Token costs.** Multi-agent setups use 3–15× more tokens than a single chat.
   - *Mitigation:* a cheap listener, cheap workers, prompt caching and hard caps from day one.
5. **Prompt injection is unsolved everywhere.** In one study, adaptive attacks broke 12 published defences more than 90% of the time.
   - *Mitigation:* design so that a tricked AI can't do much damage. Desks hold no real keys, actions are tiered, and risky ones need approval.
6. **Dependencies move fast.** OpenCode's v2 API is in beta and changes daily. Two LiteLLM releases on PyPI shipped credential-stealing malware in March 2026.
   - *Mitigation:* pin versions and digests, and wrap everything behind our own interfaces.

### Rough effort

This is an estimate, not a promise. One developer working full time with an AI coding assistant needs **about 4 months** for the MVP described in [§21](#21-mvp-scope). Part time, roughly double that. [§22](#22-roadmap-and-milestones) breaks it down.

---

## 5. Architecture overview

```
   Web app (React)                    Mobile app (Expo / React Native)
         └──────── shared package: xmpp-core (connection, sync, stores) ────────┘
                                  │ XMPP over WebSocket (TLS)
┌─────────────────────────────── Control plane (small VPS / Coolify) ───────────────────────────┐
│                                                                                               │
│  ejabberd ◄──────► Server (TypeScript)                              Postgres (+ pgvector)     │
│  groups, history,  ├─ auth, workspaces, rooms, AIs, providers       users, AIs, board,        │
│  uploads, push     ├─ agent gateway: AI chat users, context         budgets, approvals,       │
│                    │   builder, listener, routing, delegation       audit, memory             │
│                    ├─ approvals, budgets, audit                                               │
│                    ├─ runner hub (WebSocket for runners)            Object storage            │
│                    ├─ git proxy + action adapters (Ads, ...)        uploads, desk snapshots   │
│                    └─ push relay (XEP-0357 → Expo → APNs/FCM)                                 │
│                                                                                               │
│  LiteLLM (pinned): real provider keys, a virtual key per AI, budgets                          │
└───────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                │ one outbound WebSocket per runner (port 443)
         ┌──────────────────────────────────────┼──────────────────────────────────────┐
         ▼                                      ▼                                      ▼
  Runner: office-linux                   Runner: julio-mbp                    Virtual runner: cloud
  Docker + gVisor                        Docker / Apple container / macOS VM  (Modal, E2B, Hetzner
  ├─ desk: Dev-1 (OpenCode, repo)        └─ desk: QA (macOS VM, Xcode,         hourly, GitHub Actions)
  ├─ desk: Dev-2                              iOS Simulator, XcodeBuildMCP)    optional, pay per use
  └─ desk: Research
```

### Components

| Component | What it does | Tech **(proposal)** |
|---|---|---|
| **Web app** | Chat, AIs, machines, settings, approvals, board, costs | React + Vite + Tailwind 4 + shadcn/ui |
| **Mobile app** | Chat, approvals, board, push | Expo (React Native) |
| **xmpp-core** package | XMPP connection, reconnects, history sync, local cache, React hooks | `@xmpp/client` (React Native support needs verifying), zustand or TanStack Query |
| **ejabberd** | Chat sessions, DMs, groups, history, uploads, push hooks | ejabberd in Docker with a Postgres backend |
| **Server** | Everything the platform owns (see diagram) | TypeScript on Node LTS, Hono, Drizzle, Better Auth, pg-boss for jobs |
| **Agent gateway** | Connects each AI to XMPP, builds context, runs listeners, routes and delegates | Module of the server at first. Can split out later. |
| **LLM gateway** | Holds real keys, issues a virtual key per AI, enforces budgets | LiteLLM (Python container, pinned by digest) |
| **Git proxy and action adapters** | Adds credentials, enforces branch rules and spending rules | Module of the server at first |
| **Runner** | Installed on user machines. Creates desks, tunnels traffic, reports capabilities | TypeScript compiled with Bun into a single binary |
| **Desk** | Sandboxed computer for one AI in one project | Docker (+gVisor), VM, or macOS VM, with OpenCode inside |
| **Object storage** | File uploads and desk snapshots | MVP: ejabberd's built-in upload on a disk volume. Production: Supabase Storage (already running). Garage or RustFS if we need local S3. MinIO is out, since its images were deleted. |
| **Push relay** | XMPP push "app server". Forwards to Expo Push, which forwards to APNs/FCM. | Small module of the server |

### Three core rules

1. **The chat is for people.** The platform decides what each AI sees on every turn.
2. **Each AI has its own desk.** AIs collaborate through git, the board and preview links, not by sharing one computer.
3. **AIs never hold real keys.** LLM keys, git tokens and ad accounts sit behind the platform, which enforces limits in code.

---

## 6. Chat layer (XMPP)

### 6.1 Server: ejabberd

**XMPP extensions (XEPs) we rely on:**

| XEP | For |
|---|---|
| XEP-0045 MUC | Group chats |
| XEP-0313 MAM | History, synced across phone and web |
| XEP-0280 Carbons | Same account on several devices |
| XEP-0198 Stream Management | Reliable reconnects on mobile |
| XEP-0363 HTTP File Upload | Files and images |
| XEP-0357 Push | Mobile push notifications |
| XEP-0085 Chat States | "Typing…" and "Dev is working…" |
| XEP-0461 Message Replies | Replies and threads |
| XEP-0372 References | @mentions |
| XEP-0308 Last Message Correction | Edits |
| XEP-0424 Message Retraction | Deletes |
| XEP-0444 Reactions | Reactions |
| XEP-0333 Displayed Markers | Read receipts |
| XEP-0060 PubSub (optional) | Mirroring the board to clients live |
| RFC 7395 | XMPP over WebSocket, for browsers and React Native |

**Configuration:**
- **Registration closed.** Only our server creates XMPP accounts.
- **Federation off by default,** so it can't talk to other XMPP servers.
- **Rooms members-only and persistent,** with MAM enabled.

**Auth integration (to verify, see [§23](#23-things-to-verify-early-spikes)):**
- Users register and log in through our server.
- The server creates the XMPP account through ejabberd's admin API.
- Clients log in to XMPP with a **short-lived token**, via ejabberd JWT auth or an external-auth script that calls our server. The server is the single source of truth for login.

### 6.2 Identity rules

- **People** are always identified by their real bare JID, never by their room nickname. Nicknames can be faked.
- **Each AI** is its own XMPP account, for example `dev-1@ai.example.com`, connected by the agent gateway. Later this can be an XMPP *component* serving the whole `ai.` subdomain.
- **Clients always label AI accounts** as AI.

### 6.3 Our XMPP extension

Every AI message has a normal readable body. That way any XMPP client still works, and people can read it anywhere. The structured data sits in our own namespace, `urn:zilar:agent:0`, our own namespace.

**Payload types:**
- `task`
- `handoff`
- `approval`
- `progress`
- `board-update`
- `preview`
- `cost`
- `wake-reason`

**Encoding (decided 2026-09-27).** The payload is a JSON **envelope** `{ "v": 0, "type": "<payload type>", "data": { … } }`, carried as text inside the `urn:zilar:agent:0` element. Every client validates it with the zod schemas in `@zilar/protocol` (T-0013). Decoding never throws, and payloads are capped at 64 KiB. Why JSON rather than XML children: one set of schemas works on the server, web and mobile, and JSON is easier to validate.

**Example: Dev-1 hands a task to QA in a room** (older XML sketch; the real encoding is the JSON envelope above)

```xml
<message to="project-a@rooms.example.com" type="groupchat" id="m-42">
  <body>Opened PR #42: fix checkout button on mobile. QA, can you test the preview?</body>
  <reply xmlns="urn:xmpp:reply:0" id="m-31"/>
  <reference xmlns="urn:xmpp:reference:0" type="mention" uri="xmpp:qa@ai.example.com"/>
  <agent xmlns="urn:zilar:agent:0">
    <handoff task="t-17" from="dev-1@ai.example.com" to="qa@ai.example.com">
      <objective>Test checkout at iPhone viewport sizes</objective>
      <artifact kind="pr" href="https://github.com/acme/shop/pull/42"/>
      <artifact kind="preview" href="https://p-7f3a.preview.example.com"/>
      <budget currency="EUR" max="1.50"/>
    </handoff>
  </agent>
</message>
```

### 6.4 Streaming AI replies **(proposal)**

- **MVP:**
  - A **progress card** that updates a few times: "cloning repo…", "running tests…", "editing `src/app.ts`".
  - Then a single **final message**.
  - We avoid token-by-token edits, because every correction gets stored in history and floods MAM.
- **Later:** optional live token streaming through a lightweight server channel (SSE) for people currently viewing the room. The final message still goes through XMPP.

### 6.5 Push notifications

The chain is:
1. ejabberd `mod_push` (XEP-0357)
2. our push relay, which acts as the XMPP "app server"
3. the Expo Push API
4. APNs (iOS) and FCM (Android)

This requires the **Apple Developer Program ($99/year)** for iOS push and TestFlight.

The notification can show "Sender: preview" or just "New message". See question M3.

### 6.6 Clients

**Shared package `xmpp-core`:**
- Connection and reconnection
- MAM sync
- Local cache: IndexedDB on web, SQLite on mobile
- Unread counts
- Mentions parsing
- Rendering our extension
- React hooks

**MVP screens:**
- Sign-in and sign-up
- Workspace switcher
- Room list
- Room: messages, replies, mentions, uploads, AI cards, a board panel and a people/AI list with status
- DM
- AI directory and "Create AI" wizard
- Machines
- Providers and keys
- Approvals inbox
- Costs
- Settings

### 6.7 Voice messages (in the MVP)

Julio asked for this: "send audio messages, the user can play them, and the AI reads them".

**Recording:**
- Web: the browser's MediaRecorder.
- Mobile: `expo-audio`.
- The server converts every recording with ffmpeg to **one format every device can play** (AAC/M4A), so iPhone, Android and browsers never disagree.

**Sending:**
- Upload through XEP-0363.
- The message carries the duration and a small **waveform** (for the bubble) in our XMPP extension.
- Push notifications show "🎤 Voice message (0:12)".

**Playing:**
- A waveform bubble.
- 1× / 1.5× / 2× speed.
- The next voice message plays automatically.

**AIs "hear" them:**
- The server **transcribes** every voice message in chats that contain an AI. The transcript goes into the AIs' context and the listener reads it.
- Models that accept audio directly (e.g. Gemini, OpenAI's audio models) can also get the original audio, so they catch tone.
- **Transcription options:**
  - A hosted speech-to-text API through the AI owner's or workspace's key. Typically a fraction of a cent per minute.
  - Or **local Whisper** (whisper.cpp / faster-whisper) on the server's CPU, which is free and needs about 1 GB of RAM while running.

**For people:**
- **"Show transcript"** under every voice message. It's useful for people too: reading in a meeting, accessibility, search.
- In human-only chats, transcripts are made only on demand.

**AIs reply by voice (fun):**
- An AI can answer with a voice message using text-to-speech: OpenAI, ElevenLabs or Gemini TTS, or a local Piper/Kokoro.
- Each AI can have its own voice, set in the Create AI wizard.

**Privacy:** transcripts are messages like any other, so memory and audience rules apply to them.

### 6.8 Prior art on XMPP

**ProcessOne**, the company behind ejabberd, has an experimental XMPP agent called **fluux-agent**:
- It replies in a room when its nickname is mentioned, and reads the full conversation when it does.
- It keeps memory separate per user.
- It uses an experimental `urn:fluux:agent:0` namespace.

It's worth reading before we design our extension, and possibly aligning with it.

---

## 7. Accounts, workspaces and roles

### 7.0 One app for personal life and work (decision D12)

It works like WhatsApp, with Slack-style workspaces added on top. Everyone has **one account**. On top of it:

- **Personal side** (always there, with no admin above you):
  - contacts
  - DMs (your girlfriend, a friend)
  - personal groups (friends)
  - your personal AIs and machines
- **Workspaces** (optional, joined by invite): a company, a department, a club. Each has:
  - admins
  - policies: allowed AI providers, which machines can be used, retention
  - work groups
  - workspace AIs

**One chat list with folders** (proposal): *All · Personal · AIs · Acme (work) · …*, like messenger folders. Every chat shows a small badge for its space. You don't have to switch apps or accounts.

**Rules that fall out of this (proposal):**

| Question | Rule |
|---|---|
| Who owns a DM? | DMs are **personal** by default. A workspace can offer "work DMs" that follow its policies (later). |
| Who owns a group? | Its **space**: personal groups belong to their creator, work groups belong to the workspace. |
| Who approves risky AI actions? | In a **personal group**, its admins (the creator by default). In a **work group**, room admins and then workspace admins. Never above the AI owner's hard limits. |
| Can my personal AI join a work group? | Only if the workspace allows "bring your own AI". It still spends **your** key and budget. |
| Can a work AI join my personal chats? | No. |
| Memory between personal and work | **Never crosses.** The audience rule ([§14.2](#142-the-audience-rule)) is enforced by the platform, so your AI can't repeat something from your chat with your girlfriend in a work group. |
| Notifications | Per-chat mute, plus **per-space quiet hours** (e.g. mute Acme after 19:00 and on weekends). |
| Leaving a workspace | You keep your account, personal chats and personal AIs. Work groups and work AIs stay with the workspace. |

**Finding people (non-technical friendly):**
- invite links and QR codes (the main way)
- an optional `@username`
- later, optional contact matching by email or phone
- no public directory

### 7.1 Entities

- **User**: one account per person. It holds a personal space.
- **Space**: either a user's *personal space* or a **workspace** (company, department, club).
- **Workspace member**, with a role:
  - `owner`
  - `admin`
  - `member`
  - `guest` (later)
- **Contact**: a relationship between two users, created from an invite link, QR code or username.
- **Chat**: a DM between two people, or a **group** (XMPP MUC room) that belongs to one space.
- **Group member**:
  - The group role is `admin` or `member`.
  - Group admins approve Tier 2 actions in their group.
- **AI**: owned by a user (personal AI) or by a workspace (workspace AI).
- **Machine**: owned by a user or by a workspace, and optionally shared with a workspace.

### 7.2 Registration and login for non-technical people (decision D13)

**The flow:**
1. A friend receives an **invite link** by WhatsApp, SMS or anywhere else, and opens it.
   - If the app is installed, it opens the app.
   - Otherwise it opens the web app, with App Store and Play Store buttons.
2. They choose one of:
   - **Continue with Google**
   - **Continue with Apple**
   - **Continue with email**, which sends a 6-digit code (easier on phones than magic links)
3. They enter a name and an optional photo.
4. They land **inside the chat with the person who invited them**, already connected as contacts.

**Details:**
- **No passwords by default.** Passkeys (Face ID / Touch ID) come later.
- **Sign in with Apple is required on iOS** if we offer Google login (App Store guideline 4.8). Verify the current wording before submitting.
- **Invite-only sign-up by default,** to prevent spam on a public server. Anyone with an account can create invite links, and admins can open sign-up later.
- **Account recovery** through the email or Apple/Google account.
- **Library (proposal): Better Auth.** It supports email OTP, OAuth (Google, Apple, GitHub), passkeys, 2FA and organizations, which map to workspaces.
  - Alternative: reuse the **Supabase Auth** already running on Julio's server (see [§17](#17-tech-stack-proposal)).
- On sign-up, the server creates the user's XMPP account. On login, it issues a short-lived XMPP token.

### 7.2b Privacy expectations for personal chats

People expect WhatsApp-level privacy in chats with a partner or friends. Today the design uses TLS plus encryption at rest, so **the server operator (Julio) can technically read messages**. Options:

| Option | Privacy | Cost |
|---|---|---|
| A. TLS + encryption at rest, with a clear notice (MVP default) | The server can read messages | None |
| B. **OMEMO end-to-end encryption** (XEP-0384) for **human-only DMs and groups** | The server can't read them | High: the Signal protocol in our clients, multi-device, new devices can't read old history, harder push previews and search |
| C. B, plus AIs as E2E participants: the AI's keys live in the agent gateway | The server can read only chats that include an AI | Even more complexity |

AIs must be able to read the chats they're in, so any chat with an AI can never be end-to-end encrypted against the platform itself. See question D3.

**How the big messengers do it:**

| | WhatsApp | Cloud-chat messengers |
|---|---|---|
| Normal chats and groups | **End-to-end encrypted by default** (Signal protocol) | **Not end-to-end.** "Cloud chats" are encrypted between your device and the provider's servers, then stored in the provider's cloud, where a classic messenger can decrypt them |
| Why | Privacy first | Instant sync on every device, full history on a new phone, search, huge groups, bots |
| End-to-end option | Always on | **"Secret chats"**: optional, 1-to-1 only, tied to one device, no sync, no bots |
| AI and bots | Meta AI only receives the messages that mention it or are sent to it. That message leaves the encrypted envelope, and the rest of the chat stays encrypted. Summaries use "Private Processing" (secure enclaves that Meta says it can't read). | Bots in groups receive messages the normal way, since cloud chats aren't end-to-end encrypted |

**Decision (D19): the cloud-chat model, without secret chats for now.**
- Cloud chats by default, so AIs, sync, search, history on a new phone and push previews all simply work.
- Later, optional **"secret chats"** (OMEMO): 1-to-1, human-only, with a lock icon.
- This is option A now and option B later, limited to secret chats.
- The WhatsApp approach (mentioned messages leave encryption, everything else stays encrypted) is possible later as a variant of option C, but it's a lot of work.

### 7.3 Permission matrix (MVP defaults)

| Action | Owner | Workspace admin | Room admin | Member | AI owner |
|---|---|---|---|---|---|
| Invite people to workspace | ✓ | ✓ | – | – | – |
| Create room | ✓ | ✓ | – | ✓ (Q) | – |
| Add people/AIs to a room | ✓ | ✓ | ✓ | – | – |
| Create personal AI | ✓ | ✓ | – | ✓ | – |
| Create workspace AI | ✓ | ✓ | – | – | – |
| Set AI hard limits (budget, tools, rooms) | – | ws AIs | – | – | ✓ own AIs |
| Approve Tier 2 action in a room | ✓ | ✓ | ✓ | – | – |
| Pause or kill an AI | ✓ | ✓ | ✓ (in room) | – | ✓ |
| Add a machine | ✓ | ✓ | – | ✓ own | – |
| Place AIs on a machine | machine owner + (ws admin for shared machines) | | | | |
| See costs | ✓ | ✓ | room costs | – | own AIs |

(Q) = open question, see [§25](#25-open-questions-for-julio).

---

## 8. AIs, providers and budgets

### 8.1 What an AI is

| Field | Example |
|---|---|
| Name, avatar | "Dev-1" |
| Role and personality prompt | "Senior TypeScript developer. Small PRs. Always writes tests." |
| Owner | User `julio`, or Workspace `acme` |
| Model and provider connection | DeepSeek V4.1 Flash via Julio's DeepSeek key |
| Fallback model (optional) | Another model or provider if the first fails |
| Hard limits (set by owner) | €20/month, €2/day, rooms allowed, tools allowed |
| Tool packs | `git`, `browser`, `web-search`, `xcode`, `google-ads-readonly` |
| Placement | Home machine `office-linux`, or requirements `needs: [linux]` with a fallback |
| Autonomy | Highest tier it may request (Tier 1 or Tier 2 with approval) |
| Memory | On or off, scopes ([§14](#14-memory)) |
| Visibility | Which rooms it's in, and whether it can DM people |

### 8.2 Templates for the first team

| AI | Model (example) | Desk? | Main tools |
|---|---|---|---|
| **Boss / PM assistant** | Strong (e.g. Opus) | No | Board, delegate, GitHub issues, summaries |
| **Dev (1–2)** | Cheap coder (e.g. DeepSeek) | Yes, while working | Repo, shell, tests, PRs |
| **QA** | Cheap with image input | Yes, with a browser (or macOS VM for native iOS) | Tests previews at phone and desktop sizes, takes screenshots |
| **Marketing** | Mid-priced | No | Research, copy, images, Google Ads (read-only first) |
| **Listener** | Cheapest | No | Wakes AIs, suggests board items, keeps the room summary |
| **Fun / party host** | Mid-priced, with voice | No | Games (trivia, "who's most likely to…", werewolf/mafia narrator), memes and images, polls, plans outings, settles debates with sources, stories, translates for mixed-language groups, answers with voice messages |

Julio's first uses are **coding, marketing and fun**, so the first templates are Dev, Marketing and Fun, plus the Listener.

The Fun and Marketing templates need two more tool packs:
- `images`: image generation through the owner's key, e.g. OpenAI, Google, xAI or Flux providers.
- `polls`: interactive polls in chat, as a payload type in our extension.

AIs without a desk run as tool calls from the server. They need no compute of their own.

### 8.3 Providers and keys (bring your own key)

**Providers to support first (proposal):**
- Anthropic
- OpenAI
- Google Gemini
- DeepSeek
- xAI
- OpenRouter
- Any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio)

**How keys are handled:**
- **Entry.** Keys are entered in a settings form only, never in chat. Chat lives in history, logs and memory.
- **Storage.** Keys are encrypted at rest.
  - MVP: envelope encryption with a master key from the environment.
  - Later: OpenBao transit or a cloud KMS.
- **Decryption** happens only inside the LLM gateway. Desks get a **virtual key** per AI that works only through the platform and has a hard cap.
- **Setup help.**
  - A "Test key" button.
  - Guidance to create a dedicated project or workspace key with the provider's own hard cap turned on:
    - OpenAI has hard project limits.
    - Gemini has project caps that apply with about a 10-minute delay.
    - Anthropic has workspace limits, set in the Console only.

**LiteLLM:**
- **Virtual key options per AI:**
  - `max_budget` and `budget_duration`
  - a model allowlist
  - rpm/tpm limits
  - an expiry
- Teams can map to rooms or workspaces. When per-key, per-team and per-org budgets all apply, the strictest one wins.
- **Pin by digest.** Versions 1.82.7 and 1.82.8 on PyPI were compromised on 24 March 2026.
- **Check licensing.** The team-level own-key feature carries an "enterprise" marker in the docs.

**OpenRouter**, as an optional provider:
- Using your own key is free up to $25k/month, then costs 5%.
- By default it falls back to its own shared capacity when your key fails. We turn that off.

### 8.4 Budgets and spending caps

- **Owner hard limits.** Nobody can exceed them, not even an admin. They apply per day, per month and per room.
- **Room and workspace budgets** sit on top of the owner's limits.
- **Enforcement:**
  - A warning in the room at 80%, and the AI stops at 100%.
  - A `max_tokens` cap on every request.
  - Loop detection (the same tool call repeated, or the same message repeated).
  - A kill switch.
- **Cost display.** Each room shows what its AIs spent. Each AI owner sees their AI's spending everywhere.

---

## 9. How AIs work together

### 9.1 Principle

The room transcript is for **people**. The platform assembles each AI's context fresh every time the AI wakes up. AIs can read in parallel, but every shared artifact has **one writer at a time**.

Two simple approaches both fail:
- **Every AI sees the whole chat.** Costs grow with the number of agents times the length of history, and agents echo each other into loops. Grok Bot users burned a whole week's quota on bot-to-bot review loops, even after telling the bots to stop.
- **Each AI sees only its own messages.** Then it misses decisions.

### 9.2 What an AI sees on each turn

The context is built by the server, in this order:

1. **Fixed prefix:**
   - the AI's personality
   - the room's roster: people, and each AI's skills and model, as "agent cards"
   - the room rules

   It stays identical between turns, so providers can cache it cheaply.
2. **The room summary** and pinned decisions.
3. **Recent messages:** the last ~30, or everything since the AI last spoke.
4. **The message that woke it,** plus its reply thread, plus the listener's wake reason.
5. **Its own tasks** from the board.
6. **Other AIs' messages** rewritten as "Dev (AI) said: …":
   - They never appear as the AI's own turns.
   - The other AI's internal tool logs are left out; only links to its results come through.
7. **Tools:** a search over the full room archive for anything older, plus board and memory tools.

The AI's own full working trace stays inside its session on its desk.

### 9.3 The listener (scribe)

This is Julio's idea: cheap AIs read the whole chat all the time.

**Design:**
- **One listener per room scores every AI in one call.** It knows the roster, and its output looks like `{dev: 0.1, pm: 0.8, marketing: 0.0}` with a reason and the relevant message IDs. Any AI above the threshold wakes. This costs one call per check instead of one per AI.
- **It also keeps notes.** In the same call it:
  - updates the room summary
  - suggests tasks and decisions for the board
  - notices loose ends, like "Ana asked about the release date 2 hours ago and nobody answered"
- **It waits for pauses.** It checks after a few seconds of quiet or every N messages, since people type in bursts.
- **It can only tag and suggest.** It has no other tools. That's what makes it safe for it to read everything, including links and pasted text that may carry hidden instructions (see the Rule of Two, [§15](#15-security-model)).
- **Wakes are silent by default (proposal):**
  - The woken AI shows "Dev is looking at this", and tapping it shows why.
  - People can correct bad wakes, and false alarms are logged to tune the listener.
- **Eagerness is adjustable per room.** A May 2026 study (When2Speak) found models interrupt too much.
- **Its wakes count against the same hop limits** ([§9.4](#94-who-speaks-and-limits)).

**Research support:**
- In "Inner Thoughts" (CHI 2025), people preferred AIs that kept private thoughts and spoke only when motivated, in 82% of conversations.
- AgentRadio (2026) used threads, mentions and passive awareness of peers. Four agents solved 62.1% vs 32.3% for a single agent.

**Cost estimate:**
- A busy room with about 300 messages/day works out to about 100 checks/day at about 5k input tokens each, or roughly 15M input tokens/month.
- The listener's context only grows at the end, so provider caching makes re-reading cheap.

| Model (Sept 2026 list prices) | Input $/M | Est. per busy room / month |
|---|---|---|
| Qwen Flash (weaker) | $0.03 | ≈ $0.50 |
| DeepSeek V4.1 Flash | $0.30 ($0.15 off-peak) | ≈ $1–5 |

### 9.4 Who speaks and limits

1. **A person @mentions AIs:** only those AIs reply.
2. **An AI @mentions another AI:** that counts as a handoff and spends hop budget.
3. **No mention:** the listener decides, and by default nobody replies. A room can also be set to mention-only.
4. **Per human message** (proposal):
   - At most **4 AI messages** and **2 AI-to-AI hops**.
   - The budget carries across handoffs.
   - A **new human message** interrupts in-flight work and resets the budget.
5. **Stuck-detection** runs every few AI turns, modelled on Microsoft's Magentic progress ledger: "is progress being made? are we in a loop?". It escalates to a human if the answer is no.
6. **The gateway enforces all limits by not waking the AI.** A prompt like "please stay quiet" is only a hint the AI can ignore; not waking it is a guarantee.

### 9.5 Delegation (boss → workers)

- **Any AI with the delegate permission gets a `delegate` tool** from the platform's tool server:

  ```
  delegate(ai, task) · task_status(id) · post_to_room(text) · request_human(question)
  board_* tools · search_archive(query) · memory_* tools · web_search(query)
  ```
- **When the boss calls `delegate`,** the server:
  - starts a session on the **worker's own desk**, using the **worker's own model, key and budget**
  - streams the worker's progress into a room thread
  - returns the result to the boss as the tool result

  This keeps providers, keys, desks and budgets separate per AI.
- **Why not the engine's built-in sub-agents:** they share the parent's provider (Hermes, for example, shares one model across all sub-agents). They're still available *inside* a desk for cheap local exploration.

**Handoff format** (the internal JSON, mirrored in the XMPP payload):

```json
{
  "task_id": "t-17",
  "from": "boss@ai.example.com",
  "to": "dev-1@ai.example.com",
  "objective": "Fix the checkout button overlapping the footer on mobile",
  "context_summary": "Reported by Ana (PM) in #project-a at 10:12, screenshot attached. Affects iOS Safari only.",
  "acceptance": ["Button fully visible at 375x667", "No desktop layout change", "Tests pass"],
  "constraints": ["Only touch src/checkout/*", "No new dependencies"],
  "artifacts": [{"kind": "message", "ref": "m-31"}, {"kind": "screenshot", "ref": "a-9"}],
  "budget": {"currency": "EUR", "max": 3.0},
  "return_format": "PR link + 3-line summary",
  "reply_to": "thread:m-31"
}
```

`context_summary` is at most ~300 tokens. The worker replies with a state change, its artifacts, and a summary of at most ~2k tokens.

### 9.6 The shared board

The board is stored in Postgres, owned by the server, edited by AIs only through validated tools, and mirrored to the clients as a panel.

- **Tasks:**
  - Fields: id, title, owner, state, dependencies, acceptance criteria, artifacts, budget, source message.
  - States follow the A2A protocol: `submitted`, `working`, `input-required`, `completed`, `failed`, `canceled`, `rejected`.
  - Claiming a task is an atomic compare-and-swap, so two AIs can't grab the same task.
- **Decisions log:** append-only. Only people or the boss can add to it.
- **Artifacts:** files, PRs, previews, screenshots, reports, addressed by handle.

The chat summary loses detail; the board doesn't. The research also points this way: agents that coordinate through shared structured state reached comparable or better results with far fewer tokens (the blackboard and PatchBoard papers).

### 9.7 Compaction

- **Rolling room summary** updated by the listener, using overlapping windows and tuned to keep facts rather than drop them.
- **Decisions and tasks** get promoted to the board, which loses nothing.
- **Raw history** stays in the MAM archive and can be searched on demand.
- **Inside a desk,** the engine uses its own compaction and clears old tool results.

### 9.8 Team shapes: lessons from research

| Lesson | Source | What we do |
|---|---|---|
| Parallel work gains about 81%; step-by-step work loses 39–70%. Independent agents amplify errors 17×, versus 4× with a coordinator. | Google Research 2026 | Use a coordinator (the boss). Parallelize research, review and testing, not writing. |
| Multi-agent works "when writes stay single-threaded and extra agents contribute intelligence rather than actions" | Cognition, April 2026 | One writer per area of code. Others research, review and test. |
| A verifier/reviewer agent is the pattern that reliably pays off | Anthropic | QA and reviewer AIs in the default templates |
| The top failures are step repetition, reasoning/action mismatch, not knowing when to stop and ignoring the spec, with about 24% verification failures | MAST (1,600+ traces) | Acceptance criteria in every handoff, stuck detection, hop limits, logging failures per category |
| 20.6% of confirmed infinite loops were multi-agent chats with no turn limit; no big framework sets a default limit at handoffs | 2026 loop study | Hard limits enforced by the gateway and carried across handoffs |
| Split work by context boundary, not by job title | Anthropic | The boss delegates self-contained tasks |
| Messages from other agents must never count as user consent | Claude Code agent teams | Only people approve ([§15](#15-security-model)) |

### 9.9 Lessons from Grok Bot

What Grok Bot does:
- **One cloud computer per *user account*,** shared by all that user's bots, including browser sessions, files and logins.
- **Groups of 2–6 bots.** Either the bots decide who answers, or you @mention one.
- **Memory is per bot.** Shared files and handoffs move context between them.

The pitfalls its users hit:
- Bot-to-bot loops used 100% of a user's weekly quota, even after the user asked the bots to stop.
- One stuck machine takes down every bot on the account.
- A login done for one bot works for all of them.
- There's no way to start a fresh session or manage context.

What we do instead:
- A desk per AI
- Hard limits in the gateway
- A `/restart` command for a fresh session
- Per-AI credentials, kept behind the proxy

---

## 10. The AI engine inside each desk

### 10.1 Recommendation: embed OpenCode **(proposal)**

**Why OpenCode:**
- MIT license, about 210k GitHub stars, written in TypeScript like our server.
- 75+ providers through the AI SDK and models.dev, plus any OpenAI-compatible endpoint. Each agent can use its own model.
- **Headless server:** `opencode serve` exposes an OpenAPI 3.1 HTTP API.
  - Create a session with `POST /session`.
  - Send a prompt with `POST /session/:id/prompt_async`.
  - Stream events over SSE from `/event`.
  - There's a typed JS SDK.
- **Permissions:**
  - Rules per tool are `allow`, `ask` or `deny`, with glob patterns and per-agent overrides.
  - An `ask` emits a `permission.asked` event, and we answer through the permission reply endpoint.
  - Plugins can block a tool call before it runs.
- Sessions persist and can be forked. It supports MCP and sub-agents.

**Caveats:**
- **The v2 beta (2.0.x) changes the API** to `/api/session/...` and `/permission/{id}/reply`, with new releases daily in Sept 2026. We pin a stable version and wrap it.
- **Its defaults allow almost everything,** so we ship a tight config:

```jsonc
// illustrative; the exact keys depend on the pinned OpenCode version
{
  "permission": {
    "edit": "allow",
    "bash": {
      "git push --force*": "deny",
      "git push*": "ask",
      "curl *": "deny",
      "*": "allow"
    },
    "webfetch": "deny",           // web access goes through our web_search / reader tools
    "external_directory": "deny"
  }
}
```

**OpenCode v2 facts (verified on Julio's Mac, 2026-09-27, `opencode2` 2.0.12):**
- **Background service.** A background service (`opencode2 service`) runs the v2 API on localhost with basic auth. `opencode2 api <operationId>` calls it using the stored login.
- **The API:**
  - `POST /api/session` takes `model {providerID,id}`, `location {directory}` and a **`permissions` ruleset**
  - `POST /api/session/{id}/prompt` takes `{text}`
  - `GET /api/session/{id}/message` lists messages (newest first; a message of type `idle` marks the end of a run)
  - `GET /api/session/{id}/permission` lists pending requests, answered with `POST …/permission/{requestID}/reply` and `{decision: once|always|reject, message}`
  - `GET /api/event` streams events (SSE)
  - `POST /api/session/{id}/interrupt` stops a run
- **Permission rules** are `{action, resource, effect: allow|ask|deny}`, and **the shell tool's action is `shell`**, not `bash`. Session rules override the agent's rules: tested with a `deny` on `echo *` and an `ask` on `date*`.
- **Sessions created through the API show up live** in Julio's `opencode2` app (`opencode2 -s <id>`). That's the same model the Zilar gateway will use.

### 10.2 Our own driver interface

The interface is shaped like ACP, the Agent Client Protocol, which is the common standard across OpenCode, Goose, Codex, Claude, Cline and Gemini. That lets us swap engines per AI later.

Implemented in `packages/agent-drivers` (T-0006), removed in T-0856 (no importers; it is in git history). Live-tested against OpenCode v2.

```ts
export interface AgentDriver {
  start(opts: { directory: string; model: ModelRef; rules: PermissionRule[]; title?: string; agent?: string }): Promise<SessionRef>;
  prompt(s: SessionRef, text: string): Promise<PromptRef>;          // returns once accepted: { messageId, createdAt }
  events(s: SessionRef, o: { after: PromptRef; signal?: AbortSignal }): AsyncIterable<AgentEvent>;
                                                                    // only the run started by `after`:
                                                                    // text | reasoning | tool_call | tool_result
                                                                    // | permission_request | done | error
  answerPermission(s: SessionRef, requestId: string,
                   decision: 'allow_once' | 'allow_always' | 'reject', note?: string): Promise<void>;
  cancel(s: SessionRef): Promise<void>;
}
```

When the engine raises a permission request:
1. The server posts an **approval card** to the room.
2. The right person approves or denies.
3. The server answers the engine.
4. Anything unanswered is **denied after a timeout.**

### 10.3 Alternatives (for later, per AI)

| Engine | Best at | Limits |
|---|---|---|
| **Claude Agent SDK** | The richest approval hooks: `canUseTool` can wait indefinitely, and `PreToolUse` can defer so the process exits and resumes later | Claude models only (Anthropic, Bedrock, Vertex, Foundry). Commercial terms and branding rules apply. |
| **Codex CLI** (`codex app-server`) | JSON-RPC, approval requests, thread forks | Responses API only. Tuned for OpenAI models. |
| **Hermes Agent** | Long-lived assistants with learned memory and skills. API with approval states. | All sub-agents share one model. Its self-written skills and memory need review in shared rooms. |
| **Goose** | Many providers, REST+SSE or ACP | Sub-agents only work in fully autonomous mode, so there's no mixing with approvals |
| **OpenHands** | Mature, 100+ providers via LiteLLM, confirmation policies | Python |
| Not recommended | Aider (maintenance mode), Roo Code (shut down May 2026), Pi/OpenClaw (had a sandbox-escape advisory in 2026) | – |

---

## 11. Compute: bring your own compute (runners)

### 11.1 Idea and precedent

This mirrors bring-your-own-key. Anyone installs our **runner** on a machine they control, and it hosts desks for the AIs assigned to it:
- **Your** AIs run on **your** hardware.
- A **client's** AIs run on the **client's** hardware.
- Cloud providers are just "virtual runners" behind the same interface, used as an optional fallback.

**Precedent:**
- **Cursor self-hosted cloud agents** (GA March 2026, team pools in Sept 2026):
  - Workers open outbound HTTPS connections only.
  - Cursor's cloud handles planning and reasoning, while your machines run every edit, command and build.
  - Separate pools for GPU machines or Macs for iOS.
- **OpenClaw nodes:** devices connect over WebSocket with their own identity, and every node needs explicit approval.

### 11.2 Connecting a machine (pairing)

1. An admin (or any member, for their own machine) taps **Add machine** and gets a code like `K7QX-M2PA`, valid for 10 minutes.
2. On the machine:
   - **Linux:** `curl -fsSL https://<platform>/install | sh`, then `runner pair K7QX-M2PA`
   - **Docker anywhere:**
     `docker run -d --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v runner-data:/data <platform>/runner pair K7QX-M2PA`
   - **Mac:** the same command line tool at first. Later a menu-bar app where you paste the code or scan a QR code from the phone. Julio already builds Swift macOS apps, so a native app is a good fit.
3. The runner creates its **own key pair**, whose private key never leaves the machine, and sends a capability report.
4. The app shows: *"New machine: julio-mbp · macOS 27 · M3 Pro · 18 GB · Docker. Approve?"*
5. Once approved, the machine appears in the Machines list. It can be revoked with one tap.

**Caveat:** mounting `docker.sock` gives the runner container full control of that host. That's acceptable because the runner is our signed code and the owner chose to install it. The desks it creates never get that access.

### 11.3 Capability report (example)

```json
{
  "machine": "julio-mbp",
  "runner_version": "0.1.0",
  "os": "macos", "os_version": "27.0", "arch": "arm64",
  "cpu": "Apple M3 Pro", "cores": 11, "ram_gb": 18, "disk_free_gb": 200,
  "power": "laptop",
  "drivers": ["docker", "apple-container", "macos-vm"],
  "tools": { "xcode": true, "ios_simulators": true, "browsers": ["chromium", "webkit"], "ollama": false },
  "labels": ["personal", "nights-only"]
}
```

These values are an example. The real report is detected automatically.

### 11.4 Owner controls (on the machine and in the app)

- **Limits:** maximum CPU, RAM and disk given to AIs.
- **Availability:** always, on a schedule (e.g. 20:00–08:00), only when idle, or never on battery.
- **Who may use it:** which workspaces, rooms or AIs.
- **Pause button** ("I need my Mac"): saves and suspends every desk.
- **A live view** of what is running and how much it uses.

### 11.5 Assigning AIs to machines

- **Home machine:** drag an AI onto a machine card. The AI's desk lives there.
- **Or requirements:** `needs: [macos, xcode]` with a preference order, and the platform picks a matching online machine.
- **Fallback when offline** (question G2):
  - wait in a queue and notify
  - move to another machine
  - use paid cloud within the AI's budget
- **Later: jobs by capability.** Dev-1 lives on Linux. When it needs an iOS build, it asks for "any machine with Xcode". That one job runs on the Mac and the results come back. This is Cursor's pool model.
- **Presence in chat:** while an AI's machine is offline, the AI shows as *away* (XMPP presence), and its tasks queue.

**Machines screen (sketch):**

```
Machines                                            + Add machine
┌──────────────────────────────────┐ ┌─────────────────────────────┐
│ ● office-linux · Linux · 16 cores │ │ ● julio-mbp · macOS · M3 Pro │
│ 64 GB · Docker+gVisor             │ │ 18 GB · Xcode · iOS sims     │
│ CPU ▓▓▓▓░░░░   RAM ▓▓▓░░░░░       │ │ available 20:00–08:00        │
│ Dev-1 · Dev-2 · Research          │ │ QA                           │
└──────────────────────────────────┘ └─────────────────────────────┘
○ cloud-fallback (Modal) · pay per use · off
```

### 11.6 Plugins: drivers and tool packs

**Machine drivers** define how a desk is created:

| Driver | Where | Isolation | Notes |
|---|---|---|---|
| `docker` | Linux, Mac (Docker Desktop), Windows | Container. On a Mac all containers sit inside Docker Desktop's single VM. | Simplest. Fine on trusted machines. |
| `docker-gvisor` | Linux | gVisor user-space kernel | Doesn't need KVM, so it works on cheap cloud VPS. Some workloads run slower. |
| `linux-vm` | Linux with KVM (bare metal) | Full VM (Incus on ZFS, or Firecracker later) | Snapshots and instant clones. Hetzner *Cloud* reportedly has no nested virtualization, so this needs bare metal. |
| `apple-container` | macOS 26+ | One lightweight VM per container | Apple's open-source tool |
| `macos-vm` | Apple Silicon Mac | Full macOS VM | Lume (MIT, HTTP API, MCP) or Tart (free under 100 CPU cores). **Apple allows at most 2 macOS VMs per Mac.** |
| `windows` (later) | Windows | WSL2 / Hyper-V | – |
| `modal` / `e2b` / `hetzner-hourly` | Cloud ("virtual runner") | microVM / VM | Pay per use, optional fallback |
| `github-actions` (later) | The client's GitHub | Throwaway VM per job | For "do the task, open a PR" work, billed to the client's Actions minutes |

**Tool packs** add abilities when the machine or AI has them:

| Pack | Adds | When |
|---|---|---|
| `git` | clone, branch, commit, push (through the proxy), PR | All dev desks |
| `browser` | Playwright (Chromium and WebKit), screenshots, phone viewports | QA, dev |
| `xcode` | XcodeBuildMCP (MIT, maintained by Sentry): build, run on the simulator, tap, swipe, screenshot, logs, debug | Mac with Xcode |
| `android` | Android emulator tools | Machine with the Android SDK |
| `local-models` | Ollama models reachable through the LLM gateway | Machine with Ollama |

Every driver has the same small set of commands:

```ts
export interface SandboxDriver {
  id: string;                                   // 'docker' | 'docker-gvisor' | 'macos-vm' | ...
  detect(): Promise<DriverInfo | null>;         // is it usable on this machine?
  create(spec: DeskSpec): Promise<DeskRef>;
  start(d: DeskRef): Promise<void>;
  stop(d: DeskRef): Promise<void>;              // keeps disk
  snapshot(d: DeskRef, label: string): Promise<SnapshotRef>;
  restore(s: SnapshotRef): Promise<DeskRef>;
  exec(d: DeskRef, cmd: string[], opts?: ExecOpts): AsyncIterable<ExecChunk>;
  readFile(d: DeskRef, path: string): Promise<Uint8Array>;
  writeFile(d: DeskRef, path: string, data: Uint8Array): Promise<void>;
  exposePort(d: DeskRef, port: number): Promise<PortRef>;   // used for previews and the engine API
  stats(d: DeskRef): Promise<DeskStats>;
  destroy(d: DeskRef): Promise<void>;
}
```

A new kind of machine means a new driver. A new ability means a new tool pack. The core doesn't change.

### 11.7 Desks: lifecycle and portability

- **One desk per AI per project.** It holds the repo, dependencies, a browser if needed, the engine and a `memory/` folder.
- **Source of truth:**
  - git: the AI pushes WIP branches often
  - a setup recipe: `devcontainer.json`, the open standard many repos already have, for Linux desks; a Lume image plus a setup script for macOS desks

  A snapshot only makes the next start fast. So an AI can **move to another machine** and rebuild its desk there.
- **Sleep and snapshots:**
  - A desk sleeps after 15–30 minutes idle and wakes on the next message or task.
  - It's snapshotted before each task and nightly.
- **Throwaway forks** for risky or parallel attempts. We keep or discard the result.
- Removing an AI from a project **destroys its desk** there.

### 11.8 Networking and previews

- **One outbound WebSocket** per runner, over port 443. It carries:
  - commands
  - logs and events
  - the engine API
  - the AI's model traffic to the LLM gateway
  - preview tunnels

  It works behind home routers, company firewalls and phone hotspots. The protocol is versioned, and the server supports the previous version too.
- **Preview links.** When Dev-1 starts a dev server, the runner shares it as a **private preview URL** that only room members can open.
  - People open it on their phones.
  - The QA AI on another machine tests it.
  - Machines never connect to each other directly.
- **Egress:**
  - Anything that needs credentials (git push, APIs, model calls) goes **back through the platform**, where the proxy adds credentials and checks limits.
  - Large public downloads can go direct from an allowlist: npm and pip registries, Docker images, Xcode and simulator downloads.

### 11.9 Trust in both directions

**Protecting the machine owner from the platform:**
- The runner only understands the fixed desk commands above. **There is no "run on the host" command.** Even a compromised platform can't take over your Mac.
- AI code runs only inside containers or VMs.
- The "reduced isolation" macOS host mode ([§11.10](#1110-macos-and-ios-qa)) is an explicit opt-in per machine.
- Runner updates are signed. Auto-update is optional.

**Protecting the platform and clients from the runner:**
- Runners never hold real keys.
- Each machine has its own revocable identity.
- A workspace policy, "company AIs only on company machines", keeps client code off personal laptops unless the workspace allows it.
- Desk disks hold client code, so on laptops we recommend disk encryption (FileVault, LUKS).

### 11.10 macOS and iOS QA

- **The iOS Simulator needs real macOS.** A Linux container can't run it.
- **For native iOS apps,** the QA desk is a **macOS VM**:
  - Lume creates it, and has an HTTP API and MCP support.
  - It has Xcode and the simulators.
  - The QA AI drives it with XcodeBuildMCP.
- **Limits:**
  - At most **2 macOS VMs per Mac**, by Apple's license.
  - Each needs about **8 GB RAM** and **60+ GB disk** with Xcode.
  - Julio's M3 Pro with 18 GB fits **one** QA VM, best at night or while idle.
- **A lighter option:** run the simulator on the host under a separate macOS user. It's less isolated, so it's marked **"reduced isolation"**, opt-in, and for trusted AIs only.
- **Web apps don't need a Mac.** QA can test in Safari's engine (Playwright WebKit) at iPhone sizes on any Linux desk.
- **Real iPhones over USB** are possible later. XcodeBuildMCP supports devices.

### 11.11 Sizing guide

| Desk type | CPU | RAM | Disk |
|---|---|---|---|
| Light (research, scripts) | 1–2 vCPU | 2 GB | 10 GB |
| Dev (repo, tests) | 2 vCPU | 4 GB | 20–40 GB |
| Dev with browser and services | 2–4 vCPU | 8 GB | 40 GB |
| macOS VM with Xcode | 4 cores | 8 GB | 60–100 GB |

AIs mostly wait for the model, so CPU can be overcommitted 2–4×. RAM can't.

Julio's Mac (M3 Pro, 11 cores, 18 GB) can host **about 2 Linux desks while in use**, or **1 macOS VM** when idle.

### 11.12 Cloud fallbacks (optional, pay per use)

| Option | Price (Sept 2026) | Notes |
|---|---|---|
| Modal | $30 free credit/month; sandbox CPU about $0.142 per core-hour plus memory | Roughly 80–120 hours of a small desk per month free |
| E2B | Free tier (reportedly up to 100 hours/month); about $0.17/hour for 2 vCPU + 4 GB | Firecracker microVMs |
| Hetzner Cloud, hourly | Smallest VM (CX23) is capped at €5.49/month even if always on | Create per task, delete after. EU. |
| GitHub Actions / Codespaces | 2,000 free Actions minutes/month on private repos (free plan); 120 Codespaces core-hours/month per personal account | The client's own GitHub pays. Actions jobs are throwaway, good for task-to-PR work. |
| ~~Oracle Always Free~~ | Halved to 2 OCPU / 12 GB in June 2026; instances over the new limits get terminated | Not recommended |
| ~~Daytona self-hosted~~ | Development moved to a private codebase in June 2026 | No longer an option |

### 11.13 Runner protocol sketch

```
runner → server
  hello        { machine_id, runner_version, protocol_version, capabilities }
  heartbeat    { stats, desks: [{ id, state, cpu, ram }] }
  event        { desk_id, type, data }                 // lifecycle, logs, engine events
  stream.data  { stream_id, bytes }                    // multiplexed tunnels and exec output

server → runner
  desk.create | desk.start | desk.stop | desk.snapshot | desk.restore | desk.destroy
  desk.exec { desk_id, cmd, env, stream_id }
  desk.files.read | desk.files.write
  tunnel.open { desk_id, port, stream_id }             // engine API, previews, model traffic
  runner.update { version, signature }
```

---

## 12. Git and the code workflow

- **GitHub first.** A `GitProvider` interface lets GitLab or Forgejo slot in per client.
- **MVP: one GitHub App for the platform.**
  - Each client installs it on their org and picks repos.
  - Every AI pushes through it, with branches named per AI.
  - Later we can move to one App per AI for distinct `ai-name[bot]` identities. An account can register up to 100 Apps.
- **Tokens:**
  - The server mints a **one-hour installation token** per task, scoped to that repo, `contents` and `pull_requests`.
  - The git proxy injects the token.
  - It only allows pushes to `agent/<ai-name>/*` branches.
- **Main is protected:**
  - A human approval is required, and approvals from AIs don't count.
  - CODEOWNERS covers workflow files.
  - **CI on AI pull requests waits for a human to approve,** because CI can leak secrets. GitHub does the same for Copilot's agent.
- **Attribution:**
  - A `Co-authored-by:` trailer for the person who asked.
  - Commits the App makes through the API show as verified automatically.
  - A "require signed commits" rule can block AI pull requests, so we test it.
- **Merges and deploys** are Tier 2: approval cards. See question I3.

---

## 13. Web search and browsing

| Tool | Price (Sept 2026) | Use |
|---|---|---|
| **Brave Search API** | $5 per 1,000 searches, $5/month free credit | Default search |
| **Exa** | $7 per 1,000 (up to 10 results) | Semantic and code search |
| Anthropic `web_search` | $10 per 1,000 plus tokens | Simple option for Claude AIs |
| Tavily | 1,000 free credits/month, then $0.008 per credit | Alternative |
| SearXNG (self-hosted) | Free | **Fallback only.** Google puts a single server IP behind CAPTCHAs, and no setting fixes that. |

- In the 2026 AIMultiple benchmark, the top four (Brave, Firecrawl, Exa, Parallel) were statistically tied.
- **Pages are fetched by a reader** (Crawl4AI, free) that holds **no secrets**. The content is labelled **untrusted**.
- **Interactive browsing** uses Playwright inside the AI's desk. Tools that read the page structure were about 12–17 points more reliable than screenshot-only computer use.
- **Search quotas** per AI and per room, paid from the owner's or workspace's search key.

---

## 14. Memory

### 14.1 Scopes

| Scope | Holds | Who writes | When it's loaded |
|---|---|---|---|
| **AI's own** | Skills, how-tos, repo quirks. No personal facts about people. | The AI | Always, for that AI |
| **Room** | Decisions, facts, preferences of this group | AIs in the room, and the listener (as suggestions) | Only in that room |
| **Personal** | Things one person told an AI | The AI | Only in a DM with that person |
| **Workspace-wide** | Company facts, conventions | People, through review | Everywhere in the workspace, read-only for AIs |

### 14.2 The audience rule

A memory can only enter an AI's context if **everyone present now was part of the audience when it was learned.** The platform enforces this when it builds the context, not the prompt.

**Why it has to be in the platform:**
- A July 2026 study (PiSAs) found that with shared or hybrid memory, 63–90% of privacy violations happen through memory.
- Prompt-level defences work 2–3× worse on memory than on normal chat, and no setup it tested was acceptable.
- OpenClaw keeps memory out of group chats only by instructing the model not to load it.

### 14.3 Write policy

- **Where AIs can write:** AIs write only to their own scope and the current room.
- **Promotion:** a background consolidator suggests changes, and a person approves anything that goes workspace-wide.
- **Every memory records:**
  - where it came from: message IDs, author, whether it came from a person or from web/repo content
  - when it's valid (valid from / valid until)
  - an **authority label**. Keeping these labels cut unauthorized actions from 16.9% to 0% in the "authority collapse" study.
- **Safety checks:**
  - Memories are scanned for secrets before writing.
  - Content from untrusted sources is stored as data, never as instructions. This defends against memory poisoning (MINJA-style attacks, OWASP ASI06).

### 14.4 Storage

- **MVP:** markdown files per scope in git, plus Postgres full-text search and pgvector.
- **MVP simplification:** no cross-room memory at all (AI-own and room scopes only). The audience rule is then satisfied by design.
- **Later:** Graphiti or Zep, a temporal knowledge graph with one `group_id` per room, if we need "what changed and when" queries.

---

## 15. Security model

### 15.1 Principles

1. **Enforce limits in code, never in prompts.**
2. **AIs never hold real credentials.**
3. **Only people authorize.** A message from an AI never counts as approval.
4. **Assume any AI can be tricked.** Limit what a tricked AI can do.
5. **Log everything that matters.**

### 15.2 Tiers

| Tier | Examples | Rule |
|---|---|---|
| **0** | Chat, web search, read the board | Free |
| **1** | Work on its own desk, push its own branch, open PRs, write to room memory | Free, within budget |
| **2** | Merge, deploy, spend real money, send anything outside (email, social posts), use secrets, add a new internet domain | **Approval card** from an authorized person |

- **Rule of Two** (Meta): an agent should have at most two of *untrusted input*, *sensitive data* and *the ability to change things or communicate out*. So once an AI session has read untrusted content (a web page, an issue, a pasted text), **every Tier 2 action needs approval.**
- **Messages from other AIs** are untrusted input. Only a human instruction can start Tier 1+ work.

### 15.3 Approval cards

- **Card contents:** what the action is, the diff or command, the worst-case cost in €, who asked, which AI, and when it expires.
- **Buttons:** Approve once / Always allow (for this AI and this action) / Deny with a note.
- **Who can approve:** the **room admin** (Julio's decision D4), within the AI owner's hard limits. Workspace admins can approve too (question J1).
- **Integrity:**
  - An approval is tied to the **exact request hash**. The platform runs exactly what was approved, so the AI can't swap in something else.
  - Unanswered cards are **denied after a timeout.**

### 15.4 Credential and action proxy

Every paid or state-changing API goes through an **adapter** in the platform that understands it. No adapter means no access.

- The adapter works out the **cost and risk** of each request.
- The **policy engine** decides: allow, deny, or requires approval. It could be our own rules, OPA or Cedar.
- A **budget ledger** reserves money on approval and settles it against actual spend.

**Worked example: Google Ads**

Assumptions: the Marketing AI has €200 left this month, and the room's approval threshold is €50.

1. The AI asks to start campaign "Autumn launch" with a daily budget of €30.
2. The adapter computes the **worst case for the month.** Google can spend up to 2× the daily budget on a single day, and up to **30.4×** it in a month, so that's €912.
3. That exceeds both the threshold and the AI's remaining budget, so it's **blocked.** The card says: *"Marketing AI wants campaign 'Autumn launch' at €30/day, worst case €912 this month. Over its budget (€200 left). Lower the daily budget or raise the AI's limit."*
4. The AI proposes €5/day instead, a worst case of €152. It runs Google's `validate_only` check first, then posts the approval card.
5. The admin taps **Approve**, and the adapter runs **exactly that request.**

**Backstops outside our platform:**
- An account budget in Google Ads itself
- One Ads sub-account per AI
- A capped virtual card as the payment method
- A nightly job that pauses campaigns that overspend

### 15.5 Audit log

The log is append-only and visible per room. Each entry records:
- who asked
- which AI
- which room
- the tool or action
- a hash of the arguments
- the approval (who, when)
- the cost
- the result

Every AI has a **kill switch** that stops it immediately and prevents it from being woken.

### 15.6 Threat checklist

| Threat | Mitigation |
|---|---|
| Prompt injection through web pages, repo files or other people in the room | Rule of Two, tiers, no real keys, untrusted labels, a reader without secrets |
| An AI leaking data out | Egress allowlist, credentialed traffic only through the proxy, Tier 2 for sending anything outside |
| Memory poisoning (OWASP ASI06) | Provenance and authority labels, data never stored as instructions, human-reviewed promotion |
| Insecure AI-to-AI communication (ASI07) | Signed handoffs from the gateway, AI messages never count as consent |
| Cascading failures and loops (ASI08) | Hop limits, stuck detection, budgets, kill switch |
| Leaking memory between rooms | The audience rule, enforced in the platform |
| Stolen runner | Revocable machine identity, no real keys on runners, disk encryption |
| Compromised platform attacking runner owners | The runner accepts a fixed command set only, no host exec |
| Leaked keys | Encrypted storage, decrypted only in the LLM gateway, virtual keys with hard caps in desks |
| Supply chain (e.g. the LiteLLM incident) | Pin versions and digests, isolate the LLM gateway, allow outbound traffic only to provider endpoints |
| Spoofed identity in rooms | Identify people by real bare JID, never by nickname |

### 15.7 Data protection (companies, EU)

This is not legal advice. Things to plan for:
- **EU hosting** (e.g. Hetzner Germany or Finland).
- **Clients' consent to send their code and data to specific LLM providers.** A workspace setting lists the allowed providers.
- **Retention and deletion policies.**
- **A data processing agreement** if we host for companies.

---

## 16. Costs

### 16.1 Fixed and near-fixed

| Item | Cost | When |
|---|---|---|
| Control plane VPS (Hetzner CX23) | €5.49/month, or €0 on an existing personal server | From M1 |
| Domain | about €10–15/year | From M1 |
| Apple Developer Program | $99/year | When we need iOS push or TestFlight (M5) |
| Google Play developer account | $25 one-time | Android store release |
| Email sending (sign-up, invites) | Free tiers (e.g. Resend) | From M1 |
| Brave Search | $5/month free credit covers about 1,000 searches | From M2 |
| Error monitoring | Sentry free tier | From M1 |

### 16.2 Variable

- **LLM tokens.** This is the biggest cost. Everything is capped per AI and per room.
- **Cloud fallback compute.** Off by default. If turned on, it's paid within the AI's budget.

### 16.3 Ways to save

1. **Most AIs don't need a desk.** PM, marketing and the listener run as tool calls.
2. **Desks only run while working.** They sleep when idle and wake from a snapshot.
3. **Bring your own compute.** Hardware people already own costs €0.
4. **Cheap models** for the listener and workers. A strong model only for the boss and reviews.
5. **Prompt caching.** A fixed prefix and an append-only listener context.
6. **A night shift.** Non-urgent work (big refactors, research reports, full test runs) queues for when machines are idle and models are cheaper. DeepSeek charges half price off-peak.
7. **Client compute.** GitHub Actions, or the client's own runners.

**Expected cost while testing:** €0–6/month for servers, plus model usage, which you cap.

---

## 17. Tech stack (proposal)

| Area | Proposal | Alternatives | Notes |
|---|---|---|---|
| Language | TypeScript everywhere (web, mobile, server, runner) | – | One language for a small team |
| Web | React 19 + Vite + Tailwind 4 + shadcn/ui | Next.js (Julio uses it in `lokolise`) | A chat client is mostly client-side, so a single-page app is simpler |
| Mobile | Expo (React Native) | Bare React Native | Expo push, OTA updates, EAS builds |
| XMPP client | `@xmpp/client` | Stanza.js | React Native support to verify ([§23](#23-things-to-verify-early-spikes)) |
| State and data | zustand + TanStack Query | – | – |
| Server | Node LTS + Hono + Drizzle + Postgres | Bun runtime | Hono runs on both |
| Auth | Better Auth (organizations plugin) | Lucia-style custom | Email/password, magic link, OAuth, 2FA |
| Jobs | pg-boss (Postgres-based queue) | BullMQ + Redis | No Redis needed |
| Validation and schemas | zod | – | Shared across all apps |
| XMPP server | ejabberd (Docker, Postgres) | Prosody | ejabberd has built-in SQL, admin API, push, WebSocket |
| LLM gateway | LiteLLM (pinned digest) | OpenRouter, a thin custom gateway | – |
| AI engine | OpenCode (pinned) behind `AgentDriver` | Claude Agent SDK, Codex, Hermes | – |
| Runner | TypeScript + Bun single-file binary | Go | The macOS menu-bar app can come later in Swift |
| Sandboxes | Docker (+gVisor on Linux), Apple `container`, Lume | Incus VMs, Firecracker | – |
| Object storage | ejabberd upload volume (MVP), Supabase Storage (prod) | Garage, RustFS, Hetzner Object Storage, R2 | MinIO's free images were deleted on 2026-09-11 |
| Search | Brave API + Crawl4AI reader | Exa, Anthropic web_search | – |
| Monorepo | pnpm + Turborepo | Nx | – |
| Tests | Vitest + Playwright | – | – |
| CI | GitHub Actions | – | – |
| Deploy | Docker Compose on Coolify | Plain compose | – |
| Errors | Sentry | – | – |

### 17.1 Reusing what already runs on Julio's server

Julio's personal Coolify server already runs **Supabase** (Postgres, Auth, Storage), **Forgejo** (with Postgres), **Ollama**, **Uptime Kuma** and the MovaBase apps.

**Specs (from `free -h`, `nproc`, `df -h /` on 2026-09-27):**
- **15 GiB RAM**, with 9 GiB used and **6.6 GiB available**
- **8 cores**
- **896 GB free disk**
- **No swap**

**Verdict:**
- **The control plane fits.** Estimated **2–3 GB** in total:
  - ejabberd: about 0.2–0.5 GB
  - our server: about 0.3–0.5 GB
  - LiteLLM: about 0.5–1 GB
  - local Whisper while transcribing: about 1 GB
  - Postgres and Storage reused from Supabase
- **Add a 4–8 GB swap file first,** as a safety net against out-of-memory kills. Right now, one memory spike could kill MovaBase.
- **Don't run AI desks on this server,** except maybe one light desk. Julio's Mac is the first runner.
- The server is a VM (virtio disk), so full VMs inside it are unlikely to work. If desks ever run here, use gVisor.

| Need | Reuse? | Trade-off |
|---|---|---|
| Postgres | A new database in the existing Supabase Postgres, or its own container | Saves RAM, but ties it to MovaBase's database server. Upgrades and backups are shared. |
| Object storage | Supabase Storage (S3-compatible) | Saves RAM, and MinIO isn't an option anymore |
| Auth | Supabase Auth, instead of Better Auth | Already running, and covers email OTP, Google, Apple. But it's an external service, and connecting it to XMPP tokens is extra work. Better Auth lives inside our server. |
| Git for Julio's own projects | The existing Forgejo | Good for private AI experiments. Pilot repos can still be on GitHub (`JulioFerrero/*`). |
| Uptime monitoring | The existing Uptime Kuma | Free |
| Local models | The existing Ollama | Probably CPU-only, so slow. Fine for tiny tasks, not for the listener at scale. |
| Dev domain | A subdomain of `movabase.com` until the project has its own domain | Free |

### 17.2 Mobile: React Native + Expo

- **Why Expo.** It's the framework React Native itself recommends. It gives us native modules for everything we need, cloud or local builds, and over-the-air updates.
- **Versions.** As of 2026-09-27, **SDK 57 (React Native 0.86)** is the latest stable. SDK 58 (React Native 0.88, built for iOS 27) is in beta, with stable expected in about 3–4 weeks. The mobile scaffold uses whichever is stable when we reach it.
- **Development builds, not Expo Go.** Push notifications and native modules need our own build. Julio can build locally with Xcode on his Mac, or with EAS (Expo's cloud build service).

**Libraries (proposal):**

| Need | Library |
|---|---|
| Navigation | **Expo Router** (file-based, like Next.js) |
| Styling and components | **NativeWind** (Tailwind classes in React Native) + **React Native Reusables** (shadcn/ui for React Native), so it looks like the web app |
| XMPP | `@xmpp/client` (supports React Native; WebSocket is the only transport there, which is fine because ejabberd serves WebSocket) |
| Push | `expo-notifications` + Expo Push (→ APNs/FCM) |
| Voice messages | `expo-audio` |
| Local message cache | `expo-sqlite` |
| Login tokens | `expo-secure-store` |
| Images, camera, QR invites | `expo-image`, `expo-camera` |

**The iOS background reality.** When the app goes to the background, iOS suspends it and the XMPP connection drops. Every iOS chat app deals with this the same way:
- New messages arrive as **push notifications** (ejabberd `mod_push` → our relay → Expo Push → APNs).
- When the app opens, it reconnects and syncs history (MAM).

Spikes S2 and S3 verify this early. xmpp.js has an open discussion about stream-management acks over WebSocket in React Native, which S2 must check.

**Sharing code with the web app:**
- **Shared:**
  - `xmpp-core` (connection, sync, stores, hooks)
  - `protocol` (zod schemas)
  - translations
  - design tokens (the same Tailwind theme on both)
- **Separate:** the UI components. shadcn/ui on the web, React Native Reusables on mobile, with the same look.
- **Why not one Expo app for web too** (react-native-web)? A desktop chat app needs keyboard shortcuts, text selection, wide layouts and drag-and-drop, which are better on real web React.

**Monorepo note.** Expo works in pnpm monorepos but needs specific config, which is covered in its own task (T-0011).

---

## 18. Repository layout (proposal)

```
zilar/
├─ apps/
│  ├─ web/            # React + Vite web app
│  ├─ mobile/         # Expo app
│  ├─ server/         # Hono API + agent gateway + runner hub + proxies + push relay
│  └─ runner/         # bring-your-own-compute runner (Bun single binary)
├─ packages/
│  ├─ xmpp-core/      # shared XMPP client logic + hooks (web + mobile)
│  ├─ protocol/       # zod schemas: XMPP extension, runner protocol, handoffs, board
│  ├─ agent-drivers/  # AgentDriver interface + OpenCode driver (+ others later)
│  ├─ sandbox-drivers/# SandboxDriver interface + docker, gvisor, apple-container, macos-vm, cloud
│  ├─ tool-packs/     # git, browser, xcode, web-search, ...
│  ├─ policy/         # tiers, approvals, budgets, adapters (Google Ads, ...)
│  └─ ui/             # shared design tokens (and web components)
├─ infra/
│  ├─ docker-compose.dev.yml   # ejabberd, postgres, litellm
│  ├─ ejabberd/                # ejabberd.yml
│  └─ litellm/                 # config, pinned image digest
├─ docs/
│  └─ PROJECT_PLAN.md          # this file
├─ work/                        # Claude ↔ DeepSeek task files (see work/README.md)
├─ AGENTS.md                    # rules for DeepSeek workers
└─ package.json / turbo.json / pnpm-workspace.yaml
```

---

## 19. Data model sketch

| Table | Key columns |
|---|---|
| `users` | id, email, name, avatar, xmpp_jid, created_at (plus Better Auth tables) |
| `workspaces` | id, name, slug, settings (allowed providers, AI-on-personal-machines policy) |
| `workspace_members` | workspace_id, user_id, role (owner/admin/member/guest) |
| `invites` | workspace_id, email, role, token, expires_at |
| `rooms` | id, workspace_id, muc_jid, name, mode (listener/mention-only), eagerness, hop limits, approval threshold |
| `room_members` | room_id, member (user or AI), role (admin/member) |
| `provider_connections` | id, owner (user/workspace), provider, encrypted_key, label, status |
| `ais` | id, owner (user/workspace), name, avatar, jid, persona, model, provider_connection_id, fallback_model, engine, tool_packs, autonomy_max_tier, memory_settings |
| `ai_limits` | ai_id, per_day, per_month, per_room json, allowed_rooms, allowed_tools |
| `llm_virtual_keys` | ai_id, litellm_key_id, budget, duration |
| `machines` | id, owner (user/workspace), name, public_key, capabilities json, labels, limits, availability, status, last_seen |
| `machine_grants` | machine_id, workspace_id / room_id / ai_id |
| `desks` | id, ai_id, project/repo, machine_id, driver, state, snapshot_ref, preview_urls |
| `repos` / `git_installations` | provider, installation_id, repo, workspace_id |
| `tasks` | id, room_id, title, owner_ai/user, state (A2A states), deps, acceptance, budget, source_message_id, version (for compare-and-swap) |
| `task_events` | task_id, type, actor, data, at |
| `decisions` | room_id, text, author, source_message_id, at |
| `artifacts` | id, room_id, kind (pr/preview/file/screenshot/report), ref, created_by |
| `approvals` | id, room_id, ai_id, action, args_hash, worst_case_cost, requested_by, state, decided_by, expires_at |
| `ledger_entries` | ai_id, room_id, kind (reserve/settle/refund), amount, currency, ref |
| `memories` | id, scope (ai/room/user/workspace), scope_id, content, source json, audience json, valid_from, valid_to, authority, embedding |
| `audit_log` | id, at, actor, ai_id, room_id, action, args_hash, approval_id, cost, result |
| `push_registrations` | user_id, device, expo_token, platform |

---

## 20. Example flows

### 20.1 First run

1. Julio signs up.
2. He creates workspace "Acme".
3. He invites the dev, PM and marketing colleagues by email.
4. He creates room **#project-a** and adds everyone.

### 20.2 Create an AI (wizard)

1. **Name, avatar, template** (Dev / QA / PM / Marketing / custom).
2. **Personality and role prompt,** prefilled by the template.
3. **Provider:** pick a saved connection or add a key, then **Test key**.
4. **Model:** a model picker from models.dev with prices, plus an optional fallback.
5. **Limits:** €/day, €/month, rooms, tools.
6. **Placement:** needs a desk? Pick a home machine, or requirements and a fallback.
7. **Rooms:** add it to #project-a.

### 20.3 Pair a machine

1. **Add machine** shows a code and the install command.
2. The runner is installed and paired.
3. The admin approves it, and it appears with its capabilities.
4. The admin drags Dev-1 and Dev-2 onto it.

### 20.4 End-to-end request

A person writes: *"@boss the checkout button is broken on mobile, fix it"*

1. **The boss (Opus) wakes.**
   - It reads the room summary and board, and creates two tasks: fix and verify.
   - It delegates the fix to **Dev-1 (DeepSeek)**.
2. **Dev-1 works on its desk:**
   - Its desk wakes on `office-linux`, pulls the repo and fixes the bug.
   - It pushes `agent/dev-1/checkout-fix` and opens PR #42.
   - Progress shows in a thread.
3. **QA tests it:**
   - The boss hands off to **QA**, which opens the private preview link at phone sizes.
   - It finds the button overlapping the footer and posts a screenshot.
4. **They iterate.** Dev-1 fixes it and QA confirms.
5. **Approval.** The boss posts a summary and a card: **"Merge PR #42?"** The room admin taps **Approve**.
6. **Accounting.** Every step was charged to that AI's own key and budget, and all of it is in the audit log.

### 20.5 Listener wake

1. Ana (PM) writes: "Marketing needs the launch copy by Friday."
2. The listener's scores are Marketing 0.9, Boss 0.4, Dev 0.0.
3. The Marketing AI wakes, and the chat shows "Marketing is looking at this".
4. It drafts the copy and adds a task "Launch copy, due Fri" to the board.

---

## 21. MVP scope

Julio asked for: **website app, mobile app, backend, self-hosted compute app, groups and chats, login, register users, create AIs, connect providers.** All of it is in, with a tight feature list.

### In the MVP

**Accounts**
- Register and log in (email + password, and GitHub OAuth)
- Workspaces, invites, roles
- Room admins

**Chat, web and mobile**
- DMs and groups, with history synced across devices
- Replies, @mentions, reactions, edits, deletes
- Typing indicators and read markers
- Image and file upload
- **Voice messages** with transcripts, so AIs can read them
- Push notifications on mobile

**AIs**
- The Create AI wizard with templates
- Person-owned and workspace-owned AIs
- Adding AIs to rooms
- AI profile pages and costs

**Providers**
- Connect keys for Anthropic, OpenAI, Google, DeepSeek, xAI, OpenRouter and OpenAI-compatible endpoints
- Encrypted storage, a "Test key" button
- A LiteLLM virtual key per AI with hard caps

**Working together**
- A listener per room
- Mention and hop limits
- Delegation (boss → workers)
- A simple board: tasks and decisions
- A room summary

**Runner**
- Linux and macOS, using the `docker` driver (plus `docker-gvisor` on Linux if the spike works)
- Pairing and the capability report
- Home-machine assignment
- Desks with OpenCode
- The tunnel and private preview links
- Sleep when idle

**Code**
- One GitHub App
- Clone, push to `agent/<ai>/*` only, open PRs
- Human-only merges

**Web**
- A Brave search tool
- A reader with no secrets
- Playwright in desks for QA of web apps

**Safety**
- Tiers
- Approval cards (engine permission requests and merges)
- Budgets with 80% warnings and a stop at 100%
- A kill switch
- The audit log

**Memory**
- AI-own and room scopes only, as markdown and search

### Not in the MVP (next versions)

- macOS VMs for native iOS QA (Lume + XcodeBuildMCP)
- The Apple `container` driver
- The Mac menu-bar app
- Google Ads and other paid-action adapters. Marketing gets read-only and draft tools first.
- Cloud fallback runners, jobs by capability, team compute pools, the night shift
- Personal and workspace-wide memory scopes, the consolidator, Graphiti
- One GitHub App per AI, GitLab and Forgejo
- Token-by-token streaming
- End-to-end encryption, federation, guests
- Scheduled routines, cross-room delegation, debate mode
- Windows runner
- Integrations: Jira, Linear, Figma, Slack bridge and others

---

## 22. Roadmap and milestones

Rough estimates for **one developer working full time with an AI coding assistant.** Part time, roughly double.

| Milestone | Goal | Contents | Est. |
|---|---|---|---|
| **M0 Foundations** | Everything runs locally | Monorepo, CI, `docker-compose.dev` (ejabberd, Postgres, LiteLLM), spikes from [§23](#23-things-to-verify-early-spikes) | 1–2 wk |
| **M1 Accounts and chat (web)** | Humans can chat | Sign-up and login, workspaces, invites, rooms, DMs, history, uploads, mentions, replies, reactions | 3 wk |
| **M2 AIs that talk** | First AI in a room | Providers and keys, LiteLLM virtual keys, Create AI wizard, AIs as XMPP users, replies when @mentioned (no desk yet), costs | 2 wk |
| **M3 Runner and desks** | AIs that code | Runner pairing, docker driver, desks with OpenCode, tunnel, GitHub App, branch-restricted pushes, PRs, preview links, progress cards | 3 wk |
| **M4 Teamwork and safety** | AIs that collaborate safely | Listener, hop limits, delegation, board, room summary, tiers, approval cards, budgets and kill switch, audit log, search tool, room memory | 3 wk |
| **M5 Mobile** | On the phone | Expo app sharing `xmpp-core`: chat, approvals, board, push (Apple Developer account needed) | 3 wk |
| **M6 Pilot** | A real team uses it | Devs, PM and marketing pilot, fixes, tuning the listener and limits, failure logging | 2+ wk |

**Total:** about **17 weeks, roughly 4 months, full time.**

**After the MVP, suggested order:**
1. macOS/iOS QA
2. Google Ads adapter with spending approvals
3. Cloud fallback runner
4. Mac menu-bar app
5. Personal and workspace memory
6. Integrations (Jira / Linear / GitHub Issues sync)

### 22.1 How we build it: Julio + Claude + DeepSeek agents

**Roles (decision D14):**

| Who | Does |
|---|---|
| **Julio** | Product owner. Answers questions, tests on real devices, invites friends to the pilot. |
| **Claude** (Claude Code) | Architect and lead: <ul><li>keeps this plan up to date</li><li>writes specs</li><li>breaks milestones into small tasks</li><li>builds the risky and security-critical parts (spikes, protocols, auth, proxy, runner core)</li><li>reviews every PR</li></ul> |
| **DeepSeek agents** | Implementers, doing the heavy lifting. Each takes one well-scoped task, works in its own git worktree and branch, runs the checks and writes a report. **Julio launches them himself.** |

**We communicate through markdown files** (Julio's decision). The folder `work/` holds:
- `BOARD.md`, the task list and statuses, maintained by Claude
- one file per task, `work/T-0001-*.md`, with three sections:
  - **Spec**, written by Claude
  - **Report**, written by DeepSeek
  - **Review**, written by Claude

`AGENTS.md` at the repo root holds the rules every DeepSeek worker follows (OpenCode loads it automatically). The loop itself is explained in `work/README.md`.

**How a task flows:**
1. Claude writes a task file `work/T-0123-*.md` containing:
   - the goal
   - the files the agent may touch (one writer per area)
   - acceptance criteria
   - the tests to add or pass
   - out-of-scope notes
2. Julio starts a worker in its own worktree. That can be the interactive OpenCode app, which asks before risky commands, or `opencode run` **inside a Docker container**, since its auto-approve mode approves every command:

   ```
   opencode run -m deepseek/deepseek-v4-pro --dir /work --format json --auto "$(cat tasks/T-123.md)"
   ```

   OpenCode 1.18.25 is already installed on Julio's Mac. `deepseek/deepseek-v4-pro` and `deepseek/deepseek-v4-flash` are available.
3. CI runs typecheck, lint and tests, which must pass.
4. Claude reviews the diff against the acceptance criteria. It either requests fixes, which go back to the worker, or approves.
5. Claude merges once its review finds no problems, bugs or open questions.

In short: Claude plans and reviews, DeepSeek builds, Julio decides.

**Rules, based on the research in [§9.8](#98-team-shapes-lessons-from-research):**
- **Small tasks.** About one day of human work, and a single area of the code.
- **No two workers edit the same files at the same time.** Claude plans the tasks so they don't overlap.
- **Tests are the acceptance criteria.** Claude reviews every PR, since the verifier pattern is what reliably pays off.
- **Model split.**
  - DeepSeek V4 Pro for complex tasks, V4 Flash for simple ones.
  - Claude does the hard integration work (XMPP on React Native, push, the runner tunnel, security).
- **State lives in the repo:** this plan, `tasks/`, and PR descriptions. Any new Claude session can pick up where the last one stopped.

**Dogfooding: using Zilar to improve Zilar.** Once M3 (runners and desks) and M4 (teamwork and approvals) work, this workflow moves **into Zilar itself.**

- **The "Zilar dev" group:**
  - Julio, who decides and approves.
  - A strong-model boss/reviewer AI, which plans and reviews the way Claude does now.
  - DeepSeek dev AIs on Julio's Mac runner.
  - A QA AI that tests each preview at phone and desktop sizes.
  - A marketing AI that writes changelogs and the landing page.
- **Friends are testers.** "This button doesn't work" in any chat → the listener creates a task → the AIs fix it → Julio approves the merge.
- **Mapping from today's workflow:** task files become the board, Reports become PR descriptions, Reviews become approval cards.

**Safety rules for self-improvement.** AIs must never be able to weaken the guardrails that control them.

1. **Protected paths.** The following can only change with **Julio's** review, enforced by CODEOWNERS and branch protection:
   - the policy/approvals/budgets code
   - the credential and action proxy
   - auth
   - the runner's command list
   - `AGENTS.md`
   - CI config

   AI approvals never count.
2. **Two Zilars.** The AIs live in **production** Zilar, but their changes are tested in a separate **staging** Zilar (a preview deployment). Production updates only through a release Julio approves, so a bad change can't break the chat the AIs work in.
3. **One-click rollback** of any release (Coolify redeploys the previous version).
4. **Keep the markdown + OpenCode workflow as a backup path** for when Zilar itself is down.

**Limits to be honest about:**
- Claude works in sessions that Julio starts. It isn't always on, so work pauses between sessions unless workers are left running in the background.
- DeepSeek models are cheap and capable, but may struggle with subtle protocol and mobile issues. Those tasks stay with Claude or get smaller specs.

---

## 23. Things to verify early (spikes)

Do these in M0 before committing. Each is a small throwaway prototype.

| # | Spike | Why | Time | Fallback if it fails |
|---|---|---|---|---|
| S1 | ejabberd in Docker: WebSocket from a browser, MUC + MAM, account creation through the admin API, **JWT or external auth** against our server | The whole chat layer depends on it | 1 day | Prosody + token auth module |
| S2 | `@xmpp/client` in **Expo / React Native** (Hermes engine): connect, reconnect, stream management, background behaviour | Mobile is the riskiest client part | 1–2 days | Stanza.js, or a small native module |
| S3 | **Push:** ejabberd `mod_push` → our relay → Expo Push → a real iPhone | Push on iOS is often the hardest part | 1 day | Server-side push triggered by our own message hooks |
| S4 | **OpenCode** `serve` inside Docker, pinned version: prompt, event stream, `permission.asked` → reply, custom provider through LiteLLM | Core of the AI engine | 1 day | Claude Agent SDK for Claude AIs; Goose or OpenHands |
| S5 | **LiteLLM:** virtual key with budget, adding a user's own key per AI, license check for team features | Bring-your-own-key and caps | 0.5 day | OpenRouter, or a thin custom gateway |
| S6 | **Runner tunnel:** one WebSocket carrying HTTP/SSE to the desk's OpenCode, model traffic back to LiteLLM, and a preview URL | Bring-your-own-compute depends on it | 2 days | WireGuard mesh with Headscale |
| S7 | **gVisor** with Docker on a cheap Hetzner VPS | Safer Linux desks without KVM | 0.5 day | Plain Docker on trusted machines only |
| S8 | **GitHub App:** one-hour tokens, git proxy that only allows `agent/<ai>/*`, PR creation | Code workflow | 1 day | Fine-grained token per repo (less safe) |
| S9 (later) | **Lume** macOS VM + Xcode + XcodeBuildMCP on Julio's Mac, measuring RAM and disk | iOS QA | 1 day | Host mode as a separate macOS user |

---

## 24. Prior art and competitors

| Product | What it is | Takeaway for us |
|---|---|---|
| **Grok Bot** (xAI/SpaceXAI, beta Aug 2026, runs on Cursor infrastructure) | A team of 2–6 bots in group chats, one shared cloud computer per user | Great idea, but the shared machine and missing hard loop limits hurt its users. We give each AI its own desk and enforce hard limits. |
| **Claude in Slack ("Claude Tag")** (Anthropic, June 2026) | Many people in a thread with one Claude. A sandbox per thread that's thrown away after each turn. Credentials injected by an Agent Proxy. Channel memory. | The closest match for multiple humans. Copy the credential proxy and "thread is durable, sandbox is disposable". Its public-channel memory leaked across channels, so we enforce the audience rule. |
| **Slack Code** (Aug 2026) | Coding channels with discussion, plan, diff and preview tabs, and partner agents | People can pause, redirect and approve. A human signs off before production. |
| **Devin** | A VM per session from a snapshot. "Managed Devins" have a coordinator with child sessions. | Snapshots and blueprints for desks, a coordinator that resolves conflicts |
| **Cursor self-hosted cloud agents** | Workers on your own infrastructure with outbound HTTPS only, and team pools (GPU, Macs for iOS) | Direct precedent for our runners |
| **Claude Code agent teams** | A lead with teammates, a shared task list with locked claiming, and mailboxes | Board design. AI messages never count as consent. 3–5 teammates is the sweet spot. |
| **OpenAI Codex cloud** | A container per task. Secrets removed before the agent runs. Internet off by default. | Keep secrets out of desks, egress off by default |
| **OpenClaw** | An open-source personal agent in WhatsApp, Discord and Matrix. Nodes pairing. Docker sandbox. | Pairing UX. Its group-chat memory protection is prompt-only, which we must do better than. Two agents in one a classic messenger group can't see each other. |
| **Hermes Agent** (Nous) | An open-source agent with memory, skills and messaging gateways | A possible alternative engine for "assistant" AIs |
| **OpenGrokBot / OpenMausBot / Rakazo** | Young open-source Grok Bot clones | Watch for ideas. Mostly single-human. |
| **fluux-agent** (ProcessOne) | An experimental XMPP agent from the ejabberd team | XMPP prior art. Consider aligning our extension with it. |
| **Open WebUI Channels** | Multi-user rooms where models reply when @mentioned | Proves human + AI rooms. Its AIs don't coordinate with each other. |
| **LobeHub Agent Groups** | Multi-agent group chat in a polished open-source app | Agent-group UX ideas |

---

## 25. Open questions for Julio

**How to answer:**
- Each question has a **priority** and **my default**. You only need to answer where you disagree or where there's no default.
- **P0** blocks starting (M0/M1). **P1** is needed before its milestone. **P2** can wait.
- Answer inline, e.g. `A1: "Nexo"`, or just "defaults OK except …".

### A. Product and business

| ID | Pri | Question | My default |
|---|---|---|---|
| A1 | ✅ | Project name | **Answered:** Zilar |
| A2 | ✅ | Is this a personal project or for your employer? | **Answered (inferred):** personal project, and the app covers personal *and* work life. Correct me if wrong. |
| A3 | P1 | Open source, closed source, or open-core? Which license? | Private repo for now. Decide before any public release. |
| A4 | P1 | Will you **sell** it (hosted service, self-host licenses, setup services) or use it internally? | Internal pilot first, decide later |
| A5 | ✅ | Who is the first pilot team? | **Answered:** Julio and his friends |
| A6 | P1 | UI languages: English, Spanish, both? | English, translation-ready from day one |
| A7 | P2 | Any brand or design direction? | Clean, messenger-style, dark mode |
| A8 | P1 | What does success look like for the pilot? E.g. "the team uses it daily for 2 weeks and AIs merge 10 useful PRs". | – |

### B. Team, time and money

| ID | Pri | Question | My default |
|---|---|---|---|
| B1 | ✅ | Who is building it? | **Answered:** Julio + Claude + DeepSeek agents ([§22.1](#221-how-we-build-it-julio--claude--deepseek-agents)) |
| B2 | P1 | **Hours per week** you can put in for testing and review? | **Answered in part:** no deadline |
| B3 | ✅ | Monthly budget during development? | **Answered:** not a constraint |
| B4 | P1 | OK to pay **Apple Developer ($99/year)** when we reach mobile push and TestFlight? And Google Play ($25 once)? | Yes, at M5 |
| B5 | P1 | Your experience with React Native/Expo, XMPP, Docker, Postgres? You have a Swift macOS app (`magnetite`); do you want the Mac runner app in Swift later? | Swift menu-bar app later |
| B6 | ✅ | Who writes the code? | **Answered:** Claude + DeepSeek agents, with Julio reviewing and merging |
| B7 | ✅ | Who launches the DeepSeek workers? | **Answered:** Julio launches them. Claude and DeepSeek talk through markdown files in `work/`. |

### C. Accounts and workspaces

| ID | Pri | Question | My default |
|---|---|---|---|
| C1 | P0 | Registration: open sign-up, or invite links only? | Invite links only; anyone with an account can invite ([§7.2](#72-registration-and-login-for-non-technical-people-decision-d13)) |
| C2 | P0 | MVP login methods? | Google, Apple, and email 6-digit code, with no passwords. GitHub login for developers. Passkeys later. |
| C3 | P1 | Require 2FA for admins? | Yes for admins |
| C4 | P1 | Can one user belong to **several workspaces** (e.g. a consultant with several clients)? | Yes |
| C5 | P1 | Can regular members create rooms, or only admins? | Members can create rooms |
| C6 | P2 | Guests (external people in one room only)? | Later |
| C7 | P1 | Is a `@username` required, or optional? | Optional. Invite links and QR codes are the main way. |
| C8 | P1 | DMs between coworkers: always personal, or can a workspace have "work DMs" under its policies? | Personal in the MVP, work DMs later |
| C9 | P1 | "Bring your own AI" into work groups: allowed by default? | Workspace setting, off by default |
| C10 | P1 | Chat list: one list with folders (messenger-style), or a space switcher (Slack/Discord-style)? | One list with folders |

### D. Chat features

| ID | Pri | Question | My default |
|---|---|---|---|
| D1 | P0 | MVP chat features: confirm the list in [§21](#21-mvp-scope) (DMs, groups, replies, mentions, reactions, edits, deletes, typing, read markers, uploads). Anything to add or remove? | As listed |
| D2 | P1 | Messenger-style replies, or Slack-style threads? It matters for where AI work shows up. | Replies, plus "task threads" for AI work |
| D3 | ✅ | End-to-end encryption? | **Answered:** cloud chats, no encrypted chats for now (D19) |
| D4 | P2 | Federation with other XMPP servers? | Off |
| D5 | P1 | Message retention: forever, N days, or per workspace? | Forever, admins can delete |
| D6 | P1 | Maximum upload size? | 50 MB |
| D7 | P2 | Message search in the MVP? | Later |
| D8 | ✅ | Voice messages? | **Answered:** yes, and AIs read them through transcription ([§6.7](#67-voice-messages-in-the-mvp)). Calls later. |

### E. AIs

| ID | Pri | Question | My default |
|---|---|---|---|
| E1 | P0 | Can any member create **personal AIs**, and only admins **workspace AIs**? | Yes |
| E2 | P0 | Which **providers** first? | Anthropic, OpenAI, Google, DeepSeek, xAI, OpenRouter, OpenAI-compatible |
| E3 | P1 | Can AIs **DM people on their own**, e.g. "your PR is ready"? | Yes, only people in their rooms, rate-limited |
| E4 | P1 | **Scheduled routines**, e.g. "every morning post a status report"? | After the MVP |
| E5 | P1 | Can AIs create rooms or invite people? | No |
| E6 | P1 | Can a personal AI join rooms in **other workspaces**? | No, one workspace per AI |
| E7 | P1 | Are the templates right (Boss/PM, Dev, QA, Marketing, Listener)? Missing any (designer, support, data analyst, SEO)? | – |
| E8 | P1 | Who can see an AI's costs: everyone in the room, or only owners and admins? | Owners and admins |
| E9 | P1 | Local models (Ollama) in the MVP? | Via "OpenAI-compatible", no special support |
| E10 | P2 | AI avatars: uploaded or generated? | Uploaded, with generated default initials |

### F. Multi-agent behaviour

| ID | Pri | Question | My default |
|---|---|---|---|
| F1 | P0 | Listener wakes: **silent** ("Dev is looking at this") or a **visible** "@dev" message? | Silent, with a tappable reason |
| F2 | P1 | Default room mode: listener on, or mention-only? | Listener on, eagerness medium |
| F3 | P1 | Default limits per human message: 4 AI messages and 2 AI-to-AI hops. OK? | Yes |
| F4 | P1 | One boss per room, or can any AI delegate? | Any AI with the delegate permission. "Boss" is a template. |
| F5 | P1 | Can AIs delegate **across rooms**? | Not in the MVP |
| F6 | P2 | A "debate mode" where AIs argue in turn on purpose? | Later |
| F7 | P1 | Should the listener also run **reminders** ("nobody answered Ana")? | Yes, at most 1 per hour per room |

### G. Compute and runners

| ID | Pri | Question | My default |
|---|---|---|---|
| G1 | P0 | Who can **add machines**? | Anyone, for their own AIs. Admins can place workspace AIs on machines shared with the workspace. |
| G2 | P0 | When an AI's machine is **offline**: wait, move to another machine, or use paid cloud? | Wait in a queue and notify. Cloud fallback off. |
| G3 | P0 | Mac: command-line runner first and menu-bar app later? | Yes |
| G4 | P1 | Allow **company AIs on personal machines**? | A workspace setting, off by default |
| G5 | P0 | Which machines for the pilot? Your M3 Pro Mac, any Linux server or VPS, a spare PC? | Your Mac + one small VPS |
| G6 | P1 | Minimum isolation: is plain Docker OK on trusted machines, or always require gVisor or a VM? | gVisor on Linux when available. Docker Desktop's VM on Mac. |
| G7 | P2 | Cloud fallback provider when we add one: Modal, E2B, or Hetzner hourly? | Hetzner hourly (EU, cheapest) |
| G8 | P2 | Windows runners? | Later |

### H. What the first team builds (affects QA)

| ID | Pri | Question | My default |
|---|---|---|---|
| H1 | ✅ | First uses for the AIs? | **Answered:** coding, marketing, and fun |
| H1b | P2 | When we get to QA: are the apps being tested web, native iOS, React Native or Android? | Web first |
| H2 | P1 | Simulator only, or also real iPhones by USB? | Simulator only |
| H3 | P1 | Tech stack of the pilot repos (languages, how tests run, Docker Compose?) | – |

### I. Git and code

| ID | Pri | Question | My default |
|---|---|---|---|
| I1 | P0 | Which GitHub org and repos for the pilot? Are they private? | – |
| I2 | P1 | One platform GitHub App for all AIs in the MVP, with branches per AI? | Yes |
| I3 | P1 | Merges: humans only, or can a room admin let an AI merge after green CI? | Humans only |
| I4 | P1 | **Deploys:** can AIs deploy (e.g. through Coolify) with approval? | Later, as Tier 2 |
| I5 | P1 | CI on AI PRs requires a human to approve it? | Yes |

### J. Security and approvals

| ID | Pri | Question | My default |
|---|---|---|---|
| J1 | P0 | If the room admin is offline, who else can approve, and when does a request expire? | Workspace admins can approve too. Deny after 24 hours. |
| J2 | P1 | A two-person rule above some amount (e.g. over €200)? | Not in the MVP |
| J3 | P1 | Which actions always need approval, even for trusted AIs? | Merge, deploy, any real-money spend, sending anything outside |
| J4 | P1 | Audit log retention, and who can read it? | 1 year; admins, plus the room's own entries for room admins |
| J5 | P1 | Who can hit the **kill switch**? | Owner, room admin, workspace admin |
| J6 | P2 | A security review or pentest before companies use it? | Before any paying client |

### K. Integrations for the first team

| ID | Pri | Question | My default |
|---|---|---|---|
| K1 | P0 | Where does your **PM** work: Jira, Linear, GitHub Issues? Should the board sync with it or stay separate? | Our board in the MVP. GitHub Issues sync next. |
| K2 | P1 | Which **marketing** tools matter most: Google Ads, Meta Ads, LinkedIn, GA4, email tool, social scheduler, CMS? | Read-only Google Ads + GA4 after the MVP |
| K3 | P1 | Design and docs tools: Figma, Notion, Confluence, Google Docs? | Later |
| K4 | P2 | Bridges so people can talk to the AIs from Slack or WhatsApp? | No |
| K5 | P1 | Can users connect **any MCP server** to an AI, or only an admin-approved list? | Admin-approved list |

### L. Hosting and operations

| ID | Pri | Question | My default |
|---|---|---|---|
| L1 | ✅ | Coolify server size | **Answered:** personal, 15 GiB RAM (6.6 GiB available), 8 cores, 896 GB free, no swap. The control plane goes on it, and we add swap first ([§17.1](#171-reusing-what-already-runs-on-julios-server)). |
| L2 | P0 | Domain name? | Buy one once the name is chosen |
| L3 | P1 | Email provider for sign-ups and invites? | Resend free tier |
| L4 | ✅ | Object storage | **Decided (D21):** ejabberd upload volume for the MVP, then Supabase Storage |
| L5 | P1 | Backups: where, and how often? | Nightly Postgres dump + archive to object storage, kept 14 days |
| L6 | P1 | Error monitoring with Sentry? You already have it connected. | Yes, free tier |

### M. Mobile

| ID | Pri | Question | My default |
|---|---|---|---|
| M1 | P0 | iOS, Android, or both for the MVP? | Both through Expo, iOS tested first |
| M2 | P1 | Distribution: TestFlight and internal only, or public app stores? | TestFlight + Android APK |
| M3 | P1 | Should push notifications show the message text, or just "New message"? | Sender + preview, configurable per user |

### N. Tech preferences

| ID | Pri | Question | My default |
|---|---|---|---|
| N1 | ✅ | Web framework | **Answered:** Vite SPA (D20) |
| N2 | ✅ | Server stack | **Answered:** Node + Hono + Drizzle + Postgres |
| N3 | ✅ | Auth | **Answered:** Better Auth |
| N4 | ✅ | Monorepo | **Answered:** pnpm + Turborepo |
| N5 | ✅ | Where the code lives | **Answered:** private repo `JulioFerrero/zilar` |
| N6 | P1 | Testing: Vitest + Playwright OK? | Yes |
| N7 | P1 | Reuse your server's **Supabase** (Postgres, Storage, maybe Auth) or keep this project separate? ([§17.1](#171-reusing-what-already-runs-on-julios-server)) | Reuse Postgres and Storage in a separate database and bucket. Better Auth inside our server. |

### O. Data protection (for companies)

| ID | Pri | Question | My default |
|---|---|---|---|
| O1 | P1 | Will EU companies use it, so we need EU hosting and possibly a data processing agreement? | EU hosting from day one |
| O2 | P1 | Should each workspace choose which LLM providers may receive its data? | Yes |
| O3 | P1 | Deleting a user: delete their messages, or anonymize them? | Anonymize |
| O4 | P2 | Keep AI working traces for debugging? For how long? | 30 days |

---

## 26. Sources

The research was done on 2026-09-27. Figures from preprints and vendor benchmarks are directional.

### Products and prior art

- Grok Bot:
  - computer model: https://docs.x.ai/grok-bot/computer-and-apps
  - chat and collaboration: https://docs.x.ai/grok-bot/chat-and-collaboration
  - security: https://docs.x.ai/grok-bot/security
- Grok Bot bot-loop quota report: https://forum.cursor.com/t/grok-bot-weekly-usage-hits-100-after-bot-to-bot-reviews-the-user-asked-to-stop/170271
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams
- Claude in Slack (Claude Tag):
  - https://claude.com/docs/claude-tag/concepts/how-it-works
  - https://claude.com/docs/claude-tag/concepts/agent-identity
- Devin:
  - https://docs.devin.ai/onboard-devin/repo-setup
  - https://cognition.com/blog/devin-can-now-manage-devins
- Cursor:
  - cloud agents: https://cursor.com/docs/cloud-agent
  - self-hosted: https://cursor.com/blog/self-hosted-cloud-agents
- Cursor worker pools (Sept 2026): https://www.devx.com/artificial-intelligence-ai/self-hosted-cloud-agents-cursor-worker-pools/
- Codex cloud environments: https://learn.chatgpt.com/docs/environments/cloud-environment
- Slack Code: https://www.salesforce.com/ap/news/press-releases/2026/08/24/salesforce-launches-slack-code-to-make-ai-software-development-multiplayer/
- OpenClaw:
  - https://docs.openclaw.ai/nodes
  - https://docs.openclaw.ai/gateway/pairing
  - https://docs.openclaw.ai/gateway/security
  - https://github.com/openclaw/openclaw/issues/18869
- fluux-agent: https://github.com/processone/fluux-agent
- Open WebUI Channels: https://docs.openwebui.com/features/channels/
- LobeHub Agent Groups: https://lobehub.com/docs/usage/agent/agent-team
- OpenGrokBot: https://github.com/Z4YT0N/OpenGrokBot
- OpenMausBot: https://github.com/milind-soni/OpenMausBot

### Multi-agent design and research

- Anthropic, multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic, context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, when to use multi-agent systems: https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
- Google ADK context architecture: https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/
- Google Research, scaling agent systems: https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- Cognition:
  - https://cognition.com/blog/dont-build-multi-agents
  - https://cognition.com/blog/multi-agents-working
- LangChain:
  - benchmarks: https://www.langchain.com/blog/benchmarking-multi-agent-architectures
  - handoffs: https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs
- Microsoft Agent Framework:
  - group chat: https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat
  - Magentic: https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic
- AG2 GroupChat: https://docs.ag2.ai/latest/docs/api-reference/autogen/GroupChat/
- OpenAI Agents SDK handoffs: https://openai.github.io/openai-agents-python/handoffs/
- Letta shared memory: https://docs.letta.com/guides/agents/multi-agent-shared-memory/
- A2A specification: https://a2a-protocol.org/latest/specification/
- MCP 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- MAST failure taxonomy: https://arxiv.org/html/2503.13657
- Infinite loops in agent systems: https://arxiv.org/html/2607.01641v1
- Inner Thoughts (CHI 2025): https://arxiv.org/abs/2501.00383
- When2Speak: https://arxiv.org/abs/2605.05626
- Blackboard multi-agent: https://arxiv.org/abs/2507.01701
- PatchBoard: https://arxiv.org/abs/2605.29313
- AgentRadio: https://arxiv.org/abs/2607.28430
- Conversation-analysis turn-taking: https://arxiv.org/html/2412.04937v1
- OWASP Top 10 for Agentic Applications 2026: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/

### AI engines and routing

- OpenCode:
  - server: https://opencode.ai/docs/server/
  - permissions: https://opencode.ai/docs/permissions/
  - SDK: https://opencode.ai/docs/sdk/
  - releases: https://github.com/anomalyco/opencode/releases
- Hermes Agent:
  - https://github.com/nousresearch/hermes-agent
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- Claude Agent SDK:
  - https://code.claude.com/docs/en/agent-sdk/overview
  - https://code.claude.com/docs/en/agent-sdk/permissions
- Codex app-server: https://learn.chatgpt.com/docs/app-server
- Goose: https://goose-docs.ai/
- OpenHands: https://docs.openhands.dev/sdk/guides/agent-server/overview
- ACP tool calls: https://agentclientprotocol.com/protocol/tool-calls
- LiteLLM:
  - users and budgets: https://docs.litellm.ai/docs/proxy/users
  - virtual keys: https://docs.litellm.ai/docs/proxy/virtual_keys
  - March 2026 security update: https://docs.litellm.ai/blog/security-update-march-2026
- OpenRouter bring-your-own-key: https://openrouter.ai/docs/guides/overview/auth/byok
- models.dev: https://models.dev/

### Sandboxes and compute

- Firecracker: https://firecracker-microvm.github.io/
- gVisor:
  - platforms: https://gvisor.dev/docs/user_guide/platforms/
  - Docker in gVisor: https://gvisor.dev/docs/tutorials/docker-in-gvisor/
- E2B:
  - runtime: https://github.com/e2b-dev/runtime
  - billing: https://e2b.dev/docs/billing
- Daytona repo notice: https://github.com/daytonaio/daytona
- microsandbox: https://github.com/superradcompany/microsandbox
- CubeSandbox: https://github.com/TencentCloud/CubeSandbox
- Kubernetes agent-sandbox: https://github.com/kubernetes-sigs/agent-sandbox
- Docker Sandboxes: https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/
- Coder Agents: https://coder.com/docs/ai-coder/agents
- Cloudflare Sandbox GA: https://blog.cloudflare.com/sandbox-ga/
- Incus ZFS storage: https://linuxcontainers.org/incus/docs/main/reference/storage_zfs/
- iron-proxy: https://github.com/ironsh/iron-proxy
- Infisical Agent Vault: https://github.com/Infisical/agent-vault
- Apple container: https://github.com/apple/container
- Lume: https://github.com/ohso4/lume
- Tart license: https://tart.run/blog/2023/02/11/changing-tart-license/
- XcodeBuildMCP: https://github.com/getsentry/XcodeBuildMCP
- Apple 2-VM limit: https://eclecticlight.co/2022/08/04/virtualisation-on-apple-silicon-macs-8-how-apple-limits-vms/
- Modal:
  - sandbox pricing: https://modal.com/docs/guide/sandbox-resources
  - plans: https://modal.com/pricing
- Hetzner:
  - 2026 prices: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
  - CX23: https://comparedge.com/tools/hetzner/pricing
- Oracle free tier cut: https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
- GitHub Codespaces billing: https://docs.github.com/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces
- Copilot and Actions minutes: https://github.blog/changelog/2026-04-27-github-copilot-code-review-will-start-consuming-github-actions-minutes-on-june-1-2026/

### Memory, search, git, security

- Anthropic memory tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Claude Code memory: https://code.claude.com/docs/en/memory
- Letta sleep-time agents: https://docs.letta.com/guides/agents/architectures/sleeptime/
- Graphiti MCP server: https://github.com/getzep/graphiti/blob/main/mcp_server/README.md
- mem0: https://docs.mem0.ai/platform/features/graph-memory
- PiSAs (memory privacy): https://arxiv.org/abs/2607.05318
- Authorization Before Context: https://arxiv.org/abs/2608.17148
- Authority collapse: https://arxiv.org/abs/2608.01679
- Memory injection defence: https://arxiv.org/abs/2601.05504
- Brave Search API: https://brave.com/search/api/
- Exa pricing: https://exa.ai/docs/reference/pricing
- Anthropic web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Agentic search benchmark: https://aimultiple.com/agentic-search
- SearXNG CAPTCHA issue: https://www.ssdnodes.com/learn/fix-searxng-engine-captcha-errors
- GitHub App installation tokens: https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- Copilot agent risks and mitigations: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations
- Claude Code sandboxing (git proxy): https://anthropic.com/engineering/claude-code-sandboxing
- Forgejo token scopes: https://forgejo.org/docs/latest/user/token-scope/
- Lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- Meta Rule of Two: https://ai.meta.com/blog/practical-ai-agent-security/
- The Attacker Moves Second: https://arxiv.org/abs/2510.09023
- Design patterns against prompt injection: https://arxiv.org/abs/2506.08837
- CaMeL: https://arxiv.org/abs/2503.18813
- Slack AI data exfiltration: https://www.promptarmor.com/resources/data-exfiltration-from-slack-ai-via-indirect-prompt-injection
- Google Ads budgets:
  - https://support.google.com/google-ads/answer/1704443
  - https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview
- AI SDK policy approvals: https://ai-sdk.dev/docs/agents/policy-tool-approvals
- AWS AgentCore Policy: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html
- OpenBao transit: https://openbao.org/docs/secrets/transit/

### Model prices (Sept 2026)

- https://benchlm.ai/llm-pricing
- https://coworker.ai/blog/deepseek-api-pricing
