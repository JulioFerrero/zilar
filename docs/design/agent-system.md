# Zilar agent system: design and build plan

Written 2026-10-14 after research, for Julio's review. Status: **proposal**.

## 0. The goal (Julio, 2026-10-14)
- **AIs that act, not only chat.** An AI is "like Grok Bot": it can **search online, download git projects, search code, connect MCPs, edit files, run Linux commands, and use a browser** when needed.
- **Invisible plumbing.** It all happens in the background; it **doesn't spam the chat**.
- **Secure and fast.** As secure and performant as possible.
- **Cheap at scale.** Not "a Docker with 1 CPU and 1 GB per AI": 1000 users must not mean 1000 machines.

## 1. What the industry does (research, with sources in §9)
| Who | What they do | What we take |
|---|---|---|
| **Anthropic, Managed Agents** | Split every agent into a **brain** (model plus loop), **hands** (sandboxes, tools) and a **session** (a durable event log). The brain is stateless and calls a sandbox like any tool, `execute(name, input) → string`. Sandboxes are **provisioned only when first needed** and are disposable. **Credentials never enter the sandbox**: the git token is used once at setup to wire the remote, and MCP calls go through a proxy that fetches OAuth tokens from a vault. Lazy provisioning cut time-to-first-token by about 60% (p50) and over 90% (p95). | The whole shape of our design (§2) |
| **Claude Code sandbox** | Each shell command runs under **bubblewrap** (Linux) with **no direct network**. Traffic goes through a local proxy that checks each host against an allowlist that **starts empty**. File writes are limited to the working directory. | Per-command isolation and a default-deny network |
| **OpenAI** (ChatGPT, Codex) | Moved from containers to **gVisor**, then to **microVMs** (Cloud Hypervisor). Workspaces are saved as **incremental block snapshots** in object storage; warm pools; restores are routed to nodes that already cache the snapshot. Advice: "security tricks can cover performance issues, but they cannot hide security breaches". | gVisor now; microVMs once we have a KVM host; snapshots for idle AIs |
| **Cloudflare Sandboxes** | The agent loop lives outside the container, and the container **sleeps while the agent waits**. Filesystem snapshots restore a workspace days later. Pre-prepared VMs: median start **648 ms** for 100 at once. An outbound handler injects credentials and enforces policy. | Sleep when idle; snapshot and restore; credential injection at the egress |
| **Kubernetes agent-sandbox** | Sandboxes on gVisor or Kata, with **warm pools** so a claim is served in milliseconds. | A small warm pool |
| **E2B** | Firecracker microVMs. A full pause costs about **4 s per GB of RAM**; **filesystem-only snapshots** are cheaper. | Save files, not RAM |
| **Grok Bot** (xAI) | Each bot has its **own persistent cloud computer** (browser, files, terminal), sold at premium tiers. | The expensive model we are avoiding |
| **Manus** | **KV-cache hit rate is the key metric** (cached input is about 10× cheaper): keep the prompt prefix stable and the context append-only; don't add or remove tools mid-task; use the **file system as memory**; rewrite a `todo.md` so the goal stays in view; keep failed actions in context. | Prompt caching rules for our agent loop (§2.5) |
| **Security research** | Prompt injection is unsolved inside the model; contain the damage **outside** it. The "lethal trifecta" is private data plus untrusted content plus a way out; remove one leg. A 2026 study found that **domain allowlisting at tool execution blocked all attempted exfiltration**. MCP risks: **tool poisoning** (hidden instructions in tool descriptions); remote MCP uses **OAuth 2.1**. | Default-deny egress, secrets out of reach, pinned MCP tool descriptions |
| **Browsers** | Headless Chrome costs a lot per session. **Lightpanda** claims 9–16× less memory, but it is beta and implements fewer Web APIs. Hosted pools: Browserbase, Browserless. | One shared browser service, a context per task |
| **Chat UX** | Slack AI apps show a **status line** ("is thinking…", with rotating loading messages) instead of messages. GitLab Duo replaces "👀 … silence … ✅" with **one self-updating message** (status, live todo list, final answer). | §4 |

## 2. Architecture
```
            ┌──────────────── Zilar server ─────────────────┐
 chat ───►  │ Agent brain (stateless, many per process)       │──► model providers (user's key, decrypted per call)
 (XMPP)     │   ├─ tier-0 tools: web search/fetch, memory,     │
            │   │   delegate, remote MCP (via MCP proxy)        │
            │   └─ hands client: provision / execute / stop    │
            │ Session log (Postgres, append-only events)       │
            │ Egress proxy (allowlist, credential injection)   │
            └──────────────┬───────────────────────────────────┘
                           │ only when a tool needs a computer
            ┌──────────────▼────────────── sandbox host ────────┐
            │ Sandbox service: gVisor (runsc) jails, one per    │
            │ ACTIVE task, mounted on the AI's workspace folder │
            │ Browser service: one Chromium, a context per task │
            └───────────────────────────────────────────────────┘
```

### 2.1 Brain (exists; extend it)
- **Today's loop** (`apps/server/src/agents/tool-loop.ts`, `gateway.ts`, `dm-turn.ts`) stays the brain. It is stateless per turn and mostly waits on the network, so one server process drives thousands of AIs.
- **Model calls go straight from our server** through a provider SDK, with the user's sealed key decrypted per call. There is **no LiteLLM**: sandboxes never call models, so no stand-in keys are needed (`docs/audit/ai-gateway-options.md`).
- **Budgets live in our database:** tokens and estimated cost per AI per day are always counted; when the owner sets a limit, it is checked before each call (no limit by default). Prices come from models.dev (T-1395).

### 2.2 Session log (new)
- **An append-only table of events per task:** user message, model call, tool call, tool result, approval, status, final answer.
- **The brain can crash and resume:** `wake(taskId)` replays the log, as in Managed Agents.
- **It feeds the task card and the "details" view in chat (§4).**
- **It's not the model's context window.** The brain picks which events to put in context (compaction is reversible because the log keeps everything).

### 2.3 Hands: the computer, only when needed
**Tier 0, no computer** (most turns): chat, memory, web search and fetch (`apps/server/src/web-tools/`), delegate, remote MCP tools. Costs about nothing.

**Tier 1, the computer:** a jail per **active task**.
- **Tools** (an OpenCode-style set): `bash`, `read`, `write`, `edit`, `grep` (ripgrep), `glob`, `git` (clone, diff, commit, push), `download`.
- **Every tool runs inside the jail.** Even `git clone` and `grep` touch untrusted files (git hooks and filters can run code). Inside the jail, git hooks are disabled (`core.hooksPath=/dev/null`) and LFS filters are off.
- **Isolation:** **gVisor (`runsc`, systrap platform)**. It needs **no KVM**, and our VPS has none (checked: no `/dev/kvm`). The user-space kernel is far harder to escape than plain Docker. Read-only base image, writable workspace mount, no new privileges, seccomp, all capabilities dropped, cgroup limits.
- **Lifecycle** (Cloudflare and Managed Agents pattern):
  - **provision on first use:** about 200 ms–1 s; a pool of 2–3 pre-started jails makes it instant;
  - **exec many commands** while the task runs;
  - **stop after about 2 minutes idle.** The workspace folder stays on disk, so idle AIs cost only disk.
  - **Later:** cold workspaces are compressed to object storage after N days and restored on next use.
- **Memory is one shared pool** (Julio, 2026-10-14: "shared memory but in a way that doesnt colapse the vps"):
  - every jail runs under one parent cgroup (`zilar-desks`) with a **hard `memory.max` of 4 GB** for all jails together, which leaves about 3 GB free for chat, Supabase and Coolify;
  - when the pool is full, the kernel's OOM kill stays **inside the pool** (the biggest jail), never in chat or the database;
  - per jail: `memory.high` = 1 GB (throttle and reclaim, no kill) and `memory.max` = 2 GB (one runaway build); pids 256; `cpu.weight` share, no pinning;
  - light commands (git, grep, ls, small scripts) use tens of MB plus about 30–50 MB of gVisor overhead, so many fit at once. `npm install` and builds borrow up to 1–2 GB while they run.
- **Admission control:** a new jail starts only while the pool is under 75% and fewer than **12** jails run. Otherwise the task waits in a fair queue per user, and the card says "Queued (n ahead)".
- **Disk:** each AI's workspace is a **fixed-size disk image file** (e.g. 5 GB, ext4 inside), mounted into its jail. That's a quota without changing the host filesystem (the VPS is ext4; Julio's choice, 2026-10-14).
- **Time:** a wall-clock limit per command (e.g. 10 min) and per task.
- **Network** (Julio's decision, §7): **the open web through the egress proxy**, never a direct route out. The owner can narrow an AI to an allowlist (package registries, connected git hosts, chosen domains). The proxy logs every host contacted, and that list shows in "View steps".
- **Never reachable:** internal and private ranges (our existing `classifyIp`, `packages/desk/src/egress/ip-guard.ts`).
- **Credentials never enter the jail.** For git push, **the proxy injects the owner's token** on requests to that git host only, so the jail holds no token. MCP and other APIs work the same way.

**Tier 2, the browser:** one shared **browser service** (Playwright Chromium; Lightpanda later for text-only pages).
- **A fresh incognito context per task,** closed after; the same egress proxy; no access to any workspace.
- **The AI gets** page text, the accessibility tree and screenshots, as tools: `browser_open`, `browser_click`, `browser_type`, `browser_screenshot`.
- **Logged-in browsing** (cookies saved per AI) is opt-in and later.

**MCP:**
- **Remote MCP servers (HTTP):** connected by our server's MCP client. The owner adds them and approves the OAuth 2.1 sign-in; tokens are kept in our vault and are never shown to the model.
- **Tool descriptions are pinned** (hashed) at approval time. A changed description pauses the server until the owner re-approves, which defends against tool poisoning.
- **Local (stdio) MCP servers** run inside the jail, under the same network rules.

### 2.4 Scale path
| Stage | Where jails run | When |
|---|---|---|
| **Now** | The current VPS (8 vCPU, about 7.5 GB free, 877 GB disk; no KVM), with gVisor | First users |
| **Next** | One dedicated **KVM** server for sandboxes (e.g. 64 GB RAM): gVisor or Cloud Hypervisor/Firecracker microVMs, warm pool, snapshots | When the queue shows waits |
| **Then** | Several sandbox hosts; snapshot-aware routing; overflow to a hosted sandbox provider (E2B, Cloudflare) | Growth |
| **Any time** | **Runners** (§2.6): a user's own Mac, Linux box or server hosts their AI's jails | From P2 on; first-class, not an afterthought |

The brain only ever calls `provision / execute / stop / snapshot`, so swapping gVisor for microVMs, a hosted provider or a runner changes one adapter, not the agent.

### 2.6 Runners: the same system on the user's machine (Julio, 2026-10-14)
**Goal:** an owner can choose where an AI's computer runs: **Zilar cloud** or **their own runner**. Both must be equal in features, just as seamless, and just as secure. A runner may be better: faster CPU, local files, Xcode, a GPU.

**The model** (this is how Cursor's self-hosted cloud agents work, §9): **the brain stays in the Zilar server, and only the hands move.**
- **The runner is a small app** (one binary; Bun-compiled TypeScript, as `PROJECT_PLAN.md` planned) for macOS, Linux and Windows (WSL2).
- **It opens one long-lived outbound connection** (WebSocket over TLS) to Zilar. It never listens on a port, so no firewall changes, port forwarding or public IP are needed.
- **Zilar sends tool calls down that connection** (`provision / execute / stop / snapshot`, the same interface as §2.4). The runner runs them in its local jail and streams results back.
- **The chat, task card, approvals, session log and model calls are identical,** because they all live in the server. The only difference the user sees is "Running on: Julio's Mac" on the task card.

**One jail image, three hosts.** The runner uses the same pinned base image and the same tool daemon as Zilar cloud, so `bash / read / edit / grep / git / browser` behave the same everywhere:

| Host OS | Isolation |
|---|---|
| Linux | gVisor (`runsc`), or bubblewrap plus seccomp when gVisor isn't installed |
| macOS | Apple `container` (one light VM per container on macOS 26), with Docker or OrbStack as a fallback |
| Windows | WSL2 plus gVisor |

The runner refuses to run without a working jail: **there is no "unsandboxed" mode.**

**Seamless:**
- **Pairing in two steps.** In Zilar: Settings → Runners → "Add a runner" shows a one-line install command and a short code. The user runs it on the machine; the runner appears online in the list. There are no tokens to copy around.
- **Choose per AI:** "Computer: Zilar cloud / My Mac / Auto". **Auto** uses the runner when it's online and falls back to the cloud, or queues the task, as the owner chooses.
- **When the runner goes offline mid-task,** the card says "Waiting for Julio's Mac" and resumes when it's back. The session log makes this safe (§2.2).
- **Workspaces live where the jail runs.** Moving an AI between cloud and runner moves its workspace (a git push and pull, or a compressed snapshot upload), with one confirm.
- **Runner extras, opt-in per AI:**
  - a local folder mounted into the jail (read-only by default);
  - tool packs such as Xcode and the iOS Simulator on a Mac;
  - more CPU and RAM.
- **Updates are automatic** and signed; the runner checks the signature before it swaps the binary.
- **Tray or menu-bar status:** online, running tasks, and a big **Stop all** button.

**Secure, both ways.**

*Protecting the user's machine from the AI:*
- the same jail and egress proxy as the cloud;
- the runner never mounts the home folder;
- local folders only when the owner adds them, and read-only unless they say otherwise;
- local limits on CPU, RAM and disk, set by the owner;
- **Stop all** kills every jail at once;
- runner-side policy can **only tighten** what Zilar asks for (for example "never allow network" or "only these domains"), never loosen it.

*Protecting the user's machine from Zilar (and from a compromised Zilar server):*
- the runner accepts only the fixed tool operations, inside a jail. There is no "run on the host" command in the protocol at all;
- it serves only the owner's own AIs; sharing a runner with a group is an explicit owner choice.

*Protecting Zilar and secrets from a runner:*
- **The model keys never go to a runner,** because the brain stays in the server.
- **Git and API credentials:** the runner's egress proxy (outside the jail) receives a **short-lived, host-scoped token per task** (for example a GitHub token limited to one repo, valid for an hour). The proxy injects it on requests to that host only. The jail never sees it, and it expires on its own.
- **The runner's output is untrusted:** results are just tool output for the brain, like a web page.

*Identity:*
- at pairing, the runner creates its own **key pair**, and the server records the public key;
- every connection uses **mutual authentication** (a signed challenge), so a stolen pairing code is useless after first use;
- the owner can **revoke** a runner in Settings, and it disconnects at once;
- every runner connection and command is in the session log.

**Equal or better: how we keep it so.** The cloud computer and the runner run the **same image and the same daemon**, built from one package (`packages/desk`, new). The same test task runs on both in CI: clone a repo, run a test, edit a file, push through the proxy. A feature lands only when it works on both.

### 2.5 Performance rules for the brain (from Manus)
- **Prompt caching is the main lever:** a stable system prompt and tool list (no timestamps at the top), append-only context, deterministic JSON. Track the cache hit rate.
- **Don't add or remove tools mid-task;** disable them by state instead.
- **Big outputs go to files in the workspace,** with only the path and a summary in context (the file system as memory).
- **A `todo.md` in the workspace** for multi-step tasks keeps the goal in view.
- **Failed tool calls stay in context.**

## 3. Security model
1. **Secrets never reach the model or the jail:**
   - model keys: decrypted per call in the server;
   - git and API tokens: injected by the egress proxy;
   - MCP OAuth tokens: held by the server's MCP client.
2. **All egress goes through the proxy, for jails and the browser.** By default it reaches the open web (§7). An owner who wants an allowlist sets one per AI, and the AI's settings show it. Private and internal IP ranges are always blocked. Since the open web leaves the "way out" leg of the lethal trifecta open, the other two legs carry more weight: the jail holds no secrets, and private data enters a task only when the owner shares it.
3. **Isolation:** gVisor per active task (microVMs later). A read-only base image, dropped capabilities, cgroup limits, and no host mounts except the workspace.
4. **Action tiers with approval** (the existing `approval.request` and `approval.decision` payloads in `packages/protocol/src/payload.ts`):
   - **free:** read, search, run commands in the jail without network, edit the workspace;
   - **asks the owner once per task:** push to git, a new network domain, an install from outside the allowlist;
   - **always asks:** send email or messages outside Zilar, spend over the daily budget, delete a remote branch.
5. **MCP:** OAuth 2.1, pinned tool descriptions, per-AI server allowlist, never send tokens in URLs or logs.
6. **Quotas and kill switch:** per-AI daily budget, CPU and wall time, disk; **Stop** on the task card kills the jail at once; an admin switch turns all computers off.
7. **Audit:** every tool call is in the session log (with secrets redacted); the owner can open it.
8. **Supply chain:** pinned image digests for the jail base image and the browser; signed runner binaries and updates.
9. **Runners** (details in §2.6):
   - outbound-only connection with a per-runner key pair and mutual authentication;
   - no host-execution command in the protocol;
   - the runner's local policy can only tighten what Zilar asks;
   - model keys never leave the server; git and API tokens are short-lived and host-scoped;
   - instant revoke from Settings.

## 4. Chat experience: background, no spam
1. **Instant acknowledgement, no message.** The AI shows a **status line** under its name, like typing: "Searching the web…", "Cloning repo…", "Running tests (2/3)…". Use XMPP chat states plus a short status text; it disappears when done. This is the Slack `setStatus` pattern.
2. **Short jobs (under about 10 s, no computer):** just the answer, as one message.
3. **Long jobs or computer use: one task card** (the existing `progress` payload; `ProgressCard.tsx` on web and `progress-card.tsx` on mobile). It is **edited in place** (XEP-0308 corrections), never re-posted:
   - a title, a live checklist (planned → doing → done), the elapsed time and a **Stop** button;
   - collapsed to one line by default;
   - at the end: "Done in 2m 14s · 12 steps · $0.03".
   - **Card edits never notify** (no push, no unread bump).
4. **The answer is a normal message:** a summary plus attachments (diff, files, screenshots, preview link). **Only that, or an approval request, notifies** the user.
5. **The details are one tap away:** "View steps" opens the session log (commands, outputs, files changed). Raw tool output never goes into the chat.
6. **Approvals:** one compact card with Approve / Deny that times out. Several requests in one task are batched into one card.
7. **Groups:** an AI posts only when mentioned or assigned. Long work can run in its own topic.
8. **Queue and failure:**
   - when the host is busy, the card says "Queued (2 ahead)";
   - on failure, the card shows one plain sentence and a Retry button; the details live in the log.

## 5. Capacity and cost (estimates, to verify in the spike)
- **The model tokens dominate the cost.** They are on the user's own key; prompt caching cuts them up to about 10×.
- **An idle AI** costs its workspace on disk and a few rows in Postgres.
- **A running jail** uses what its processes use (a `git status` or `grep` needs a few MB; `npm install` or a build, hundreds of MB), plus the gVisor overhead (tens of MB, reported).
- **1000 users:** perhaps 30–50 tasks thinking at once (cheap) and a handful of jails running. The current VPS can carry the start; a dedicated sandbox host is the first scale step.

## 6. Build plan (each phase ships to production and is live-checked)
| Phase | What | Notes |
|---|---|---|
| **P0. AIs answer in production** | Model calls through Effect AI in the server; token and cost table; an optional daily budget per AI (no default); remove the LiteLLM client; models.dev prices (T-1395) | Today no AI can reply in production (`LITELLM_BASE_URL` is a placeholder) |
| **P1. Background UX** | Session log table; status line; one task card edited in place; Stop; "View steps"; edits never notify; approval card wired to the tiers | Benefits today's web-search AIs right away |
| **P2. Computer v1** | `packages/desk`: the jail image and the tool daemon, built once for cloud and runner; the hands interface (`provision / execute / stop / snapshot`); gVisor on the current VPS; workspace folders with quotas; provision on first use; idle stop; tools bash, read, write, edit, grep, glob, git; egress proxy (open web, optional allowlist, private ranges blocked, short-lived token injection) | **Installing gVisor on the VPS: Julio's OK at install time** |
| **P3. Runner v1** | The runner binary (macOS, Linux; Windows via WSL2); pairing with a code and a key pair; outbound WebSocket; the same daemon and image; "Computer: Zilar cloud / My Mac / Auto"; offline waiting; signed auto-update; tray status with Stop all; one CI test task that runs on cloud and on a runner | Right after P2, so the two stay equal from the start |
| **P4. Browser** | A shared Playwright browser service in the cloud; on a runner, the browser runs inside the runner's jail; browser tools; the same egress proxy | |
| **P5. MCP** | Remote MCP with OAuth 2.1 and pinned descriptions; local MCP inside the jail (cloud or runner); per-AI allowlist UI | |
| **P6. Scale** | Warm pool; workspace snapshots to object storage; moving a workspace between cloud and runner; a dedicated KVM host with microVMs; runner extras (local folders, Xcode tool pack) | When the queue shows waits |

## 7. Decisions (Julio, 2026-10-14)
1. **Jails run on the current VPS** (gVisor installed on production; the install itself still needs Julio's OK at the time it happens).
2. **Effect AI** (`@effect/ai` and its provider packages) makes the model calls. No Vercel AI SDK.
3. **Default network for a new AI's computer: the open web through the egress proxy.** Private and internal ranges stay blocked; the owner can narrow it to an allowlist. Git and API tokens are still injected only for their own hosts.
4. **No default daily budget.** Spend is still counted and shown per AI; the owner can set a limit.
5. **The jail memory is a shared 4 GB pool with admission control** (§2.3), not a fixed small cap per jail.
6. **The workspace quota is a disk image file per AI.**
7. **A Zilar GitHub App** mints short-lived, repo-scoped tokens for git push. Julio creates it when P2 is ready; the lead writes the steps and never handles its keys.
8. **The lead may set `AGENT_GATEWAY_ENABLED=true`** in Coolify once T-1399 is deployed.
9. **brig.sh** (an Apache 2.0 microVM CLI; needs KVM on Linux, Hypervisor.framework on macOS) is a candidate isolation backend for **runners** in P3, not for the VPS.

## 8. Not in scope yet
Voice, phone use, logged-in browsing with saved cookies, GPU sandboxes, running the brain itself on a runner (with local models).

## 9. Sources
- Anthropic, "Managed Agents" (engineering blog): https://anthropic.com/engineering/managed-agents
- Claude Code sandboxing docs: https://code.claude.com/docs/en/sandboxing
- OpenAI sandbox infrastructure talk (ZenML summary): https://www.zenml.io/llmops-database/designing-agent-sandbox-infrastructure-at-scale-from-runtime-to-orchestration
- OpenAI Codex paper (gVisor for the eval sandbox): https://arxiv.org/pdf/2107.03374
- Cloudflare, "Containers, rebuilt to scale agent sandboxes": https://blog.cloudflare.com/faster-agent-sandboxes/
- Kubernetes agent-sandbox: https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox
- E2B persistence and snapshots: https://docs.e2b.dev/sandbox/persistence, https://fly.io/learn/fly-vs-e2b/
- gVisor systrap: https://gvisor.dev/blog/2023/04/28/systrap-release/, https://gvisor.dev/docs/architecture_guide/platforms
- Firecracker vs gVisor: https://fly.io/learn/firecracker-vs-gvisor/
- Manus, context engineering: https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Anthropic, multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- Silent egress study: https://arxiv.org/pdf/2602.22450
- Lethal trifecta overview: https://tianpan.co/blog/2026/04/18/prompt-injection-agentic-pipelines-defense
- MCP security: https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices/, https://workos.com/blog/mcp-security-risks-best-practices
- Grok Bot: https://x.ai/bot/guides/grok-bot-101, https://composio.dev/blog/guide-to-frok-bot
- Lightpanda benchmarks: https://lightpanda.io/docs/core-concepts/benchmarks
- Slack AI apps status: https://docs.slack.dev/reference/methods/assistant.threads.setStatus
- GitLab Duo live progress in Slack: https://gitlab.com/gitlab-org/gitlab/-/merge_requests/238628
- Self-hosted sandboxes: https://helix.ml/blog/self-hosted-agent-sandboxes, https://github.com/restyler/awesome-sandbox
- Cursor self-hosted cloud agents (brain in the cloud, tools on the customer's worker, outbound-only HTTPS): https://cursor.com/docs/cloud-agent/self-hosted-pool, https://cursor.com/blog/self-hosted-machines
- Self-hosted CI runner hardening (ephemeral and just-in-time registration): https://www.ubicloud.com/docs/github-actions-integration/security, https://appsec.equinor.com/guidelines/gh-actions-runners
- Apple `container` (one light VM per container on macOS): https://www.infoq.com/news/2025/06/apple-container-linux, https://thenewstack.io/apple-containers-on-macos-a-technical-comparison-with-docker
