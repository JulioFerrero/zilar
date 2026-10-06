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
| [T-0148](T-0148-mobile-gifs.md) | Mobile GIFs | 2026-10-01 |
| [T-0151](T-0151-deploy-storage-safety.md) | Production storage safety | 2026-10-01 |
| [T-0160](T-0160-rename-zilar.md) | Rename everything from Zilar to Zilar | 2026-10-02 |
| [T-0161](T-0161-first-run-setup.md) | First-run setup screen: email, Resend key, code; the key is stored encrypted, no manual mail setup or invite code | 2026-10-02 |
| [T-0162](T-0162-integrations-settings-telegram.md) | Integration keys in the UI: Telegram bot token and email sender and key (owner only, stored encrypted), import dialog as an overlay with a clear reason | 2026-10-02 |
| [T-0166](T-0166-voice-fixes.md) | Voice notes on web: click to record with Send/Cancel, play/pause follows the audio, readable waveform colors, clear errors | 2026-10-03 |
| [T-0163](T-0163-usernames-and-contact-requests.md) | @usernames and contact requests: unique handles, requests that must be accepted, share links, session-skippable onboarding step | 2026-10-03 |
| [T-0164](T-0164-public-groups-and-channels.md) | Public and private groups and channels: handles, Explore directory, open join with an atomic cap, share links | 2026-10-03 |
| [T-0165](T-0165-avatars.md) | Profile pictures for people, AIs, groups and channels: browser crop, validated static WebP/PNG, avatar-data volume | 2026-10-03 |
| [T-0167](T-0167-ejabberd-admin-password-log.md) | ejabberd admin password no longer printed in logs: quiet registration in our entrypoint, leak test, dev stack mirrored | 2026-10-03 |
| [T-0155](T-0155-web-ui-polish-2.md) | Web UI polish round 2: Machines and Approvals layout, notification cards, sticker nits | 2026-10-03 |
| [T-0158](T-0158-scheduled-backups.md) | Scheduled backups with retention, a freshness check in doctor, offsite hint, bare-metal timer and a Coolify guide | 2026-10-03 |
| [T-0168](T-0168-send-failure-state.md) | Failed voice/attachment sends show Not sent with Retry and Delete, 60 s timeout | 2026-10-03 |
| [T-0169](T-0169-mentions-by-handle.md) | Mentions find people by @handle and show handles | 2026-10-03 |
| [T-0156](T-0156-server-deploy-nits.md) | Server and deploy nits bundle | 2026-10-03 |
| [T-0159](T-0159-install-rehearsal.md) | Fresh production install rehearsal: report with findings (push host defect, docs notes) | 2026-10-03 |
| [T-0157](T-0157-mobile-nits-2.md) | Mobile nits bundle 2: attachments, GIFs, search jump, roles load error | 2026-10-03 |
| [T-0170](T-0170-voice-transcripts.md) | Voice transcripts on demand (owner-configured OpenAI-compatible endpoint) | 2026-10-03 |
| [T-0154](T-0154-mobile-voice-messages.md) | Mobile voice messages: record, send, play (expo-audio) | 2026-10-03 |
| [T-0176](T-0176-mobile-attach-icons-short-press.md) | Attach popup and attachment rows use icons, not emoji; a too-short mic press records and says nothing (1 round) | 2026-10-03 |
| [T-0174](T-0174-connection-resilience.md) | XMPP connection survives idle networks and blips: transient token errors retry with backoff, keepalive ping, server pings answered, ejabberd pings (1 round + lead fix) | 2026-10-03 |
| [T-0175](T-0175-emoji-panel-mobile.md) | One emoji button opens a sheet with Emoji, Stickers and GIFs tabs; sticker grid spacing, GIF tab hiding, composer height fix | 2026-10-03 |
| [T-0177](T-0177-whistle-on-device-spike.md) | Whistle on-device spike: local Expo module (arm64 Android), hidden dev screen, native sha256, tested on emulator and phone | 2026-10-03 |
| [T-0178](T-0178-whistle-quiet-cut-chunks.md) | Whistle: quiet-point chunking from a native amplitude envelope | 2026-10-03 |
| [T-0180](T-0180-signin-no-code-hint.md) | Sign-in hints for people without an invite (web + mobile) | 2026-10-03 |
| [T-0179](T-0179-mobile-transcribe-voice-notes.md) | Transcribe voice notes on the phone with Whistle: button in the bubble, consent for the 17 MB model, transcripts stored locally | 2026-10-03 |
| [T-0182](T-0182-mobile-contacts-requests.md) | Mobile contacts: find by @handle, profile card, contact requests | 2026-10-03 |
| [T-0183](T-0183-mobile-explore-group-handles.md) | Mobile Explore, @group links and group visibility | 2026-10-03 |
| [T-0181](T-0181-mobile-settings-profile.md) | Mobile settings hub, profile (name, avatar, @handle) and the handle step after sign-up | 2026-10-03 |
| [T-0184](T-0184-mobile-approvals-page.md) | Mobile approvals page: pending approvals and always-allowed rules | 2026-10-03 |
| [T-0193](T-0193-mobile-search-people-by-handle.md) | Mobile: find people by @handle in the search bar, replacing the add-contact menu entry | 2026-10-03 |
| [T-0185](T-0185-mobile-machines-connections.md) | Mobile machines and model connections screens, home machine picker on an AI | 2026-10-03 |
| [T-0192](T-0192-web-search-people-by-handle.md) | Web: find people by @handle in the search bar, replacing Add contact in the new-chat menu | 2026-10-03 |
| [T-0197](T-0197-old-name-in-smoke-script.md) | Old product name out of the smoke script; reviewer files at worktree roots are git-ignored | 2026-10-03 |
| [T-0198](T-0198-lead-state-lost-writes.md) | Lead state writes re-read the file first: the autopilot no longer loses tasks launched, merged or switched during a tick | 2026-10-04 |
| [T-0199](T-0199-prereview-follow-ups.md) | Pre-review findings outside a task's scope are follow-ups, not automatic fix rounds | 2026-10-04 |
| [T-0188](T-0188-mobile-integrations-owner.md) | Mobile owner integrations: Email, Voice and Telegram cards in settings, owner-only (2 auto rounds) | 2026-10-04 |
| [T-0187](T-0187-mobile-sticker-packs.md) | Mobile sticker packs: my packs, discover, add and remove, reorder, favorites (2 auto rounds) | 2026-10-04 |
| [T-0196](T-0196-lead-doctor.md) | The doctor: a Muse session that audits main after merges and writes DOCTOR.md | 2026-10-04 |
| [T-0173](T-0173-effect-spike.md) | Effect 4.0 spike: voice transcription pipeline as Effect programs, worker guide docs/EFFECT_GUIDE.md | 2026-10-05 |
| [T-0201](T-0201-runner-connect-test-flake.md) | Runner connect test polls for the runner to be live instead of a fixed 200 ms sleep (CI flake) | 2026-10-05 |
| [T-0200](T-0200-lead-squash-merge.md) | lead merge lands each task as one commit on main (squash, board included) | 2026-10-05 |
| [T-0205](T-0205-dashboard-merged-today-squash.md) | Dashboard merged-today list reads one-commit-per-task merges | 2026-10-05 |
| [T-0194](T-0194-mobile-pitfall-guards.md) | Mobile guard tests for the Android Coroutine+Promise and Hermes crypto.subtle pitfalls | 2026-10-05 |
| [T-0206](T-0206-scout-repomap-trial.md) | RepoMapper trial: measured on our repo, recommendation drop it (docs only) | 2026-10-05 |
| [T-0195](T-0195-mobile-parity-audit.md) | Audit of web vs mobile for AI tools, routines, activity, mentions and group dialogs (docs only) | 2026-10-05 |
| [T-0208](T-0208-reviews-on-free-muse.md) | Pre-reviews and the doctor run on the free Muse listing | 2026-10-05 |
| [T-0202](T-0202-lead-fresh-session-fix-rounds.md) | Fix rounds run in a fresh worker session; lead reply --fresh | 2026-10-05 |
| [T-0203](T-0203-worker-prompt-quiet-checks.md) | Worker prompt: checks once with pnpm gate, quiet single tests | 2026-10-05 |
| [T-0204](T-0204-prereview-no-duplicate-checks.md) | Pre-review stops re-running the gate's checks and focuses on the diff | 2026-10-05 |
| [T-0209](T-0209-lead-watch-terminal.md) | lead watch: live terminal view of every running task | 2026-10-05 |
| [T-0191](T-0191-mobile-sticker-editor-telegram.md) | Mobile sticker pack editor: create, rename, visibility, add and remove stickers, delete | 2026-10-05 |
| [T-0210](T-0210-lead-watch-speed.md) | lead watch: speed line (tok/s, s/step, context, sparkline) | 2026-10-05 |
| [T-0207](T-0207-mobile-telegram-sticker-import.md) | Mobile: import a Telegram sticker pack from the Stickers screen | 2026-10-05 |
| [T-0189](T-0189-mobile-ai-tools-routines-read.md) | Mobile: the AI edit screen lists the AI's tools and routines (read only) | 2026-10-05 |
| [T-0190](T-0190-mobile-invite-new-message.md) | Mobile: Invite a friend link sheet and the New message box | 2026-10-05 |
| [T-0213](T-0213-mobile-ai-activity.md) | Mobile: the AI edit screen shows the AI's activity feed | 2026-10-05 |
| [T-0212](T-0212-mobile-routine-actions.md) | Mobile: pause, resume and delete a routine on the AI screen | 2026-10-05 |
| [T-0215](T-0215-review-model-override.md) | Lead tooling: ZILAR_REVIEW_MODEL overrides the pre-review and doctor model | 2026-10-05 |
| [T-0217](T-0217-routines-api-type.md) | Mobile: RoutinesSection takes AiToolsApi (no cast) and ignores a second tap | 2026-10-05 |
| [T-0214](T-0214-mobile-new-group-sheet.md) | Mobile: New group sheet (pick contacts, name the group) | 2026-10-05 |
| [T-0216](T-0216-quota-fallback-in-place.md) | Lead tooling: on a free-Muse rate limit the autopilot switches the same session to the paid Muse | 2026-10-05 |
| [T-0218](T-0218-mobile-tool-detail-read.md) | Mobile: tool detail sheet on the AI screen (source, versions, recent runs; read only) | 2026-10-05 |
| [T-0220](T-0220-prompt-name-cleanup.md) | Lead tooling: 'prereview-resume' in PromptName, one task-file import | 2026-10-05 |
| [T-0221](T-0221-fallback-planned-status.md) | Lead tooling: in-place fallback also for a worker still at planned | 2026-10-05 |
| [T-0211](T-0211-lead-watch-ink-redesign.md) | Lead tooling: lead watch redesigned as an Ink terminal app | 2026-10-05 |
| [T-0222](T-0222-switch-model-in-place.md) | Lead tooling: lead switch-model --in-place switches the same session and records the model | 2026-10-05 |
| [T-0223](T-0223-docs-sync-1005.md) | Docs: FEATURES, mobile parity roadmap and README catch up with T-0181..T-0222 | 2026-10-05 |
| [T-0225](T-0225-doctor-claude-md.md) | Lead tooling: the doctor accepts lead commits that touch CLAUDE.md | 2026-10-05 |
| [T-0224](T-0224-doctor-fallback.md) | Lead tooling: the doctor also switches in place to the paid Muse on a free-Muse rate limit | 2026-10-05 |
| [T-0226](T-0226-smoke-mock-build.md) | Phone tooling: pnpm phone:smoke can build a mock-mode app for the emulator | 2026-10-05 |
| [T-0219](T-0219-mobile-tool-writes.md) | Mobile: Run now, Revert and Delete in the tool detail sheet | 2026-10-05 |
| [T-0229](T-0229-mobile-ai-screen-polish.md) | Mobile: AI screen layout fixes found on the emulator | 2026-10-05 |
| [T-0231](T-0231-folder-matcher.md) | chat-core: ChatFolder type and the pure folder matcher | 2026-10-05 |
| [T-0228](T-0228-mobile-create-visibility.md) | Mobile: New group and New channel can be created Public with an @handle | 2026-10-05 |
| [T-0172](T-0172-push-component-host.md) | Push component dials the ejabberd service, not 127.0.0.1 | 2026-10-05 |
| [T-0230](T-0230-mobile-tool-sheet-keyboard.md) | Mobile: tool sheet keyboard and Tools list refresh after close | 2026-10-05 |
| [T-0171](T-0171-block-users.md) | Block users part 1a: server blocklist, block/unblock API, silent effects | 2026-10-05 |
| [T-0232](T-0232-chat-folders-server.md) | Server: chat_folders table and API | 2026-10-05 |
| [T-0235](T-0235-web-block-users.md) | Web: block and unblock people, Blocked people page | 2026-10-05 |
| [T-0236](T-0236-ui-kit-audit.md) | Audit: duplicated UI, shared kit and React Cosmos plan (docs only) | 2026-10-05 |
| [T-0237](T-0237-web-chat-folders.md) | Web: chat folders from the server, chips and left folder rail | 2026-10-05 |
| [T-0239](T-0239-web-hide-blocked.md) | Web: hide blocked people's group messages; Blocked page fix for people without a @handle | 2026-10-05 |
| [T-0227](T-0227-mobile-mention-picker.md) | Mobile: @mention picker in the group composer, mentions sent with the message | 2026-10-05 |
| [T-0241](T-0241-mobile-mention-chips.md) | Mobile: mention chips in bubbles, a mention of me stands out | 2026-10-05 |
| [T-0240](T-0240-ui-tokens-package.md) | packages/ui-tokens: shared colours, radius and depth recipes, drift tests in web and mobile | 2026-10-05 |
| [T-0242](T-0242-tokens-dot-grid-cleanup.md) | ui-tokens: dot grid from the package, drift tests tightened | 2026-10-05 |
| [T-0233](T-0233-mobile-bottom-bar.md) | Mobile: floating bottom bar (Chats, AIs, Settings, Profile), search bar on Chats, Profile tab | 2026-10-05 |
| [T-0238](T-0238-web-folders-page-editor.md) | Web: Chat folders page with reorder and the folder editor dialog | 2026-10-05 |
| [T-0243](T-0243-web-cosmos-kit-1.md) | Web: React Cosmos catalog, kit fixtures, Dialog, TextInput, Badge, Switch | 2026-10-05 |
| [T-0244](T-0244-mobile-block-users.md) | Mobile: block and unblock, Blocked people screen, 'blocked' relation fix (DeepSeek flash trial) | 2026-10-05 |
| [T-0245](T-0245-model-by-peak-hours.md) | Lead tooling: model: auto picks DeepSeek flash off-peak, free Muse in DeepSeek peak hours | 2026-10-05 |
| [T-0247](T-0247-mobile-settings-hub.md) | Mobile: Settings hub redesign, Blocked people row, tab header padding | 2026-10-05 |
| [T-0250](T-0250-fallback-line-model.md) | Lead tooling: FALLBACK line names the failing model; models.ts breaks the import cycle | 2026-10-05 |
| [T-0246](T-0246-web-kit-2.md) | Web kit 2: SegmentedControl, ListRow, Card, SectionLabel, StateMessage, Avatar fixture; Cosmos on 5100 | 2026-10-05 |
| [T-0248](T-0248-mobile-folders-chips.md) | Mobile: chat folders from the server as scrollable chips on the shared matcher | 2026-10-05 |
| [T-0249](T-0249-web-blocked-previews.md) | Web: blocked senders never show as chat list previews; shared isBlockedSender | 2026-10-05 |
| [T-0234](T-0234-mobile-create-sheets-keyboard.md) | Mobile: create sheets move above the keyboard; mock store creates groups and channels | 2026-10-05 |
| [T-0251](T-0251-mobile-tab-shell-bottom-space.md) | Mobile: Settings and My AIs tab lists scroll clear of the floating bar | 2026-10-05 |
| [T-0253](T-0253-web-kit-switches.md) | Web kit migration 1: toggles on the kit Switch; Notifications on Card and SectionLabel | 2026-10-05 |
| [T-0254](T-0254-mobile-sheets-keyboard-scroll.md) | Mobile: create sheets scroll above the Android keyboard | 2026-10-05 |
| [T-0252](T-0252-mobile-hide-blocked.md) | Mobile: blocked people hidden in groups and previews; helpers shared in chat-core | 2026-10-05 |
| [T-0259](T-0259-ci-slow-folder-test.md) | CI: fast folder cap test; MachinesPage Copied check waits | 2026-10-05 |
| [T-0256](T-0256-forwarding-plan.md) | Forwarding plan (docs/audit/forwarding-plan.md) | 2026-10-05 |
| [T-0257](T-0257-media-gallery-plan.md) | Media gallery plan (docs/audit/media-gallery-plan.md) | 2026-10-05 |
| [T-0255](T-0255-mobile-folders-editor.md) | Mobile: Chat folders settings and editor | 2026-10-05 |
| [T-0258](T-0258-web-kit-dialogs-1.md) | Web kit migration 2: four dialogs on the kit Dialog | 2026-10-05 |
| [T-0261](T-0261-forward-wire.md) | Forwarding step 1: ForwardOriginSchema and the xmpp-core forward element | 2026-10-05 |
| [T-0262](T-0262-mobile-ticks-folder-deeplink.md) | Mobile: list ticks use the signed-in id; folder editor waits for its folder | 2026-10-05 |
| [T-0264](T-0264-mobile-kit-1.md) | Mobile kit batch 1: IconTile, ListRow, Card, SectionLabel, CountBadge; dev/kit catalog | 2026-10-05 |
| [T-0265](T-0265-web-kit-people-pages.md) | Web kit migration 4: Blocked, Requests, Folders pages on Card/StateMessage/Button | 2026-10-05 |
| [T-0263](T-0263-web-kit-dialogs-2.md) | Web kit migration 3: three dialogs on the kit; kit Dialog caps height and scrolls its body | 2026-10-05 |
| [T-0266](T-0266-mobile-subpage-inset-folder-summary.md) | Mobile: sub-pages clear the gesture bar; folder summary matches web | 2026-10-05 |
| [T-0267](T-0267-kit-section-label-heading.md) | Kit: SectionLabel is a heading on web and mobile | 2026-10-05 |
| [T-0268](T-0268-mobile-kit-people-screens.md) | Mobile kit migration: Requests and Blocked screens on Card/ListRow | 2026-10-05 |
| [T-0269](T-0269-flaky-535-assertion.md) | Server tests: 535 checks ignore the random requestId | 2026-10-05 |
| [T-0271](T-0271-mobile-kit-connections-machines.md) | Mobile kit migration: Connections and Machines lists on SectionLabel/Card | 2026-10-05 |
| [T-0270](T-0270-web-kit-dialogs-3.md) | Web kit migration 5: NewTopic and FolderEditor dialogs on the kit; size lg | 2026-10-05 |
| [T-0260](T-0260-auto-deploy-green-main.md) | Deploy: auto-deploy live after green CI on main; /health reports the commit | 2026-10-05 |
| [T-0273](T-0273-web-kit-dialogs-4.md) | Web kit: NewChatButton pickers and GroupHandleRoute dialogs on the kit Dialog | 2026-10-05 |
| [T-0275](T-0275-web-kit-accent-buttons-1.md) | Web kit: accent buttons on Connections, Integrations and Stickers pages use the kit Button | 2026-10-05 |
| [T-0272](T-0272-lockfile-peer-flip.md) | Tooling: pnpm install no longer flips the bufferutil/utf-8-validate lockfile peers | 2026-10-05 |
| [T-0274](T-0274-web-kit-dialogs-5.md) | Web kit: Explore and avatar crop dialogs on the kit Dialog | 2026-10-05 |
| [T-0276](T-0276-web-kit-accent-buttons-2.md) | Web kit: accent buttons in machines, Telegram import and invite links use the kit Button | 2026-10-05 |
| [T-0279](T-0279-web-kit-accent-buttons-5.md) | Web kit: sign-in and onboarding call-to-action buttons and links use the kit Button | 2026-10-05 |
| [T-0278](T-0278-web-kit-accent-buttons-4.md) | Web kit: accent buttons in profile, visibility, pack editor and contact rows use the kit Button | 2026-10-05 |
| [T-0277](T-0277-web-kit-accent-buttons-3.md) | Web kit: accent buttons in the chat dialogs use the kit Button | 2026-10-05 |
| [T-0281](T-0281-web-accent-pill-guard.md) | Web guard: a test fails when a hand-rolled solid bg-accent button or link comes back outside the kit | 2026-10-05 |
| [T-0280](T-0280-grouphandle-escape-flake.md) | Web tests: GroupHandleRoute Escape tests wait for the dialog effect; no more flake under load | 2026-10-06 |
| [T-0283](T-0283-mobile-kit-action-sheet.md) | Mobile kit: ActionSheet; the AI and chat long-press sheets use it | 2026-10-06 |
| [T-0282](T-0282-web-kit-sheet.md) | Web kit: right-side Sheet (PinsPanel on it); modal Escape stops at the topmost overlay and attaches in a layout effect | 2026-10-06 |
| [T-0284](T-0284-mobile-topic-actions-sheet.md) | Mobile kit: topic actions sheet on the kit ActionSheet; Open group row gets its icon | 2026-10-06 |
| [T-0286](T-0286-web-sheet-topic-ai.md) | Web kit: TopicPanel and AiPanel on the kit Sheet; AiPanel closes on Escape | 2026-10-06 |
| [T-0285](T-0285-web-sheet-group-channel.md) | Web kit: GroupPanel and ChannelPanel on the kit Sheet | 2026-10-06 |
| [T-0287](T-0287-mobile-kit-confirm-dialog.md) | Mobile kit: ConfirmDialog; AI delete, rule revoke and machine confirms use it | 2026-10-06 |
| [T-0289](T-0289-ci-cancel-superseded.md) | CI: a newer push cancels the older in-progress run, so the tip is verified and auto-deployed sooner | 2026-10-06 |
| [T-0288](T-0288-web-kit-text-input-1.md) | Web kit: name, username and add-contact fields use the kit TextInput | 2026-10-06 |
| [T-0290](T-0290-web-kit-text-input-2.md) | Web kit: New group and invite-link fields use the kit TextInput and TextArea | 2026-10-06 |
| [T-0291](T-0291-web-kit-text-input-3.md) | Web kit: Integrations, Connections, topic name and group handle fields use the kit TextInput | 2026-10-06 |
| [T-0292](T-0292-web-kit-field-no-wrapper.md) | Web kit: TextInput and TextArea render the bare field without a label, hint or counter | 2026-10-06 |
| [T-0293](T-0293-web-kit-text-input-4.md) | Web kit: setup, new-AI, AI panel and spending-limit fields use the kit TextInput and TextArea | 2026-10-06 |
| [T-0294](T-0294-mobile-kit-text-field.md) | Mobile kit: TextField (well look); profile name, handle, add-contact and new-AI fields use it | 2026-10-06 |
| [T-0295](T-0295-web-kit-text-input-5.md) | Web kit: sticker pack, machine rename and model picker fields use the kit TextInput | 2026-10-06 |
| [T-0296](T-0296-mobile-remove-add-contact-sheet.md) | Mobile cleanup: remove the unused AddContactSheet; resolveContactChat moves to add-contact.ts | 2026-10-06 |
| [T-0297](T-0297-mobile-text-field-2.md) | Mobile kit: integrations, connections, AI edit and invite-link fields use the kit TextField | 2026-10-06 |
| [T-0298](T-0298-web-kit-text-input-6.md) | Web kit: Explore search, sticker pack search and task-strip link fields use the kit TextInput | 2026-10-06 |
| [T-0299](T-0299-mobile-invite-links-keyboard.md) | Mobile: invite links sheet moves above the keyboard and scrolls | 2026-10-06 |
| [T-0300](T-0300-mobile-text-field-3.md) | Mobile kit: create-sheet fields use the kit TextField | 2026-10-06 |
| [T-0301](T-0301-mobile-text-field-4.md) | Mobile kit: role name and topic link fields use the kit TextField | 2026-10-06 |
| [T-0304](T-0304-web-image-native-builder.md) | Images: web builder stage runs natively, not under QEMU | 2026-10-06 |
| [T-0303](T-0303-mobile-integrations-mock.md) | Mobile mock mode: Integrations owner mock | 2026-10-06 |
| [T-0302](T-0302-mobile-text-field-5.md) | Mobile kit: join link and visibility handle fields use the kit TextField | 2026-10-06 |
| [T-0306](T-0306-mobile-text-field-7.md) | Mobile kit: machine rename and sticker pack name use the kit TextField | 2026-10-06 |
| [T-0305](T-0305-mobile-text-field-6.md) | Mobile kit: AI model, spend limit and tool run-input fields use the kit TextField | 2026-10-06 |
| [T-0307](T-0307-mobile-text-field-8.md) | Mobile kit: sign-in email, name and username fields use the kit TextField | 2026-10-06 |
| [T-0308](T-0308-mobile-kit-search-field.md) | Mobile kit: SearchField; group topics search and Explore use it | 2026-10-06 |
| [T-0310](T-0310-mobile-visibility-sheet-keyboard.md) | Mobile: visibility sheet moves above the keyboard; shared sheetBottomPadding | 2026-10-06 |
| [T-0309](T-0309-mobile-search-field-2.md) | Mobile kit: chat list and Stickers discover search use SearchField | 2026-10-06 |
| [T-0311](T-0311-mobile-gif-telegram-fields.md) | Mobile kit: GIF search on SearchField, Telegram import field on TextField | 2026-10-06 |
| [T-0312](T-0312-mobile-message-actions-kit.md) | Mobile kit: message actions sheet and voice download confirm on ActionSheet/ConfirmDialog | 2026-10-06 |
| [T-0313](T-0313-mobile-kit-bottom-sheet.md) | Mobile kit: BottomSheet; pins and invite links sheets use it | 2026-10-06 |
| [T-0314](T-0314-mobile-search-chat-matches.md) | Mobile: chat search shows matching chats and groups above message hits | 2026-10-06 |
| [T-0315](T-0315-mobile-bottom-sheet-2.md) | Mobile kit: visibility, members/roles and topic info sheets on BottomSheet | 2026-10-06 |
| [T-0316](T-0316-web-search-group-name.md) | Web: chat list search also matches a group by its own name | 2026-10-06 |
| [T-0317](T-0317-mobile-kit-card-contrast.md) | Mobile kit polish: ActionSheet and ConfirmDialog cards on bg-surface with a border | 2026-10-06 |
| [T-0318](T-0318-web-kit-menu.md) | Web kit: Menu with keyboard support; main menu and New chat menu use it | 2026-10-06 |
| [T-0319](T-0319-web-menu-2.md) | Web kit: message actions and chat actions menus on the kit Menu | 2026-10-06 |
| [T-0320](T-0320-web-menu-3.md) | Web kit: ChatHeader and TaskStrip menus on Menu; Escape no longer leaves the chat on narrow screens | 2026-10-06 |
| [T-0321](T-0321-web-badge.md) | Web kit: unread count pills on Badge | 2026-10-06 |
| [T-0322](T-0322-web-state-message.md) | Web kit: AIs, Connections and Machines page states on StateMessage | 2026-10-06 |
| [T-0324](T-0324-web-segmented.md) | Web kit: SegmentedControl radio mode for the Explore filter and group Visibility | 2026-10-06 |
| [T-0323](T-0323-web-checkbox.md) | Web kit: Checkbox for the group, topic, roles and folder pickers | 2026-10-06 |
| [T-0325](T-0325-web-stickers-kit.md) | Web kit: Stickers page states on StateMessage and pill buttons on Button | 2026-10-06 |
| [T-0326](T-0326-web-segmented-2.md) | Web kit: New group and sticker pack visibility on SegmentedControl | 2026-10-06 |
| [T-0327](T-0327-web-stickers-buttons.md) | Web kit: Stickers pack actions on Button; glyph arrows and star become icons | 2026-10-06 |
| [T-0328](T-0328-web-glyph-icons.md) | Web: star and close glyphs become lucide icons | 2026-10-06 |
| [T-0330](T-0330-web-segmented-fix.md) | Web kit: SegmentedControl ignores re-clicks; PackEditor glyphs become icons | 2026-10-06 |
| [T-0329](T-0329-mobile-checkbox.md) | Mobile kit: Checkbox with a Check icon; ✓ glyphs become icons | 2026-10-06 |
| [T-0331](T-0331-web-share-tooltip.md) | Web: disabled Share on an imported sticker pack shows its reason again | 2026-10-06 |
| [T-0333](T-0333-web-panel-tabs.md) | Web kit: sticker panel tabs on SegmentedControl | 2026-10-06 |
| [T-0334](T-0334-web-badge-label.md) | Web kit: Badge label follows the visible count (99+) | 2026-10-06 |
| [T-0335](T-0335-autopilot-review-fallback.md) | Autopilot: fix rounds in review fall back on a rate limit | 2026-10-06 |
| [T-0332](T-0332-mobile-new-topic-sheet.md) | Mobile: New topic sheet on BottomSheet; long Private form scrolls | 2026-10-06 |
| [T-0336](T-0336-mobile-inline-ticks.md) | Mobile: inline bubble ticks as icons | 2026-10-06 |
| [T-0337](T-0337-mobile-ai-bubble-layout.md) | Mobile: AI markdown list and code block layout fixed; tick nudge | 2026-10-06 |
| [T-0338](T-0338-mobile-bubble-meta-wrap.md) | Mobile: tick never wraps away from the time; list items without extra height | 2026-10-06 |
| [T-0339](T-0339-mobile-settings-confirms.md) | Mobile kit: Stickers, Sticker pack and Integrations confirms on ConfirmDialog | 2026-10-06 |
| [T-0340](T-0340-mobile-add-machine-kit.md) | Mobile kit: Add machine dialog on the kit surface and Buttons | 2026-10-06 |
| [T-0341](T-0341-mobile-empty-state-plus.md) | Mobile: empty-state Plus icons in accent foreground | 2026-10-06 |
| [T-0342](T-0342-web-new-topic-visibility-segmented.md) | Web kit: New topic visibility on SegmentedControl | 2026-10-06 |
| [T-0343](T-0343-mobile-machines-buttons-kit.md) | Mobile kit: Machines screen pill buttons on Button | 2026-10-06 |
| [T-0344](T-0344-web-inputs-kit.md) | Web kit: Telegram import and Group roles fields on TextInput | 2026-10-06 |
| [T-0345](T-0345-mobile-connections-buttons-kit.md) | Mobile kit: Connections screen text pill buttons on Button | 2026-10-06 |
| [T-0346](T-0346-mobile-stickers-buttons-kit.md) | Mobile kit: Stickers screen text pill buttons on Button | 2026-10-06 |
| [T-0347](T-0347-mobile-sticker-pack-buttons-kit.md) | Mobile kit: Sticker pack editor text pill buttons on Button | 2026-10-06 |
| [T-0348](T-0348-mobile-integrations-requests-buttons-kit.md) | Mobile kit: Integrations and Requests text pill buttons on Button | 2026-10-06 |
| [T-0349](T-0349-mobile-profile-buttons-kit.md) | Mobile kit: Profile settings, avatar and handle buttons on Button | 2026-10-06 |
| [T-0350](T-0350-mobile-telegram-import-buttons-kit.md) | Mobile kit: Telegram import sheet text pill buttons on Button | 2026-10-06 |
| [T-0351](T-0351-mobile-auth-buttons-kit.md) | Mobile kit: sign-in and onboarding buttons on Button | 2026-10-06 |
| [T-0352](T-0352-mobile-join-handle-buttons-kit.md) | Mobile kit: join link and @handle screen buttons on Button | 2026-10-06 |
| [T-0353](T-0353-mobile-new-group-explore-buttons-kit.md) | Mobile kit: New group sheet and Explore join buttons on Button | 2026-10-06 |
| [T-0355](T-0355-mobile-invite-links-buttons-kit.md) | Mobile kit: invite links sheet buttons on Button | 2026-10-06 |
| [T-0356](T-0356-mobile-profile-button-labels.md) | Mobile fix: Profile settings buttons show their labels again | 2026-10-06 |
| [T-0354](T-0354-mobile-join-invite-buttons-kit.md) | Mobile kit: join-link card and Invite a friend sheet buttons on Button | 2026-10-06 |
| [T-0358](T-0358-web-inline-loading-state.md) | Web kit: StateMessage inline size; panel Loading lines use it | 2026-10-06 |
| [T-0357](T-0357-web-kit-search-field.md) | Web kit: SearchField; GIF, folder editor, Explore and sticker searches use it | 2026-10-06 |
| [T-0359](T-0359-web-chat-menu-items-kit.md) | Web kit: MenuItem aria-label; chat row, header and topic menus on MenuItem | 2026-10-06 |
| [T-0361](T-0361-mobile-roles-topics-buttons-kit.md) | Mobile kit: Group roles, topic sheets and task strip buttons on Button | 2026-10-06 |
| [T-0362](T-0362-mobile-profile-card-channel-buttons-kit.md) | Mobile kit: profile card, Profile tab and channel screen buttons on Button | 2026-10-06 |
| [T-0363](T-0363-web-message-menu-items-kit.md) | Web kit: message actions menu items on MenuItem | 2026-10-06 |
| [T-0364](T-0364-web-gif-stickers-states-kit.md) | Web kit: GIF and Stickers states on StateMessage; SearchField shares FIELD_INPUT | 2026-10-06 |
| [T-0360](T-0360-mobile-create-sheets-buttons-kit.md) | Mobile kit: create and visibility sheet buttons on Button | 2026-10-06 |
| [T-0366](T-0366-web-contact-row-buttons-kit.md) | Web kit: contact profile row buttons on Button | 2026-10-06 |
| [T-0367](T-0367-web-pinned-banner-buttons-kit.md) | Web kit: pinned banner buttons on Button | 2026-10-06 |
| [T-0365](T-0365-web-connections-folder-taskstrip-buttons-kit.md) | Web kit: Connections, folder editor and task link buttons on Button | 2026-10-06 |
| [T-0372](T-0372-web-panel-close-buttons-kit.md) | Web kit: panel close buttons on Button | 2026-10-06 |
| [T-0368](T-0368-web-machine-cards-buttons-kit.md) | Web kit: machine card buttons on Button | 2026-10-06 |
| [T-0369](T-0369-web-ais-integrations-buttons-kit.md) | Web kit: AIs page and Integrations Remove buttons on Button | 2026-10-06 |
| [T-0370](T-0370-web-dialog-footers-buttons-kit.md) | Web kit: ConfirmDialog, New AI and avatar uploader buttons on Button | 2026-10-06 |
| [T-0371](T-0371-web-pack-editor-buttons-kit.md) | Web kit: sticker pack editor buttons on Button | 2026-10-06 |
| [T-0373](T-0373-web-dialog-cancel-back-close-kit.md) | Web kit: dialog Cancel, Back and Close on Button | 2026-10-06 |
| [T-0377](T-0377-mobile-topic-info-leave-archive-kit.md) | Mobile kit: topic info Leave/Archive on Button; New topic Create guard | 2026-10-06 |
| [T-0378](T-0378-mobile-group-fab-key.md) | Mobile: group New topic FAB as a raised key | 2026-10-06 |
| [T-0374](T-0374-web-visibility-invite-buttons-kit.md) | Web kit: visibility and invite link buttons on Button | 2026-10-06 |
| [T-0375](T-0375-web-plus-glyphs-icons-kit.md) | Web: Plus icons for + glyphs; New topic, Manage stickers, folder Edit on Button | 2026-10-06 |
| [T-0376](T-0376-web-fab-voice-key-guard.md) | Web kit: FAB and voice play on Button; guard flags key-primary and solid bg-danger | 2026-10-06 |
| [T-0379](T-0379-web-explore-states-kit.md) | Web kit: Explore states on StateMessage and Button | 2026-10-06 |
| [T-0383](T-0383-mobile-group-roles-remaining-buttons-kit.md) | Mobile kit: last group roles sheet buttons on Button | 2026-10-06 |
| [T-0381](T-0381-web-auth-setup-text-buttons-kit.md) | Web kit: Setup, handle, Add machine, profile and sign-in text buttons on Button | 2026-10-06 |
| [T-0382](T-0382-web-picker-rows-outline-kit.md) | Web kit: panel picker rows on outline Button | 2026-10-06 |
| [T-0385](T-0385-web-hover-action-buttons-kit.md) | Web kit: hover Chat/Message actions and attachment Remove on Button | 2026-10-06 |
| [T-0380](T-0380-web-shell-back-icons-kit.md) | Web kit: settings Back, AI close and refresh on Button; drop unused AiPageShell frame | 2026-10-06 |
| [T-0387](T-0387-mobile-profile-card-confirm-block-kit.md) | Mobile kit: profile card Confirm block on destructive Button | 2026-10-06 |
| [T-0384](T-0384-mobile-explore-blocked-retry-buttons-kit.md) | Mobile kit: Explore, Blocked and panel Retry buttons on Button | 2026-10-06 |
| [T-0390](T-0390-web-disclosure-toggles-kit.md) | Web kit: Revoked and More options disclosure toggles on Button | 2026-10-06 |
| [T-0386](T-0386-mobile-kit-state-message.md) | Mobile kit: StateMessage component, catalog and kit test | 2026-10-06 |
| [T-0388](T-0388-web-voice-file-key-icons-kit.md) | Web kit: transcript toggle as Captions IconButton; file Retry IconButton; transcript states on kit | 2026-10-06 |
| [T-0389](T-0389-web-kit-secret-input.md) | Web kit: SecretInput replaces four hand-rolled key/token fields | 2026-10-06 |
| [T-0391](T-0391-mobile-no-solid-pill-guard.md) | Mobile guard: no hand-rolled solid bg-accent/bg-danger Pressable | 2026-10-06 |
| [T-0395](T-0395-web-chat-message-list-errors-kit.md) | Web kit: chat and message list errors on StateMessage | 2026-10-06 |
| [T-0396](T-0396-web-connections-icon-buttons-kit.md) | Web kit: Connections icon buttons on Button | 2026-10-06 |
| [T-0393](T-0393-mobile-panels-state-message.md) | Mobile kit: sticker and GIF panel states on StateMessage | 2026-10-06 |
| [T-0394](T-0394-web-inline-loading-lines-kit.md) | Web kit: eight Loading/Searching lines on StateMessage | 2026-10-06 |
| [T-0392](T-0392-mobile-kit-segmented-control.md) | Mobile kit: SegmentedControl from the Stickers tabs | 2026-10-06 |
| [T-0397](T-0397-mobile-kit-switch.md) | Mobile kit: themed Switch row replaces the folder editor's SwitchRow | 2026-10-06 |
| [T-0401](T-0401-web-kit-menu-radio-item.md) | Web kit: MenuRadioItem; TaskStrip status and owner menus use it | 2026-10-06 |
| [T-0403](T-0403-web-secret-input-label-safe.md) | Web kit: SecretInput toggle stays on the input with a label or hint | 2026-10-06 |
| [T-0402](T-0402-web-small-leftovers-kit.md) | Web kit: four small leftovers on the kit | 2026-10-06 |
| [T-0398](T-0398-mobile-settings-states-a.md) | Mobile: Requests, Blocked and Connections states on StateMessage | 2026-10-06 |
| [T-0399](T-0399-mobile-settings-states-b.md) | Mobile: Integrations, Machines and Stickers states on StateMessage | 2026-10-06 |
| [T-0400](T-0400-mobile-kit-catalog-switch-segmented.md) | Mobile kit: Switch in the catalog; SegmentedControl press tests | 2026-10-06 |
| [T-0404](T-0404-mobile-switch-on-colors.md) | Mobile kit: Switch ON keeps a light thumb on a grey track | 2026-10-06 |
| [T-0405](T-0405-mobile-ai-approvals-states.md) | Mobile: AIs, AI detail and Approvals states on StateMessage | 2026-10-06 |
| [T-0406](T-0406-ui-kit-leftovers-audit.md) | Audit: UI kit leftovers on web and mobile (docs/audit/ui-kit-leftovers.md) | 2026-10-06 |
| [T-0407](T-0407-web-archived-dismiss-kit.md) | Web kit: Archived disclosure and Dismiss notice on Button | 2026-10-06 |
| [T-0408](T-0408-mobile-pins-buttons-kit.md) | Mobile kit: pins banner and sheet buttons on Button | 2026-10-06 |
| [T-0409](T-0409-web-forwarded-header.md) | Forwarding step 2 (web): received forwards show 'Forwarded from' header | 2026-10-06 |
| [T-0412](T-0412-mobile-connections-icon-buttons.md) | Mobile kit: Connections icon buttons on Button | 2026-10-06 |
| [T-0411](T-0411-web-fields-empty-kit.md) | Web kit: Run input, sign-in email and two empty lines on the kit | 2026-10-06 |
| [T-0413](T-0413-web-empty-error-lines-kit.md) | Web kit: Tools, Always-allowed, Approvals empty lines and people search errors on StateMessage | 2026-10-06 |
| [T-0415](T-0415-mobile-settings-buttons-kit.md) | Mobile kit: folder, integrations and machines buttons on Button | 2026-10-06 |
| [T-0416](T-0416-mobile-stickers-auth-buttons-kit.md) | Mobile kit: Stickers import/move and sign-in links on Button | 2026-10-06 |
| [T-0417](T-0417-mobile-screen-states-kit.md) | Mobile: Explore, user page, Profile tab and New AI states on StateMessage | 2026-10-06 |
| [T-0418](T-0418-mobile-settings-states-c.md) | Mobile: Profile settings, Discover, sticker pack and Add machine states on StateMessage | 2026-10-06 |
| [T-0420](T-0420-mobile-empty-lines-kit.md) | Mobile: AI sections, Connections, Folders and Explore empty lines on StateMessage | 2026-10-06 |
| [T-0421](T-0421-mobile-revoked-chevron.md) | Mobile: Revoked machines disclosure shows a chevron and expanded state | 2026-10-06 |
| [T-0423](T-0423-mobile-list-empty-lines.md) | Mobile: empty chat, tool versions/runs and empty sticker pack on StateMessage | 2026-10-06 |
| [T-0424](T-0424-mobile-stickers-machines-empty.md) | Mobile: Stickers and Machines empty states on StateMessage | 2026-10-06 |
| [T-0422](T-0422-mobile-sheet-empty-lines.md) | Mobile: topic, invite links and roles sheets empty lines on StateMessage | 2026-10-06 |
| [T-0414](T-0414-web-forward-store-action.md) | Web store: forwardMessages sends copies with a forward origin, optional comment | 2026-10-06 |
| [T-0425](T-0425-mobile-profile-buttons-kit.md) | Mobile: profile and contact card buttons on the kit Button | 2026-10-06 |
| [T-0426](T-0426-mobile-ai-sheet-buttons-kit.md) | Mobile: AI activity Refresh, tool sheet Show all/less and Close on the kit Button | 2026-10-06 |
| [T-0436](T-0436-mobile-media-sheet.md) | Media gallery 3 (mobile): media sheet | running | auto | T-0431 | |
| [T-0441](T-0441-ai-memory-routes.md) | AI memory M4a: GET /api/ai-memory, delete fact, clear | running | auto | T-0438 | |
| [T-0443](T-0443-web-ai-memory-dm.md) | AI memory M5a (web): Memory section in the AI panel | running | auto | T-0441 | |
| [T-0442](T-0442-ai-memory-room-cleanup.md) | AI memory M4b: removing an AI from a room deletes that room's memory | running | auto | T-0438 | |
| [T-0427](T-0427-mobile-forwarded-header.md) | Mobile: forwarded messages show 'Forwarded from X [in Y]' | 2026-10-06 |
| [T-0428](T-0428-mobile-new-chat-menu-sheet.md) | Mobile: New chat menu on the kit ActionSheet with icons | 2026-10-06 |
| [T-0429](T-0429-mobile-dismiss-banner.md) | Mobile: DismissBanner replaces 12 copied chat screen banners | 2026-10-06 |
| [T-0410](T-0410-server-media-index.md) | Server: media_items and media_index_state tables with an incremental MAM media indexer | 2026-10-06 |
| [T-0419](T-0419-web-forward-picker.md) | Web: Forward in the message menu opens a chat picker with an optional comment | 2026-10-06 |
| [T-0430](T-0430-ai-history-newest-page.md) | AI and app history load the newest MAM page (empty RSM before), not the oldest | 2026-10-06 |
| [T-0431](T-0431-server-media-route.md) | Server: GET /api/media gallery route (members only, block check, paged by type) | 2026-10-06 |
| [T-0432](T-0432-mobile-forward-store-action.md) | Mobile store: forwardMessages with forward origin (real and mock) | 2026-10-06 |
| [T-0433](T-0433-ai-memory-schema-core.md) | AI memory M1: memory tables (migration 0042) and the summary-tree core | 2026-10-06 |
| [T-0435](T-0435-mobile-forward-sheet.md) | Mobile: Forward in the message sheet opens a forward sheet | 2026-10-06 |
| [T-0434](T-0434-web-chat-media-panel.md) | Web: Media, files and links panel (Media / Files / Links / Voice tabs) | 2026-10-06 |
| [T-0437](T-0437-ai-memory-indexer.md) | AI memory M2a: mirror indexer (archive to ai_memory_messages) | 2026-10-06 |
| [T-0438](T-0438-ai-memory-store.md) | AI memory M2b: store reads (window, memory block, recall, zoom, facts, compaction input, clear) | 2026-10-06 |
| [T-0439](T-0439-web-forward-multiselect.md) | Web: multi-select forwarding (Select, selection bar, forward in chat order) | 2026-10-06 |
| [T-0440](T-0440-ai-memory-gateway-context.md) | AI memory M3a: turns index the chat and read facts + memory block; window 50 | 2026-10-06 |
