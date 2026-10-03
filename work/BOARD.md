# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## Active (M1 complete; next: M2 AIs that talk)

Claude runs the workers (DeepSeek V4.1 Flash, MiMo-V2.6-Flash, Muse Spark 1.3; **no V4 Pro**, Julio 2026-09-28) through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../zilar-T-XXXX`. Watch a worker live with `cd ../zilar-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account |

## Follow-ups

- **M5 plan (2026-09-29): see [`docs/ROADMAP_M5.md`](../docs/ROADMAP_M5.md)** for the order, the waves for tonight, what only Julio can provide, and the decisions the lead made in the specs.
- **AI-built tools and routines (Julio, 2026-09-29: server sandbox first).** T-0102 sandbox (QuickJS/WASM, allowlisted SSRF-safe fetch), T-0103 versioned tools store + routes, T-0104 scheduler/routines (pinned to approved hosts, auto-pause after failures), T-0105 tool/routine actions for the action gateway (routine.schedule needs a card and can never be always-allowed) + wiring the sandbox (`TOOLS_ENABLED`), T-0106 model side (prompt guide, more rounds per turn, "working on it" line, scripted-model e2e), T-0107 web Tools & Routines in the AI/group panel.
- Kill switch (T-0080): room-admin and workspace-admin stop (J5). (`addGroupAi` now refuses a stopped or provisioning AI with 409 `ai_not_active`, lead change 2026-09-29; audit entries for stop/resume are done, T-0083.)
- Audit log (T-0079): entries from the engine and the proxy, a web page for an AI's / group's log, retention (J4: 1 year).
- Deployment: set Better Auth `advanced.ipAddress` for the real proxy (from the T-0015 review).
- OAuth (Google/Apple/GitHub): first-time users must carry the invite through the redirect (from the T-0015 review).
- **Real GitHub App wiring for the git proxy (needs Julio's GitHub account).** T-0009 proved the token lifecycle and the `agent/<ai>/*` branch rule with fakes. Still unproven: that GitHub accepts the App JWT and mints an installation token, and the pkt-line ref parsing against a real `git` client. A worker cannot create the App, so this needs a human.
- `apps/mobile/ios/` is generated and gitignored: run `pnpm --filter @zilar/mobile boot:ios --device <udid>` after any native dependency change (T-0031). Running it in CI needs a macOS runner (Julio's decision).

- **M3 tunnel hardening (from the T-0008 spike):**
  - TLS/wss;
  - runner public keys stored in Postgres, plus pairing codes;
  - preview-token expiry and room-member authorization;
  - an https gateway upstream (today it is http-only);
  - a durable runner registry.


## Done

| ID | Title | Merged |
|---|---|---|
| [T-0001](T-0001-monorepo.md) | Monorepo scaffold | 2026-09-27 |
| [T-0012](T-0012-tooling-cleanups.md) | Tooling cleanups from the T-0001 review | 2026-09-27 |
| [T-0013](T-0013-protocol-payloads.md) | Protocol v0 payload schemas (2 review rounds: fixed javascript:/data: link injection) | 2026-09-27 |
| [T-0002](T-0002-dev-infra.md) | Local dev infrastructure: Postgres 18 + pgvector, ejabberd 26.07, LiteLLM 1.102.1; `pnpm infra:up` / `infra:smoke` | 2026-09-27 |
| [T-0006](T-0006-opencode-driver.md) | `@zilar/agent-drivers` + OpenCode v2 driver (2 rounds; live-tested with DeepSeek: permission flow, no replay) | 2026-09-27 |
| [T-0011](T-0011-mobile-scaffold.md) | Expo app (SDK 57, React Native 0.86, Expo Router, NativeWind + React Native Reusables); runs in the iOS simulator, light and dark | 2026-09-27 |
| [T-0014](T-0014-server-foundation.md) | Server foundation: zod config, redacted pino logs, JSON errors, request ids, Drizzle + migrations, PGlite tests | 2026-09-27 |
| [T-0003](T-0003-xmpp-accounts-rooms.md) | XMPP: server-created accounts, JWT-only login (non-admin), members-only rooms, MAM history; `pnpm xmpp:e2e` 12/12 (2 rounds) | 2026-09-27 |
| [T-0015](T-0015-auth-invites.md) | Auth: invite-only sign-up, 6-digit email codes (hashed, gated, rate-limited), cookie + bearer sessions, trusted origins (2 rounds) | 2026-09-27 |
| [T-0019](T-0019-mobile-chat-shell.md) | Mobile: messenger-style chat list and chat screen with mock data; screenshots in `apps/mobile/screenshots/` | 2026-09-27 |
| [T-0018](T-0018-web-chat-shell.md) | Web: messenger-style chat shell + `@zilar/chat-core` (2 rounds) | 2026-09-27 |
| [T-0016](T-0016-xmpp-core.md) | `@zilar/xmpp-core`: JWT reconnect, rooms, DMs, MAM, typing, receipts, payloads, real-JID resolution via occupant roster (2 rounds) | 2026-09-27 |
| [T-0017](T-0017-xmpp-provisioning.md) | Server: XMPP account on sign-up, chat token endpoint, profile name; live end-to-end invite → code → sign-in → token → XMPP online | 2026-09-27 |
| [T-0022](T-0022-web-ui-polish.md) | Web polish: new-chat button, unread divider, typing, message menu and reply, big emoji, safe links, green online dot | 2026-09-27 |
| [T-0021](T-0021-sm-ack-bug.md) | Fixed random disconnects: our own XEP-0198 inbound counter (2 xmpp.js 0.14 bugs), stress-tested 3× with 0 server closes | 2026-09-27 |
| [T-0020](T-0020-contacts-groups-chats.md) | Server: contacts from invites (roster, nick refresh), groups (MUC), `GET /api/chats` (2 rounds) | 2026-09-27 |
| [T-0024](T-0024-web-real-data.md) | **Web on real data**: invite, email code, name; real DMs and groups via xmpp-core. **Julio used it live.** | 2026-09-28 |
| [T-0023](T-0023-mobile-ui-polish.md) | Mobile polish: switch to `@zilar/chat-core`, typing, unread divider, long-press menu + swipe to reply with haptics, big emoji, safe links (2 rounds) | 2026-09-28 |
| [T-0025](T-0025-real-use-fixes-1.md) | Real-use fixes 1: list status stuck on sending, live list updates (XEP-0249 invites + roster pushes), big-emoji sender name; no JID localparts in names; own typing/markers ignored in groups (3 rounds) | 2026-09-28 |
| [T-0004](T-0004-expo-xmpp-spike.md) | **Spike S2: xmpp.js works in Expo on iOS** — proven on device with 2 inline shims + a Metro stub, no new packages. Unblocks mobile on real data (2 rounds) | 2026-09-28 |
| [T-0007](T-0007-litellm-virtual-keys.md) | **Spike S5: LiteLLM hard-capped virtual keys work** — cap enforced pre-flight (429), revocation and user-key forwarding proven live; cap is server-owned (2 rounds) | 2026-09-28 |
| [T-0026](T-0026-mobile-auth.md) | **Mobile sign-in for real**: invite, email code, name; session in the OS keychain. Verified live against the server with codes redacted. First slice of mobile on real data | 2026-09-28 |
| [T-0027](T-0027-mobile-real-data.md) | **Mobile on real data** — real DMs and groups via xmpp-core; gated live integration verified by the lead. **M1 complete** | 2026-09-28 |
| [T-0009](T-0009-git-proxy.md) | Spike S8: GitHub App tokens + git proxy allowing only `agent/<ai>/*` pushes; fails closed on unparseable pushes (2 rounds) | 2026-09-28 |
| [T-0029](T-0029-flaky-web-tests.md) | Load-sensitive `apps/web` tests: commented per-test timeouts on the three first-in-file full-app renders; verified with forced full-suite runs under a CPU burner | 2026-09-28 |
| [T-0028](T-0028-connections-ui.md) | **Connections**: provider API keys encrypted at rest (AES-256-GCM, HKDF, `v1` envelope), `/api/connections`, Settings → Connections screen with Test/Remove; live-verified by the lead (2 rounds) | 2026-09-28 |
| [T-0031](T-0031-mobile-boot-check.md) | **Mobile boot check** `boot:ios`: pods vs autolinking (auto `pod install`), stale-deps check, own Metro on 8082, passes only after the JS app runs; caught the SecureStore regression live | 2026-09-28 |
| [T-0030](T-0030-ais-server.md) | **M2: AIs on the server**: `/api/ais`, own XMPP account + roster, capped LiteLLM virtual key (sealed), all-or-nothing create, resumable delete, 409 on a connection in use; live-verified by the lead (3 rounds) | 2026-09-28 |
| [T-0008](T-0008-runner-tunnel-spike.md) | Spike S6: runner tunnel over one WebSocket. Design confirmed for M3; round 2 fixed runner isolation, stream-id ownership and the WS payload cap. | 2026-09-28 |
| [T-0032](T-0032-create-ai-wizard.md) | **M2: web Create-AI wizard + My AIs** (list, edit, two-step delete); lead clicked through live in Chrome; round 2 fixed model suggestions keyed by connection id | 2026-09-28 |
| [T-0036](T-0036-web-tests-under-load.md) | `apps/web` tests reliable under load: measured cause (render work ×10 under CPU starvation), one package-level 15 s `testTimeout`, T-0029's per-test timeouts removed; 3/3 forced full runs under 8 burners | 2026-09-28 |
| [T-0035](T-0035-server-followups.md) | Server follow-ups: Test-key route rate-limited (5/min/user, before any provider call) via a shared limiter; `Unnamed user` for blank-name contacts (never the email) | 2026-09-28 |
| [T-0033](T-0033-ai-models-litellm.md) | **M2: each AI's private LiteLLM model** (owner key decrypted once, stored only in LiteLLM encrypted with the salt key); virtual key limited to `ai-<id>`; concurrent-safe backfill; AIs in `/api/chats`. Muse pre-review found 5 issues; live-proven against LiteLLM (2 rounds) | 2026-09-28 |
| [T-0034](T-0034-ai-replies-dm.md) | Agent gateway v0: every active AI online over XMPP; the owner's DMs get a reply via LiteLLM with the AI's capped key; coalesced turns; honest failure texts; keys redacted everywhere; off by default (`AGENT_GATEWAY_ENABLED`); live proof with a fake key | 2026-09-28 |
| [T-0038](T-0038-lead-autopilot.md) | Lead autopilot: `lead launch/autopilot/prereview/reply/merge/status` (zod + Node only); fail-closed permission policy (~120-case table: per-element pipes, bare shells, git globals, `.env` operands, read-only localhost curl), quota resume, nudges, auto Muse pre-review per HEAD, one-line `LEAD:` escalations; dry-run proven read-only | 2026-09-28 |
| [T-0037](T-0037-mobile-my-ais.md) | Mobile My AIs: list (limits, AI badge, actions sheet), 6-step Create-AI wizard (provider-keyed model suggestions, web-identical limit validation, single POST), edit via PATCH of changed fields, two-step delete; mock scenarios; 18 screenshots | 2026-09-28 |
| [T-0039](T-0039-quick-create-ai.md) | Web one-screen New AI dialog (name → Create, defaults: provider auto, defaultModelFor, $1/$10; lands in the chat) + in-chat AI panel (name/persona/limits/delete, honest delete copy); 6-step wizard removed | 2026-09-28 |
| [T-0040](T-0040-persona-by-chat.md) | The owner shapes an AI by chat: update_persona/revert_persona tools in the DM turn (≤2 model calls, per-call guards, one-step undo toggle via ais.previous_persona), fixed 'Persona updated' / 'Persona restored' lines, persona never logged | 2026-09-28 |
| [T-0042](T-0042-web-loading-states.md) | Web loading ≠ empty: chats/history load states with skeletons, inline errors + Retry; a reloaded /c/<jid> loads its history (pending open flushed on ready/reconnect); no 'No chats yet' / 'No messages yet' flash | 2026-09-28 |
| [T-0041](T-0041-streaming-replies-server.md) | Server streams AI reply drafts over SSE (/api/drafts/stream) to the owner; final message still via XMPP | 2026-09-28 |
| [T-0043](T-0043-web-reply-drafts.md) | Web shows AI reply drafts from /api/drafts/stream as a growing bubble, replaced by the final XMPP message without a jump | 2026-09-28 |
| [T-0044](T-0044-draft-tail-flush.md) | Server publishes the complete reply as a draft before the final XMPP message | 2026-09-28 |
| [T-0045](T-0045-smooth-drafts.md) | Web reveals AI drafts smoothly, gray until complete, continuing into the final message without a snap | 2026-09-28 |
| [T-0046](T-0046-redesign-foundation-sidebar.md) | Web redesign part 1 (D24): dark tokens, Geist, skeuomorphic primitives, floating panels, sidebar | 2026-09-28 |
| [T-0047](T-0047-redesign-chat-panel.md) | Web redesign part 2: chat panel (glossy/recessed bubbles, header, composer well, rich messages, hidden-tab reveal snap) | 2026-09-28 |
| [T-0049](T-0049-ai-markdown-web.md) | Web renders Markdown in AI replies (safe subset: http/https/mailto links, no HTML/images), plain previews in the list | 2026-09-28 |
| [T-0050](T-0050-gateway-resource-and-read-markers.md) | Gateway: fixed XMPP resource per AI (newest gateway wins, the replaced one stands down, no reconnect loop) + read markers when the AI takes a message | 2026-09-28 |
| [T-0052](T-0052-change-ai-model.md) | Change an AI's model after creation: PATCH model/connection under the ensure locks (no orphans, failed swap keeps a working AI), AI panel pickers | 2026-09-28 |
| [T-0048](T-0048-mobile-redesign.md) | Mobile redesign (D24): dark-only tokens, Geist, depth primitives (depth.ts), chat list and chat screen, rich messages | 2026-09-28 |
| [T-0053](T-0053-mentions-web.md) | @mentions in groups (web): XEP-0372 references (code-point offsets), @ picker, mention chips, me-mention highlight | 2026-09-28 |
| [T-0051](T-0051-lead-switch-model-and-merge-cleanup.md) | lead CLI: switch-model (quota fallback, validates before interrupting) + merge stops the worktree's processes (exact path match, TERM/KILL, name-only output) | 2026-09-28 |
| [T-0054](T-0054-ai-in-groups-server.md) | AIs in groups (server): group_ais, add/remove routes, the gateway joins rooms and replies to @mentions from human members (rate-limited, no AI-to-AI) | 2026-09-28 |
| [T-0056](T-0056-mobile-reply-drafts.md) | Mobile AI reply drafts: bearer SSE over XHR, smooth reveal, recessed generating bubble, same-node swap to the final message | 2026-09-28 |
| [T-0057](T-0057-web-polish-retry-models.md) | Web polish: Retry keeps the loaded chat list (pending button only); model picker suggestions as raised rows with a SUGGESTED caption | 2026-09-28 |
| [T-0055](T-0055-ai-in-groups-web.md) | AIs in groups (web): group panel, add/remove my AI, AIs in the @ picker, AI replies with badge and Markdown | 2026-09-28 |
| [T-0058](T-0058-ai-costs.md) | AI costs: today/30-day spend in the panel and AIs list, soft per-day limit enforced before each turn | 2026-09-28 |
| [T-0059](T-0059-reactions-web.md) | Reactions (web): XEP-0444 quick bar, chips, MAM persistence, DMs and groups | 2026-09-28 |
| [T-0060](T-0060-web-qa-sweep.md) | Web QA sweep: prioritized bug list + screenshots, no code changes | 2026-09-28 |
| [T-0062](T-0062-web-qa-fixes.md) | Esc closes every menu/dialog, reduced motion covers skeleton/spinner/retry-spinner, focus ring + id/name + disabled Approve/Deny polish | 2026-09-28 |
| [T-0063](T-0063-mobile-mock-gating.md) | Mobile: ?mock= honored only in dev builds or with EXPO_PUBLIC_ZILAR_MOCK (chat store + My AIs), one shared gate | 2026-09-28 |
| [T-0061](T-0061-edit-delete-web.md) | Edit + delete for everyone (web): XEP-0308 corrections, XEP-0424 retractions, edit bar, tombstones, sender-only authorization; live-verified against ejabberd incl. MAM | 2026-09-28 |
| [T-0066](T-0066-budget-warning.md) | AI budget warning at 80% (daily and 30-day window): one fixed notice per kind per chat per UTC day, sent after the reply; live proof open | 2026-09-29 |
| [T-0064](T-0064-mobile-markdown.md) | Mobile renders Markdown in AI replies (own dependency-free parser, safe subset, plain list previews); visual check open | 2026-09-29 |
| [T-0067](T-0067-mobile-loading-states.md) | Mobile loading is not empty: skeletons, inline errors with Retry, pending open flushed on ready (port of T-0042); phone check open | 2026-09-29 |
| [T-0068](T-0068-machines-registry.md) | M3 machines registry (server): hashed single-use pairing codes, proof-of-key-possession registration, owner approve/deny/revoke, durable key registry; live proof open | 2026-09-29 |
| [T-0069](T-0069-web-mock-standalone.md) | Web mock mode: ?mock=1 only in dev builds; standalone (fake session, mock /api for AIs and connections); production ignores the param (proved with vite preview) | 2026-09-29 |
| [T-0065](T-0065-attachments-web.md) | Web attachments: images and files via XEP-0363 + attachment payload, preview bar, paste and drag-and-drop, image/file bubbles, retry; images auto-load only from Zilar's upload host; live check open | 2026-09-29 |
| [T-0070](T-0070-machines-web.md) | Machines page (web): add with a pairing code, approve/deny, rename, revoke, delete; mock data; runner described as coming soon; visual check open | 2026-09-29 |
| [T-0072](T-0072-runner-app.md) | Runner app skeleton: pair, run, identity file 0600, no exec path | 2026-09-29 |
| [T-0071](T-0071-runner-hub.md) | Runner hub: approved machines connect over the tunnel, revoke drops them, online + last-seen; off by default | 2026-09-29 |
| [T-0073](T-0073-approvals-service.md) | Approvals service: stored requests with args hash, expiry, owner/admin-only atomic decisions, single-use approvals | 2026-09-29 |
| [T-0074](T-0074-connections-through-request.md) | ConnectionsPage through request(); mock global fetch wrapper removed | 2026-09-29 |
| [T-0075](T-0075-runner-polish.md) | Runner polish: wss hub URLs, disconnected status, fixed 409 text, non-zero exits, e2e pair/approve/online/revoke test | 2026-09-29 |
| [T-0077](T-0077-tunnel-wss.md) | RunnerClient accepts wss:// server URLs | 2026-09-29 |
| [T-0076](T-0076-approvals-web.md) | Web approval card decides for real: Approve/Deny call the approvals API, shows its state, mock mode | 2026-09-29 |
| [T-0078](T-0078-mobile-edits-receive.md) | Mobile shows edits, deletions and reactions from others (receive side), reusing chat-core reducers | 2026-09-29 |
| [T-0081](T-0081-approvals-inbox-web.md) | Web Approvals inbox page (Settings → Approvals) with Approve/Deny | 2026-09-29 |
| [T-0079](T-0079-audit-log.md) | Audit log: append-only table (DB trigger), recorder, owner/admin read routes, writers in approvals and machines | 2026-09-29 |
| [T-0082](T-0082-approvals-mobile.md) | Mobile approval card decides for real (approvals API twin, states, mock) | 2026-09-29 |
| [T-0080](T-0080-ai-kill-switch.md) | Owner kill switch: stop/resume an AI at once, in-flight replies dropped, works without LiteLLM; web button; mobile tolerates the status | 2026-09-29 |
| [T-0083](T-0083-audit-ai-stop-resume.md) | Audit entries for the AI kill switch (ai.stopped, ai.resumed) | 2026-09-29 |
| [T-0084](T-0084-ai-activity-web.md) | Web: Activity section in the AI panel showing audit entries, with paging | 2026-09-29 |
| [T-0085](T-0085-mobile-edits-send.md) | Mobile sends reactions, deletions and edits (optimistic with rollback), composer edit mode | 2026-09-29 |
| [T-0086](T-0086-group-activity-web.md) | Web: Activity section in the group panel for owners and admins | 2026-09-29 |
| [T-0087](T-0087-approvals-sweeper.md) | Approvals sweeper: expired pending requests are denied on a timer with one audit entry each; swept rows read as expired | 2026-09-29 |
| [T-0088](T-0088-authz-route-sweep.md) | authz route sweep test: 40 /api routes, all 401 except 4 allowlisted; no open routes | 2026-09-29 |
| [T-0090](T-0090-action-gateway.md) | action gateway: adapters, tier policy, approval-gated exactly-once execution of stored args; no adapters registered | 2026-09-29 |
| [T-0091](T-0091-ai-home-machine.md) | AI home machine: ais.machineId, PUT /api/ais/:id/machine, revoke unassigns, AiPanel select, machine card lists AIs | 2026-09-29 |
| [T-0092](T-0092-approval-card-announce.md) | approval cards and outcomes posted into the chat through the AI's live session | 2026-09-29 |
| [T-0094](T-0094-server-config-docs.md) | docs/SERVER_CONFIG.md: env vars, flags, migrations, jobs, health | 2026-09-29 |
| [T-0095](T-0095-mobile-kill-switch.md) | mobile kill switch: Stop/Resume from the AI list, Stopped pill | 2026-09-29 |
| [T-0093](T-0093-request-action-tool.md) | request_action AI tool + dev-only demo.echo adapter (ACTION_DEMO_ENABLED) | 2026-09-29 |
| [T-0096](T-0096-action-flow-e2e-test.md) | end-to-end test of the action flow through the real approvals routes | 2026-09-29 |
| [T-0097](T-0097-approval-card-live-refresh.md) | approval card refreshes itself; menu shows pending approvals count | 2026-09-29 |
| [T-0098](T-0098-group-request-action.md) | request_action in groups: admins only, card visible to the room; persona tools unreachable from groups | 2026-09-29 |
| [T-0099](T-0099-approval-rules-always-allow.md) | approve always as a per-chat standing rule (personal or one group), revocable, audited | 2026-09-29 |
| [T-0100](T-0100-web-always-allow.md) | web: Always allow here on approval cards, revocable always-allowed list in AI and group panels | 2026-09-29 |
| [T-0101](T-0101-group-always-admin-only.md) | approve always in a group needs a group owner/admin; alwaysEligible is per viewer; approve once unchanged | 2026-09-29 |
| [T-0102](T-0102-tool-sandbox.md) | tool sandbox: AI-written JS runs in QuickJS/WASM inside a worker, allowlisted SSRF-safe fetch, CPU/memory/output limits; not wired to anything yet | 2026-09-29 |
| [T-0103](T-0103-ai-tools-store.md) | AI tools store: versioned tool code per AI and chat (append-only history, revert = new version), manual run through an injected runner, read/manage routes, audit without code or output | 2026-09-29 |
| [T-0118](T-0118-web-push-spike.md) | Web push spike: decision doc, GO for T-0119 (MUC/Sub for groupchat); code preserved on branch spike/T-0118-push | 2026-09-29 |
| [T-0108](T-0108-topics-server.md) | Topics on the server: one XMPP room per topic, public/private, General backfill, task strip data | 2026-09-29 |
| [T-0109](T-0109-ais-in-topics.md) | AIs in topics: topic_ais, per-topic rooms and wake gate, owner-visibility rule, postToChat topicId | 2026-09-29 |
| [T-0110](T-0110-topic-scoped-actions.md) | Approvals, always-allow rules and tools scoped to (AI, topic); topic announcer wiring; backfill to General | 2026-09-30 |
| [T-0126](T-0126-production-images-compose.md) | production images + compose (Caddy, Coolify) for the self-hosted install; upload proxy fixed | 2026-09-30 |
| [T-0128](T-0128-smtp-mailer.md) | SMTP mailer for sign-in codes (nodemailer), production console opt-in, config validation | 2026-09-30 |
| [T-0117](T-0117-message-search.md) | message search across DMs, groups and topics (server, read-only archive role, web) | 2026-09-30 |
| [T-0104](T-0104-routines-scheduler.md) | routines: scheduler, DST-correct schedules, host pinning, service and routes (migration 0023) | 2026-09-30 |
| [T-0105](T-0105-tool-adapters.md) | tool and routine action adapters + sandbox wiring (TOOLS_ENABLED), modelText for the model | 2026-09-30 |
| [T-0111](T-0111-topics-web.md) | topics web UI: nested sidebar, task strip, new-topic dialog, topic panel (not yet live-checked) | 2026-09-30 |
| [T-0113](T-0113-chat-prefs.md) | per-user chat preferences: mute, archive, pin for chats and topics (migration 0024, web) | 2026-09-30 |
| [T-0125](T-0125-web-tools.md) | keyless web tools for AIs: fetch, wikipedia, price, feed, best-effort search (WEB_TOOLS_ENABLED) | 2026-09-30 |
| [T-0112](T-0112-topics-mobile.md) | topics on mobile: group list, topics screen, task strip, new-topic sheet (not run in a simulator) | 2026-09-30 |
| [T-0114](T-0114-pinned-messages.md) | pinned messages in chats, groups and topics: banner, list, 20-pin cap, audit (migration 0025, server + web) | 2026-09-30 |
| [T-0130](T-0130-topics-web-fixes.md) | topics web fixes: kebab archive, safe member removal, mock store actions, AI owner by id, keyboard nav | 2026-09-30 |
| [T-0129](T-0129-coolify-baked-config.md) | Coolify without bind mounts: ejabberd and Postgres config baked into images, 4-image workflow | 2026-09-30 |
| [T-0115](T-0115-invite-links.md) | shareable group invite links: expiry, max uses, revoke, join page (migration 0026) | 2026-09-30 |
| [T-0131](T-0131-screenshots-user-docs.md) | feature screenshots (script + PNGs), user guide, README and FEATURES links | 2026-09-30 |
| [T-0116](T-0116-group-roles.md) | group roles: private-topic access and approver rights (migration 0027) | 2026-09-30 |
| [T-0127](T-0127-install-wizard-backup-baremetal.md) | install wizard (./zilar init/up/doctor/backup/restore), bare-metal guide, deploy/backups ignored | 2026-09-30 |
| [T-0133](T-0133-web-followups.md) | web follow-ups: single-call topic adds, revoke unstick, stale refresh guard, quiet-archive leak, screenshot script tests | 2026-09-30 |
| [T-0132](T-0132-tool-host-approval.md) | tool host approval: hosts approved once per tool, sandbox gets declared ∩ approved (migration 0028) | 2026-09-30 |
| [T-0136](T-0136-mobile-invite-links.md) | mobile group invite links: create, list, revoke, join by link (mobile only, to be run on Android) | 2026-09-30 |
| [T-0137](T-0137-mobile-roles-admin.md) | mobile group roles: manage roles, member chips, private-topic access and approver (mobile only, to be run on Android) | 2026-09-30 |
| [T-0107](T-0107-tools-routines-ui.md) | tools and routines UI (web): tool list, detail, versions, run, revert, routines, approved hosts | 2026-09-30 |
| [T-0138](T-0138-mobile-search.md) | mobile message search with paging, jump to message, chat scope (mobile only, to be run on Android) | 2026-09-30 |
| [T-0135](T-0135-mobile-parity.md) | mobile chat prefs (mute, archive, pin) and pinned messages, mock parity, T-0112 fixes (mobile only) | 2026-09-30 |
| [T-0120](T-0120-stickers.md) | stickers: user-made packs, storage, sending, rendering (migration 0029) | 2026-09-30 |
| [T-0134](T-0134-server-followups.md) | server follow-ups: atomic link join, trusted proxy hops, pin 404 parity, preview limiter, approver names, search role scoping test | 2026-09-30 |
| [T-0124](T-0124-channels.md) | channels: only admins post, subscribers read-only, role route (migration 0030) | 2026-09-30 |
| [T-0139](T-0139-mobile-device-bugs.md) | mobile: topics from /api/chats, group route, header actions, cached group detail | 2026-09-30 |
| [T-0140](T-0140-mobile-followups.md) | mobile follow-ups: invite mock, roles load error, search jump and abort | 2026-09-30 |
| [T-0119](T-0119-pwa-web-push.md) | PWA and web push notifications (migration 0031) | 2026-10-01 |
| [T-0142](T-0142-smarter-search.md) | smarter search: prefixes, accent folding, typo tolerance | 2026-10-01 |
| [T-0141](T-0141-web-server-followups.md) | web/server follow-ups: sticker dir, mock stickers, revoke, approval names | 2026-10-01 |
| [T-0106](T-0106-tool-model-side.md) | model side of AI tools: guide, several rounds per turn, progress line | 2026-10-01 |
| [T-0122](T-0122-gifs.md) | GIF search and sending via a privacy proxy (off until a provider key is set) | 2026-10-01 |
| [T-0144](T-0144-mobile-channels.md) | mobile channels: read-only bar, channel screen, create, promote/demote | 2026-10-01 |
| [T-0121](T-0121-sticker-creator.md) | sticker pack creator, favorites, panel reorder (migration 0032) | 2026-10-01 |
| [T-0147](T-0147-mobile-nits.md) | mobile nits: group fetch ordering, join link cleanups, jump-scroll retries | 2026-10-01 |
| [T-0146](T-0146-web-server-nits.md) | web/server nits: sticker dir warning, leave 404, AI reload, GIF host rule, GIF tab | 2026-10-01 |
| [T-0143](T-0143-mobile-stickers.md) | mobile stickers: render, panel, send, recents, mock packs | 2026-10-01 |
| [T-0123](T-0123-telegram-sticker-importer.md) | Telegram sticker pack importer | 2026-10-01 |
| [T-0149](T-0149-docs-refresh.md) | Docs refresh | 2026-10-01 |
| [T-0145](T-0145-deploy-push.md) | Push in the production deploy | 2026-10-01 |
| [T-0150](T-0150-mobile-attachments.md) | Mobile attachments | 2026-10-01 |
| [T-0152](T-0152-web-sticker-ui.md) | Web sticker UI fixes | 2026-10-01 |
| [T-0153](T-0153-web-settings-layout.md) | Web settings pages layout | 2026-10-01 |
| [T-0154](T-0154-mobile-voice-messages.md) | Mobile voice messages: record, send, play (expo-audio) | planned | meta/muse-spark-1.3-contributor | T-0150 | Spec ready |
| [T-0155](T-0155-web-ui-polish-2.md) | Web UI polish round 2: Machines, Approvals, dialogs, text size, sticker nits | planned | meta/muse-spark-1.3-contributor | T-0153 | Spec ready |
| [T-0156](T-0156-server-deploy-nits.md) | Server and deploy nits bundle | planned | meta/muse-spark-1.3-contributor | T-0145, T-0151 | Spec ready |
| [T-0157](T-0157-mobile-nits-2.md) | Mobile nits bundle 2: attachments, GIFs, roles load error | planned | meta/muse-spark-1.3-contributor | T-0148, T-0150 | Spec ready |
| [T-0158](T-0158-scheduled-backups.md) | Scheduled backups with retention and a freshness check | planned | meta/muse-spark-1.3-contributor | T-0151 | Spec ready |
| [T-0159](T-0159-install-rehearsal.md) | Fresh production install rehearsal (run only on a free machine) | planned | meta/muse-spark-1.3-contributor | T-0145, T-0151, T-0158 | Spec ready |
| [T-0148](T-0148-mobile-gifs.md) | Mobile GIFs | 2026-10-01 |
| [T-0151](T-0151-deploy-storage-safety.md) | Production storage safety | 2026-10-01 |
| [T-0160](T-0160-rename-zilar.md) | Rename everything from Zilar to Zilar | 2026-10-02 |
| [T-0161](T-0161-first-run-setup.md) | First-run setup screen: email, Resend key, code; the key is stored encrypted, no manual mail setup or invite code | 2026-10-02 |
| [T-0164](T-0164-public-groups-and-channels.md) | Public and private groups and channels: handles, directory, open join | planned | meta/muse-spark-1.3-contributor | T-0163 | Spec ready; launch after T-0163 merges |
| [T-0165](T-0165-avatars.md) | Profile pictures for people, AIs, groups and channels | planned | meta/muse-spark-1.3-contributor | T-0164 | Spec ready; launch after T-0164 merges |
| [T-0162](T-0162-integrations-settings-telegram.md) | Integration keys in the UI: Telegram bot token and email sender and key (owner only, stored encrypted), import dialog as an overlay with a clear reason | 2026-10-02 |
| [T-0166](T-0166-voice-fixes.md) | Voice notes on web: click to record with Send/Cancel, play/pause follows the audio, readable waveform colors, clear errors | 2026-10-03 |
| [T-0163](T-0163-usernames-and-contact-requests.md) | @usernames and contact requests: unique handles, requests that must be accepted, share links, session-skippable onboarding step | 2026-10-03 |
