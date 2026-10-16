# Board

Claude maintains this file. Statuses are explained in [README.md](README.md).

## Active (M1 complete; next: M2 AIs that talk)

Claude runs the workers (DeepSeek V4.1 Flash, MiMo-V2.6-Flash, Muse Spark 1.3; **no V4 Pro**, Julio 2026-09-28) through OpenCode 2 (Julio's authorization, 2026-09-27). Each task gets its own git worktree `../zilar-T-XXXX`. Watch a worker live with `cd ../zilar-T-XXXX && opencode2 -s <session>`.

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|
| T-0005 | Spike S3: push chain, ejabberd → relay → Expo Push → iPhone | planned | v4-pro | T-0004 | Needs an Apple Developer account; superseded by T-1129's plan |
| [T-1298](T-1298-mobile-layout-batch.md) | Mobile batch 3 (MUX-18/20/24/31) | planned | auto | T-1289 | audit wave B |

## Follow-ups
- **Mobile markdown has no tables (found 2026-10-10, T-1040 smoke).** The Dev AI review summary's table shows as raw `|` text on mobile. This is a new feature, so it needs Julio's OK.
- **Mock images (waiting for Julio's choice, NOW.md 2026-10-11 05:00).** Web seed stickers are fixed (T-1083, a dev-only vite plugin), and web GIFs were never blank. Still broken:
  - **mobile sticker and GIF images are blank:** native `Image` fetches over the network, never through `mockFetch`, and the seed art is SVG;
  - **a sent attachment or GIF has no bytes:** it is a file row on web and "Not loaded: untrusted address" on mobile, because the fake slot is an empty `data:` url (`packages/mock-backend/src/xmpp/core.ts:227-231`).

  Load paths and options: `docs/audit/mock-sweep-status.md` §3-§4. Any fix sits next to `isTrustedMediaUrl` (`packages/chat-core/src/media.ts:82`).
- **The `interruptFiber` follow-up is now T-1128,** which covers 18 sites.
- **The dedup decisions are resolved** (Julio, 2026-10-11: "move unchanged"):
  - S6 is T-1107;
  - S7 is T-1108, and S8/S9 are kept, because moving them would change the answer order;
  - S10/S11 are T-1110, T-1115 and T-1116;
  - S15 is T-1111 and T-1113, with `/setup` and the avatar delete kept.
  - Status: `docs/audit/simplify-status.md` 2.3, 2.6 and 3.3.

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
| [T-0618](T-0618-test-speed-audit.md) | Audit: a faster, lighter server test setup | planned | auto | T-0596 | |
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
| [T-0436](T-0436-mobile-media-sheet.md) | Mobile: media sheet (Media / Files / Links / Voice) | 2026-10-06 |
| [T-0442](T-0442-ai-memory-room-cleanup.md) | AI memory M4b: removing an AI from a room deletes that room's memory | 2026-10-06 |
| [T-0441](T-0441-ai-memory-routes.md) | AI memory M4a: GET /api/ai-memory, delete fact, clear | 2026-10-06 |
| [T-0443](T-0443-web-ai-memory-dm.md) | AI memory M5a (web): Memory section in the AI panel | 2026-10-06 |
| [T-0445](T-0445-mobile-forward-multiselect.md) | Mobile: multi-select forwarding (Select, selection bar, forward in chat order) | 2026-10-06 |
| [T-0444](T-0444-ai-memory-tools.md) | AI memory M3b: recall, memory_zoom and remember tools with a secret check | 2026-10-06 |
| [T-0447](T-0447-web-ai-memory-rooms.md) | AI memory M5b (web): 'What <AI> remembers' dialog from room panels | 2026-10-06 |
| [T-0449](T-0449-mobile-ai-memory-dm.md) | AI memory M6a (mobile): Memory section on the AI screen | 2026-10-07 |
| [T-0450](T-0450-web-forward-memory-polish.md) | Web polish: Forget once per click; multi-select order and reset tests | 2026-10-07 |
| [T-0446](T-0446-ai-memory-compactor.md) | AI memory M3c: compactor after each reply (4 nodes, AI's model, daily limit) | 2026-10-07 |
| [T-0448](T-0448-mobile-media-forward-polish.md) | Mobile polish: media grid, keys, dates; no swipe while selecting; no empty forward | 2026-10-07 |
| [T-0451](T-0451-mobile-ai-memory-rooms.md) | AI memory M6b (mobile): 'What <AI> remembers' sheet from the topic info sheet | 2026-10-07 |
| [T-0452](T-0452-upload-auth-audit.md) | Audit + plan: lock /upload files behind session and membership | 2026-10-07 |
| [T-0453](T-0453-server-files-route.md) | Upload lock 1: GET /api/files streams uploads to chat members only (Range) | 2026-10-07 |
| [T-0454](T-0454-web-files-through-route.md) | Upload lock 2 (web): uploads load through /api/files | 2026-10-07 |
| [T-0455](T-0455-memory-remembered-line.md) | AI memory: 'Remembered: <fact>' line after remember | 2026-10-07 |
| [T-0456](T-0456-chat-backgrounds-plan.md) | Audit + plan: custom chat backgrounds | 2026-10-07 |
| [T-0457](T-0457-background-preset-tokens.md) | Backgrounds A: preset tokens in ui-tokens | 2026-10-07 |
| [T-0459](T-0459-files-route-cleanup.md) | Cleanup: shared isDmBlocked; RFC 5987 filename in /api/files | 2026-10-07 |
| [T-0458](T-0458-server-background-prefs.md) | Backgrounds B: per-chat + default background prefs (schema) | 2026-10-07 |
| [T-0461](T-0461-web-render-backgrounds.md) | Backgrounds D (web): paint each chat's effective background | 2026-10-07 |
| [T-0460](T-0460-server-background-images.md) | Backgrounds C: background image upload/list/serve/delete (owner only) | 2026-10-07 |
| [T-0462](T-0462-web-background-picker.md) | Backgrounds E (web): Chat background dialog (presets, this chat / all chats) | 2026-10-07 |
| [T-0463](T-0463-server-group-backgrounds.md) | Backgrounds F (server): group background by owner/admin, members read image | 2026-10-07 |
| [T-0464](T-0464-web-background-images.md) | Backgrounds E2 (web): upload, pick, dim, delete background images | 2026-10-07 |
| [T-0465](T-0465-chats-group-background.md) | Backgrounds G1 (server): /api/chats group entries carry background | 2026-10-07 |
| [T-0466](T-0466-web-group-background.md) | Backgrounds G2 (web): paint group background; admins set it in group panel | 2026-10-07 |
| [T-0468](T-0468-listener-delegation-plan.md) | Audit + plan: listener and delegation on today's code | 2026-10-07 |
| [T-0467](T-0467-web-kit-leftovers-refresh.md) | Audit: refresh web UI kit leftovers with ready batches | 2026-10-07 |
| [T-0469](T-0469-release-readiness-audit.md) | Audit: release readiness (Effect status, docs freshness, release checklist) | 2026-10-07 |
| [T-0471](T-0471-docs-catch-up.md) | Docs catch-up: FEATURES, USER_GUIDE, READMEs, storage dirs, RELEASING | 2026-10-07 |
| [T-0470](T-0470-listener-schema.md) | Listener S1 (schema): listener columns, delegation flags, ai_delegations | 2026-10-07 |
| [T-0473](T-0473-env-examples-storage.md) | Env examples: avatar and background storage dirs | 2026-10-07 |
| [T-0472](T-0472-listener-score-core.md) | Listener S2 (server): pure scoring core | 2026-10-07 |
| [T-0476](T-0476-web-kit-panel-rows.md) | Web kit: panel rows on ListRow, archived toggle on Button | 2026-10-07 |
| [T-0474](T-0474-listener-settings-routes.md) | Listener S6a (server): LISTENER_ENABLED, group listener + AI delegation settings | 2026-10-07 |
| [T-0477](T-0477-web-kit-chip.md) | Web kit: Chip component; reactions + search scope chip; topic Type on SegmentedControl | 2026-10-07 |
| [T-0478](T-0478-web-listener-settings.md) | Listener W1 (web): group listener switch + eagerness; AI delegation switches | 2026-10-07 |
| [T-0475](T-0475-listener-gateway.md) | Listener S3 (server): per-room listener in the gateway wakes AIs | 2026-10-07 |
| [T-0479](T-0479-listener-round-budget.md) | Listener S4a (server): 4 AI turns per human message; wake line after gates | 2026-10-07 |
| [T-0480](T-0480-delegation-service.md) | Listener S5a (server): delegation service | 2026-10-07 |
| [T-0481](T-0481-ai-handoff-mentions.md) | Listener S4b (server): AI-to-AI handoff by @mention, max 2 hops | 2026-10-07 |
| [T-0484](T-0484-effect-guarded-fetch.md) | Effect convert: web-tools guarded GET | 2026-10-07 |
| [T-0489](T-0489-effect-run-tool.md) | Effect convert: sandbox runTool | 2026-10-07 |
| [T-0490](T-0490-effect-everywhere-plan.md) | Audit + plan: whole codebase on Effect 4 | 2026-10-07 |
| [T-0482](T-0482-delegate-tools.md) | Listener S5b (server): delegate + task_status tools | 2026-10-07 |
| [T-0486](T-0486-effect-runner-hub.md) | Effect convert: runner hub loops | 2026-10-07 |
| [T-0488](T-0488-effect-background-loops.md) | Effect convert: routines scheduler + approvals sweeper | 2026-10-07 |
| [T-0491](T-0491-watch-scroll-columns.md) | lead watch: keyboard scroll + two columns | 2026-10-07 |
| [T-0493](T-0493-effect-push-service.md) | Effect convert: push delivery pipeline | 2026-10-07 |
| [T-0492](T-0492-effect-transcription-provider.md) | Effect convert: voice transcription provider call | 2026-10-07 |
| [T-0487](T-0487-effect-mailer.md) | Effect convert: SMTP mailer send | 2026-10-07 |
| [T-0495](T-0495-server-runtime-logger.md) | Effect F1: server runtime + pino-backed Effect Logger | 2026-10-07 |
| [T-0485](T-0485-effect-giphy.md) | Effect convert: Giphy provider | 2026-10-07 |
| [T-0483](T-0483-effect-telegram-import.md) | Effect convert: Telegram import client | 2026-10-07 |
| [T-0497](T-0497-effect-recovery-loop.md) | Effect convert: action gateway recovery loop | 2026-10-07 |
| [T-0500](T-0500-effect-runner-tunnel-schema.md) | Effect F: runner-tunnel zod to Effect Schema | 2026-10-07 |
| [T-0501](T-0501-effect-runner-app-schema.md) | Effect F: apps/runner zod to Effect Schema | 2026-10-07 |
| [T-0499](T-0499-effect-agent-drivers.md) | Effect P4: agent-drivers on Effect + Schema | 2026-10-07 |
| [T-0503](T-0503-audit-agent-gateway-effect.md) | Audit: agents module Effect plan | 2026-10-07 |
| [T-0502](T-0502-effect-devtools-lead-schema.md) | Effect F: lead CLI schemas on Effect Schema | 2026-10-07 |
| [T-0511](T-0511-effect-tunnel-server-timers.md) | Effect F: tunnel server timers on Effect | 2026-10-07 |
| [T-0498](T-0498-httpapi-adapter-handles.md) | Effect F4+P1: HttpApi adapter under Hono, handles moved | 2026-10-07 |
| [T-0509](T-0509-effect-runner-client-lifecycle.md) | Effect F: RunnerClient lifecycle on Effect | 2026-10-07 |
| [T-0513](T-0513-agents-c1-completion-effect.md) | Agents C1: model call on Effect | 2026-10-07 |
| [T-0496](T-0496-db-effect-sql-spike.md) | Effect F3 spike: pins on effect/sql + migration plan | 2026-10-07 |
| [T-0515](T-0515-effect-http-contact-requests.md) | Effect C (HTTP): contact-requests on HttpApi | 2026-10-07 |
| [T-0512](T-0512-agents-g1-extract-contracts.md) | Agents G1: extract contracts and DB lookups | 2026-10-07 |
| [T-0510](T-0510-effect-sql-blocks-runtime.md) | Effect C1: blocks on effect/sql + runtime wiring | 2026-10-07 |
| [T-0516](T-0516-agents-g2-extract-budget.md) | Agents G2: extract the budget gate | 2026-10-07 |
| [T-0494](T-0494-protocol-effect-schema.md) | Effect B1: protocol on Effect Schema + every consumer | 2026-10-07 |
| [T-0514](T-0514-effect-http-blocks-contacts-directory.md) | Effect C (HTTP): blocks, contacts, directory on HttpApi | 2026-10-07 |
| [T-0517](T-0517-agents-g3-extract-memory.md) | Agents G3: extract memory context and compaction | 2026-10-07 |
| [T-0519](T-0519-effect-sql-contact-requests.md) | Effect C1: contact-requests on effect/sql | 2026-10-07 |
| [T-0508](T-0508-effect-web-drafts-tools-cache.md) | Effect D4: web drafts, tools, chatListCache on Effect Schema | 2026-10-07 |
| [T-0506](T-0506-effect-mobile-pins-api.md) | Effect E pilot: mobile pins-api on Effect Schema | 2026-10-07 |
| [T-0505](T-0505-effect-web-api-1.md) | Effect D1: web api.ts on Effect Schema, part 1 | 2026-10-07 |
| [T-0518](T-0518-effect-http-blocks-directory-tests.md) | Effect C (HTTP) follow-up: blocks/directory tests on the Effect path | 2026-10-07 |
| [T-0521](T-0521-audit-atom-react-plan.md) | Audit: zustand to atom-react plan | 2026-10-07 |
| [T-0504](T-0504-effect-server-config.md) | Effect F5: server config on Effect Schema | 2026-10-07 |
| [T-0523](T-0523-agents-g6-extract-listener.md) | Agents G6: extract the room listener | 2026-10-07 |
| [T-0520](T-0520-effect-http-chat-prefs-folders.md) | Effect C (HTTP): chat-prefs, chat-folders on HttpApi | 2026-10-07 |
| [T-0524](T-0524-effect-mobile-api-batch-1.md) | Effect E batch 1: mobile invites, chat-prefs, search, audit API | 2026-10-07 |
| [T-0522](T-0522-effect-sql-contacts-directory.md) | Effect C1: contacts, directory services on effect/sql | 2026-10-07 |
| [T-0526](T-0526-atom-react-web-w1.md) | atom-react W1: web stores on an atom registry | 2026-10-07 |
| [T-0507](T-0507-effect-web-api-2.md) | Effect D2: web api.ts on Effect Schema, part 2 | 2026-10-07 |
| [T-0527](T-0527-effect-mobile-api-batch-2.md) | Effect E batch 2: mobile roles, gifs, ai-memory, connections API | 2026-10-08 |
| [T-0529](T-0529-agents-g5a-live-wrappers.md) | Agents G5a: extract the live-session wrappers and postToChat | 2026-10-08 |
| [T-0525](T-0525-effect-http-pins-roles-audit.md) | Effect C (HTTP): pins, roles, audit on HttpApi | 2026-10-08 |
| [T-0530](T-0530-effect-web-api-3.md) | Effect D3: web api.ts part 3, zod leaves web | 2026-10-08 |
| [T-0531](T-0531-atom-react-mobile-m1.md) | atom-react M1: mobile stores on an atom registry | 2026-10-08 |
| [T-0534](T-0534-agents-g5b-session-registry.md) | Agents G5b: extract the session lifecycle | 2026-10-08 |
| [T-0528](T-0528-effect-sql-chat-prefs-folders.md) | Effect C1: chat-prefs, chat-folders services on effect/sql | 2026-10-08 |
| [T-0536](T-0536-effect-http-groups.md) | Effect C (HTTP): groups on HttpApi | 2026-10-08 |
| [T-0532](T-0532-effect-mobile-api-batch-3.md) | Effect E batch 3: zod leaves mobile | 2026-10-08 |
| [T-0535](T-0535-effect-sql-connections-machines-registry.md) | Effect C1: machine registry on effect/sql | 2026-10-08 |
| [T-0537](T-0537-effect-scripts-shots.md) | Effect: screenshot scripts on Effect Schema | 2026-10-08 |
| [T-0533](T-0533-effect-http-xmpp-chats-memory.md) | Effect C (HTTP): xmpp token, chats, AI memory on HttpApi | 2026-10-08 |
| [T-0540](T-0540-agents-g7-extract-dm-turn.md) | Agents G7: extract the DM turn | 2026-10-08 |
| [T-0538](T-0538-mobile-api-error-envelope.md) | Mobile polish: shared lenient error envelope, search abort race | 2026-10-08 |
| [T-0541](T-0541-effect-mobile-api-batch-4.md) | Effect E batch 4: mobile directory, chat-folders, profile, approvals API | 2026-10-08 |
| [T-0547](T-0547-effect-mobile-api-batch-5.md) | Effect E batch 5: mobile auth, machines, ais, invite-links API | 2026-10-08 |
| [T-0546](T-0546-agents-g8a-extract-group-turn.md) | Agents G8a: extract the group turn | 2026-10-08 |
| [T-0542](T-0542-effect-http-output-schema-check.md) | Effect C (HTTP) check: no stripped response fields | 2026-10-08 |
| [T-0539](T-0539-effect-http-topics.md) | Effect C (HTTP): topics on HttpApi | 2026-10-08 |
| [T-0550](T-0550-effect-mobile-api-batch-6.md) | Effect E batch 6: mobile contacts, stickers API | 2026-10-08 |
| [T-0551](T-0551-effect-mobile-api-batch-7.md) | Effect E batch 7: mobile topics, chat API | 2026-10-08 |
| [T-0548](T-0548-effect-sql-ai-usage-search-archives.md) | Effect C1: AI usage and search archives on effect/sql | 2026-10-08 |
| [T-0552](T-0552-effect-mobile-api-batch-8.md) | Effect E batch 8: mobile tools API (last client) | 2026-10-08 |
| [T-0544](T-0544-effect-http-integrations.md) | Effect C (HTTP): integration settings on HttpApi | 2026-10-08 |
| [T-0549](T-0549-agents-g8b-extract-group-ingest.md) | Agents G8b: extract the group ingest | 2026-10-08 |
| [T-0543](T-0543-effect-http-push.md) | Effect C (HTTP): push on HttpApi | 2026-10-08 |
| [T-0554](T-0554-effect-http-routines.md) | Effect C (HTTP): routines on HttpApi | 2026-10-08 |
| [T-0545](T-0545-effect-http-voice-transcription.md) | Effect C (HTTP): voice transcription on HttpApi | 2026-10-08 |
| [T-0553](T-0553-effect-http-approvals.md) | Effect C (HTTP): approvals on HttpApi | 2026-10-08 |
| [T-0556](T-0556-agents-g4-extract-tool-exec.md) | Agents G4: extract the tool executor | 2026-10-08 |
| [T-0562](T-0562-agents-g9-extract-lifecycle.md) | Agents G9: extract start/stop/reconcile | 2026-10-08 |
| [T-0558](T-0558-effect-http-search.md) | Effect C (HTTP): message search on HttpApi | 2026-10-08 |
| [T-0563](T-0563-effect-http-socket-address.md) | Effect C (HTTP) adapter: socket address and shared client IP | 2026-10-08 |
| [T-0555](T-0555-effect-http-ais.md) | Effect C (HTTP): AI management on HttpApi | 2026-10-08 |
| [T-0559](T-0559-effect-http-tools.md) | Effect C (HTTP): tools routes on HttpApi | 2026-10-08 |
| [T-0557](T-0557-effect-http-connections.md) | Effect C (HTTP): provider-key connections on HttpApi | 2026-10-08 |
| [T-0567](T-0567-effect-sql-gateway-db.md) | effect/sql: agents gateway db helpers | 2026-10-08 |
| [T-0564](T-0564-effect-schema-server-leaf-batch-1.md) | Effect Schema: server leaf batch 1 | 2026-10-08 |
| [T-0565](T-0565-effect-schema-gifs.md) | Effect Schema: gifs provider and Giphy parser | 2026-10-08 |
| [T-0568](T-0568-effect-sql-delegation.md) | effect/sql: AI delegation service | 2026-10-08 |
| [T-0566](T-0566-effect-http-invite-links.md) | Effect C (HTTP): group invite links on HttpApi | 2026-10-08 |
| [T-0569](T-0569-effect-schema-server-leaf-batch-2.md) | Effect Schema: server leaf batch 2 | 2026-10-08 |
| [T-0570](T-0570-effect-schema-server-batch-3.md) | Effect Schema: push config, subscriptions, AI templates, provider ids | 2026-10-08 |
| [T-0573](T-0573-effect-http-voice.md) | Effect C (HTTP): voice conversion, the binary pilot | 2026-10-08 |
| [T-0560](T-0560-effect-http-media.md) | Effect C (HTTP): media gallery on HttpApi | 2026-10-08 |
| [T-0574](T-0574-effect-sql-invites-provisioning.md) | effect/sql: sign-up invites and XMPP provisioning | 2026-10-08 |
| [T-0572](T-0572-effect-http-machines.md) | Effect C (HTTP): machines and runner pairing on HttpApi | 2026-10-08 |
| [T-0575](T-0575-stale-server-path-comments.md) | Comments: client comments point at live server api files | 2026-10-08 |
| [T-0561](T-0561-effect-http-auth-me-invites.md) | Effect C (HTTP): /me and account invites on HttpApi | 2026-10-08 |
| [T-0576](T-0576-effect-http-avatars.md) | Effect C (HTTP): avatars on HttpApi | 2026-10-08 |
| [T-0579](T-0579-server-review-followups.md) | Review follow-ups: comments and two pinning tests | 2026-10-08 |
| [T-0583](T-0583-effect-sql-gateway-inline-queries.md) | effect/sql: the last inline gateway reads and loadRoster | 2026-10-08 |
| [T-0577](T-0577-effect-http-backgrounds.md) | Effect C (HTTP): background images on HttpApi | 2026-10-08 |
| [T-0580](T-0580-effect-http-files.md) | Effect C (HTTP): file proxy with a streamed body | 2026-10-08 |
| [T-0584](T-0584-effect-audit-service.md) | Effect: audit service on effect/sql and Effect Schema | 2026-10-08 |
| [T-0585](T-0585-delete-ai-virtual-keys-spike.md) | Delete the unmounted /ai/virtual-keys spike | 2026-10-08 |
| [T-0578](T-0578-effect-http-setup.md) | Effect C (HTTP): first-run setup on HttpApi | 2026-10-08 |
| [T-0586](T-0586-effect-http-gifs.md) | Effect C (HTTP): GIF search, trending and media proxy | 2026-10-08 |
| [T-0587](T-0587-effect-sql-connections.md) | effect/sql: provider connection queries | 2026-10-08 |
| [T-0588](T-0588-effect-sql-routine-runs.md) | effect/sql: routine scheduler claim and runner queries | 2026-10-08 |
| [T-0593](T-0593-effect-sql-push-service-reads.md) | effect/sql: push service reads | 2026-10-08 |
| [T-0571](T-0571-audit-tool-args-schema.md) | Audit: tool-args layer zod to Effect Schema plan | 2026-10-08 |
| [T-0589](T-0589-effect-sql-startup-and-audit-nits.md) | effect/sql: startup sticker count, plus the audit issue-text nits | 2026-10-08 |
| [T-0582](T-0582-effect-http-stickers-json.md) | Effect C (HTTP): stickers part A, the JSON routes | 2026-10-08 |
| [T-0594](T-0594-tool-args-decode-seam.md) | Tool args T-A: registry and gateway decode seam | 2026-10-08 |
| [T-0591](T-0591-effect-sql-approvals-api-reads.md) | effect/sql: approvals API reads | 2026-10-08 |
| [T-0592](T-0592-effect-sql-routines-api-reads.md) | effect/sql: routines API reads | 2026-10-08 |
| [T-0581](T-0581-effect-http-drafts-sse.md) | Effect C (HTTP): AI draft stream (SSE) pilot | 2026-10-08 |
| [T-0595](T-0595-sandbox-schemas-effect.md) | Tool args T-F: sandbox schemas on Effect Schema | 2026-10-08 |
| [T-0596](T-0596-dead-zod-service-schemas.md) | Effect Schema: drop dead zod schemas in the pins, roles and topics services | 2026-10-08 |
| [T-0590](T-0590-effect-sql-api-inline-reads.md) | effect/sql: inline reads in the memory, media and /me APIs | 2026-10-08 |
| [T-0597](T-0597-demo-args-effect.md) | Tool args T-C: demo.echo args on Effect Schema | 2026-10-08 |
| [T-0598](T-0598-web-tools-args-effect.md) | Tool args T-D: web tool args on Effect Schema | 2026-10-08 |
| [T-0600](T-0600-xmpp-admin-client-schema.md) | Effect Schema: ejabberd admin client | 2026-10-08 |
| [T-0603](T-0603-agent-tool-args-effect.md) | Tool args T-B: model tool arguments on Effect Schema | 2026-10-08 |
| [T-0601](T-0601-litellm-client-schema.md) | Effect Schema: LiteLLM admin client | 2026-10-08 |
| [T-0602](T-0602-effect-http-stickers-binary.md) | Effect C (HTTP): stickers part B, upload and file | 2026-10-08 |
| [T-0604](T-0604-tool-routine-schemas-effect.md) | Tool args T-E: tool and routine schemas on Effect Schema | 2026-10-08 |
| [T-0599](T-0599-zod-small-trio.md) | Effect Schema: draft events, invite CLI and routine title | 2026-10-08 |
| [T-0605](T-0605-effect-sql-topic-access.md) | effect/sql: topic access reads | 2026-10-08 |
| [T-0609](T-0609-effect-sql-invite-links-service.md) | effect/sql: invite-link service and the join transaction | 2026-10-08 |
| [T-0606](T-0606-effect-sql-avatars-backgrounds.md) | effect/sql: avatar and background services | 2026-10-08 |
| [T-0610](T-0610-approvals-input-schema.md) | Effect Schema: approval input schema | 2026-10-08 |
| [T-0607](T-0607-effect-sql-push-store-machines.md) | effect/sql: push device store and machine service | 2026-10-08 |
| [T-0611](T-0611-effect-sql-group-join.md) | effect/sql: public group join transaction | 2026-10-08 |
| [T-0613](T-0613-effect-sql-handles-visibility.md) | effect/sql: handle store and group visibility switch | 2026-10-08 |
| [T-0616](T-0616-gate-light-tests.md) | Gate: run only the nearest tests; --full for the batched full run | 2026-10-08 |
| [T-0612](T-0612-registry-effect-only.md) | Tool args T-G: action registry on Effect Schema only | 2026-10-08 |
| [T-0615](T-0615-effect-sql-tools-service.md) | effect/sql: tool service, transactions included | 2026-10-08 |
| [T-0614](T-0614-effect-sql-json-keys.md) | effect/sql: keep jsonb keys as written | 2026-10-08 |
| [T-0619](T-0619-worker-no-daemons-gate-timeout.md) | Workers cannot start daemons or detached runs; gate step time limits | 2026-10-08 |
| [T-0617](T-0617-lead-watch-light.md) | lead watch: far fewer processes per refresh, honest tok/s | 2026-10-08 |
| [T-0608](T-0608-effect-sql-roles-service.md) | roles service on effect/sql | 2026-10-08 |
| [T-0620](T-0620-gate-folder-tests.md) | gate: run folder tests when no test shares the source name | 2026-10-08 |
| [T-0621](T-0621-effect-sql-approval-rules-reads.md) | approval rules statements on effect/sql | 2026-10-08 |
| [T-0622](T-0622-effect-sql-owner-lookups.md) | owner lookups on effect/sql | 2026-10-08 |
| [T-0624](T-0624-effect-sql-production-announcer.md) | production announcer reads on effect/sql | 2026-10-08 |
| [T-0623](T-0623-effect-sql-voice-settings.md) | voice transcription settings on effect/sql | 2026-10-08 |
| [T-0625](T-0625-effect-sql-files-lookup.md) | file proxy lookup on effect/sql | 2026-10-08 |
| [T-0627](T-0627-effect-sql-routines-service.md) | routines service on effect/sql | 2026-10-08 |
| [T-0628](T-0628-effect-sql-topic-rooms.md) | topic room reads on effect/sql | 2026-10-08 |
| [T-0629](T-0629-effect-sql-action-gateway.md) | action gateway statements on effect/sql | 2026-10-08 |
| [T-0630](T-0630-effect-sql-group-turn.md) | group turn reads on effect/sql | 2026-10-08 |
| [T-0632](T-0632-effect-sql-review-nits.md) | review nits: comments and row types | 2026-10-08 |
| [T-0631](T-0631-effect-sql-media-indexer.md) | media indexer on effect/sql | 2026-10-08 |
| [T-0633](T-0633-effect-sql-sticker-packs.md) | sticker packs and panel on effect/sql | 2026-10-08 |
| [T-0634](T-0634-effect-sql-memory-indexer.md) | AI memory indexer on effect/sql | 2026-10-08 |
| [T-0637](T-0637-retire-drafts-hono-wrapper.md) | retire the drafts Hono test wrapper | 2026-10-08 |
| [T-0635](T-0635-effect-sql-memory-store.md) | AI memory store on effect/sql | 2026-10-08 |
| [T-0636](T-0636-effect-sql-sticker-files.md) | sticker favorites, files and import on effect/sql | 2026-10-08 |
| [T-0638](T-0638-retire-files-hono-wrapper.md) | retire the files Hono test wrapper | 2026-10-08 |
| [T-0626](T-0626-audit-effect-last-mile.md) | audit: the Effect last mile and the bigint check | 2026-10-08 |
| [T-0639](T-0639-retire-connections-hono-wrapper.md) | retire the connections Hono test wrapper | 2026-10-08 |
| [T-0640](T-0640-retire-routines-hono-wrapper.md) | retire the routines Hono test wrapper | 2026-10-08 |
| [T-0644](T-0644-retire-audit-hono-wrapper.md) | retire the audit Hono test wrapper | 2026-10-08 |
| [T-0642](T-0642-retire-tools-hono-wrapper.md) | retire the tools Hono test wrapper | 2026-10-08 |
| [T-0643](T-0643-retire-machines-hono-wrapper.md) | retire the machines Hono test wrapper | 2026-10-08 |
| [T-0641](T-0641-retire-approvals-hono-wrapper.md) | retire the approvals Hono test wrapper | 2026-10-08 |
| [T-0645](T-0645-retire-push-hono-wrapper.md) | retire the push Hono test wrapper | 2026-10-08 |
| [T-0646](T-0646-delete-invite-links-routes.md) | delete invite-links/routes.ts | 2026-10-08 |
| [T-0647](T-0647-tools-api-adapters-effect-sql.md) | tools API and adapters reads on effect/sql | 2026-10-08 |
| [T-0649](T-0649-stale-routes-comments.md) | repoint comments that named the deleted routes.ts files | 2026-10-08 |
| [T-0648](T-0648-ais-update-persona-effect-sql.md) | ais update and persona transactions on effect/sql | 2026-10-08 |
| [T-0650](T-0650-handles-drop-zod.md) | handles without the legacy zod schema | 2026-10-08 |
| [T-0651](T-0651-contact-requests-drop-zod.md) | contact requests without the legacy zod schema | 2026-10-08 |
| [T-0654](T-0654-db-schema-drop-zod.md) | db/schema.ts enums become plain unions | 2026-10-08 |
| [T-0653](T-0653-stickers-drop-zod.md) | stickers API without the legacy zod schemas | 2026-10-08 |
| [T-0655](T-0655-gate-affected-typecheck.md) | gate typechecks affected packages with a shared Turbo cache | 2026-10-08 |
| [T-0657](T-0657-tsgo-spike.md) | tsgo spike: same result as tsc, about 2-4x faster | 2026-10-08 |
| [T-0652](T-0652-ais-delete-and-model-clear-effect-sql.md) | ais delete and model-clear transactions on effect/sql | 2026-10-08 |
| [T-0659](T-0659-server-drop-zod-dependency.md) | drop the zod dependency from the server | 2026-10-08 |
| [T-0658](T-0658-autopilot-sweeper.md) | autopilot sweeps leftover test and typecheck processes | 2026-10-08 |
| [T-0656](T-0656-gate-slots-and-nice.md) | gate slots, nice, Gradle stop, turbo globalDependencies | 2026-10-08 |
| [T-0661](T-0661-typecheck-with-tsgo.md) | TypeScript 7.0.2 (native tsc) everywhere; mobile keeps the TS 6 API for Expo via @typescript/typescript6 | 2026-10-08 |
| [T-0662](T-0662-sweeper-survivors-and-dry-run.md) | sweeper reports SIGKILL survivors with LEAD: SWEEP FAILED; dry runs no longer arm the sweep throttle | 2026-10-08 |
| [T-0660](T-0660-ais-ensure-change-model-effect-sql.md) | effect/sql: ais ensure/change model transactions, gateway lookups and connections decryptForGatewayUse (C3) | 2026-10-08 |
| [T-0663](T-0663-rules-revoke-effect.md) | effect/sql phase 1: revokeActiveRulesForAiInGroupEffect | 2026-10-08 |
| [T-0664](T-0664-tools-deletes-effect.md) | effect/sql phase 1: tools deletes as Effects | 2026-10-08 |
| [T-0665](T-0665-routines-delete-effect.md) | effect/sql phase 1: deleteRoutinesForAiInGroupEffect | 2026-10-08 |
| [T-0666](T-0666-room-memory-delete-effect.md) | effect/sql phase 1: deleteRoomMemoryEffect | 2026-10-08 |
| [T-0667](T-0667-setup-settings-effects.md) | effect/sql phase 1 (C4): setup settings helpers as Effects | 2026-10-08 |
| [T-0668](T-0668-telegram-token-effect-sql.md) | effect/sql (C4): Telegram token store, no drizzle transactions | 2026-10-08 |
| [T-0669](T-0669-voice-transcript-store-effect-sql.md) | effect/sql (C4): voice transcript store on sql.withTransaction | 2026-10-08 |
| [T-0674](T-0674-push-test-tables-effect-sql.md) | effect/sql: push test-table helper | 2026-10-08 |
| [T-0670](T-0670-remove-group-ai-effect-sql.md) | effect/sql phase 2: removeGroupAi on sql.withTransaction, 3 drizzle helpers deleted | 2026-10-08 |
| [T-0671](T-0671-ais-reads-effect-sql.md) | effect/sql: ais reads (listAis, listActiveAisForGateway, findOwnedAi) | 2026-10-08 |
| [T-0673](T-0673-voice-api-fast-path-effect-sql.md) | effect/sql: voice API fast-path read | 2026-10-08 |
| [T-0676](T-0676-topic-ais-effect-sql.md) | effect/sql: topic AIs (add, remove, dropped) | 2026-10-08 |
| [T-0677](T-0677-ais-stop-resume-assign-effect-sql.md) | effect/sql: ais stop, resume, assign, findUserName | 2026-10-08 |
| [T-0678](T-0678-group-ais-and-topic-helpers-effect-sql.md) | effect/sql: addGroupAi + group-topic helpers | 2026-10-08 |
| [T-0679](T-0679-delete-last-drizzle-deletes.md) | effect/sql cleanup: drizzle deleteToolsForAiInTopic and deleteRoomMemory deleted, stale comments fixed | 2026-10-08 |
| [T-0680](T-0680-topic-members-effect-sql.md) | effect/sql: topic members (list, add, remove) | 2026-10-08 |
| [T-0681](T-0681-ais-create-effect-sql.md) | effect/sql: createAi and compensateCreate; ais/service.ts drops drizzle | 2026-10-08 |
| [T-0675](T-0675-setup-transactions-effect-sql.md) | effect/sql phase 2 (C4): setup transactions on sql.withTransaction, SetupTransaction gone | 2026-10-08 |
| [T-0672](T-0672-approvals-decision-effect-sql.md) | effect/sql (C1): approval decision transaction and createRule | 2026-10-08 |
| [T-0682](T-0682-group-reads-effect-sql.md) | effect/sql: groups read helpers | 2026-10-08 |
| [T-0685](T-0685-delete-setup-routes.md) | A7: setup Hono wrapper deleted | 2026-10-08 |
| [T-0683](T-0683-topic-roles-and-helpers-effect-sql.md) | effect/sql: setTopicRoles and topic helpers | 2026-10-08 |
| [T-0686](T-0686-group-member-writes-effect-sql.md) | effect/sql: group member writes | 2026-10-08 |
| [T-0687](T-0687-create-patch-topic-effect-sql.md) | effect/sql: createTopic and patchTopic; topics/service.ts drops drizzle | 2026-10-08 |
| [T-0688](T-0688-create-patch-group-effect-sql.md) | effect/sql: createGroup and patchGroup; groups/service.ts drops drizzle | 2026-10-09 |
| [T-0684](T-0684-approvals-service-effect-sql.md) | effect/sql: rest of approvals/service.ts and the gateway approval transaction; approvals drops drizzle | 2026-10-09 |
| [T-0692](T-0692-retired-handle-create-test.md) | test: public create on another group retired handle; ais row type | 2026-10-09 |
| [T-0689](T-0689-plan-edge-flip.md) | plan: B1 edge flip, Hono edge to Effect HTTP | 2026-10-09 |
| [T-0693](T-0693-health-check-effect-sql.md) | effect/sql: /health probe; app.ts drops drizzle | 2026-10-09 |
| [T-0691](T-0691-plan-drizzle-removal.md) | plan: last drizzle removal | 2026-10-09 |
| [T-0695](T-0695-test-sql-helper.md) | H1: testSql helper; pins tests off drizzle | 2026-10-09 |
| [T-0690](T-0690-better-auth-sql-adapter.md) | D2 step 1: better-auth adapter over effect/sql | 2026-10-09 |
| [T-0699](T-0699-search-tests-off-drizzle.md) | tests off drizzle: search | 2026-10-09 |
| [T-0701](T-0701-auth-tests-off-drizzle.md) | tests off drizzle: auth | 2026-10-09 |
| [T-0702](T-0702-push-tests-off-drizzle.md) | tests off drizzle: push | 2026-10-09 |
| [T-0697](T-0697-chats-media-tests-off-drizzle.md) | tests off drizzle: chats and media | 2026-10-09 |
| [T-0698](T-0698-voice-integrations-tests-off-drizzle.md) | tests off drizzle: voice-transcription and integrations | 2026-10-09 |
| [T-0696](T-0696-platform-node-smoke.md) | B1.2: @effect/platform-node 4.0.2 and NodeHttpServer smoke test | 2026-10-09 |
| [T-0700](T-0700-blocks-handles-tests-off-drizzle.md) | tests off drizzle: blocks and handles | 2026-10-09 |
| [T-0703](T-0703-chat-prefs-tests-off-drizzle.md) | tests off drizzle: chat-prefs | 2026-10-09 |
| [T-0706](T-0706-audit-tests-off-drizzle.md) | tests off drizzle: audit | 2026-10-09 |
| [T-0694](T-0694-split-effect-http-core.md) | B1.1: effect/http split into http-core and the Hono bridge | 2026-10-09 |
| [T-0704](T-0704-contacts-tests-off-drizzle.md) | tests off drizzle: contacts and contact-requests | 2026-10-09 |
| [T-0705](T-0705-backgrounds-delegation-tests-off-drizzle.md) | tests off drizzle: backgrounds and agents/delegation | 2026-10-09 |
| [T-0710](T-0710-stickers-tests-off-drizzle.md) | tests off drizzle: stickers | 2026-10-09 |
| [T-0708](T-0708-xmpp-tests-off-drizzle.md) | tests off drizzle: xmpp | 2026-10-09 |
| [T-0707](T-0707-invite-links-tests-off-drizzle.md) | tests off drizzle: invite-links | 2026-10-09 |
| [T-0709](T-0709-small-folders-tests-off-drizzle.md) | tests off drizzle: avatars, chat-folders, connections, files | 2026-10-09 |
| [T-0711](T-0711-listener-score-tests-off-drizzle.md) | tests off drizzle: agents/listener | 2026-10-09 |
| [T-0715](T-0715-roles-tests-off-drizzle.md) | tests off drizzle: roles | 2026-10-09 |
| [T-0714](T-0714-topics-tests-off-drizzle.md) | tests off drizzle: topics | 2026-10-09 |
| [T-0716](T-0716-setup-tests-off-drizzle.md) | tests off drizzle: setup | 2026-10-09 |
| [T-0712](T-0712-agents-memory-tests-off-drizzle.md) | tests off drizzle: agents/memory | 2026-10-09 |
| [T-0713](T-0713-machines-tests-off-drizzle.md) | tests off drizzle: machines | 2026-10-09 |
| [T-0717](T-0717-app-mount-list.md) | B1.3a: one ordered module mount list in app.ts | 2026-10-09 |
| [T-0718](T-0718-routines-tests-off-drizzle.md) | tests off drizzle: routines | 2026-10-09 |
| [T-0729](T-0729-sql-adapter-test-off-drizzle.md) | tests off drizzle: auth/sql-adapter | 2026-10-09 |
| [T-0721](T-0721-actions-small-tests-off-drizzle.md) | tests off drizzle: actions (announce, production-announcer, demo) | 2026-10-09 |
| [T-0719](T-0719-groups-tests-off-drizzle.md) | tests off drizzle: groups | 2026-10-09 |
| [T-0720](T-0720-tools-tests-off-drizzle.md) | tests off drizzle: tools | 2026-10-09 |
| [T-0725](T-0725-ais-routes-tests-off-drizzle.md) | tests off drizzle: ais/routes | 2026-10-09 |
| [T-0722](T-0722-actions-flow-tests-off-drizzle.md) | tests off drizzle: actions/flow.e2e | 2026-10-09 |
| [T-0723](T-0723-actions-gateway-tests-off-drizzle.md) | tests off drizzle: actions/gateway | 2026-10-09 |
| [T-0724](T-0724-ais-small-tests-off-drizzle.md) | tests off drizzle: ais (integration, usage, service) | 2026-10-09 |
| [T-0726](T-0726-approvals-a-tests-off-drizzle.md) | tests off drizzle: approvals (sweepers, service) | 2026-10-09 |
| [T-0728](T-0728-agents-gateway-tests-off-drizzle.md) | tests off drizzle: agents/gateway | 2026-10-09 |
| [T-0727](T-0727-approvals-b-tests-off-drizzle.md) | tests off drizzle: approvals (routes, rules) | 2026-10-09 |
| [T-0730](T-0730-effect-edge-core.md) | B1.3b: the Effect edge replaces the Hono app in createApp | 2026-10-09 |
| [T-0731](T-0731-retire-hono-bridge.md) | B1.8: retire the Hono bridge | 2026-10-09 |
| [T-0732](T-0732-edge-nits-comment-sweep.md) | sweep: edge nits, errors.ts off hono, api.ts header comments | 2026-10-09 |
| [T-0733](T-0733-node-http-server-start.md) | B1.6: server starts on NodeHttpServer; @hono/node-server removed | 2026-10-09 |
| [T-0734](T-0734-web-dockerfile-ui-tokens.md) | fix the production web image: Dockerfile copies packages/ui-tokens | 2026-10-09 |
| [T-0735](T-0735-drop-serve-bindings-path.md) | cleanup after B1.6: drop the dead serve-bindings path | 2026-10-09 |
| [T-0736](T-0736-stale-serve-comments.md) | comments: stale serve() wording | 2026-10-09 |
| [T-0737](T-0737-sql-adapter-pg-timestamps.md) | D2 prep: auth adapter timestamps correct on real pg | 2026-10-09 |
| [T-0738](T-0738-auth-switch-to-sql-adapter.md) | D2 switch: login on the effect/sql adapter | 2026-10-09 |
| [T-0740](T-0740-git-proxy-effect.md) | A12: git proxy off Hono, Effect mount | 2026-10-09 |
| [T-0739](T-0739-server-image-pglite-dep.md) | HOTFIX: server image starts (pglite dependency) + CI image smoke | 2026-10-09 |
| [T-0742](T-0742-drop-hono-dep.md) | B1.9: drop the hono dependency | 2026-10-09 |
| [T-0743](T-0743-startup-sql-runtime-order.md) | HOTFIX 2: register the sql runtime before startup reads + CI smoke on real Postgres | 2026-10-09 |
| [T-0744](T-0744-coolify-background-dir.md) | Coolify compose: chat backgrounds on the avatar volume | 2026-10-09 |
| [T-0745](T-0745-approvals-audit-fail-test.md) | main CI green: approvals audit-failure test independent of query order | 2026-10-09 |
| [T-0746](T-0746-startup-label-voice-clock.md) | startup log names the right dir; voice timeout test on TestClock | 2026-10-09 |
| [T-0747](T-0747-s3-storage-audit.md) | AUDIT: S3 storage plan | 2026-10-09 |
| [T-0748](T-0748-backup-docs.md) | docs: real Coolify backup setup and restore runbook | 2026-10-09 |
| [T-0741](T-0741-migrator-switch.md) | D3: migrations on effect/sql | 2026-10-09 |
| [T-0750](T-0750-images-build-timeout.md) | images.yml: job timeouts | 2026-10-09 |
| [T-0749](T-0749-row-types-off-drizzle.md) | row types off drizzle (db/rows.ts) | 2026-10-09 |
| [T-0751](T-0751-drizzle-out.md) | drizzle out of the server | 2026-10-09 |
| [T-0755](T-0755-images-faster.md) | images faster: amd64 on main, gha cache, docs-safe tip | 2026-10-09 |
| [T-0754](T-0754-ci-faster.md) | CI faster: docs-only skip, parallel jobs, turbo cache | 2026-10-09 |
| [T-0756](T-0756-gate-faster.md) | gate faster: changed-file format, skip re-gate of passed tree | 2026-10-09 |
| [T-0752](T-0752-effect-map-pages.md) | self-updating Effect map on GitHub Pages | 2026-10-09 |
| [T-0753](T-0753-effect-100-plan.md) | the plan to a 100% Effect codebase | 2026-10-09 |
| [T-0759](T-0759-web-effect-runtime.md) | F1: web Effect runtime, ApiFailure, fromApi | 2026-10-09 |
| [T-0757](T-0757-watch-claude-tasks.md) | lead watch shows Claude-subagent tasks | 2026-10-09 |
| [T-0761](T-0761-server-edges-c.md) | S9: git proxy and connection probe on Effect | 2026-10-09 |
| [T-0760](T-0760-server-edges-a.md) | S7: voice engine, GIF media fetch, version on Effect | 2026-10-09 |
| [T-0762](T-0762-web-use-action.md) | F2: web hooks useAction and useQuery | 2026-10-09 |
| [T-0763](T-0763-xmpp-typed-errors.md) | X1: xmpp-core typed errors | 2026-10-09 |
| [T-0758](T-0758-effect-map-rule.md) | R1: the Effect map measures the 100% rule | 2026-10-09 |
| [T-0765](T-0765-url-helper.md) | R3: pure URL helpers in chat-core | 2026-10-09 |
| [T-0764](T-0764-server-edges-b.md) | S8: message search and draft throttle on Effect | 2026-10-09 |
| [T-0768](T-0768-effect-ratchet.md) | R6: Effect ratchet in the gate | 2026-10-09 |
| [T-0770](T-0770-server-markers.md) | R2: effect-plain markers on pure server files | 2026-10-09 |
| [T-0766](T-0766-web-lib-hooks.md) | WU1: web lib hooks on Effect | 2026-10-09 |
| [T-0769](T-0769-xmpp-timers-fibers.md) | X2a: xmpp-core timers as Effect fibers | 2026-10-09 |
| [T-0767](T-0767-web-approvals-pages.md) | WU6 + WU14: approvals and list pages on Effect | 2026-10-09 |
| [T-0774](T-0774-ci-no-cancel-main.md) | CI on main: a running check always finishes | 2026-10-09 |
| [T-0771](T-0771-sandbox-host-fetch.md) | S5a: sandbox host fetch on Effect | 2026-10-09 |
| [T-0773](T-0773-web-dialogs.md) | WU22: web dialogs on Effect | 2026-10-09 |
| [T-0772](T-0772-web-lib-helpers.md) | WU2: web lib helpers on Effect | 2026-10-09 |
| [T-0777](T-0777-xmpp-requests-deferred.md) | X2b: xmpp-core requests on Deferred | 2026-10-09 |
| [T-0778](T-0778-web-ai-panel.md) | WU11 + WU12: web AI components on Effect | 2026-10-09 |
| [T-0775](T-0775-web-settings-pages.md) | WU7: AI, connections, integrations pages on Effect | 2026-10-09 |
| [T-0776](T-0776-web-machines.md) | WU8: machines pages on Effect | 2026-10-09 |
| [T-0779](T-0779-web-tools-sections.md) | WU13: web tools sections on Effect | 2026-10-09 |
| [T-0780](T-0780-xmpp-request-tests.md) | xmpp-core request path tests | 2026-10-09 |
| [T-0783](T-0783-web-stickers-page.md) | WU10: StickersPage on Effect | 2026-10-09 |
| [T-0784](T-0784-web-gif-sticker-panels.md) | WU19: GifPanel and StickerPanel on Effect | 2026-10-09 |
| [T-0781](T-0781-web-group-panel.md) | WU15: GroupPanel on Effect | 2026-10-09 |
| [T-0786](T-0786-web-pack-editor-import.md) | WU20: PackEditor and Telegram import on Effect | 2026-10-09 |
| [T-0785](T-0785-web-channel-invites.md) | WU17: channel and invite components on Effect | 2026-10-09 |
| [T-0782](T-0782-web-topic-panel.md) | WU16: TopicPanel on Effect | 2026-10-09 |
| [T-0790](T-0790-web-list-bubble-app.md) | WU26: ChatList, MessageBubble, App on Effect | 2026-10-09 |
| [T-0788](T-0788-web-profile-explore.md) | WU24: profile, explore, visibility on Effect | 2026-10-09 |
| [T-0793](T-0793-web-voice-avatar.md) | WU21: VoiceMessage and AvatarUploader on Effect | 2026-10-09 |
| [T-0789](T-0789-web-strip-media-pins.md) | WU25: task strip, media panel, pins, search results on Effect | 2026-10-09 |
| [T-0787](T-0787-web-chat-header.md) | WU23: chat header, actions menu, background dialog on Effect | 2026-10-09 |
| [T-0795](T-0795-web-auth.md) | WU4: web auth on Effect | 2026-10-09 |
| [T-0791](T-0791-gateway-s1.md) | S1: AI gateway part 1 on Effect | 2026-10-09 |
| [T-0794](T-0794-web-lib-ports.md) | WU3: web lib ports (attachments, voice, push) on Effect | 2026-10-09 |
| [T-0798](T-0798-runner-tunnel-mux.md) | H1: runner-tunnel mux on Effect | 2026-10-09 |
| [T-0797](T-0797-push-sender-component.md) | S6: push component and sender on Effect | 2026-10-09 |
| [T-0796](T-0796-sandbox-tool-worker.md) | S5b: sandbox tool worker on Effect | 2026-10-09 |
| [T-0800](T-0800-mobile-effect-toolkit.md) | F3 + F4: mobile Effect toolkit | 2026-10-09 |
| [T-0801](T-0801-xmpp-core-effect.md) | X3-X7: xmpp-core Effect core | 2026-10-09 |
| [T-0802](T-0802-mobile-r4-parse-markers.md) | R4: mobile parses and markers | 2026-10-09 |
| [T-0803](T-0803-mobile-r5-mock-gate.md) | R5: mobile mock env in one place | 2026-10-09 |
| [T-0804](T-0804-server-auth-db.md) | S10: server auth and db client on Effect | 2026-10-09 |
| [T-0805](T-0805-small-sweep.md) | Small sweep: spike delete, markers, group events | 2026-10-09 |
| [T-0806](T-0806-runner-chain.md) | H2 + H3: runner-tunnel and apps/runner on Effect | 2026-10-09 |
| [T-0807](T-0807-web-onboarding.md) | WU5: web onboarding routes on Effect | 2026-10-09 |
| [T-0809](T-0809-web-composer.md) | WU18: Composer on Effect | 2026-10-09 |
| [T-0792](T-0792-gateway-s2.md) | S2: AI gateway part 2 on Effect | 2026-10-09 |
| [T-0799](T-0799-lead-batch.md) | lead batch: one combined check per wave | 2026-10-09 |
| [T-0808](T-0808-web-notifications.md) | WU9: NotificationsPage and GroupHandleRoute on Effect | 2026-10-09 |
| [T-0837](T-0837-gateway-s3-s4.md) | S3 + S4: AI gateway parts 3 and 4 on Effect | 2026-10-09 |
| [T-0811](T-0811-mobile-mu2.md) | MU2: mobile on Effect | 2026-10-09 |
| [T-0812](T-0812-mobile-mu3.md) | MU3: mobile on Effect | 2026-10-09 |
| [T-0813](T-0813-mobile-mu4.md) | MU4: mobile on Effect | 2026-10-09 |
| [T-0815](T-0815-mobile-mu6.md) | MU6: mobile on Effect | 2026-10-09 |
| [T-0816](T-0816-mobile-mu7.md) | MU7: mobile on Effect | 2026-10-09 |
| [T-0817](T-0817-mobile-mu8.md) | MU8: mobile on Effect | 2026-10-09 |
| [T-0818](T-0818-mobile-mu9.md) | MU9: mobile on Effect | 2026-10-09 |
| [T-0820](T-0820-mobile-mu11.md) | MU11: mobile on Effect | 2026-10-09 |
| [T-0821](T-0821-mobile-mu12.md) | MU12: mobile on Effect | 2026-10-09 |
| [T-0822](T-0822-mobile-mu13.md) | MU13: mobile on Effect | 2026-10-09 |
| [T-0823](T-0823-mobile-mu14.md) | MU14: mobile on Effect | 2026-10-09 |
| [T-0825](T-0825-mobile-mu16.md) | MU16: mobile on Effect | 2026-10-09 |
| [T-0826](T-0826-mobile-mu17.md) | MU17: mobile on Effect | 2026-10-09 |
| [T-0827](T-0827-mobile-mu18.md) | MU18: mobile on Effect | 2026-10-09 |
| [T-0828](T-0828-mobile-mu19.md) | MU19: mobile on Effect | 2026-10-09 |
| [T-0829](T-0829-mobile-mu20.md) | MU20: mobile on Effect | 2026-10-09 |
| [T-0830](T-0830-mobile-mu21.md) | MU21: mobile on Effect | 2026-10-09 |
| [T-0831](T-0831-mobile-mu22.md) | MU22: mobile on Effect | 2026-10-09 |
| [T-0832](T-0832-mobile-mu23.md) | MU23: mobile on Effect | 2026-10-09 |
| [T-0833](T-0833-mobile-mu24.md) | MU24: mobile on Effect | 2026-10-09 |
| [T-0834](T-0834-mobile-mu25.md) | MU25: mobile on Effect | 2026-10-09 |
| [T-0814](T-0814-mobile-mu5.md) | MU5: mobile on Effect | 2026-10-09 |
| [T-0810](T-0810-mobile-mu1.md) | MU1: mobile on Effect | 2026-10-09 |
| [T-0824](T-0824-mobile-mu15.md) | MU15: mobile on Effect | 2026-10-09 |
| [T-0819](T-0819-mobile-mu10.md) | MU10: mobile on Effect | 2026-10-09 |
| [T-0836](T-0836-mobile-store.md) | MS1-MS10: mobile chat store on Effect | 2026-10-09 |
| [T-0840](T-0840-batch-lint.md) | lead batch check runs lint | 2026-10-09 |
| [T-0835](T-0835-web-store.md) | WS1-WS11: web chat store on Effect | 2026-10-09 |
| [T-0839](T-0839-mobile-search-list.md) | mobile message-search-list on Effect | 2026-10-09 |
| [T-0841](T-0841-people-search-stale-card.md) | mobile people-search card shows the refreshed relation | 2026-10-09 |
| [T-0838](T-0838-server-entry.md) | S12 + S13: server entry on Effect | 2026-10-09 |
| [T-0842](T-0842-web-test-races.md) | web tests wait for the visible state | 2026-10-09 |
| [T-0843](T-0843-mobile-ai-chats.md) | Mobile marks AI DMs as AI (isAi from /api/chats, as web does) | 2026-10-10 |
| [T-0844](T-0844-shared-topic-order-money.md) | One topic order and one money format in chat-core, used by web and mobile; mobile search… | 2026-10-10 |
| [T-0845](T-0845-web-store-selectors.md) | Web store selector hook; MessageBubble, ChatListItem, MessageList and ChatList subscribe… | 2026-10-10 |
| [T-0846](T-0846-mobile-message-list-perf.md) | Mobile message list: memoised bubbles, AI draft outside the list entries, then real… | 2026-10-10 |
| [T-0847](T-0847-web-mock-out-of-bundle.md) | Web: the mock backend and mock store leave the production bundle (build-time gate plus… | 2026-10-10 |
| [T-0848](T-0848-mobile-mock-out-of-bundle.md) | Mobile: the mock store, mock APIs and dev screens leave the release bundle | 2026-10-10 |
| [T-0849](T-0849-membership-indexes.md) | One migration: indexes for lookups by user_id / ai_id on membership tables,… | 2026-10-10 |
| [T-0850](T-0850-tools-list-n-plus-1.md) | Tools list endpoints: batch the per-tool queries (no N+1), select only the columns the… | 2026-10-10 |
| [T-0851](T-0851-topic-views-n-plus-1.md) | Topic list: batch toTopicViews (4 queries per topic today) into a few grouped queries | 2026-10-10 |
| [T-0852](T-0852-approvals-list-n-plus-1.md) | Approvals list: preload what canDecide needs instead of 3-6 queries per row | 2026-10-10 |
| [T-0853](T-0853-stickers-prefs-n-plus-1.md) | Sticker discover page and chat-prefs room check: batch the per-row queries | 2026-10-10 |
| [T-0854](T-0854-mobile-fonts.md) | Mobile bundles only the 5 font faces it loads (not 36) and drops the unused Material… | 2026-10-10 |
| [T-0855](T-0855-drizzle-leftovers.md) | Remove the unused drizzle migration snapshots (apps/server/drizzle/meta, 3.7 MB) and… | 2026-10-10 |
| [T-0856](T-0856-delete-agent-drivers-git-proxy.md) | Delete packages/agent-drivers and the unmounted git proxy (apps/server/src/git) — Julio… | 2026-10-10 |
| [T-0857](T-0857-xmpp-events-streams.md) | xmpp-core: delete the unused events.* Streams (10 unbounded PubSubs per connection) —… | 2026-10-10 |
| [T-0858](T-0858-session-cookie-cache.md) | better-auth session cookie cache, 5 minutes — Julio approved | 2026-10-10 |
| [T-0859](T-0859-test-db-snapshot-once.md) | Server tests: build the migrated PGlite snapshot once per run (globalSetup), not once per… | 2026-10-10 |
| [T-0860](T-0860-ci-shard-server-tests.md) | CI: run the server tests in 3 shards next to a job for the other packages | 2026-10-10 |
| [T-0861](T-0861-server-bundle-image.md) | Server image: bundled build instead of tsx, PGlite out of production deps, Dockerfile… | 2026-10-10 |
| [T-0862](T-0862-web-lazy-routes.md) | Web code splitting: lazy settings, setup, welcome and login routes | 2026-10-10 |
| [T-0888](T-0888-composer-voice-test-deterministic.md) | Composer.voice test deterministic: fake setTimeout around the 400 ms hold, 20/20 under load | 2026-10-10 |
| [T-0863](T-0863-server-http-helpers.md) | Server HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi), blocks/roles/routines converted, routes.expected per module | 2026-10-10 |
| [T-0865](T-0865-dead-files-exports.md) | Dead files and 58 unreferenced declarations removed (-357 lines) | 2026-10-10 |
| [T-0889](T-0889-scope-glob-zero-folders.md) | Gate scope check: **/ matches zero folders | 2026-10-10 |
| [T-0864](T-0864-api-contract-pilot.md) | packages/api-contract pilot: pins group shared by server, web, mobile with derived clients | 2026-10-10 |
| [T-0890](T-0890-prettier-gate-test-batch-check.md) | Main CI green: prettier on gate.test.ts; lead batch check runs prettier --check | 2026-10-10 |
| [T-0866](T-0866-sweep-tools-chats.md) | Server sweep: tools, chats, contacts, drafts, xmpp onto the shared HTTP helpers (runSql, SchemaErrors, makeRat | 2026-10-10 |
| [T-0867](T-0867-sweep-media-files.md) | Server sweep: stickers, avatars, backgrounds, files onto the shared HTTP helpers (runSql, SchemaErrors, makeRa | 2026-10-10 |
| [T-0868](T-0868-sweep-approvals-routines.md) | Server sweep: approvals, audit, routines, directory onto the shared HTTP helpers (runSql, SchemaErrors, makeRa | 2026-10-10 |
| [T-0869](T-0869-sweep-groups.md) | Server sweep: groups, invite-links, chat-folders, chat-prefs, roles onto the shared HTTP helpers (runSql, Sche | 2026-10-10 |
| [T-0870](T-0870-sweep-ais.md) | Server sweep: ais, agents/memory, connections, voice, search onto the shared HTTP helpers (runSql, SchemaError | 2026-10-10 |
| [T-0871](T-0871-sweep-push-topics.md) | Server sweep: push, topics, handles, media onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit,  | 2026-10-10 |
| [T-0872](T-0872-sweep-machines-setup.md) | Server sweep: machines, integrations, setup onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, | 2026-10-10 |
| [T-0873](T-0873-sweep-voice-auth.md) | Server sweep: voice-transcription, gifs, auth, contact-requests onto the shared HTTP helpers (runSql, SchemaEr | 2026-10-10 |
| [T-0874](T-0874-protocol-jid-handles.md) | JID helpers and handle rules in @zilar/protocol, used by web, mobile, chat-core and the non-api server files | 2026-10-10 |
| [T-0875](T-0875-chat-core-format-media.md) | chat-core gets the duplicated format, attachment, media-trust, sticker-size and smooth-text helpers; web and m | 2026-10-10 |
| [T-0876](T-0876-chat-core-prefs-routines-ai.md) | chat-core gets chat prefs, routines formatting and the AI form logic (limits, templates, models, errors, activ | 2026-10-10 |
| [T-0877](T-0877-chat-core-store-ledger.md) | chat-core gets the store message-ledger helpers both stores copy: forwarding payloads, reaction/mention equali | 2026-10-10 |
| [T-0878](T-0878-client-core-react-glue.md) | packages/client-core: the shared React + Effect glue (useAction, useQuery, atomStore, api-effect) used by web  | 2026-10-10 |
| [T-0879](T-0879-web-selectors-rest.md) | Web: ChatView and the remaining useChatStore() call sites use useChatSelector; GroupHeaderRow memoised | 2026-10-10 |
| [T-0880](T-0880-web-lazy-markdown.md) | Web: lazy-load the markdown stack (about 120 KB min) behind a plain-text fallback | 2026-10-10 |
| [T-0881](T-0881-mobile-dark-only.md) | Mobile is dark-only: remove the dead light-theme branches (155 [scheme] lookups, 135 useColorScheme calls) | 2026-10-10 |
| [T-0882](T-0882-mock-imports-rest.md) | The last static mock imports leave the production bundles (mobile chat screen, chats tab, composer; web Sticke | 2026-10-10 |
| [T-0883](T-0883-web-panels-dedupe.md) | Web panels: one roleLabel/GroupAiRow/pick-row and one set of shared tagged errors instead of copies in GroupPa | 2026-10-10 |
| [T-0884](T-0884-fake-xmpp-core-mobile-fakes.md) | One createFakeXmppCore() in xmpp-core/testing; mobile store tests use it and shared fakeApi/fakeAppState helpe | 2026-10-10 |
| [T-0885](T-0885-web-store-fakes.md) | Web store tests share one fakeApi/fakeXmpp harness (159-line copies today) | 2026-10-10 |
| [T-0886](T-0886-gateway-test-split.md) | Split apps/server/src/agents/gateway.test.ts (7,242 lines, 100 s) into feature files around one extracted harn | 2026-10-10 |
| [T-0887](T-0887-slow-loop-tests.md) | Server: cut the loop-driven slow tests (600 real requests for a 429, 200 sticker uploads) without weakening th | 2026-10-10 |
| [T-0891](T-0891-contract-prep-chains.md) | api-contract prep: one Session/CurrentUser, per-chain blocks, per-group smoke files | 2026-10-10 |
| [T-0892](T-0892-contract-chain-a-groups.md) | api-contract chain A: move the groups, invite-links, roles, chat-folders, chat-prefs, topics groups into packa | 2026-10-10 |
| [T-0894](T-0894-contract-chain-c-people.md) | api-contract chain C: move the contacts, contact-requests, directory, blocks, search, chats, drafts, handles g | 2026-10-10 |
| [T-0893](T-0893-contract-chain-b-ais.md) | api-contract chain B: move the ais, agents/memory, connections, approvals, audit, tools, routines groups into  | 2026-10-10 |
| [T-0895](T-0895-contract-chain-d-media.md) | api-contract chain D: move the stickers, gifs, machines, integrations, push, backgrounds, voice, media, auth g | 2026-10-10 |
| [T-0896](T-0896-store-core-design.md) | Store core design: docs/STORE_CORE_PLAN.md, 10-task split, lead decisions Q1-Q4 | 2026-10-10 |
| [T-0900](T-0900-deps-catalog.md) | Dependency alignment: effect ^4.0.2 everywhere and a pnpm catalog for the repeated packages (simplify plan 6.5 | 2026-10-10 |
| [T-0899](T-0899-test-wait-helpers.md) | One flush/waitFor/jsonResponse per package, real sleeps replaced with fake timers, and a guard against one-tic | 2026-10-10 |
| [T-0898](T-0898-source-pinning-tests.md) | Replace the brittle mobile source-pinning tests with render tests or a lint rule (simplify plan 5.6, F-F7) | 2026-10-10 |
| [T-0897](T-0897-contract-tidy.md) | api-contract tidy: one middleware file and one schema-error layer, the chain lists merged, hand-decoded payloa | 2026-10-10 |
| [T-0901](T-0901-mobile-sign-out-state.md) | Sign-out clears the user's chat state: no chats, contacts, messages or profile of the previous user survive in | 2026-10-10 |
| [T-0902](T-0902-store-core-t1-rows.md) | Store core T1 (pilot): @zilar/client-core/store subpath and the pure row helpers moved from both stores | 2026-10-10 |
| [T-0903](T-0903-store-core-t2-lifetime.md) | Store core T2: the lifetime (store and session Scopes, keyed fibers) in packages/client-core, web runtime on i | 2026-10-10 |
| [T-0904](T-0904-store-core-t3-ledger.md) | Store core T3: the message ledger (ids, aliases, edits, reactions, mentions) in packages/client-core, the web  | 2026-10-10 |
| [T-0905](T-0905-store-core-t4-mobile-lifetime.md) | Store core T4: the mobile store on the core lifetime (makeLife and makeRunners as adapters, keyed fibers for t | 2026-10-10 |
| [T-0906](T-0906-store-core-t5-mobile-ledger.md) | Store core T5: the mobile store on the core ledger, tests first, with the group echo race fix (linkAckToServer | 2026-10-10 |
| [T-0910](T-0910-contract-lenient-rows.md) | Lenient row schemas in the api-contract, so the mobile gifs, media and stickers clients derive from it and sti | 2026-10-10 |
| [T-0908](T-0908-one-run-sql.md) | One runSql: delete the 21 module-local copies of runSql and import the shared one from apps/server/src/effect/ | 2026-10-10 |
| [T-0909](T-0909-pglite-dev-only.md) | PGlite out of the production install: lazy or type-only imports, so @electric-sql/pglite and @effect/sql-pglit | 2026-10-10 |
| [T-0907](T-0907-store-core-t6-incoming-history.md) | Store core T6: incoming events, message actions, reads and history in packages/client-core, the web store on t | 2026-10-10 |
| [T-0911](T-0911-test-sleeps-followup.md) | Test follow-up from T-0899: the remaining real sleeps and 10 ms settles in web and mobile tests use fake timer | 2026-10-10 |
| [T-0912](T-0912-store-core-t6b-history.md) | Store core T6b: web history (first page, older pages, open at message) in packages/client-core, tests first, w | 2026-10-10 |
| [T-0914](T-0914-store-core-t7a-mobile-incoming.md) | Store core T7a: the mobile store on the core incoming events, message actions and reads (history stays for T7b | 2026-10-10 |
| [T-0916](T-0916-core-echo-refresh.md) | Core echo re-applies pending edits and reactions: an edit made between the ack and the echo keeps its new text | 2026-10-10 |
| [T-0915](T-0915-store-core-t8-lifecycle.md) | Store core T8: polling, drafts and lifecycle (boot, connect with retry, resume, stop/reset) in packages/client | 2026-10-10 |
| [T-0913](T-0913-load-flakes.md) | Load flakes: four timing tests that fail combined checks under high load become deterministic (fake timers or  | 2026-10-10 |
| [T-0917](T-0917-store-core-t7b-mobile-history.md) | Store core T7b: the mobile store on the core history (first page, older pages, open at message), with the load | 2026-10-10 |
| [T-0919](T-0919-store-core-pins-prefs-folders.md) | Store core phase 2: pins, chat prefs and folders in packages/client-core, both stores on them (one set of pin  | 2026-10-10 |
| [T-0920](T-0920-store-core-group-detail.md) | Store core phase 2a: one GroupDetail type, a per-group detail cache and applyTopicRow in packages/client-core, | 2026-10-10 |
| [T-0921](T-0921-store-core-group-actions.md) | Store core phase 2b: the group, topic and channel actions (create, patch, members, AIs, roles, leave, settings | 2026-10-10 |
| [T-0923](T-0923-store-core-group-actions-2.md) | Store core phase 2c: the channel and group actions (create, leave, roles, settings, join, AIs, invite, archive | 2026-10-10 |
| [T-0918](T-0918-store-core-t9-mobile-lifecycle.md) | Store core T9: the mobile store on the core polling and lifecycle (boot, connect retry with backoff Q3, resume | 2026-10-10 |
| [T-0924](T-0924-one-chat-entry.md) | Store core phase 2d: one ChatEntry schema in packages/api-contract and one summariesFor in packages/client-cor | 2026-10-10 |
| [T-0926](T-0926-mobile-native-mocks.md) | Mobile tests: the three most-copied native mocks (reanimated, safe-area insets, ui/text) move to one vitest se | 2026-10-10 |
| [T-0922](T-0922-store-core-t10-send.md) | Store core T10: the send pipeline (text, sticker, attachment, voice, forward; failure, deadline, retry) in pac | 2026-10-10 |
| [T-0925](T-0925-server-test-seeds.md) | Server tests: one shared seed module (seedUser, seedAi, seedGroup with overrides) in apps/server/src/test-supp | 2026-10-10 |
| [T-0934](T-0934-cut-package-tests.md) | Cut the package tests to the crucial ones (message pipeline, tunnel auth, the lead's merge and gate scope), pa | 2026-10-10 |
| [T-0932](T-0932-cut-web-tests.md) | Cut the web tests: delete every UI test and every non-crucial test; keep the auth provider and the message-pip | 2026-10-10 |
| [T-0933](T-0933-cut-mobile-tests.md) | Cut the mobile tests: delete every UI test and every non-crucial test; keep auth/session and the message-pipel | 2026-10-10 |
| [T-0931](T-0931-cut-server-tests.md) | Cut the server tests to the crucial ones (auth and keys, permissions and money): keep a fixed list, delete eve | 2026-10-10 |
| [T-0930](T-0930-test-memory-cap.md) | Test memory: cap the web vmThreads pool (memory limit, worker count) and the lead's combined check, measured p | 2026-10-10 |
| [T-0929](T-0929-store-core-t10b-mobile-send.md) | Store core T10b: the mobile store on the core send pipeline (R6 deadline, R18 sticker retry, R20 banner), mobi | 2026-10-10 |
| [T-0935](T-0935-mock-plan-audit.md) | Audit: mock mode on one shared fake backend (docs/audit/mock-plan.md) | 2026-10-10 |
| [T-0937](T-0937-mock-backend-scaffold.md) | Mock backend A: scaffold @zilar/mock-backend with one JID-keyed seed (people, chats, messages), in-memory stat | 2026-10-10 |
| [T-0940](T-0940-mock-backend-ais.md) | Mock backend E1: the AI routes (ais, ai-memory, connections, machines) in @zilar/mock-backend (docs/audit/mock | 2026-10-10 |
| [T-0938](T-0938-code-map-page.md) | Replace the Effect map on GitHub Pages with a Code map: lines, file sizes against the 400-line limit, files ad | 2026-10-10 |
| [T-0941](T-0941-mock-backend-approvals-tools.md) | Mock backend E2: approvals, approval rules, audit, tools and routines routes in @zilar/mock-backend (docs/audi | 2026-10-10 |
| [T-0939](T-0939-mock-backend-messages-search.md) | Mock backend B: the full message seed and the /search route in @zilar/mock-backend (docs/audit/mock-plan.md ta | 2026-10-10 |
| [T-0942](T-0942-mock-backend-domains.md) | Mock backend: one module per domain (seed, state and routes together) and alphabetical registries, so parallel | 2026-10-10 |
| [T-0945](T-0945-mock-backend-xmpp.md) | Mock backend F2: a fake XMPP core on createFakeXmppCore that serves the seed's history, echoes sends, and emit | 2026-10-10 |
| [T-0943](T-0943-mock-backend-groups-topics.md) | Mock backend D1: groups, members, topics and roles domains in @zilar/mock-backend, plus topic rows on the grou | 2026-10-10 |
| [T-0944](T-0944-mock-backend-channels-invites.md) | Mock backend D2: invite links, join, directory and public-group lookup domains in @zilar/mock-backend (docs/au | 2026-10-10 |
| [T-0946](T-0946-web-mock-cutover.md) | Mock cutover G (web): mock mode runs the real web store on @zilar/mock-backend | 2026-10-10 |
| [T-0947](T-0947-delete-web-mock-store.md) | Mock sweep O: delete the web mock store (apps/web/src/store/mockStore.ts, 1,294 lines), its production stub an | 2026-10-10 |
| [T-0948](T-0948-mock-backend-polish.md) | Mock backend polish: real-format AI JIDs (ai-<id>@zilar.test) so AI markdown renders, read markers clear unrea | 2026-10-10 |
| [T-0950](T-0950-unread-clears-on-refocus.md) | Unread clears on refocus: when the app or tab comes back to the foreground with a chat open, that chat is mark | 2026-10-10 |
| [T-0936](T-0936-size-dup-audit.md) | Audit (no code): a 400-line file limit and duplicated code: measure clones, plan a split for every source file | 2026-10-10 |
| [T-0952](T-0952-split-xmpp-stanza.md) | Size split T17: packages/xmpp-core/src/stanza.ts (1,078 lines) into stanza/{reactions,build-outgoing,parse-con | 2026-10-10 |
| [T-0957](T-0957-split-server-topics-service.md) | Size split T14: apps/server/src/topics/service.ts (1,127 lines) into topics/{schemas,members,roles,ais,queries | 2026-10-10 |
| [T-0951](T-0951-split-xmpp-core-effect.md) | Size split T9: packages/xmpp-core/src/core-effect.ts (1,206 lines) into core-effect/{config,lifecycle,presence | 2026-10-10 |
| [T-0956](T-0956-split-server-ais-service.md) | Size split T7: apps/server/src/ais/service.ts (1,390 lines) into ais/{queries,provisioning,persona,status}.ts, | 2026-10-10 |
| [T-0953](T-0953-split-store-ledger.md) | Size split T11+T12: packages/client-core/src/store/ledger.ts (1,176 lines) into ledger-{types,signatures,ids,e | 2026-10-10 |
| [T-0949](T-0949-mobile-mock-cutover-store.md) | Mock cutover H1 (mobile): mock mode runs the real mobile store on @zilar/mock-backend (fake HTTP through fetch | 2026-10-10 |
| [T-0955](T-0955-split-server-tools-service.md) | Size split T10: apps/server/src/tools/service.ts (1,200 lines) into tools/{queries,mutations,hosts,runner}.ts, | 2026-10-10 |
| [T-0954](T-0954-split-web-composer.md) | Size split T13: apps/web/src/components/Composer.tsx (1,145 lines) into composer/{useVoiceRecorder,useComposer | 2026-10-10 |
| [T-0958](T-0958-split-server-stickers-service.md) | Size split T8: apps/server/src/stickers/service.ts (1,388 lines) into stickers/{schemas,packs,panel,favorites, | 2026-10-10 |
| [T-0964](T-0964-split-server-approvals-service.md) | Size split T19: apps/server/src/approvals/service.ts (1,030 lines) into approvals/{schemas,queries,access}.ts, | 2026-10-10 |
| [T-0959](T-0959-split-web-api.md) | Size split T1+T2: apps/web/src/lib/api.ts (1,792 lines) into lib/api/{http,chats,groups,topics,media,settings, | 2026-10-10 |
| [T-0961](T-0961-split-server-groups-service.md) | Size split T5+T6: apps/server/src/groups/service.ts (1,583 lines) into groups/{schemas,members,ais,queries}.ts | 2026-10-10 |
| [T-0960](T-0960-split-server-agents-reply.md) | Size split T3+T4: apps/server/src/agents/reply.ts (1,585 lines) into agents/{tool-loop,dm-turn,group-turn}.ts, | 2026-10-10 |
| [T-0965](T-0965-split-lead-policy.md) | Size split T16: packages/devtools/src/lead/policy.ts (1,111 lines) into lead/policy/{types,shell-parse,rm,curl | 2026-10-10 |
| [T-0963](T-0963-split-server-actions-gateway.md) | Size split T18: apps/server/src/actions/gateway.ts (1,036 lines) into actions/{decisions,recovery,queries,supp | 2026-10-10 |
| [T-0967](T-0967-split-web-group-panel.md) | Size split T20: apps/web/src/components/GroupPanel.tsx (995 lines) into components/panels/{groupPanelOps,Group | 2026-10-10 |
| [T-0968](T-0968-web-mock-mode-sticky.md) | Web mock mode stays on for the tab: decide once at page load and remember ?mock=1 in sessionStorage (dev build | 2026-10-10 |
| [T-0966](T-0966-split-server-tools-adapters.md) | Size split T21: apps/server/src/tools/adapters.ts (944 lines) into tools/{tool-adapters,tool-arg-schemas,routi | 2026-10-10 |
| [T-0962](T-0962-split-mobile-chat-screen.md) | Size split T15: apps/mobile/src/app/chat/[id].tsx (1,118 lines) into components/chat/{use-chat-screen,chat-hea | 2026-10-10 |
| [T-0969](T-0969-split-store-send.md) | Size split T33: packages/client-core/src/store/send.ts (883 lines) into store/send/{context,pipeline,text,voic | 2026-10-10 |
| [T-0972](T-0972-ai-reply-crucial-tests.md) | Crucial tests for the AI reply pipeline: failure-to-reply mapping, secret redaction, and the tool-loop call ca | 2026-10-10 |
| [T-0970](T-0970-split-lead-batch.md) | Size split T22: packages/devtools/src/lead/batch.ts (913 lines) into lead/batch/{types,text,wave,parsers,check | 2026-10-10 |
| [T-0971](T-0971-split-web-message-bubble.md) | Size split T25: apps/web/src/components/MessageBubble.tsx (846 lines) into components/message/{SendFailure,Mes | 2026-10-10 |
| [T-0973](T-0973-split-web-ai-panel.md) | Size split T23: apps/web/src/components/ais/AiPanel.tsx (870 lines) into ais/{aiPanelOps,AiUsageSection,AiPict | 2026-10-10 |
| [T-0975](T-0975-split-lead-watch.md) | Size split T27: packages/devtools/src/lead/watch.ts (818 lines) into lead/watch/{live-step,changed-files,forma | 2026-10-10 |
| [T-0976](T-0976-split-server-tools-api.md) | Size split T29: apps/server/src/tools/api.ts (799 lines) into tools/{routes,wire,access}.ts, the old path a ba | 2026-10-10 |
| [T-0978](T-0978-split-server-roles-service.md) | Size split T36: apps/server/src/roles/service.ts (763 lines) into roles/{schemas,access,queries,sync}.ts, the  | 2026-10-10 |
| [T-0977](T-0977-split-web-topic-panel.md) | Size split T32: apps/web/src/components/TopicPanel.tsx (780 lines) into components/panels/{topicPanelOps,Topic | 2026-10-10 |
| [T-0974](T-0974-split-mobile-group-screen.md) | Size split T26: apps/mobile/src/app/group/[id].tsx (835 lines) into components/chat/{group-header,group-topic- | 2026-10-10 |
| [T-0979](T-0979-split-mobile-tool-detail-sheet.md) | Size split T28: apps/mobile/src/components/ais/tool-detail-sheet.tsx (808 lines) into ais/{tool-run-blocks,too | 2026-10-10 |
| [T-0980](T-0980-split-mobile-sticker-pack.md) | Size split T24: apps/mobile/src/app/settings/sticker-pack.tsx (859 lines) into components/stickers/{use-pack-e | 2026-10-10 |
| [T-0983](T-0983-split-server-contact-requests.md) | Size split T40: apps/server/src/contact-requests/service.ts (730 lines) into contact-requests/{queries,reads,e | 2026-10-10 |
| [T-0984](T-0984-split-server-routines-service.md) | Size split T47: apps/server/src/routines/service.ts (657 lines) into routines/{schemas,queries,support}.ts, th | 2026-10-10 |
| [T-0985](T-0985-split-lead-watch-app.md) | Size split T39: packages/devtools/src/lead/watch-app.tsx (735 lines) into lead/watch-app/{segments,lines,chrom | 2026-10-10 |
| [T-0982](T-0982-split-web-stickers-page.md) | Size split T35: apps/web/src/routes/StickersPage.tsx (765 lines) into components/sticker/{pageActions,PackThum | 2026-10-10 |
| [T-0981](T-0981-split-web-pack-editor.md) | Size split T31: apps/web/src/components/PackEditor.tsx (783 lines) into components/sticker/{packEditorModel,Bl | 2026-10-10 |
| [T-0990](T-0990-split-web-channel-panel.md) | Size split T65: apps/web/src/components/ChannelPanel.tsx (559 lines) into components/panels/{channelPanelOps,C | 2026-10-10 |
| [T-0989](T-0989-split-web-sticker-panel.md) | Size split T49: apps/web/src/components/StickerPanel.tsx (634 lines) into components/sticker/{StickerThumb,Fav | 2026-10-10 |
| [T-0991](T-0991-split-server-invite-links.md) | Size split T50: apps/server/src/invite-links/service.ts (631 lines) into invite-links/{tokens,queries,join}.ts | 2026-10-10 |
| [T-0993](T-0993-split-server-web-tools-adapters.md) | Size split T55: apps/server/src/web-tools/adapters.ts (606 lines) into web-tools/{shared,fetch-adapter,wikiped | 2026-10-10 |
| [T-0992](T-0992-split-server-stickers-api.md) | Size split T56: apps/server/src/stickers/api.ts (595 lines) into stickers/{api-handlers,api-decode,api-upload} | 2026-10-10 |
| [T-0986](T-0986-split-mobile-composer.md) | Size split T30: apps/mobile/src/components/chat/composer.tsx (788 lines) into chat/{composer-media,composer-sh | 2026-10-10 |
| [T-0987](T-0987-split-mobile-message-bubble.md) | Size split T37: apps/mobile/src/components/chat/message-bubble.tsx (758 lines) into chat/{message-bubble-decor | 2026-10-10 |
| [T-0988](T-0988-split-mobile-integrations.md) | Size split T38: apps/mobile/src/app/settings/integrations.tsx (740 lines) into components/integrations/{card-f | 2026-10-10 |
| [T-0994](T-0994-contact-request-permission-tests.md) | Contact requests: a few permission tests (who may accept, decline, cancel; blocks; limits) | 2026-10-10 |
| [T-1001](T-1001-split-server-telegram-import.md) | Size split T59: apps/server/src/stickers/telegram-import.ts (573 lines) into stickers/telegram/{pack-input,err | 2026-10-10 |
| [T-0995](T-0995-split-mobile-machines.md) | Size split T41: apps/mobile/src/app/settings/machines.tsx (717 lines) into components/machines/{mutations,use- | 2026-10-10 |
| [T-0996](T-0996-split-mobile-stickers-screen.md) | Size split T44: apps/mobile/src/app/settings/stickers.tsx (691 lines) into components/stickers/{tile-size,use- | 2026-10-10 |
| [T-1002](T-1002-split-server-push-service.md) | Size split T64: apps/server/src/push/service.ts (561 lines) into push/{delivery,archive-scan,candidates}.ts, t | 2026-10-10 |
| [T-0998](T-0998-split-web-chat-background-dialog.md) | Size split T66: apps/web/src/components/ChatBackgroundDialog.tsx (555 lines) into components/background/{backg | 2026-10-10 |
| [T-0999](T-0999-split-web-notifications-page.md) | Size split T67: apps/web/src/routes/NotificationsPage.tsx (551 lines) into lib/push/{deviceStorage,pageActions | 2026-10-10 |
| [T-1000](T-1000-split-web-integrations-page.md) | Size split T69: apps/web/src/routes/IntegrationsPage.tsx (548 lines) into components/settings/{integrationErro | 2026-10-10 |
| [T-0997](T-0997-split-mobile-voice-message.md) | Size split T51: apps/mobile/src/components/chat/voice-message.tsx (631 lines) into chat/{voice-playback-source | 2026-10-10 |
| [T-1007](T-1007-split-web-avatar-uploader.md) | Size split T81: apps/web/src/components/AvatarUploader.tsx (514 lines) into components/avatar/{avatarImageCode | 2026-10-10 |
| [T-1008](T-1008-split-web-tool-detail-panel.md) | Size split T83: apps/web/src/components/tools/ToolDetailPanel.tsx (513 lines) into tools/{toolDetailOps,ToolSo | 2026-10-10 |
| [T-1010](T-1010-split-server-xmpp-admin-client.md) | Size split T71: apps/server/src/xmpp/admin-client.ts (539 lines) into xmpp/admin/{schemas,types,errors,client} | 2026-10-10 |
| [T-1009](T-1009-split-web-chat-list.md) | Size split T84: apps/web/src/components/ChatList.tsx (509 lines) into components/chatList/{rowsSelector,ChatLi | 2026-10-10 |
| [T-1004](T-1004-split-mobile-approvals.md) | Size split T74: apps/mobile/src/app/settings/approvals.tsx (529 lines) into components/approvals/{use-approval | 2026-10-10 |
| [T-1005](T-1005-split-mobile-profile.md) | Size split T78: apps/mobile/src/app/settings/profile.tsx (521 lines) into components/settings/{use-profile-set | 2026-10-10 |
| [T-1006](T-1006-split-mobile-connections.md) | Size split T79: apps/mobile/src/app/settings/connections.tsx (519 lines) into components/connections/{use-conn | 2026-10-10 |
| [T-1003](T-1003-push-candidate-tests.md) | Push: a few tests for who gets a notification (hidden private topic, muted chat, own message, retraction) | 2026-10-10 |
| [T-1014](T-1014-split-web-machines-page.md) | Size split T91: apps/web/src/routes/MachinesPage.tsx (473 lines) into components/machines/{machineRowOps,Pendi | 2026-10-10 |
| [T-1011](T-1011-split-mobile-media-sheet.md) | Size split T87: apps/mobile/src/components/chat/media-sheet.tsx (491 lines) into chat/{media-rows,media-sheet- | 2026-10-10 |
| [T-1012](T-1012-split-mobile-voice-recorder.md) | Size split T93: apps/mobile/src/components/chat/voice-recorder.tsx (470 lines) into chat/{voice-recorder-flow, | 2026-10-10 |
| [T-1013](T-1013-split-mobile-gif-panel.md) | Size split T95: apps/mobile/src/components/chat/gif-panel.tsx (461 lines) into chat/{gif-cells,gif-paging,gif- | 2026-10-10 |
| [T-1016](T-1016-split-server-audit-service.md) | Size split T82: apps/server/src/audit/service.ts (514 lines) into audit/{schema,recorder,list}.ts, the old pat | 2026-10-10 |
| [T-1017](T-1017-split-server-push-api.md) | Size split T89: apps/server/src/push/api.ts (484 lines) into push/{api-handlers,api-subscribe,api-util}.ts, ap | 2026-10-10 |
| [T-1018](T-1018-split-server-machines-service.md) | Size split T90: apps/server/src/machines/service.ts (476 lines) into machines/{pairing,machines,crypto,view}.t | 2026-10-10 |
| [T-1019](T-1019-split-server-chat-prefs.md) | Size split T98: apps/server/src/chat-prefs/service.ts (445 lines) into chat-prefs/{access,backgrounds}.ts, the | 2026-10-10 |
| [T-1015](T-1015-split-web-task-strip.md) | Size split T99: apps/web/src/components/TaskStrip.tsx (442 lines) into components/topic/{stripModel,StatusMenu | 2026-10-10 |
| [T-1023](T-1023-split-server-topic-rooms.md) | Size split T77: apps/server/src/topics/rooms.ts (522 lines) into topics/{room-members,room-sync,room-push}.ts, | 2026-10-10 |
| [T-1024](T-1024-split-server-media-indexer.md) | Size split T103: apps/server/src/media/indexer.ts (435 lines) into media/{extract,rows}.ts, the old path keeps | 2026-10-10 |
| [T-1025](T-1025-split-server-agent-memory-store.md) | Size split T60: apps/server/src/agents/memory/store.ts (572 lines) into memory/{mirror,render,recall,facts,com | 2026-10-10 |
| [T-1027](T-1027-split-devtools-xmpp-e2e.md) | Size split T94: packages/devtools/src/xmpp-e2e.ts (457 lines) into xmpp-e2e/{harness,connect,muc,mam,main}.ts; | 2026-10-10 |
| [T-1026](T-1026-split-site-scene.md) | Size split T80: apps/site/src/scene.ts (515 lines) into scene/{config,textures,geometry,backdrop,mark,post,loo | 2026-10-10 |
| [T-1020](T-1020-split-mobile-chats-tab.md) | Size split T72: apps/mobile/src/app/(tabs)/index.tsx (537 lines) into components/chat/{search-header,chat-sear | 2026-10-10 |
| [T-1021](T-1021-split-mobile-attachment-native.md) | Size split T75: apps/mobile/src/lib/attachment-native.ts (528 lines) into lib/{attachment-picker,attachment-up | 2026-10-10 |
| [T-1022](T-1022-split-mobile-topic-sheets.md) | Size split T100: apps/mobile/src/components/chat/topic-sheets.tsx (442 lines) into chat/{topic-actions-sheet,t | 2026-10-10 |
| [T-1029](T-1029-split-server-agent-tools.md) | Size split T73: apps/server/src/agents/tools.ts (536 lines) into agents/tools/{schemas,parse,definitions,reply | 2026-10-10 |
| [T-1033](T-1033-split-server-voice-transcription-api.md) | Size split T110: apps/server/src/voice-transcription/api.ts (422 lines) into voice-transcription/{schemas,midd | 2026-10-10 |
| [T-1035](T-1035-split-web-chat-media-panel.md) | Size split T123: apps/web/src/components/ChatMediaPanel.tsx (403 lines) into components/media/{mediaModel,useS | 2026-10-10 |
| [T-1028](T-1028-split-server-routine-execute.md) | Size split T105: apps/server/src/routines/execute.ts (434 lines) into routines/{outcomes,audit,preflight}.ts,  | 2026-10-10 |
| [T-1034](T-1034-split-web-voice-lib.md) | Size split T112: apps/web/src/lib/voice.ts (420 lines) into lib/voice/{recorder,convert,waveform,sample}.ts, v | 2026-10-10 |
| [T-1030](T-1030-split-mobile-voice-native.md) | Size split T96: apps/mobile/src/lib/voice-native.ts (451 lines) into lib/{voice-recorder,voice-playback,voice- | 2026-10-10 |
| [T-1031](T-1031-split-mobile-message-search.md) | Size split T97: apps/mobile/src/components/chat/message-search.ts (451 lines) into chat/{message-search-format | 2026-10-10 |
| [T-1032](T-1032-split-mobile-voice-player.md) | Size split T109: apps/mobile/src/components/chat/voice-player.ts (423 lines) into chat/{voice-player-registry, | 2026-10-10 |
| [T-1036](T-1036-split-server-routines-api.md) | Size split T116: apps/server/src/routines/api.ts (409 lines) into routines/{wire,access,reads,status-errors}.t | 2026-10-10 |
| [T-1038](T-1038-split-web-folder-editor.md) | Size split T120: apps/web/src/components/FolderEditorDialog.tsx (404 lines) into components/folder/{folderEdit | 2026-10-10 |
| [T-1037](T-1037-split-site-instruments.md) | Size split T119: apps/site/src/instruments.ts (405 lines) into instruments/{dom,approval,routine,provider,pair | 2026-10-10 |
| [T-1039](T-1039-split-mobile-message-list.md) | Size split T114: apps/mobile/src/components/chat/message-list.tsx (418 lines) into chat/{use-stable-handlers,u | 2026-10-10 |
| [T-1040](T-1040-split-mobile-markdown.md) | Size split T115: apps/mobile/src/lib/markdown.ts (410 lines) into lib/{markdown-inline,markdown-blocks}.ts, th | 2026-10-10 |
| [T-1042](T-1042-max-lines-lint-warning.md) | Lint: oxlint max-lines warning at 400 for source files; tests, mocks, the emoji table and .d.ts files are off | 2026-10-10 |
| [T-1043](T-1043-server-shared-error-helpers.md) | Dedup F6a: one server errorName/errorClassName and one isUniqueViolation in effect/error-utils.ts, replacing 1 | 2026-10-10 |
| [T-1041](T-1041-split-mobile-channel-screen.md) | Size split T117: apps/mobile/src/components/chat/channel-screen.tsx (408 lines) into chat/{channel-members,use | 2026-10-10 |
| [T-1044](T-1044-mock-backend-prefs-pins.md) | Mock backend C1: chat-prefs (pin, mute, archive), chat-background and pins domains in @zilar/mock-backend | 2026-10-10 |
| [T-1049](T-1049-dedup-trim-trailing-punctuation.md) | Dedup F8a: mobile markdown uses @zilar/chat-core's trimTrailingPunctuation instead of its own copy | 2026-10-10 |
| [T-1047](T-1047-mobile-mock-uploader.md) | Mobile mock mode: a no-network mock uploader, so voice notes and attachments send instead of failing | 2026-10-10 |
| [T-1050](T-1050-mobile-effect-timers.md) | Dedup F8b: one mobile lib/effect/timers.ts (runLater, interruptFiber) for the message list, GIF panel and voic | 2026-10-10 |
| [T-1051](T-1051-audit-dedup-status.md) | Audit: what is left of the size-plan dedups F1-F7 on main, with small task slices | 2026-10-10 |
| [T-1054](T-1054-server-read-capped.md) | Dedup F6 (S5): one readCapped (apps/server/src/http/read-capped.ts) for the sticker, background, voice and ava | 2026-10-10 |
| [T-1052](T-1052-server-runsql-last-sites.md) | Dedup F1 (S1): the last service-level sqlRuntimeFor(db).runPromise calls use runSql | 2026-10-10 |
| [T-1046](T-1046-mock-backend-stickers-gifs.md) | Mock backend F1: stickers (packs, panel, favorites, discover, files) and GIFs (search, trending) domains in @z | 2026-10-10 |
| [T-1048](T-1048-mock-backend-group-general-topics.md) | Mock backend: every seeded group and channel gets its General topic in /chats, like the real server, so the mo | 2026-10-10 |
| [T-1055](T-1055-server-pins-handler.md) | Dedup F2 (S2): pins/api.ts uses the shared handler() instead of three hand-written withErrorEnvelope blocks | 2026-10-10 |
| [T-1053](T-1053-server-jid-truncate-helpers.md) | Dedup F6 (S3): one server bareJid/ownBareJid (apps/server/src/jid.ts) and one truncateChars (apps/server/src/t | 2026-10-10 |
| [T-1056](T-1056-mobile-approvals-ai-list-mock.md) | Mobile approvals: list AIs through useAisApi, so 'Always allowed' keeps its rules in mock mode when nothing is | 2026-10-10 |
| [T-1058](T-1058-split-mobile-boot-check.md) | Size split: apps/mobile/scripts/boot-check.mjs (805 lines) into boot-check-{proc,steps,launch}.mjs, moved unch | 2026-10-10 |
| [T-1057](T-1057-server-schema-issues.md) | Dedup F6 (S4): one firstIssueMessage in apps/server/src/effect/schema-issues.ts for auth, routines and xmpp ad | 2026-10-10 |
| [T-1045](T-1045-mock-backend-folders-media.md) | Mock backend C2: chat-folders, backgrounds and media gallery domains in @zilar/mock-backend | 2026-10-10 |
| [T-1059](T-1059-audit-mock-sweep-status.md) | Audit: what still uses the old mock code (web mock/api.ts fallback, mobile use-*-api mock switches, mobile moc | 2026-10-10 |
| [T-1060](T-1060-delete-mobile-mock-store.md) | Mock sweep Q (mobile): delete the dead mock store apps/mobile/src/store/chat-store.ts (1,595 lines) and the fo | 2026-10-10 |
| [T-1061](T-1061-mobile-approvals-on-mock-backend.md) | Mock H2-2 (mobile): approvals run on @zilar/mock-backend through mockFetch; one shared mockToken in mock/gate. | 2026-10-10 |
| [T-1062](T-1062-web-mock-delete-covered-routes-1.md) | Mock sweep W1+W2 (web): delete the mock/api.ts routes the shared backend already answers (tools, chats, sticke | 2026-10-10 |
| [T-1063](T-1063-mobile-ais-on-mock-backend.md) | Mock H2-1 (mobile): AIs, AI memory, audit and tools run on @zilar/mock-backend through mockFetch | 2026-10-10 |
| [T-1064](T-1064-mobile-machines-connections-directory-on-mock-backend.md) | Mock H2-3 (mobile): machines, connections and directory run on @zilar/mock-backend through mockFetch (contacts | 2026-10-10 |
| [T-1066](T-1066-delete-mobile-replaced-mocks.md) | Mock sweep M2+R2 (mobile): delete the seven old mocks the H2 adapters replaced (ais, ai-memory, audit, tools,  | 2026-10-10 |
| [T-1065](T-1065-web-mock-delete-covered-routes-2.md) | Mock sweep W1b (web): delete the mock/api.ts routes the shared backend answers that T-1062 kept, plus backgrou | 2026-10-10 |
| [T-1067](T-1067-mock-backend-contacts-blocks-handles.md) | Mock backend F3: contact-requests (with users/by-handle), blocks, handles/check and PUT /me/handle domains in  | 2026-10-10 |
| [T-1068](T-1068-web-mock-delete-covered-routes-3.md) | Mock sweep W3 (web): delete the mock/api.ts groups, invite-links, join, directory and topics routes the shared | 2026-10-10 |
| [T-1069](T-1069-mobile-contacts-directory-on-mock-backend.md) | Mock H2-4a (mobile): contacts and directory run on @zilar/mock-backend through mockFetch | 2026-10-10 |
| [T-1070](T-1070-mobile-search-on-mock-backend-and-delete-dead-mocks.md) | Mock H2-4b + sweep (mobile): chat search runs on @zilar/mock-backend; delete contacts-mock, mock/directory and | 2026-10-10 |
| [T-1071](T-1071-web-mock-delete-covered-routes-4.md) | Mock sweep W4 (web): delete the mock/api.ts /topics/:id, roles, audit, approvals, approval-rules, connections  | 2026-10-10 |
| [T-1072](T-1072-web-mock-delete-covered-routes-5.md) | Mock sweep W10 (web): delete the mock/api.ts me, me/handle, users/by-handle, contact-requests, blocks and hand | 2026-10-10 |
| [T-1073](T-1073-mock-backend-push-voice.md) | Mock backend F4: push (config, subscriptions, settings, test) and voice transcription domains in @zilar/mock-b | 2026-10-10 |
| [T-1074](T-1074-web-mock-drop-old-routes.md) | Mock sweep W5-W9 (web): dispatch answers only from @zilar/mock-backend; delete mock/api.ts and the dead seed f | 2026-10-10 |
| [T-1075](T-1075-dither-avatars.md) | Dither avatars: every avatar without a picture shows dither-avatar's coloured SVG (web and mobile, AIs too) in | 2026-10-10 |
| [T-1076](T-1076-mock-backend-avatars.md) | Mock backend F5: avatars domain (PUT/DELETE /avatars/:kind/:ownerId) whose urls show without a server; /me car | 2026-10-10 |
| [T-1077](T-1077-mobile-profile-on-mock-backend.md) | Mock H2-6 (mobile): profile runs on @zilar/mock-backend through mockFetch; delete mock/profile.ts | 2026-10-10 |
| [T-1078](T-1078-mock-backend-integrations-and-mobile-switch.md) | Mock backend F6 + H2-5: integrations domain in @zilar/mock-backend; mobile integrations run on it; delete inte | 2026-10-10 |
| [T-1080](T-1080-mock-voice-follows-integrations.md) | Mock backend: GET /voice/transcription follows the integrations voice setting; seed voice as configured; fix s | 2026-10-10 |
| [T-1079](T-1079-mobile-stickers-on-mock-backend.md) | Mock H2-7 (mobile): sticker management runs on @zilar/mock-backend through mockFetch; delete stickers-mock.ts | 2026-10-10 |
| [T-1082](T-1082-mock-sweep-status-2.md) | Audit: rewrite docs/audit/mock-sweep-status.md for main after T-1081, with what is left of the mock plan and a | 2026-10-10 |
| [T-1081](T-1081-mobile-mock-sticker-owner.md) | Mobile mock: sticker screens know the mock viewer, so your own packs open for editing (viewerId from the share | 2026-10-10 |
| [T-1084](T-1084-mobile-mock-dead-files.md) | Mock cleanup: delete mobile mock/drafts.ts and mock/time.ts (no importers); trim web mock/ids.ts to currentUse | 2026-10-10 |
| [T-1083](T-1083-web-mock-sticker-files-dev-middleware.md) | Web mock: a dev-server-only vite middleware serves the shared backend's seed sticker files, so sticker images  | 2026-10-10 |
| [T-1085](T-1085-mobile-composer-stickers-gifs-on-backend.md) | Mock H2-8 (mobile): the composer's sticker and GIF tabs load from @zilar/mock-backend through injected APIs in | 2026-10-10 |
| [T-1086](T-1086-web-gif-tab-on-backend.md) | Mock H1 (web): the GIF tab loads from @zilar/mock-backend like real mode (no placeholder props, real probe); d | 2026-10-10 |
| [T-1087](T-1087-mobile-rules-fanout-partial-failure.md) | Mobile approvals: mergeRulesFanOut returns the error state only when every AI's rules fetch failed (not when t | 2026-10-10 |
| [T-1088](T-1088-voice-transcription-contract-schemas.md) | api-contract: share the voice-transcription response schemas (EnabledStatus, TranscriptResult) with the server | 2026-10-10 |
| [T-1089](T-1089-gif-mock-props-and-voice-client-schemas.md) | Cleanup: delete the unused mobile GifSheet and GifPanel's mockItems prop; web and mobile clients decode voice  | 2026-10-11 |
| [T-1090](T-1090-mock-general-topics-in-topics-seed.md) | Mock backend: seed every group's General as a real topics row, so GET /groups/:id/topics lists it (not only De | 2026-10-11 |
| [T-1091](T-1091-ball-avatar-package.md) | Ball avatars: a zero-dependency @zilar/ball-avatar package (glossy 3D ball SVG from a seed) replaces dither-av | 2026-10-11 |
| [T-1092](T-1092-cleanup-avatar-comments-me-setters.md) | Cleanup: 'dither' comments now say ball avatar; mobile mock/load.ts header; mock me state gets handle/avatar s | 2026-10-11 |
| [T-1093](T-1093-simplify-plan-status.md) | Audit: status of every docs/audit/simplify-plan.md item on main (done / partly / open), with evidence and the  | 2026-10-11 |
| [T-1098](T-1098-shared-message-search-constants.md) | Message search debounce and min length: one copy in @zilar/chat-core, used by web and mobile | 2026-10-11 |
| [T-1094](T-1094-split-web-store-ts.md) | Split apps/web/src/store/store.ts (555 lines) into types + selectors + chat groups, pure relocation | 2026-10-11 |
| [T-1095](T-1095-split-mobile-store-types.md) | Split apps/mobile/src/store/types.ts (507 lines): list-view helpers and send option types out, ChatStoreState  | 2026-10-11 |
| [T-1097](T-1097-split-mobile-store-effects-groups.md) | Split apps/mobile/src/store/effects/groups.ts (586 lines): the GroupActions object moves to group-actions.ts b | 2026-10-11 |
| [T-1096](T-1096-split-web-store-effects-groups.md) | Split apps/web/src/store/effects/groups.ts (548 lines) into topics + group create + group settings, pure reloc | 2026-10-11 |
| [T-1099](T-1099-web-new-topic-from-group-header.md) | Web bug: New topic from a group header's + fails ('Could not create the topic', blank group name): the header  | 2026-10-11 |
| [T-1100](T-1100-mock-new-room-occupants.md) | Mock XMPP: a room with no posts takes its occupants from its group's members, not every seeded person (new top | 2026-10-11 |
| [T-1101](T-1101-web-dockerfile-ball-avatar.md) | Release blocker: the web Docker image fails ('failed to resolve import @zilar/ball-avatar'); the Dockerfile mu | 2026-10-11 |
| [T-1102](T-1102-coolify-app-compose.md) | Deploy: deploy/coolify/docker-compose.app.yml, the Coolify stack built from git (build: contexts instead of GH | 2026-10-11 |
| [T-1103](T-1103-coolify-app-compose-contexts.md) | Deploy fix: docker-compose.app.yml build contexts are relative to the repo root (Coolify passes --project-dire | 2026-10-11 |
| [T-1106](T-1106-android-app-links.md) | Android App Links: https://chat.zilar.app links open the Zilar app (intent filter + assetlinks.json + web→app  | 2026-10-11 |
| [T-1108](T-1108-rate-limit-layers-to-factory.md) | Dedup S7: the hand-written per-user rate-limit layers in groups, topics, invite-links (and integrations if ide | 2026-10-11 |
| [T-1107](T-1107-shared-crypto-envelope.md) | Dedup S6: one shared AES-GCM/HKDF envelope for the push, connections and setup ciphers, moved unchanged (each  | 2026-10-11 |
| [T-1104](T-1104-signup-invite-code-server-web.md) | Sign-up: an unknown email gets 'invite_required' instead of a silent fake success; web sign-in shows an Invite | 2026-10-11 |
| [T-1109](T-1109-xmpp-unavailable-constructor.md) | Error codes: one xmppUnavailable() constructor (always 503) replaces the 33 inline HttpError(502|503, 'xmpp_un | 2026-10-11 |
| [T-1105](T-1105-signup-invite-code-mobile.md) | Mobile sign-in: Invite code field for new accounts (shows on invite_required / invite_invalid, accepts a code  | 2026-10-11 |
| [T-1110](T-1110-groups-access-membership-read.md) | Dedup S10 (slice 1): apps/server/src/groups/access.ts with findGroupMembership + isGroupManagerRole, adopted b | 2026-10-11 |
| [T-1111](T-1111-xmpp-token-into-contract.md) | S15 (part 1): the /xmpp/token endpoint moves into @zilar/api-contract unchanged; web getXmppToken uses callApi | 2026-10-11 |
| [T-1112](T-1112-signup-email-first-invite-step.md) | Sign-in: email first; only an email with no account gets the Invite code input (pre-filled from an invite link | 2026-10-11 |
| [T-1113](T-1113-voice-transcription-into-contract.md) | S15 (part 2): the voice-transcription group (status, transcript, settings put/delete) moves into @zilar/api-co | 2026-10-11 |
| [T-1114](T-1114-invite-field-polish.md) | Invite step polish: no autocorrect/spellcheck on the invite code field; the email-step error shows under the i | 2026-10-11 |
| [T-1115](T-1115-tools-routines-membership.md) | Dedup S11 (slice 1): tools and routines use groups/access.ts — delete their two private findMembership copies  | 2026-10-11 |
| [T-1116](T-1116-approvals-membership.md) | Dedup S11 (slice 2): approvals and groups/queries use groups/access.ts — one isGroupManager() replaces the two | 2026-10-11 |
| [T-1117](T-1117-shared-timing-constants.md) | Drift 0.2: the GIF search, people search and chat refresh debounce constants (copied in web and mobile, same v | 2026-10-11 |
| [T-1120](T-1120-split-setup-api.md) | Size split: apps/server/src/setup/api.ts (441) — the body schemas to setup/schema.ts and the invite/mail helpe | 2026-10-11 |
| [T-1119](T-1119-split-search-routes.md) | Size split: apps/server/src/search/routes.ts (531) — snippet/stanza helpers to search/snippet.ts and the SQL b | 2026-10-11 |
| [T-1118](T-1118-split-approvals-api.md) | Size split: apps/server/src/approvals/api.ts (562) — the read helpers after createApprovalsApi move unchanged  | 2026-10-11 |
| [T-1121](T-1121-split-topics-access.md) | Size split: apps/server/src/topics/access.ts (688) — the topic view builders move unchanged to topics/views.ts | 2026-10-11 |
| [T-1123](T-1123-split-edge.md) | Size split: apps/server/src/effect/edge.ts (434) — route matching, request id, CORS and body helpers move unch | 2026-10-11 |
| [T-1122](T-1122-split-litellm-client.md) | Size split: apps/server/src/ai/litellm-client.ts (589) — public types to ai/litellm-types.ts and the wire sche | 2026-10-11 |
| [T-1126](T-1126-split-db-rows.md) | Size split: apps/server/src/db/rows.ts (426) — the approval, tool, routine and media row types move unchanged  | 2026-10-11 |
| [T-1127](T-1127-split-machines-api.md) | Size split: apps/server/src/machines/api.ts (404) — toMachineView, invalidCode, toConflict and INVALID_JSON mo | 2026-10-11 |
| [T-1124](T-1124-split-mobile-chat-api.md) | Size split: apps/mobile/src/lib/chat-api.ts (439) — the wire schemas and parse functions move unchanged to lib | 2026-10-11 |
| [T-1125](T-1125-split-web-ports.md) | Size split: apps/web/src/store/effects/ports.ts (427) — the browser default adapters move unchanged to store/e | 2026-10-11 |
| [T-1128](T-1128-mobile-interrupt-fiber.md) | Mobile dedup: the 18 inline Effect.runFork(Fiber.interrupt(x)) calls use interruptFiber from lib/effect/timers | 2026-10-11 |
| [T-1129](T-1129-native-push-plan.md) | Audit: plan for native push (Android FCM now, iPhone APNs + publisher relay next), content-free, on top of the | 2026-10-11 |
| [T-1130](T-1130-split-mobile-real-store.md) | Size split: apps/mobile/src/store/real-store.ts (693) — chat-row mapping, the closure's helpers, initial state | 2026-10-11 |
| [T-1131](T-1131-split-tool-worker.md) | Size split: apps/server/src/sandbox/tool-worker.ts (616) — one failRun() replaces the repeated error finish li | 2026-10-11 |
| [T-1133](T-1133-fcm-sender.md) | Native push 2/6: FCM HTTP v1 sender — OAuth token minted with node:crypto (RS256 JWT, cached ~55 min, one shar | 2026-10-11 |
| [T-1134](T-1134-split-web-real-store.md) | Size split: apps/web/src/store/realStore.ts (524) — the closure's mutable locals, the ctx build and the store  | 2026-10-11 |
| [T-1132](T-1132-push-device-kind.md) | Native push 1/6: push_subscriptions gets a device kind (webpush | fcm | apns) and a token column — hand-writte | 2026-10-11 |
| [T-1137](T-1137-trim-lifecycle-sql-adapter.md) | Size: client-core store/lifecycle.ts (405) and server auth/sql-adapter.ts (404) under 400 — readLastRead moves | 2026-10-11 |
| [T-1136](T-1136-web-account-switch.md) | Web: signing in as another account while one is still signed in kept the old account's chat session until relo | 2026-10-11 |
| [T-1135](T-1135-push-delivery-by-kind.md) | Native push 3/6: delivery branches by device kind — a native (fcm) device gets a data-only, ids-only wake thro | 2026-10-11 |
| [T-1138](T-1138-push-native-subscribe.md) | Native push 4/6: POST /push/subscriptions accepts { kind: 'fcm', token } beside the Web Push body, and the ser | 2026-10-11 |
| [T-1139](T-1139-mobile-push-register.md) | Native push 5/6 (mobile): expo-notifications + google-services.json; after sign-in the app gets its FCM token, | 2026-10-11 |
| [T-1140](T-1140-compose-fcm-env.md) | Deploy: pass FCM_SERVICE_ACCOUNT_JSON and FCM_PROJECT_ID to the server container; documented in deploy/.env.example | 2026-10-11 |
| [T-1141](T-1141-push-token-one-owner.md) | Push: a native token belongs to one account — registering an fcm/apns token deletes every other user's row wit | 2026-10-11 |
| [T-1142](T-1142-push-preview-route.md) | Push: GET /api/push/preview?messageId= returns the notification { title, body, chatId } for one archived messa | 2026-10-11 |
| [T-1143](T-1143-mobile-push-wake.md) | Native push 6/6 (mobile): a headless task handles the FCM wake — GET /api/push/preview, then a local notificat | 2026-10-11 |
| [T-1144](T-1144-coolify-compose-fcm-env.md) | Deploy: pass FCM_SERVICE_ACCOUNT_JSON and FCM_PROJECT_ID to the server in deploy/coolify/docker-compose.app.ym | 2026-10-11 |
| [T-1145](T-1145-web-in-tab-notifications.md) | Web: in-tab notifications — while a Zilar tab is open but hidden, an incoming unread message in an unmuted cha | 2026-10-11 |
| [T-1147](T-1147-close-chat-clears-active.md) | Web + mobile: leaving a chat clears the open chat, so a message arriving while you are on the chat list stays  | 2026-10-11 |
| [T-1148](T-1148-people-prefix-search.md) | Web + server: Telegram-style people search — the chat-list search shows people whose @username or name starts  | 2026-10-11 |
| [T-1146](T-1146-ejabberd-push-enable-audit.md) | Audit: why XEP-0357 <enable/> to ejabberd answers internal-server-error in production, so no real message ever | 2026-10-11 |
| [T-1149](T-1149-typing-stop-and-badge.md) | Typing: a received message clears that chat's typing line at once, and the sender sends 'paused' on send or wh | 2026-10-11 |
| [T-1150](T-1150-push-register-idempotent.md) | Push: re-registering the same device keeps its node (server), and the Android app registers its token once per | 2026-10-11 |
| [T-1155](T-1155-precise-push-triggers.md) | F6 (audit MP-7): mod_push notify_on: messages (typing/presence no longer trigger pushes), and the archive scan | 2026-10-11 |
| [T-1157](T-1157-safe-file-serving.md) | Security wave 2 (SEC-1, SEC-9): /api/files serves inline only an allowlist of safe media types (png/jpeg/gif/w | 2026-10-11 |
| [T-1154](T-1154-group-push-notifier.md) | F5 (audit MP-3, P0): server-side group push notifier | 2026-10-11 |
| [T-1156](T-1156-deploy-hardening.md) | Security wave 2 (SEC-2, SEC-4, SEC-5/6/10): Caddy proxies only /xmpp-ws/ws to ejabberd (admin /api no longer p | 2026-10-11 |
| [T-1152](T-1152-push-pair-every-session.md) | F2 (audit MP-2b, MP-8, MP-13): the XEP-0357 <enable/> is sent on EVERY new XMPP session (each transition to on | 2026-10-11 |
| [T-1158](T-1158-block-really-blocks.md) | SG-1 (P0): blocking really blocks | 2026-10-11 |
| [T-1162](T-1162-webpush-endpoint-one-owner.md) | Push: a Web Push endpoint belongs to one account | 2026-10-11 |
| [T-1163](T-1163-plan-page.md) | GitHub Pages: a 'Fix plan' page next to the Code map, generated from docs/plan/plan.json plus each task's stat | 2026-10-11 |
| [T-1151](T-1151-mobile-background-lifecycle.md) | F1 (audit MP-1, MP-12): mobile background lifecycle — after 10 s in background the app suspends its XMPP socke | 2026-10-11 |
| [T-1160](T-1160-seen-only-when-seen.md) | UI-2/9/10/11: the displayed ('seen') marker goes out only for a chat that is open, visible and focused — not f | 2026-10-11 |
| [T-1161](T-1161-incoming-unread-lastseen-typing.md) | UI-3/4/5 in the core incoming path: my own message from another device clears that chat's unread; 'last seen'  | 2026-10-11 |
| [T-1159](T-1159-block-strangers.md) | SG-2 (P0): contacts-only DMs — ejabberd mod_block_strangers drops chat messages from JIDs without a roster sub | 2026-10-11 |
| [T-1166](T-1166-web-draft-stream-reconnect.md) | AI-2 + AI-12: the web AI draft stream reopens with jittered backoff after an HTTP error (deploy 502, 401) inst | 2026-10-12 |
| [T-1165](T-1165-ai-context-edits.md) | AI-6: the AI's context applies edits and deletes before it is cut to 50 — a correction replaces its target's t | 2026-10-12 |
| [T-1168](T-1168-ai-drain-on-deploy.md) | AI-1: on shutdown the AI gateway drains — refuse new turns, wait up to 8 s for running DM and room turns to fi | 2026-10-12 |
| [T-1171](T-1171-web-new-message-dialog.md) | WUX-7: web 'New message' lists your contacts with a filter and opens the DM at once; the contact card shows Me | 2026-10-12 |
| [T-1164](T-1164-plan-page-all-findings.md) | Plan page v2: list EVERY finding of every audit (P0–P3, id, severity, platform, one line, 'fixed by' chip), th | 2026-10-12 |
| [T-1172](T-1172-mobile-list-keep-position.md) | MUX-1 + MUX-7: the mobile message list keeps the reading position — loading an older page or a new message no  | 2026-10-12 |
| [T-1169](T-1169-health-and-uptime-alert.md) | OPS-2 (P0): /health also reports ejabberd (admin ping), the push component (online/offline) and the last push  | 2026-10-12 |
| [T-1173](T-1173-mobile-sign-out-and-back.md) | MUX-5 + MUX-6: a Sign out row (with confirm) at the bottom of the mobile settings hub; the header back on a ch | 2026-10-12 |
| [T-1167](T-1167-ai-error-replies.md) | AI-3/4/5: honest AI failure replies — a 429 is 'my provider is busy' (one retry first), budget only when the d | 2026-10-12 |
| [T-1170](T-1170-web-composer-drafts-focus.md) | WUX-3 + WUX-6: web keeps a composer draft per chat (survives chat switches and reloads, 'Draft:' in red in the | 2026-10-12 |
| [T-1175](T-1175-chats-topics-batched.md) | PERF-4: GET /api/chats loads every group's visible topics and topic views in one batched pass (a fixed handful | 2026-10-12 |
| [T-1177](T-1177-web-search-results.md) | WUX-1 + WUX-2: web search — a people row opens the DM (contact) or the @handle card instead of expanding inlin | 2026-10-12 |
| [T-1178](T-1178-web-notifications-page.md) | WUX-5: web Notifications page — 'only while open' is information, not a red error shown twice; 'Blocked by the | 2026-10-12 |
| [T-1180](T-1180-topic-room-sync-retry.md) | SG-3: a topic-room affiliation sync that fails after a group membership change (ejabberd unreachable) is retri | 2026-10-12 |
| [T-1179](T-1179-log-redaction-and-grace.md) | OPS-16 + OPS-17: the log redaction list covers every server secret (FCM JSON, private_key, VAPID private key,  | 2026-10-12 |
| [T-1176](T-1176-ai-group-limits-and-replies.md) | AI-7 + AI-8: in groups, a turn dropped by the room rate limit or the round budget tells the asker once per win | 2026-10-12 |
| [T-1182](T-1182-ai-followups.md) | AI follow-ups from T-1167/T-1168: a plain (no-tools) DM reply cut by max_tokens also says so; a listener wake  | 2026-10-12 |
| [T-1174](T-1174-rate-limits-and-group-avatars.md) | SEC-7 + SEC-8: per-user budgets on invite creation (10/day), profile edits (10/10 min), group creation (20/h)  | 2026-10-12 |
| [T-1184](T-1184-push-scan-batched.md) | PERF-5 (first step): the per-push archive scan computes the user's allowed rooms with one batched topic-visibi | 2026-10-12 |
| [T-1181](T-1181-mobile-composer-drafts.md) | MUX-4: mobile keeps a composer draft per chat (survives leaving the chat and app restarts, per signed-in user) | 2026-10-12 |
| [T-1183](T-1183-web-group-members.md) | WUX-8: web group panel — a members section with Add members (contact picker, owners/admins), Remove on each ro | 2026-10-12 |
| [T-1187](T-1187-group-owner-transfer.md) | SG-4 (part 1): PUT /api/groups/:id/owner — the owner hands the group to another member (roles swap in one tran | 2026-10-12 |
| [T-1185](T-1185-mobile-media-via-proxy.md) | SEC-3 step 1: mobile loads every chat file (image, GIF/video, voice, file viewer/open) through GET /api/files? | 2026-10-12 |
| [T-1188](T-1188-mobile-list-render-cost.md) | PERF-2 (first step): the mobile message row is memoised and renderItem is stable, with windowSize/maxToRenderP | 2026-10-12 |
| [T-1153](T-1153-honest-ticks-outbox.md) | F4 (audit MP-4, MP-11): honest 'sent' tick from stream-management acks, an outbox that resends texts that fail | 2026-10-12 |
| [T-1190](T-1190-web-owner-transfer.md) | SG-4 web UI: the group owner gets 'Make owner' on each member row (inline confirm), calling PUT /api/groups/:i | 2026-10-12 |
| [T-1189](T-1189-web-row-badge-layout.md) | WUX-4: web chat list rows put the time and the unread badge on one right edge for DM, topic and group rows; th | 2026-10-12 |
| [T-1191](T-1191-mobile-jump-and-keyboard.md) | MUX-8 + MUX-9: mobile chat shows a round jump-to-bottom button (with the count of messages that arrived while  | 2026-10-12 |
| [T-1192](T-1192-mobile-avatars-header.md) | MUX-11/12/15: mobile shows people's and groups' profile photos (ball as fallback) in chat rows, the chat heade | 2026-10-12 |
| [T-1186](T-1186-migration-safety.md) | OPS-5 + OPS-6: migration safety — the gate rejects a new apps/server/drizzle/NNNN_*.sql whose number is not ex | 2026-10-12 |
| [T-1195](T-1195-web-confirm-quote-focus.md) | WUX-9/13/15: web asks before Sign out and 'Archive topic for everyone'; a reply quote is clickable and jumps t | 2026-10-12 |
| [T-1194](T-1194-reply-ids.md) | UI-F1 (UI-1, UI-6): a reply names the quoted message by an id both sides share (the same wire id reactions use | 2026-10-12 |
| [T-1199](T-1199-web-older-and-keys.md) | WUX-11/12: web keeps the viewport fixed when older messages load (layout effect), shows a small loading line a | 2026-10-12 |
| [T-1193](T-1193-token-401-retry.md) | MP-F7: a 401/403 from the XMPP token fetch during an automatic reconnect is retried once after 2 s before it c | 2026-10-12 |
| [T-1201](T-1201-mobile-image-viewer.md) | MUX-13 (first step): the mobile full-screen image viewer moves to its own file on reanimated + Gesture API: sm | 2026-10-12 |
| [T-1198](T-1198-server-unread.md) | MP-F3 server half (MP-6): a chat_reads table and PUT /api/chats/:jid/read store each user's last-read archive  | 2026-10-12 |
| [T-1200](T-1200-reply-fallback-strip.md) | T-1194 follow-up: the XEP-0461 reply fallback line ('> quote') is removed from the decoded body in xmpp-core,  | 2026-10-12 |
| [T-1196](T-1196-mobile-failed-text-retry.md) | MUX-3: a failed text on mobile shows a red alert icon and 'Not sent' instead of the sending clock, and its lon | 2026-10-12 |
| [T-1202](T-1202-mobile-voice-hints.md) | MUX-14 (first step): a too-short press on the mobile mic shows 'Hold to record, release to send' for 1.5 s ins | 2026-10-12 |
| [T-1204](T-1204-mobile-chat-swipe.md) | MUX-10: swiping a mobile chat row left reveals Pin/Unpin, Mute/Unmute and Archive/Unarchive buttons that call  | 2026-10-12 |
| [T-1205](T-1205-server-unread-again.md) | T-1198 again, after a production 500: re-apply the server unread/lastMessage work, pass every archive paramete | 2026-10-12 |
| [T-1203](T-1203-avatar-seed-audit.md) | Audit: every ball-avatar call site on web and mobile, the seed it passes (user id, JID, group id, chat id) and | 2026-10-12 |
| [T-1206](T-1206-mobile-notifications.md) | Mobile notifications (parity fix #9): Settings → Notifications shows the permission state (with a way to the s | 2026-10-12 |
| [T-1208](T-1208-native-test-push.md) | T-1206 follow-up: 'Send test notification' works on a phone — the push test route (POST /push/test) sends a da | 2026-10-12 |
| [T-1209](T-1209-web-avatar-seeds.md) | Avatar seeds, web + shared part: avatarSvg normalizes every seed (bare JID, lowercase); a shared personSeed/ai | 2026-10-12 |
| [T-1197](T-1197-outbox-flush-on-resume.md) | Outbox fix (found by the lead on the emulator): a text sent in airplane mode on mobile never goes out after th | 2026-10-12 |
| [T-1213](T-1213-retry-text-outbox-args.md) | URGENT: main does not typecheck — retry-text.ts (T-1196) calls outboxFailed with the old 8-argument shape afte | 2026-10-12 |
| [T-1210](T-1210-web-send-tests-honest-tick.md) | Two web send-pipeline tests have failed since T-1153 (honest sent tick): update them to the new rule — a text  | 2026-10-12 |
| [T-1211](T-1211-muc-removal-event.md) | SG-5: when the server removes me from a room (my own unavailable MUC presence with status 307 kicked, 301 bann | 2026-10-12 |
| [T-1207](T-1207-client-server-unread.md) | MP-F3 client half: web and mobile take unread counts and the last-message preview from /api/chats (fresher ser | 2026-10-12 |
| [T-1212](T-1212-mobile-avatar-seeds.md) | Avatar seeds, mobile: every mobile Avatar/avatarSvg call site in docs/audit/avatar-seeds.md §4 passes the rule | 2026-10-12 |
| [T-1215](T-1215-voice-hint-and-test-push.md) | Two bugs the lead found on the emulator (APK 86f8eef2): the mobile 'Hold to record' hint is squeezed to the mi | 2026-10-12 |
| [T-1214](T-1214-unread-follow-ups.md) | MP-F3 finish (T-1207 follow-ups): the server preview also carries its archive id and the client uses it as the | 2026-10-12 |
| [T-1217](T-1217-unread-dedupe-origin-id.md) | Server unread counts a resent message once: rows of one chat with the same sender and origin id (a client rese | 2026-10-12 |
| [T-1219](T-1219-archived-rows-keyboard-nav.md) | Web: arrow keys in the chat list also reach the open Archived rows — move the Archived section inside the Topi | 2026-10-12 |
| [T-1218](T-1218-swipe-failure-line.md) | Mobile: a failed swipe action (pin, mute or archive) shows 'Could not save. Try again.' in a line above the ch | 2026-10-12 |
| [T-1216](T-1216-delivered-but-stuck-sending.md) | Emulator find (APK 86f8eef2): a text sent as the network drops reaches the server, but its bubble stays 'sendi | 2026-10-12 |
| [T-1221](T-1221-history-dedupe-origin-id.md) | Clients show a resent message once: two archived rows of one chat with the same sender and origin id (a by-des | 2026-10-12 |
| [T-1222](T-1222-live-dedupe-origin-id.md) | A resent message that arrives live shows once: the live incoming path drops a message the ledger links to one  | 2026-10-12 |
| [T-1220](T-1220-resend-tick-after-replace.md) | Emulator find (APK 745be24c): after a long airplane-mode gap the app reconnects about 2 minutes late, and a re | 2026-10-12 |
| [T-1224](T-1224-mobile-http-timeout.md) | Mobile HTTP calls time out after 20 s: the two shared transports (raw-request.ts, api-client.ts) add an abort  | 2026-10-12 |
| [T-1226](T-1226-delivered-tick-plan.md) | Plan: a real delivered tick (sent / delivered / seen) | 2026-10-12 |
| [T-1225](T-1225-light-markdown-web.md) | Light Markdown for human messages: chat-core parser + web | 2026-10-12 |
| [T-1230](T-1230-web-pinned-light-markdown.md) | Web pins follow light Markdown | 2026-10-12 |
| [T-1228](T-1228-delivered-status-and-ticks.md) | Delivered tick step 1: status, ladder and icons | 2026-10-12 |
| [T-1231](T-1231-mobile-seen-green-everywhere.md) | Mobile seen ticks green everywhere | 2026-10-12 |
| [T-1227](T-1227-light-markdown-mobile.md) | Light Markdown for human messages: mobile | 2026-10-12 |
| [T-1229](T-1229-delivered-server.md) | Delivered tick: server stores delivery (chat_deliveries, PUT delivered, deliveredUntil) | 2026-10-12 |
| [T-1233](T-1233-remove-contact-and-web-contacts.md) | Remove a contact (server, both directions + roster) and web Contacts page | 2026-10-12 |
| [T-1223](T-1223-revoked-session-to-login.md) | A revoked session goes to sign-in (401 on /api/me after authFailed) | 2026-10-12 |
| [T-1234](T-1234-link-previews-server-web.md) | Link previews: server unfurl (SSRF-guarded, cached) + web card | 2026-10-12 |
| [T-1232](T-1232-web-media-viewer.md) | Web photo viewer (arrows, Esc, Open original) and inline video | 2026-10-12 |
| [T-1237](T-1237-mobile-contacts-screen.md) | Mobile Contacts screen with Remove; mock DELETE contacts; web empty-card fix | 2026-10-12 |
| [T-1238](T-1238-delivered-clients.md) | Delivered tick: apps confirm delivery and apply deliveredUntil | 2026-10-12 |
| [T-1239](T-1239-web-format-shortcuts.md) | Web composer formatting shortcuts (Cmd+B/I/E) and hint | 2026-10-12 |
| [T-1240](T-1240-link-preview-ua-partial.md) | Link previews: bot User-Agent and partial read of big pages | 2026-10-12 |
| [T-1241](T-1241-mobile-link-preview-card.md) | Mobile link preview card; PlainBubbleBody split out; contacts deep link | 2026-10-12 |
| [T-1236](T-1236-dm-clear-history-delete-for-me-server.md) | DM clear history and delete for me (own archive copy); archive role gets DELETE | 2026-10-12 |
| [T-1242](T-1242-workers-on-opencode-go.md) | Auto workers on OpenCode Go DeepSeek Flash; fall back to DeepSeek API, then paid Muse | 2026-10-12 |
| [T-1244](T-1244-mark-as-unread-server-web.md) | Mark as unread: migration 0050, server clears on read, web menu and dot | 2026-10-12 |
| [T-1243](T-1243-owner-deletes-group.md) | Owner deletes a group: server, destroy presence, web confirm | 2026-10-12 |
| [T-1235](T-1235-web-devices-page.md) | Web Devices page on our own /me/sessions routes (no tokens to the client) | 2026-10-12 |
| [T-1246](T-1246-mobile-multi-photo-downscale.md) | Mobile: pick several photos, downscale to 2048 px; readable captions on own photos | 2026-10-12 |
| [T-1249](T-1249-web-group-panel-reachable.md) | Web: Group info opens the group panel from every group topic | 2026-10-12 |
| [T-1248](T-1248-mobile-mark-as-unread.md) | Mobile: mark a chat as unread; unreadMark mapping shared in chat-core | 2026-10-12 |
| [T-1250](T-1250-mobile-devices-screen.md) | Mobile: Devices screen, sign out one or all other sessions; user-agent parser shared in chat-core | 2026-10-12 |
| [T-1252](T-1252-link-preview-images-proxy.md) | Link preview images served through our server (keyed, image types only, no open proxy); web card thumbnail | 2026-10-12 |
| [T-1245](T-1245-delivered-live-notice.md) | Live delivered tick: server notice from own bare JID, apps apply it; no push | 2026-10-12 |
| [T-1251](T-1251-mobile-group-manage.md) | Mobile: Leave group, Make owner, Delete group with typed-name confirm | 2026-10-12 |
| [T-1254](T-1254-web-topic-header-group-link.md) | Web: the topic header's group name opens the group panel; ?panel=group works on topics | 2026-10-12 |
| [T-1253](T-1253-mobile-link-preview-image.md) | Mobile: link preview thumbnail through our server path with the bearer | 2026-10-12 |
| [T-1255](T-1255-push-rows-follow-session.md) | Security: a revoked session's push devices are removed (session_id cascade, migration 0051) | 2026-10-12 |
| [T-1256](T-1256-mobile-photo-viewer-swipe-save.md) | Mobile: photo viewer swipes between the chat's photos; Save to gallery | 2026-10-12 |
| [T-1257](T-1257-push-preview-marks-delivered.md) | Delivered tick: a push wake (preview fetch) marks the message delivered | 2026-10-12 |
| [T-1258](T-1258-profile-bio.md) | Profile bio (140 chars): server + web, migration 0052 | 2026-10-12 |
| [T-1260](T-1260-account-deletion-audit.md) | Audit: account deletion (7-day grace) + export plan | 2026-10-12 |
| [T-1261](T-1261-account-deletion-request.md) | Account deletion request/cancel/status with 7-day grace (migration 0053); sign-in cancels; nothing deletes yet | 2026-10-12 |
| [T-1259](T-1259-mobile-profile-bio.md) | Mobile: Bio field in Profile; bio on the @handle card | 2026-10-12 |
| [T-1247](T-1247-web-delete-for-me-clear-history.md) | Web: Delete for me on any DM message, Clear history; client-core delete-own | 2026-10-12 |
| [T-1264](T-1264-fallback-on-provider-auth.md) | Lead tooling: a provider auth failure (401) falls back like a quota error | 2026-10-12 |
| [T-1263](T-1263-mobile-delete-for-me-clear-history.md) | Mobile: Delete for me on any DM message, Clear history | 2026-10-12 |
| [T-1262](T-1262-account-export.md) | Export my messages: streamed JSON of profile, contacts and own archive (caps, fresh session, 1/h) | 2026-10-12 |
| [T-1265](T-1265-web-export-button.md) | Web: Export my messages button in Profile | 2026-10-12 |
| [T-1266](T-1266-albums-plan.md) | Audit: albums plan (wire marker, grouping, rules, task split) | 2026-10-12 |
| [T-1267](T-1267-albums-wire-grouping.md) | Albums 1: album marker in xmpp-core, grouping and N-photos preview in chat-core | 2026-10-12 |
| [T-1269](T-1269-albums-push.md) | Albums 4: one push per album in DMs, 'N photos' preview | 2026-10-12 |
| [T-1270](T-1270-albums-push-groups.md) | Albums push: one push per album in groups too; late siblings stay silent | 2026-10-12 |
| [T-1268](T-1268-albums-web.md) | Albums 2: web multi-select send, album grid, viewer scoped to the album; album kept on the wire | 2026-10-12 |
| [T-1271](T-1271-albums-mobile.md) | Albums 3: mobile album send, grid and album-first viewer | 2026-10-12 |
| [T-1272](T-1272-albums-unread.md) | Albums 5: an album counts as 1 unread (server + live); server preview 'N photos' | 2026-10-12 |
| [T-1273](T-1273-albums-actions-web.md) | Albums: album-wide Delete and Forward on web; a forwarded album stays one album | 2026-10-12 |
| [T-1274](T-1274-albums-actions-mobile.md) | Albums: album-wide Delete and Forward on mobile | 2026-10-12 |
| [T-1275](T-1275-photo-long-press-menu.md) | Mobile: long-press on a photo opens the message menu, not the viewer | 2026-10-12 |
| [T-1277](T-1277-reconnect-previews.md) | PERF-1: reconnect skips known chats' preview queries; 4 at a time; one store update per preview | 2026-10-12 |
| [T-1278](T-1278-web-message-window.md) | PERF-3: web renders the newest 150 rows (grows on scroll/jump); background chats pruned to 300 | 2026-10-12 |
| [T-1279](T-1279-progress-card-empty.md) | Progress and approval cards from history/live render again (toUiMessage mapped only stickers) | 2026-10-12 |
| [T-1276](T-1276-mobile-inverted-list.md) | MUX-2: mobile chats open at the bottom instantly (inverted list, no mount scrolls) | 2026-10-12 |
| [T-1280](T-1280-voice-lock.md) | MUX-14: lock a voice recording (slide up), then Cancel or Send | 2026-10-12 |
| [T-1281](T-1281-mobile-album-type.md) | Mobile: album typed on SendAttachmentOptions | 2026-10-12 |
| [T-1283](T-1283-web-menu-feedback.md) | WUX-29/30/37: menu at the pointer, Copy/Pin toasts, icon tooltips | 2026-10-12 |
| [T-1282](T-1282-web-name-and-menu.md) | WUX-38/10: display name in Profile; menu icons, sections, Settings | 2026-10-12 |
| [T-1284](T-1284-web-polish.md) | Web polish batch: WUX-14/22/24/25/31/35/36/42 | 2026-10-12 |
| [T-1288](T-1288-mobile-touch-fixes.md) | Mobile batch 1: MUX-16/17/22/28/30 | 2026-10-12 |
| [T-1294](T-1294-mobile-cold-start.md) | PERF-12/15: mobile chat-list cache, font gate, recyclingKey | 2026-10-12 |
| [T-1302](T-1302-mobile-notify-react.md) | Mobile batch 4: MUX-23 channels, MUX-21 double-tap react, MUX-33 icon | 2026-10-12 |
| [T-1293](T-1293-client-perf.md) | PERF-7/11/13: stable chats on presence, coalesced polls, ledger pruned | 2026-10-12 |
| [T-1295](T-1295-web-bundle-push-nodes.md) | PERF-14/17: web vendor chunks (entry 636→425 kB); push nodes dropped on gone | 2026-10-12 |
| [T-1290](T-1290-ai-turn-fixes.md) | AI-14/9/10: per-call turn budget, mentions per sender, room failure notice + owner DM | 2026-10-12 |
| [T-1303](T-1303-push-chat-kind.md) | Push wake payload carries chatKind (dm/group/channel) | 2026-10-12 |
| [T-1287](T-1287-client-ui-fixes.md) | UI-7/12/13/14: canAct guard, failed stickers, recency insert, ledger reset | 2026-10-12 |
| [T-1296](T-1296-client-version-check.md) | OPS-21 + SEC-11: client version banner; Better Auth warn/error logged | 2026-10-12 |
| [T-1300](T-1300-web-notify-emoji.md) | WUX-39/26/43: muted chats list, emoji search + categories, copy nits | 2026-10-12 |
| [T-1292](T-1292-ai-connection-key.md) | AI-20/21: replace a provider key in place; plain AI form errors | 2026-10-12 |
| [T-1286](T-1286-server-social-fixes.md) | SG-7/8/9: handle-only search, joins respect blocks, invite consumed with the user insert | 2026-10-12 |
| [T-1285](T-1285-web-lists-and-groups.md) | WUX-19/20/23/33: requests row, group member search, search keyboard, Esc closes | 2026-10-12 |
| [T-1291](T-1291-ai-drafts-fixes.md) | AI-11/13/19 + PERF-9: draft replay, late-frame drop, 10-min cap, stream only with AI chats | 2026-10-12 |
| [T-1297](T-1297-web-scroll-select.md) | WUX-28/32: per-chat scroll memory; select-mode Delete/Copy | 2026-10-12 |
| [T-1299](T-1299-ai-logs-routines.md) | AI-22/18: failure kinds in logs; routines non-blocking tick, missed late runs, post retry | 2026-10-12 |
| [T-1305](T-1305-deploy-phase1.md) | Deploy phase 1: start_interval, Caddy lb_try, expand/contract rule | 2026-10-12 |
| [T-1306](T-1306-singleton-jobs-audit.md) | Audit: two servers side by side; advisory-lock leader design | 2026-10-12 |
| [T-1289](T-1289-mobile-copy-states.md) | Mobile batch 2: MUX-25/26/27/29/32 (copy, empty states, toast, time, New topic) | 2026-10-12 |
| [T-1304](T-1304-stay-signed-in-on-errors.md) | Stay signed in when the server is down: only a 401 signs out (mobile + web) | 2026-10-12 |
| [T-1301](T-1301-web-inchat-search.md) | WUX-34: narrow web in-chat search bar | 2026-10-12 |
| [T-1312](T-1312-mobile-fast-start.md) | Mobile fast start: open at once on a stored session; background check, 401 signs out | 2026-10-13 |
| [T-1308](T-1308-mobile-header-profile.md) | Mobile: chat header text centred; Telegram-style contact profile | 2026-10-13 |
| [T-1309](T-1309-preview-icons-unread-divider.md) | Preview icons instead of emoji (web+mobile); mobile unread divider above the first unread | 2026-10-13 |
| [T-1311](T-1311-read-ticks-after-restart.md) | Read ticks survive a restart: /api/chats readUntil from chat_reads, applied on history load | 2026-10-13 |
| [T-1307](T-1307-mobile-history-photos-untrusted.md) | parseUrl without the runtime URL; a failed image load shows retry, not 'untrusted' | 2026-10-13 |
| [T-1315](T-1315-files-proxy-host.md) | Files proxy: internal upload fetch carries the public Host (ejabberd vhost); log upstream status | 2026-10-13 |
| [T-1313](T-1313-mobile-offline-chat-cache.md) | Mobile offline message cache: last 50 messages of 30 recent chats, cleared on sign-out | 2026-10-13 |
| [T-1310](T-1310-mobile-swipe-folders.md) | Mobile home: swipe between chat folders like Telegram (pager + tabs follow) | 2026-10-13 |
| [T-1316](T-1316-leader-lock-drain.md) | Zero-downtime prep: advisory-lock leader for background work; 5 s SIGTERM drain; /health leader flag | 2026-10-13 |
| [T-1317](T-1317-mobile-polish-a11y.md) | Mobile a11y: message labels end with status, no object char; one create button on My AIs | 2026-10-13 |
| [T-1314](T-1314-mobile-contacts-new-group.md) | Mobile Telegram-style Contacts (search, tap opens chat) and full-screen New group; mock create adds chat + General | 2026-10-13 |
| [T-1318](T-1318-mobile-followups.md) | A new chat with no messages sorts by creation time (group createdAt on /api/chats); mock Notifications; sticker a11y status | 2026-10-13 |
| [T-1319](T-1319-mobile-file-bubble-open.md) | Mobile files like Telegram: round-icon bubble; tap opens the type's app (Android VIEW intent), share as fallback | 2026-10-13 |
| [T-1320](T-1320-mobile-attach-sheet-telegram.md) | Mobile attach sheet like Telegram: inline gallery grid (camera tile, numbered select, Send N), Gallery/File tabs; photo+video permission only | 2026-10-13 |
| [T-1321](T-1321-ios-file-preview.md) | iOS: files open in the in-app QuickLook preview (react-native-file-viewer-turbo), share as fallback | 2026-10-13 |
| [T-1324](T-1324-web-attach-menu.md) | Web attach like Telegram: paperclip menu (Photo or video / File), Send N photos dialog with caption and send-as-files | 2026-10-13 |
| [T-1322](T-1322-web-file-bubble-open.md) | Web files like Telegram: round-icon bubble with 'size TYPE'; PDF opens in a new tab (blob), others download | 2026-10-13 |
| [T-1323](T-1323-web-contact-panel.md) | Web contact info panel like Telegram: DM header opens photo, status, actions, @username, shared media, Block | 2026-10-13 |
| [T-1325](T-1325-web-file-one-button.md) | Web file bubble: one circle (FileText opens a PDF, ArrowDown downloads others); Download in the message menu | 2026-10-13 |
| [T-1329](T-1329-mobile-profile-polish.md) | Mobile profile polish: Settings card avatar+email, one Save in Edit profile, no @handle title on contact page | 2026-10-13 |
| [T-1327](T-1327-web-chat-polish.md) | Web chat polish: one date pill, big-emoji time pill, profile heading, New chat menu icons | 2026-10-13 |
| [T-1326](T-1326-sender-colors-reply-quotes.md) | Sender colours + reply quotes with name, coloured bar and media label on web and mobile | 2026-10-13 |
| [T-1331](T-1331-mobile-three-tabs.md) | Phone: three tabs (Chats, AIs, Settings); own profile opens from the Settings card; /profile still works | 2026-10-13 |
| [T-1330](T-1330-web-nav-simplify.md) | Web nav like Telegram: rail folders+Edit, short menu, /settings hub sharing the row list with mobile | 2026-10-13 |
| [T-1332](T-1332-own-ball-seed.md) | Own no-picture ball is the same personSeed ball on every web and mobile screen | 2026-10-13 |
| [T-1333](T-1333-reply-name-data.md) | Reply sender name resolved in history data; unloaded quotes named and coloured by the to JID | 2026-10-13 |
| [T-1328](T-1328-mobile-markdown-bubble.md) | Mobile bubbles: time bottom-right (inline or its own right row, never twice), Markdown tables render | 2026-10-13 |
| [T-1334](T-1334-orb-by-name-and-pictures.md) | Avatars: one shared EntityAvatar per app; orb seeded by name; real pictures wherever available | 2026-10-13 |
| [T-1335](T-1335-photo-bubbles-edge-to-edge.md) | Photos like Telegram: edge to edge in the bubble, time pill on the photo, caption below (mobile + web) | 2026-10-13 |
| [T-1336](T-1336-requests-in-chat-list.md) | Contact requests as rows at the top of the chat list with inline Accept / Decline (Undo) on mobile and web | 2026-10-13 |
| [T-1338](T-1338-mobile-viewer-gestures.md) | Mobile photo viewer gestures (hand-rolled): dropped, superseded by T-1341 | 2026-10-14 |
| T-1365…T-1392 | Model eval: 12 OpenCode Go models replay T-1361 (B) and T-1356 (A); never merged; results in `docs/audit/model-eval-2026-10.md` | stopped early (Go 402 funds), graded | per model | T-1364 | Julio 10-14 |
| [T-1337](T-1337-just-sent-photo-loads.md) | Just-sent photos keep the local preview and retry /api/files instead of sticking on Image unavailable (web + mobile) | 2026-10-13 |
| [T-1339](T-1339-web-viewer-zoom.md) | Web photo viewer: wheel/trackpad/double-click zoom, drag pan, touch swipe, prev/next arrows | 2026-10-13 |
| [T-1340](T-1340-web-viewer-dblclick.md) | Web viewer: double-click on the photo zooms and toggles back; only a click outside the photo closes | 2026-10-13 |
| [T-1341](T-1341-viewer-zoom-toolkit.md) | Mobile photo viewer on react-native-zoom-toolkit Gallery: swipe carousel, pinch, pan, double tap, pull down to close | 2026-10-13 |
| [T-1342](T-1342-library-audit.md) | Library audit: docs/audit/library-plan.md ranks hand-rolled UI to swap for libraries | 2026-10-13 |
| [T-1345](T-1345-keyboard-controller.md) | Mobile keyboard on react-native-keyboard-controller: composer rides the keyboard, last message stays visible | 2026-10-13 |
| [T-1347](T-1347-web-dnd-kit.md) | Web folder and sticker reorder on dnd-kit (mouse, touch, keyboard; named announcements) | 2026-10-13 |
| [T-1344](T-1344-web-dialogs-radix.md) | Web Dialog, Sheet and ConfirmDialog on Radix Dialog (focus trap, Escape, scroll lock), call sites unchanged | 2026-10-13 |
| [T-1346](T-1346-web-easy-crop.md) | Web avatar cropper on react-easy-crop (drag, wheel and pinch zoom, 256x256 export) | 2026-10-13 |
| [T-1343](T-1343-web-lightbox.md) | Web photo viewer on yet-another-react-lightbox (zoom, pan, swipe, arrows) | 2026-10-13 |
| [T-1348](T-1348-gorhom-sheets.md) | Mobile kit sheets native via react-native-true-sheet (drag to close, backdrop, keyboard) | 2026-10-13 |
| [T-1350](T-1350-web-base-ui.md) | Web Dialog, Sheet, ConfirmDialog and Button on Base UI; radix-ui removed | 2026-10-14 |
| [T-1351](T-1351-nested-confirm-escape.md) | Web: Escape on a confirm opened from a sheet or dialog closes only the confirm | 2026-10-14 |
| [T-1349](T-1349-web-menus-radix.md) | Web dropdown menus on Base UI Menu (portalled, collision-aware, cursor-anchored context menu) | 2026-10-14 |
| [T-1353](T-1353-search-overlap.md) | Web search results flow without overlap; request rows hide while searching | 2026-10-14 |
| [T-1352](T-1352-refresh-screenshots.md) | Docs screenshots and USER_GUIDE text refreshed to today's app | 2026-10-14 |
| [T-1354](T-1354-android-release-workflow.md) | GitHub Releases: tag v* builds release-signed APKs (arm64 + universal) and publishes them with notes | 2026-10-14 |
| [T-1355](T-1355-channel-shows-as-group.md) | Channels render as channels (no General topic expansion) on web and mobile | 2026-10-14 |
| [T-1356](T-1356-push-diagnostics.md) | Push diagnostics per device (kind, last push, last failure + reason) on web and mobile; migration 0054 | 2026-10-14 |
| [T-1358](T-1358-android-wake-shows-nothing.md) | Android: notifications are shown again (the foreground handler no longer drops every post; only the open chat stays silent); failed posts are logged | 2026-10-14 |
| [T-1357](T-1357-push-pending-sessions.md) | Push: ejabberd mod_push no longer suppresses every message push (include_body static text instead of false); config test + e2e steps | 2026-10-14 |
| [T-1359](T-1359-headless-wake-entry.md) | Android: the push wake task is defined in a new entry file, so a closed app handles the wake without being opened | 2026-10-14 |
| [T-1360](T-1360-component-iq-callee.md) | Push component: publishes go through iqCallee and get one result reply, so ejabberd no longer disables push after the first notification | 2026-10-14 |
| [T-1361](T-1361-unread-lost-after-wake.md) | Mobile: DM rows keep the server unread count and preview (the mobile DM mapper hard-coded unread 0) | 2026-10-14 |
| [T-1363](T-1363-mobile-dm-marks.md) | Mobile: DM rows keep readUntil/deliveredUntil (group keeps deliveredUntil); dead summariesForTopicsEntry removed | 2026-10-14 |
| [T-1362](T-1362-go-muse-fallback.md) | Lead tool: Go Muse joins the fallback chain before the paid Muse (workers and reviews) | 2026-10-14 |
| [T-1364](T-1364-launch-base-ref.md) | Lead tool: launch --base <ref> branches from an older commit and commits the task file (model eval replays) | 2026-10-14 |
| [T-1393](T-1393-ai-wizard-inline-key.md) | Create an AI: add a provider key inline in the wizard (mobile + web); the new key is selected, no dead end | 2026-10-14 |
| [T-1394](T-1394-provider-dropdown.md) | Provider dropdown (Base UI web, sheet mobile); GitHub hidden from the AI wizard; shared LLM provider list in chat-core | 2026-10-14 |
| [T-1397](T-1397-effect-ai-plan-audit.md) | Audit: Effect AI plan to replace LiteLLM (docs/audit/effect-ai-plan.md) | 2026-10-14 |
| [T-1398](T-1398-agent-ux-plan-audit.md) | Audit: quiet background agent UX plan (docs/audit/agent-ux-plan.md) | 2026-10-14 |
| [T-1395](T-1395-models-dev-catalog.md) | Model picker from the models.dev catalog: GET /api/ai/catalog (24 h cache, fallback) + searchable pickers with context and prices (web + mobile) | 2026-10-14 |
| [T-1401](T-1401-provisioning-without-litellm.md) | AI create/edit/delete without LiteLLM; AIs API needs only the key cipher | 2026-10-14 |
| [T-1402](T-1402-desk-runner-plan-audit.md) | Audit: desk (jail image + tool daemon, gVisor on VPS, desk-agent sidecar, egress proxy) and runner plan (docs/audit/desk-runner-plan.md) | 2026-10-14 |
| [T-1400](T-1400-ai-cards-never-notify.md) | AI progress cards never notify: push, unread, preview and the push preview route skip progress rows and their edits | 2026-10-14 |
| [T-1404](T-1404-lead-forget.md) | lead forget: drop finished tasks from the lead state | 2026-10-14 |
| [T-1399](T-1399-model-client-effect-ai.md) | Every AI model call through an Effect AI ModelClient on the AI's own provider connection; effect 4.0.4; listener off; gateway starts without LiteLLM | 2026-10-14 |
| [T-1403](T-1403-desk-image-tool-daemon.md) | packages/desk: pinned jail image + desk-tool daemon (bash/read/write/edit/grep/glob/git; path-escape and git https-only hardening) | 2026-10-14 |
| [T-1405](T-1405-ai-usage-cost.md) | ai_usage table: tokens + cost per AI per UTC day (models.dev prices); spend summary reads it instead of LiteLLM | 2026-10-14 |
| [T-1406](T-1406-ai-status-line.md) | AI status line: chat state carries a fixed status text shown next to the typing dots (web + mobile); aiStatus wired | 2026-10-14 |
| [T-1407](T-1407-desk-agent-sidecar.md) | Hands interface + desk-agent sidecar: fixed run flags, shared memory pool + admission, fair queue, idle stop, disk-image workspaces, unix-socket API; app-side cloud hands client | 2026-10-14 |
| [T-1408](T-1408-optional-ai-limits.md) | AI spending limits optional (no default) end to end; budget gate only for set limits | 2026-10-14 |
| [T-1410](T-1410-egress-proxy.md) | Desk egress proxy in packages/desk: open web, private/internal IPs blocked (pinned resolution), optional allowlist, host-only log; IP guard moved to packages/desk | 2026-10-14 |
| [T-1409](T-1409-desk-tools-in-loop.md) | Desk tools (bash, read, write, edit, grep, glob, git) in the agent loop via Hands for computer_mode=cloud; ais.computer_mode (0057) | 2026-10-14 |
| [T-1412](T-1412-server-image-desk.md) | Hotfix: server image copies packages/desk; gate checks app Dockerfiles copy every @zilar workspace dependency | 2026-10-14 |
| [T-1411](T-1411-desk-host-install.md) | AI computers install like the rest of Zilar: desk-agent + desk-egress compose services (off behind DESKS_ENABLED / profile desks), ./zilar host-setup (pinned gVisor via reload, 4 GB slice), doctor + init, docs | 2026-10-14 |
| [T-1415](T-1415-chat-menu-icons.md) | Web chat menu: icons on Topic info, Pinned messages, Media, Search, Chat background | 2026-10-14 |
| [T-1416](T-1416-unread-divider-own.md) | Unread divider never above your own message (count and id anchors skip own messages; web + mobile) | 2026-10-14 |
| [T-1413](T-1413-remove-litellm.md) | Remove LiteLLM: client, model entry, config + env, compose lines, dev container; stop reading llm_virtual_keys (tables dropped later) | 2026-10-14 |
| [T-1414](T-1414-task-card-protocol.md) | Task card protocol: one card per turn edited in place (title, steps, state, summary, elapsed), corrections carry the payload, no retraction | 2026-10-14 |
| [T-1417](T-1417-runner-desk-ops.md) | Runner desk ops: desk.* tunnel frames, runner runs desks with the shared lifecycle (runsc / docker-vm, no unsandboxed mode), local policy only tightens | 2026-10-14 |
| [T-1418](T-1418-wire-cloud-hands.md) | Wire the cloud desk client: DESK_IMAGE config, buildDeskClient, gateway gets it when socket + image are set | 2026-10-14 |
| [T-1420](T-1420-one-commit-per-task.md) | Lead CLI: one commit per task on main | 2026-10-14 |
| [T-1419](T-1419-task-card-ui.md) | Task card UI on web and mobile; clients apply card edits | 2026-10-14 |
| [T-1396](T-1396-openai-compatible-provider.md) | Custom OpenAI-compatible provider, SSRF-pinned | 2026-10-14 |
| [T-1424](T-1424-drop-litellm-tables.md) | Drop the unused LiteLLM tables | 2026-10-14 |
| [T-1421](T-1421-go-pause.md) | Lead models: pause OpenCode Go until a date | 2026-10-14 |
| [T-1423](T-1423-runner-hands.md) | RunnerHands + computer modes runner and auto | 2026-10-14 |
| [T-1426](T-1426-session-log.md) | Session log behind View steps: events table, route | 2026-10-14 |
| [T-1425](T-1425-computer-picker.md) | Computer picker per AI on web and mobile | 2026-10-14 |
| [T-1422](T-1422-stop-ai-turn.md) | Stop a running AI turn from its card (owner only) | 2026-10-14 |
| [T-1427](T-1427-gate-file-size.md) | Gate: changed files may not grow past 400 lines | 2026-10-14 |
| [T-1430](T-1430-orb-params.md) | Orb params: ballParams and ballSvg, output unchanged | 2026-10-14 |
| [T-1433](T-1433-sweep-client-findings.md) | Findings sweep (client UX): 57 rechecked on main | 2026-10-14 |
| [T-1434](T-1434-sweep-server-findings.md) | Findings sweep (server, sec, perf, AI, ops): 59 rechecked | 2026-10-14 |
| [T-1428](T-1428-one-line-installer.md) | One-line installer: curl | sh, sudo-aware, dry run | 2026-10-14 |
| [T-1435](T-1435-web-small-ux.md) | Web: remembered handle skip, invite spinner, deploy reload | 2026-10-14 |
| [T-1438](T-1438-get-zilar-app.md) | Web image serves /install.sh; get.zilar.app answers with it | 2026-10-14 |
| [T-1432](T-1432-mobile-sheet-kit.md) | Mobile sheet kit: D24 panel, header, sticky footer, step track | 2026-10-14 |
| [T-1437](T-1437-server-perf-batch.md) | Search without N+1, push archive cache, budget fails closed | 2026-10-14 |
| [T-1429](T-1429-catalog-providers.md) | Every models.dev OpenAI-compatible provider can back an AI | 2026-10-14 |
| [T-1439](T-1439-ops-docs.md) | Ops docs: Application-era backups, restore drill, install doc | 2026-10-14 |
| [T-1436](T-1436-mobile-small-ux.md) | Mobile: clear hit target, font caps, keyboard-safe auth, haptics | 2026-10-14 |
| [T-1431](T-1431-web-dialog-kit.md) | Web dialog kit: close key, footer, stepper, combobox, choice | 2026-10-15 |
| [T-1441](T-1441-catalog-ai-restart.md) | Catalog connections back an AI right after a restart | 2026-10-15 |
| [T-1442](T-1442-new-ai-shared.md) | New AI shared logic: providers, key check, orb swatches | 2026-10-15 |
| [T-1440](T-1440-ai-local-time.md) | AIs know the user's local date and time zone | 2026-10-15 |
| [T-1446](T-1446-web-dialogs-create.md) | Web create dialogs: one close key, Enter submits, step bar | 2026-10-15 |
| [T-1443](T-1443-mobile-sheets-forms.md) | Mobile sheets on the kit: default close key, one footer primary | 2026-10-15 |
| [T-1447](T-1447-web-dialogs-other.md) | Web dialogs: no Cancel/Close footer, kit error line and busy | 2026-10-15 |
| [T-1449](T-1449-poll-less-when-online.md) | Chat list and pins poll every 5 min while XMPP is online | 2026-10-15 |
| [T-1450](T-1450-stored-instance-owner.md) | Instance owner stored once; one isOwner for settings | 2026-10-15 |
| [T-1452](T-1452-web-polish-batch.md) | Web: connection status in the chat header, folder name focus | 2026-10-15 |
| [T-1444](T-1444-web-new-ai-flow.md) | Web New AI flow from the approved boards | 2026-10-15 |
| [T-1453](T-1453-ejabberd-schema-check.md) | Startup check of ejabberd table shapes; OPS_LOG for manual SQL | 2026-10-15 |
| [T-1451](T-1451-mobile-sheets-part2.md) | Mobile: New chat actions as modal kit sheets, no Cancel keys | 2026-10-15 |
| [T-1448](T-1448-ai-follows-owned-topic.md) | An AI that owns a topic follows it until reassigned or Stop | 2026-10-15 |
| [T-1454](T-1454-web-add-key-dialog.md) | Web Connections adds keys with the New AI provider and key steps | 2026-10-15 |
| [T-1457](T-1457-split-server-config.md) | Split server config.ts into config/ modules; ais/api under 400 | 2026-10-15 |
| [T-1455](T-1455-clear-removed-ai-owner.md) | Removing an AI clears it as topic owner | 2026-10-15 |
| [T-1459](T-1459-web-compatible-preselect.md) | Web: compatible provider never reuses an old endpoint | 2026-10-15 |
| [T-1458](T-1458-split-small-overs.md) | 400-line splits: mock group members, xmpp-core operations types | 2026-10-15 |
| [T-1456](T-1456-split-runner-tunnel.md) | 400-line split of runner-tunnel runner, server and mux | 2026-10-15 |
| [T-1463](T-1463-chat-row-title-shrink.md) | Mobile chat row title truncates; no overlap at large fonts | 2026-10-15 |
| [T-1462](T-1462-cert-expiry-check.md) | Daily TLS certificate expiry check for chat.zilar.app | 2026-10-15 |
| [T-1464](T-1464-search-field-font-scale.md) | Mobile search field stays centred and unclipped at large fonts | 2026-10-15 |
| [T-1460](T-1460-split-server-app.md) | Split server app.ts into app/ route modules | 2026-10-15 |
| [T-1465](T-1465-mobile-not-found.md) | Mobile: Zilar 'Page not found' screen for unknown routes | 2026-10-15 |
| [T-1461](T-1461-await-pending-spend.md) | Budget gate waits for in-flight AI spend writes | 2026-10-15 |
| [T-1467](T-1467-phone-build-metro-cache.md) | Phone builds clear Metro's cache so new routes are bundled | 2026-10-15 |
| [T-1466](T-1466-split-server-main.md) | Split server main.ts into startup/ modules | 2026-10-15 |
| [T-1468](T-1468-split-lead-client-cli.md) | 400-line split of the lead client and CLI | 2026-10-15 |
| [T-1469](T-1469-web-close-drops-created-key.md) | Web: closing New AI or Add key drops the key it created | 2026-10-15 |
| [T-1470](T-1470-mock-new-ai-chat.md) | Mock: a new AI gets its DM chat | 2026-10-15 |
| [T-1445](T-1445-mobile-new-ai-flow.md) | Mobile New AI flow as one kit sheet | 2026-10-15 |
| [T-1471](T-1471-provider-label-and-step-chips.md) | OpenAI-compatible label and one-line step chips | 2026-10-15 |
| [T-1472](T-1472-mobile-new-ai-followups.md) | Mobile New AI notice on chat, grey Zilar, no dead highlight | 2026-10-15 |
| [T-1473](T-1473-mobile-add-key-sheet.md) | Mobile Add key sheet on a shared key-check hook | 2026-10-15 |
| [T-1475](T-1475-add-key-chip-provider-name.md) | Add key chip shows the provider name | 2026-10-15 |
| [T-1476](T-1476-web-sidebar-recency-order.md) | Web sidebar orders chats by recency like mobile | 2026-10-15 |
| [T-1477](T-1477-web-mock-no-draft-stream.md) | Web mock mode opens no live draft stream | 2026-10-15 |
| [T-1478](T-1478-web-bubble-max-width.md) | Web message bubble fits its column at narrow widths | 2026-10-15 |
| [T-1479](T-1479-web-cache-date-crash.md) | Web cache rehydrates dates so a reload never goes blank | 2026-10-15 |
| [T-1474](T-1474-new-ai-chat-leads-list.md) | A new AI's chat leads the chat list on web and mobile | 2026-10-15 |
| [T-1480](T-1480-composer-placeholder-one-line.md) | Composer placeholder stays on one line on web and mobile | 2026-10-15 |
| [T-1481](T-1481-autopilot-split.md) | Split the lead autopilot under lead/autopilot/ | 2026-10-15 |
| [T-1483](T-1483-subtitle-online-not-above-members.md) | Group header never shows more online than members | 2026-10-15 |
| [T-1482](T-1482-reply-edit-focus-composer.md) | Reply and Edit focus the composer on web and mobile | 2026-10-15 |
| [T-1484](T-1484-escape-cancels-reply-first.md) | Escape cancels a reply before it closes the chat | 2026-10-15 |
| [T-1485](T-1485-web-a11y-axe-fixes.md) | Web fixes from an axe audit: composer, code blocks, Accept | 2026-10-15 |
| [T-1486](T-1486-mobile-table-font-scale.md) | Mobile table columns follow the system font scale | 2026-10-15 |
| [T-1487](T-1487-sandbox-log-test-flake.md) | Sandbox log test gets wide limits, ending a CI flake | 2026-10-15 |
| [T-1488](T-1488-contact-panel-key.md) | Contact info panel gets its own React key | 2026-10-15 |
| [T-1489](T-1489-predictive-back.md) | T-1489: Android predictive back is on (MUX-24) | 2026-10-15 |
| [T-1490](T-1490-ci-dead-deploy-cert-check.md) | T-1490: Drop the dead deploy job; cert check covers zilar.app | 2026-10-15 |
| [T-1491](T-1491-mock-dev-ai-title.md) | Mock AI DM is titled with the AI's name (Dev-1) | 2026-10-15 |
| [T-1492](T-1492-ais-count-as-members.md) | AIs count as members in groups and topics | 2026-10-15 |
| [T-1494](T-1494-web-group-info-pages.md) | Web group info root page with subpages and panel keys | 2026-10-15 |
| [T-1493](T-1493-save-follow-pause.md) | Save an AI's Stop pause on a followed topic | 2026-10-15 |
| [T-1495](T-1495-sticker-pack-link.md) | Sticker pack links: open and add any pack by its id | 2026-10-15 |
| [T-1496](T-1496-sticker-motion-server.md) | Moving stickers: GIF and video become animated WebP | 2026-10-15 |
| [T-1497](T-1497-web-sticker-pack-page.md) | Web sticker pack link page and pack menu with Share | 2026-10-15 |
| [T-1498](T-1498-approval-names.md) | Approvals carry the AI and group names | 2026-10-15 |
| [T-1500](T-1500-ai-work-audit.md) | AI work in topics: audit and step plan | 2026-10-15 |
| [T-1499](T-1499-web-approvals-simple.md) | Web approvals: one simple card and one list of rows | 2026-10-15 |
| [T-1502](T-1502-telegram-video-stickers.md) | Telegram importer keeps video stickers as animated WebP | 2026-10-15 |
| [T-1501](T-1501-web-sticker-motion.md) | Web sticker upload keeps GIF and video motion | 2026-10-15 |
| [T-1504](T-1504-ai-last-failure.md) | AI list carries each AI's last unanswered failure | 2026-10-15 |
| [T-1503](T-1503-web-connections.md) | Web Connections: one key list with status dots and a menu | 2026-10-15 |
| [T-1507](T-1507-mobile-stickers-expo-image.md) | Phone stickers render with expo-image so they move | 2026-10-15 |
| [T-1506](T-1506-web-lean-settings.md) | Web Settings home is lean: one-line rows, e-mail on the card | 2026-10-15 |
| [T-1511](T-1511-web-empty-chats.md) | Web empty chats: quiet DM, AI with model line and suggestions | 2026-10-15 |
| [T-1512](T-1512-web-several-files.md) | Web composer sends several files of any kind at once | 2026-10-15 |
| [T-1505](T-1505-ai-activity-read-model.md) | AI work step 1: per-topic AI activity read model | 2026-10-15 |
| [T-1513](T-1513-mobile-approvals-simple.md) | Phone approvals: simple card and one list of rows | 2026-10-15 |
| [T-1510](T-1510-web-ai-health.md) | Web My AIs shows each AI's health and today's spend | 2026-10-15 |
| [T-1508](T-1508-web-group-info-step2.md) | Web group info: More menu, Leave row, redrawn member rows | 2026-10-15 |
| [T-1515](T-1515-mobile-lean-settings.md) | Phone Settings tab is lean: one-line rows, e-mail on the card | 2026-10-15 |
| [T-1509](T-1509-web-new-pack-grid.md) | Web new pack is a sticker grid; GIF previews load again | 2026-10-15 |
| [T-1514](T-1514-ai-activity-in-topic-list.md) | Topic list carries each topic's AI activity | 2026-10-15 |
| [T-1519](T-1519-web-channel-info.md) | Web channel info: root page, subpages, Subscribers with icons | 2026-10-15 |
| [T-1520](T-1520-mobile-empty-chats.md) | Phone empty chats; the mock gets handles and two empty chats | 2026-10-15 |
| [T-1521](T-1521-topic-done-flag.md) | AI work step 3: a person marks a topic done (topics.done_at) | 2026-10-15 |
| [T-1518](T-1518-web-machines.md) | Web Machines: pending code card, plain rows with a details sheet | 2026-10-15 |
| [T-1516](T-1516-mobile-connections.md) | Phone Connections: one key list with dots and a key sheet | 2026-10-15 |
| [T-1523](T-1523-web-stickers-tabs.md) | Web Stickers: tabs, drag to reorder, lean pack rows | 2026-10-15 |
| [T-1527](T-1527-web-lean-leftovers.md) | Web lean leftovers: approvals header, Public and Private icons | 2026-10-15 |
| [T-1528](T-1528-live-ai-activity-refresh.md) | Topic list refreshes when an AI card starts, ends or asks | 2026-10-15 |
| [T-1522](T-1522-view-steps-audit.md) | View steps audit: data, route design and task list | 2026-10-15 |
| [T-1517](T-1517-mobile-ai-health.md) | Phone My AIs shows each AI's health and today's spend | 2026-10-15 |
| [T-1524](T-1524-mobile-pack-link.md) | Phone sticker pack link page and the /stickers/ app link | 2026-10-15 |
| [T-1526](T-1526-mobile-machines.md) | Phone Machines: pending code card, lean rows, details sheet | 2026-10-15 |
| [T-1531](T-1531-sticker-owner-handle.md) | Sticker lists show the owner's @handle; empty texts say New pack | 2026-10-15 |
| [T-1532](T-1532-web-topic-activity-marks.md) | Web topic rows and the AIs here key show the AIs at work | 2026-10-15 |
| [T-1538](T-1538-web-ai-health-shared.md) | Web AI health row uses chat-core's aiHealth and formatUsd | 2026-10-15 |
| [T-1530](T-1530-view-steps-server.md) | View steps route: a task's card steps with their actions | 2026-10-15 |
| [T-1529](T-1529-mention-follow.md) | The last @mentioned AI follows a topic (topics.follower_ai_id) | 2026-10-15 |
| [T-1534](T-1534-web-remove-task-strip.md) | Web drops the task strip; link row and Mark as done in info | 2026-10-15 |
| [T-1525](T-1525-mobile-sticker-motion.md) | Phone sticker upload keeps GIF and video motion | 2026-10-15 |
| [T-1533](T-1533-mobile-my-packs.md) | Phone Stickers My packs: lean rows and a pack sheet with Share | 2026-10-15 |
| [T-1541](T-1541-web-album-order.md) | Web sends an album's photos together, then the other files | 2026-10-15 |
| [T-1544](T-1544-split-chats-unread.md) | Split chats/unread.ts: the archive SQL builders move out | 2026-10-15 |
| [T-1543](T-1543-split-chats-api.md) | Split chats/api.ts: the list and mark handlers move out | 2026-10-15 |
| [T-1537](T-1537-web-ai-status-line.md) | Web status line above a topic's composer shows the AIs at work | 2026-10-15 |
| [T-1545](T-1545-split-web-store-types.md) | Split the web store types: group and topic members move out | 2026-10-15 |
| [T-1539](T-1539-mobile-topic-activity-marks.md) | Phone topic rows and the AIs here sheet show the AIs at work | 2026-10-15 |
| [T-1540](T-1540-mobile-remove-task-strip.md) | Phone drops the task strip; link and done rows in topic info | 2026-10-15 |
| [T-1536](T-1536-mobile-several-files.md) | Phone sends several files at once; photos go as one album | 2026-10-15 |
| [T-1547](T-1547-split-chat-rows.md) | Split client-core chat-rows.ts: topic mappers and row helpers | 2026-10-15 |
| [T-1546](T-1546-split-topics-access.md) | Split topics/access.ts: types and AI access move out | 2026-10-15 |
| [T-1549](T-1549-split-message-bubble.md) | Split MessageBubble.tsx: the derived flags move to bubbleFlags | 2026-10-15 |
| [T-1550](T-1550-mobile-dead-labels.md) | Phone drops dead status and strip label helpers | 2026-10-15 |
| [T-1542](T-1542-mobile-group-info-audit.md) | Phone Group info audit: plan and six tasks | 2026-10-15 |
| [T-1548](T-1548-mobile-new-pack-grid.md) | Phone pack editor shows one sticker grid with a tile sheet | 2026-10-15 |
| [T-1556](T-1556-split-web-ports.md) | Split web ports.ts: the ApiClient and StorageLike types move out | 2026-10-15 |
| [T-1555](T-1555-split-client-core-lifecycle.md) | Split client-core lifecycle.ts: the XMPP connect block moves out | 2026-10-15 |
| [T-1535](T-1535-web-view-steps.md) | Web View steps panel: a task card's steps with their actions | 2026-10-15 |
| [T-1554](T-1554-split-actions-decisions.md) | Split actions/decisions.ts: the approval path moves out | 2026-10-15 |
| [T-1553](T-1553-split-avatars-service.md) | Split avatars/service.ts: the byte check and file read move out | 2026-10-15 |
| [T-1561](T-1561-web-dead-format-limits.md) | Web drops the unused formatLimits | 2026-10-15 |
| [T-1551](T-1551-mobile-ai-status-line.md) | Phone status line above a topic's composer shows the AIs at work | 2026-10-15 |
| [T-1558](T-1558-split-build-outgoing.md) | Split build-outgoing.ts: the control stanza builders move out | 2026-10-15 |
| [T-1559](T-1559-split-auth-api.md) | Split auth/api.ts: the /me view moves out | 2026-10-15 |
| [T-1560](T-1560-split-client-core-history.md) | Split client-core history.ts: types and state helpers move out | 2026-10-15 |
| [T-1563](T-1563-split-mobile-history-effects.md) | Split phone history effects: the core history adapter moves out | 2026-10-15 |
| [T-1557](T-1557-mobile-stickers-polish.md) | Phone stickers: large titles, visibility switch, lean Discover | 2026-10-15 |
| [T-1564](T-1564-mobile-sticker-types.md) | Phone sticker types: a kept moving file declares its real type | 2026-10-15 |
| [T-1565](T-1565-split-push-api-handlers.md) | Split push/api-handlers.ts: the test route moves out | 2026-10-15 |
| [T-1562](T-1562-mobile-view-steps.md) | Phone View steps sheet on a finished task card | 2026-10-15 |
| [T-1567](T-1567-sticker-convert-logs-pino.md) | Sticker conversion failures log through pino | 2026-10-15 |
| [T-1568](T-1568-card-timer-mss.md) | Task card timers show m:ss on web and phone | 2026-10-15 |
| [T-1552](T-1552-mobile-group-info-root.md) | Phone Group info root: identity, four keys, people rows, Leave | 2026-10-15 |
| [T-1566](T-1566-audit-handoff-questions.md) | Audit: handoff lines and question chips plan | 2026-10-15 |
| [T-1570](T-1570-split-group-turn-body.md) | Split group-turn-body.ts: the handoff roster read moves out | 2026-10-15 |
| [T-1569](T-1569-mobile-group-info-people.md) | Phone Group info: Members and AIs pages, add and remove | 2026-10-15 |
| [T-1571](T-1571-ai-questions-table.md) | AI questions: the ai_questions table and its service | 2026-10-15 |
| [T-1573](T-1573-mobile-group-info-content.md) | Phone Group info: Content pages (media, pins, tools, activity) | 2026-10-15 |
| [T-1572](T-1572-handoff-marker.md) | Handoff marker: AI replies carry a handoff.line payload | 2026-10-15 |
| [T-1575](T-1575-handoff-line-render.md) | Handoff line on web and phone: from → to · task | 2026-10-15 |
| [T-1577](T-1577-activity-open-question.md) | An open AI question shows as waiting, with its message id | 2026-10-15 |
| [T-1576](T-1576-ask-people-tool.md) | AI ask_people tool posts a question card | 2026-10-15 |
| [T-1580](T-1580-split-tool-exec.md) | Split tool-exec.ts: the delegate and task_status runners move | 2026-10-15 |
| [T-1574](T-1574-mobile-group-info-settings.md) | Phone Group info Settings page; the group header drops its keys | 2026-10-15 |
| [T-1579](T-1579-question-answer-path.md) | A person's reply closes the AI's open question | 2026-10-15 |
| [T-1578](T-1578-question-card-chips.md) | Question card with reply chips on web and phone | 2026-10-15 |
| [T-1581](T-1581-mobile-channel-info-root.md) | Phone channel info root and Subscribers page | 2026-10-15 |
| [T-1582](T-1582-desk-images-in-ci.md) | CI publishes the AI computer images; zilar up pins the jail | 2026-10-15 |
| [T-1586](T-1586-ais-here-opens-question.md) | A waiting AI in AIs here opens its question in the chat | 2026-10-15 |
| [T-1585](T-1585-install-preflight.md) | Installer checks the host first and stops clearly without Docker | 2026-10-15 |
| [T-1584](T-1584-coolify-split-layout.md) | Coolify target layout: zilar-core compose and LAYOUT.md | 2026-10-15 |
| [T-1587](T-1587-mobile-channel-content-settings.md) | Phone channel Content, Settings and More; channel opens on start | 2026-10-15 |
| [T-1583](T-1583-fresh-install-ci-test.md) | CI installs Zilar fresh after each image publish and checks it | 2026-10-15 |
| [T-1589](T-1589-install-test-ws-http11.md) | Fresh-install test checks the WebSocket over HTTP/1.1 | 2026-10-15 |
| [T-1588](T-1588-install-coolify-mode.md) | Installer Coolify mode: the whole layout through Coolify's API | 2026-10-15 |
| [T-1590](T-1590-landing-serves-installer.md) | Landing app serves the installer on get.zilar.app | 2026-10-15 |
| [T-1592](T-1592-coolify-template.md) | Coolify one-click template with AI computer services | 2026-10-15 |
| [T-1593](T-1593-installer-coolify-template-path.md) | Installer points Coolify users to the template; --desks-host | 2026-10-15 |
| [T-1595](T-1595-android-release-setup-fix.md) | Android release installs only platform-tools | 2026-10-15 |
| [T-1597](T-1597-readme-rewrite.md) | New README: simpler, current install and stack | 2026-10-15 |
| [T-1596](T-1596-flaky-run-tool-log-test.md) | Sandbox worker heap headroom fixes the flaky log test | 2026-10-15 |
| [T-1598](T-1598-remove-tunnel-model-path.md) | Remove the tunnel's model path, the last LiteLLM code | 2026-10-15 |
| [T-1601](T-1601-ais-on-by-default.md) | AIs answer on a fresh install (gateway on by default) | 2026-10-15 |
| [T-1600](T-1600-server-config-doc-regen.md) | Server config reference rewritten from the current schema | 2026-10-15 |
| [T-1599](T-1599-audit-ai-computers-auto.md) | Audit: AI computers that turn on with one host command | 2026-10-15 |
| [T-1604](T-1604-computer-card-setup-text.md) | Computer card: 'Needs setup on your server' | 2026-10-15 |
| [T-1602](T-1602-desk-agent-readiness.md) | Desk agent waits for gVisor and pins its own image | 2026-10-15 |
| [T-1603](T-1603-server-asks-desk-agent.md) | Server asks the desk agent whether it is ready | 2026-10-15 |
| [T-1605](T-1605-desks-always-in-stack.md) | AI computer services in every stack; one host command | 2026-10-15 |
| [T-1607](T-1607-installer-from-latest-release.md) | get.zilar.app redirects to the latest release's install.sh | 2026-10-15 |
| [T-1606](T-1606-egress-registry-env-name.md) | Desk egress reads its registry socket setting | 2026-10-15 |
| [T-1608](T-1608-android-release-create-race.md) | Android release survives the release-create race | 2026-10-15 |
| [T-1609](T-1609-installer-job-condition.md) | Installer job runs on tags (status function) | 2026-10-15 |
| [T-1610](T-1610-host-setup-installs-prereqs.md) | host-setup installs bzip2 and jq when missing | 2026-10-15 |
| [T-1611](T-1611-desk-turns-multi-round.md) | Computer turns get 40 rounds, 80 calls and 15 minutes | 2026-10-15 |
| [T-1612](T-1612-jail-reaches-egress-proxy.md) | AI computers reach the egress proxy under gVisor; jail gets curl | 2026-10-15 |
| [T-1613](T-1613-ai-tools-on-by-default.md) | AI tools, routines and web tools on by default | 2026-10-15 |
| [T-1615](T-1615-workspace-reaches-jail.md) | AI disk reaches its computer, owned by the jail user | 2026-10-15 |
| [T-1616](T-1616-prices-and-action-args.md) | Prices from Yahoo; every action shows the model its args | 2026-10-15 |
| [T-1617](T-1617-typed-mentions.md) | A typed @Name or 'Name, ...' wakes the AI in groups | 2026-10-15 |
| [T-1618](T-1618-web-work-card-standalone.md) | Web work card stands alone: no bubble, text or edited row | 2026-10-15 |
| [T-1622](T-1622-split-group-turn.md) | Split GroupTurnDeps out of agents/group-turn.ts | 2026-10-15 |
| [T-1623](T-1623-desk-tool-says-what-it-has.md) | The bash tool tells the AI what its computer has | 2026-10-15 |
| [T-1619](T-1619-phone-work-card-standalone.md) | Phone work card stands alone: no bubble or meta row | 2026-10-15 |
| [T-1620](T-1620-recreate-unknown-jails.md) | Desk agent recreates jails left from an earlier run | 2026-10-15 |
| [T-1624](T-1624-web-tools-logger.md) | Web tools log through the server logger | 2026-10-15 |
| [T-1628](T-1628-split-xmpp-lifecycle.md) | Split the keepalive out of xmpp-core lifecycle.ts | 2026-10-15 |
| [T-1621](T-1621-smart-wake-plan.md) | Plan: smart wake for AIs in group chats | 2026-10-15 |
| [T-1627](T-1627-split-gateway-dm-turn.md) | Split the turn input out of gateway/dm-turn.ts | 2026-10-15 |
| [T-1626](T-1626-jails-across-restarts.md) | Desk agent clears jails on stop and start, re-registers egress | 2026-10-15 |
| [T-1629](T-1629-compose-log-rotation.md) | Every compose service rotates its logs (json-file 10m x 3) | 2026-10-16 |
| [T-1625](T-1625-no-double-mention.md) | Group replies never start with a doubled @mention | 2026-10-16 |
| [T-1631](T-1631-addressing-core.md) | Addressing core: decide when a group message is for an AI | 2026-10-16 |
| [T-1632](T-1632-client-findings-resweep.md) | Fresh status for the open client findings | 2026-10-16 |
| [T-1635](T-1635-split-desk-docker.md) | Split the jail argument builders out of desk docker.ts | 2026-10-16 |
| [T-1636](T-1636-split-model-client.md) | Split the error mapping out of ai/model-client.ts | 2026-10-16 |
| [T-1634](T-1634-split-dm-tool-turn.md) | Split the tool round loop out of agents/dm-tool-turn.ts | 2026-10-16 |
| [T-1633](T-1633-wire-smart-wake.md) | Group AIs wake on a name, a one-AI-room question or a follow-up | 2026-10-16 |
| [T-1637](T-1637-split-run-tool.md) | Split the worker schemas out of sandbox/run-tool.ts | 2026-10-16 |
| [T-1638](T-1638-routine-kind-migration.md) | Routines can hold a prompt: migration 0067 and the row type | 2026-10-16 |
| [T-1630](T-1630-findings-resweep.md) | Fresh status for the open server findings | 2026-10-16 |
| [T-1640](T-1640-routine-timezone-guide.md) | Tool guide: routines use the person's own time zone | 2026-10-16 |
| [T-1639](T-1639-turn-outcome-stopped.md) | A stopped AI turn has its own outcome, not a failure | 2026-10-16 |
| [T-1641](T-1641-create-prompt-routine.md) | createPromptRoutine stores a prompt routine (service only) | 2026-10-16 |
| [T-1643](T-1643-pin-ejabberd-digest.md) | Pin the ejabberd base image by digest (OPS-7) | 2026-10-16 |
| [T-1642](T-1642-dm-scheduled-item.md) | DM queue accepts a scheduled run and reports its outcome | 2026-10-16 |
| [T-1645](T-1645-execute-prompt-routine.md) | Routine executor runs prompt routines with a daily cap | 2026-10-16 |
| [T-1644](T-1644-ci-deploy-checks.md) | CI runs the offline deploy tests and renders every compose file | 2026-10-16 |
| [T-1646](T-1646-room-scheduled-item.md) | Room queue accepts a scheduled run as its own turn | 2026-10-16 |
| [T-1650](T-1650-backup-doc-test-ci.md) | Backup doc says ejabberd-database is not covered; test joins CI | 2026-10-16 |
| [T-1651](T-1651-routine-row-prompt-label.md) | Routines lists say 'runs a prompt' for prompt routines | 2026-10-16 |
| [T-1652](T-1652-stat-gnu-first.md) | Shell scripts try GNU stat before BSD stat (Linux fix) | 2026-10-16 |
| [T-1647](T-1647-scheduled-turn-runner.md) | Gateway runs a routine's scheduled turn and returns its outcome | 2026-10-16 |
| [T-1653](T-1653-git-credentials-plan.md) | Plan: GitHub access for AI computers via a proxy git endpoint | 2026-10-16 |
| [T-1648](T-1648-wire-run-prompt.md) | Routine scheduler runs prompt routines through the gateway | 2026-10-16 |
| [T-1649](T-1649-routine-schedule-prompt-card.md) | routine.schedule accepts a prompt the AI runs on schedule | 2026-10-16 |
| [T-1655](T-1655-scheduled-safe-actions.md) | Scheduled runs use no-approval actions; tier 2 needs a person | 2026-10-16 |
| [T-1656](T-1656-scheduled-path-trace.md) | Audit: scheduled prompt routine traced end to end | 2026-10-16 |
| [T-1654](T-1654-parity-recheck.md) | Audit: phone parity re-check for 10-10..10-16 web changes | 2026-10-16 |
| [T-1658](T-1658-scheduled-run-routine-fixes.md) | Prompt routines refund offline slots; bad schedules park one row | 2026-10-16 |
| [T-1659](T-1659-back-cancels-reply.md) | Phone: Android back cancels an armed reply or edit first | 2026-10-16 |
| [T-1657](T-1657-scheduled-run-gateway-fixes.md) | Scheduled runs: timeout from turn start, own DM turn | 2026-10-16 |
| [T-1660](T-1660-phone-emoji-search.md) | Phone: search the Emoji tab by name | 2026-10-16 |
| [T-1662](T-1662-topic-header-group-link.md) | Phone: the topic header's group name opens the group | 2026-10-16 |
| [T-1661](T-1661-split-group-turn-body.md) | Split the room turn's access rules into group-turn-access.ts | 2026-10-16 |
| [T-1663](T-1663-confirm-archive-topic.md) | Phone: archiving a topic for everyone asks first | 2026-10-16 |
| [T-1664](T-1664-profile-shared-media.md) | Phone: Shared media row in the contact panel | 2026-10-16 |
| [T-1665](T-1665-phone-emoji-common.md) | Phone emoji picker adds common emoji; table split under 400 | 2026-10-16 |
| [T-1666](T-1666-phone-select-delete-copy.md) | Phone select mode: Delete and Copy beside Forward | 2026-10-16 |
| [T-1667](T-1667-phone-reply-quote-jump.md) | Phone: tap a reply quote to jump to the quoted message | 2026-10-16 |
| [T-1614](T-1614-scheduled-ai-jobs-plan.md) | Plan: scheduled AI jobs (prompt routines) | 2026-10-16 |
| [T-1668](T-1668-phone-people-prefix-search.md) | Phone: chat-list search finds people by name prefix | 2026-10-16 |
| [T-1670](T-1670-selection-bar-fit.md) | Phone select bar: icon keys so the count fits | 2026-10-16 |
| [T-1671](T-1671-split-topic-row.md) | Split GroupHeaderRow out of the web TopicRow | 2026-10-16 |
| [T-1669](T-1669-emoji-sheet-keyboard.md) | Phone emoji sheet rises above the keyboard | 2026-10-16 |
| [T-1674](T-1674-split-message-bubble.md) | Split the phone bubble's reveal hook; sticker quote long hold | 2026-10-16 |
| [T-1673](T-1673-shared-emoji-table.md) | One emoji table for web and phone in chat-core | 2026-10-16 |
| [T-1676](T-1676-channel-manage-noun.md) | Phone: channel manage errors say channel | 2026-10-16 |
| [T-1675](T-1675-split-web-composer.md) | Split the web composer's recording lifecycle into a hook | 2026-10-16 |
| [T-1677](T-1677-phone-new-message-contacts.md) | Phone: New message lists contacts with a filter | 2026-10-16 |
| [T-1678](T-1678-split-group-members.md) | Split member roles out of groups/members.ts | 2026-10-16 |
| [T-1680](T-1680-split-mobile-ports.md) | Split the media helpers out of the phone store ports | 2026-10-16 |
| [T-1681](T-1681-oxlint-stale-exemptions.md) | Drop two stale max-lines lint exemptions | 2026-10-16 |
| [T-1672](T-1672-mock-handle-identity.md) | Mock: a seed person's handle resolves to their seed id | 2026-10-16 |
| [T-1679](T-1679-split-client-polling.md) | Split the draft stream out of client-core polling.ts | 2026-10-16 |
| [T-1683](T-1683-split-topic-panel-ops.md) | Split the list helpers out of the web topicPanelOps.ts | 2026-10-16 |
| [T-1682](T-1682-split-giphy.md) | Split the Giphy parser out of giphy.ts; drop the dead fake | 2026-10-16 |
| [T-1684](T-1684-split-group-actions.md) | Split the role actions out of the phone group-actions.ts | 2026-10-16 |
| [T-1685](T-1685-split-tool-mutations.md) | Split the tool deletes out of tools/mutations.ts | 2026-10-16 |
| [T-1686](T-1686-split-tool-queries.md) | Split the row mappers out of tools/queries.ts | 2026-10-16 |
| [T-1688](T-1688-split-media-api.md) | Split the gallery item mapping out of media/api.ts | 2026-10-16 |
| [T-1687](T-1687-split-group-ais.md) | Split the topic-room sync out of groups/ais.ts | 2026-10-16 |
| [T-1689](T-1689-split-message-list.md) | Split the scroll logic out of the web MessageList | 2026-10-16 |
| [T-1690](T-1690-split-profile-settings.md) | Split the handle check out of the phone profile hook | 2026-10-16 |
| [T-1691](T-1691-split-voice-recorder.md) | Split the shared composer pieces out of useVoiceRecorder | 2026-10-16 |
| [T-1693](T-1693-phone-copied-notice.md) | Phone: a short Copied notice after copying messages | 2026-10-16 |
| [T-1694](T-1694-split-approvals-service.md) | Split verifyApproval out of approvals/service.ts | 2026-10-16 |
| [T-1697](T-1697-split-chat-view.md) | Split the select mode out of the web ChatView | 2026-10-16 |
| [T-1696](T-1696-split-admin-client.md) | Split the ejabberd admin client's parsers and transport | 2026-10-16 |
| [T-1699](T-1699-split-ai-memory-section.md) | Split the memory logic out of the phone AI memory section | 2026-10-16 |
| [T-1700](T-1700-split-guarded-fetch.md) | Split the pinned request out of web-tools/guarded-fetch.ts | 2026-10-16 |
| [T-1695](T-1695-split-web-push.md) | Split the badge code out of the web push.ts | 2026-10-16 |
| [T-1692](T-1692-phone-scroll-memory.md) | Phone remembers where you left each chat | 2026-10-16 |
| [T-1698](T-1698-split-collect-snapshot.md) | Split the worktree git cache out of lead collect-snapshot.ts | 2026-10-16 |
| [T-1701](T-1701-split-contact-requests.md) | Split the request decisions out of contact-requests/service | 2026-10-16 |
| [T-1703](T-1703-split-sticker-storage.md) | Split the sticker view mappers out of stickers/storage.ts | 2026-10-16 |
| [T-1702](T-1702-split-routine-support.md) | Split the bulk routine deletes out of routines/support.ts | 2026-10-16 |
| [T-1704](T-1704-routine-schedule-example.md) | routine.schedule: neutral example and the hourly minimum | 2026-10-16 |
| [T-1708](T-1708-gate-boot-guard.md) | Gate always runs the server's boot-guard test | 2026-10-16 |
| [T-1706](T-1706-sec13b-desk-gate.md) | SEC-13b: only the owner or an admin can use the AI's computer | 2026-10-16 |
| [T-1705](T-1705-flat-app-icon.md) | Phone app icon from the flat Zilar mark | 2026-10-16 |
| [T-1707](T-1707-minute-routines.md) | Routines every minute, 1440 runs a day, no overlapping runs | 2026-10-16 |
| [T-1710](T-1710-short-chat-replies.md) | Short chat replies: no narration, tool names or URLs | 2026-10-16 |
| [T-1711](T-1711-audit-routine-live-message.md) | Plan: a routine's single live message | 2026-10-16 |
| [T-1709](T-1709-continue-after-approval.md) | The AI continues its task after an approval | 2026-10-16 |
| [T-1713](T-1713-routine-message-store.md) | Routines store their live message id (migration 0068) | 2026-10-16 |
| [T-1712](T-1712-merge-hold-push.md) | lead merge --hold and lead push: one deploy per batch | 2026-10-16 |
| [T-1715](T-1715-edited-time.md) | 'edited' shows the latest edit time on web and phone | 2026-10-16 |
| [T-1714](T-1714-routine-send.md) | A routine posts one message and later runs edit it | 2026-10-16 |
| [T-1716](T-1716-quiet-approvals.md) | Quieter approvals: no extra messages, no hosts in the card | 2026-10-16 |
| [T-1717](T-1717-my-routines-api.md) | GET /api/routines: all routines of the AIs I own | 2026-10-16 |
| [T-1718](T-1718-free-models-first.md) | Free models first: free DeepSeek workers, free GLM reviews | 2026-10-16 |
| [T-1719](T-1719-web-routines-page.md) | Web Settings › Routines: every routine, Ask and Pause | 2026-10-16 |
| [T-1721](T-1721-routine-payload.md) | Routine messages carry a routine payload; failures post nothing | 2026-10-16 |
| [T-1720](T-1720-phone-routines-screen.md) | Phone Settings › Routines: every routine, Ask and Pause | 2026-10-16 |
| [T-1723](T-1723-routine-approval-card.md) | Routine approval card: repeat icon, title and schedule | 2026-10-16 |
| [T-1722](T-1722-routine-header-bump.md) | Routine header in chat; each routine edit bumps the chat | 2026-10-16 |
| [T-1726](T-1726-android-icon-size.md) | Android icon: smaller mark inside the launcher circle | 2026-10-16 |
| [T-1724](T-1724-android-update-core.md) | Android updater core: check, download, install | 2026-10-16 |
| [T-1727](T-1727-members-ask-card-reply.md) | Members can ask AIs; no memory-only card; live-facts rule | 2026-10-16 |
| [T-1725](T-1725-android-update-ui.md) | Android updater UI: update dialog and Settings › This app | 2026-10-16 |
| [T-1728](T-1728-site-next-scaffold.md) | T-1728: new landing scaffold in apps/site-next (Next 16 export) | 2026-10-16 |
| [T-1729](T-1729-site-next-planet.md) | real WebGL planet behind the new landing, scroll stations | 2026-10-16 |
| [T-1731](T-1731-site-next-story.md) | pinned phone story on the new landing | 2026-10-16 |
| [T-1730](T-1730-site-next-hero.md) | hero and ownership line on the new landing | 2026-10-16 |
| [T-1733](T-1733-site-next-details.md) | details strip with live demos on the new landing | 2026-10-16 |
| [T-1736](T-1736-mobile-no-cookies.md) | phone never sends cookies (403 on sign-in after sign-out) | 2026-10-16 |
| [T-1732](T-1732-site-next-keys-computer.md) | provider band and pinned terminal on the new landing | 2026-10-16 |
| [T-1737](T-1737-routine-actions-fixes.md) | routines: tool form without hosts, ids, delete by id, one card | 2026-10-16 |
| [T-1738](T-1738-ai-turn-behaviour.md) | AI turns: no post after routine OK; typed answer closes question | 2026-10-16 |
| [T-1740](T-1740-phone-group-routines.md) | phone group page manages routines; last fetches omit cookies | 2026-10-16 |
| [T-1741](T-1741-group-admins.md) | group admins: owner can make or remove admins (web + phone) | 2026-10-16 |
| [T-1734](T-1734-site-next-install-finale.md) | install and finale on the new landing | 2026-10-16 |
| [T-1744](T-1744-web-ai-card.md) | web work card: one-line finished card with chevron, 2-line title | 2026-10-16 |
| [T-1742](T-1742-site-next-polish.md) | landing polish: hero planet clears headline, static fallback | 2026-10-16 |
| [T-1743](T-1743-review-follow-ups.md) | review follow-ups: quotes, routine messages, group wording | 2026-10-16 |
| [T-1739](T-1739-phone-ai-cards.md) | phone AI cards as drawn, no empty quotes, jump via archive id | 2026-10-16 |
| [T-1745](T-1745-ai-names-task.md) | the AI names its work card (task_title on its first call) | 2026-10-16 |
