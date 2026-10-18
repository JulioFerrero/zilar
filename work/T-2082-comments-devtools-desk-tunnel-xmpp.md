---
id: T-2082
title: "Cut comments (devtools, desk, runner-tunnel, xmpp-core, runner): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2082-comments-devtools-desk-tunnel-xmpp
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2082: Comment cut — devtools, desk, runner-tunnel, xmpp-core, runner

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2963 comment lines in 202 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1481** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/runner/src/capabilities.ts`
- `apps/runner/src/cli.ts`
- `apps/runner/src/connect.ts`
- `apps/runner/src/desk/driver.ts`
- `apps/runner/src/desk/handler.ts`
- `apps/runner/src/desk/policy.ts`
- `apps/runner/src/identity.ts`
- `apps/runner/src/pair.ts`
- `packages/desk/src/agent/admission.ts`
- `packages/desk/src/agent/config.ts`
- `packages/desk/src/agent/docker-args.ts`
- `packages/desk/src/agent/docker-network.ts`
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/egress.ts`
- `packages/desk/src/agent/index.ts`
- `packages/desk/src/agent/lifecycle.ts`
- `packages/desk/src/agent/main.ts`
- `packages/desk/src/agent/server.ts`
- `packages/desk/src/agent/test-harness.ts`
- `packages/desk/src/agent/wire.ts`
- `packages/desk/src/agent/workspace.ts`
- `packages/desk/src/capture.ts`
- `packages/desk/src/egress/ip-guard.ts`
- `packages/desk/src/egress/log.ts`
- `packages/desk/src/egress/main.ts`
- `packages/desk/src/egress/policy.ts`
- `packages/desk/src/egress/proxy.ts`
- `packages/desk/src/egress/registry.ts`
- `packages/desk/src/hands.ts`
- `packages/desk/src/paths.ts`
- `packages/desk/src/process.ts`
- `packages/desk/src/protocol.ts`
- `packages/desk/src/serve.ts`
- `packages/desk/src/tool.ts`
- `packages/desk/src/tools/bash.ts`
- `packages/desk/src/tools/edit.ts`
- `packages/desk/src/tools/git.ts`
- `packages/desk/src/tools/glob.ts`
- `packages/desk/src/tools/grep.ts`
- `packages/desk/src/tools/read.ts`
- `packages/desk/src/tools/write.ts`
- `packages/devtools/src/code-map/cli.ts`
- `packages/devtools/src/code-map/collect.ts`
- `packages/devtools/src/code-map/page.js`
- `packages/devtools/src/code-map/treemap.js`
- `packages/devtools/src/effect-map/generate.ts`
- `packages/devtools/src/effect-map/ratchet-cli.ts`
- `packages/devtools/src/effect-map/ratchet.ts`
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/images.ts`
- `packages/devtools/src/gate/migrations.ts`
- `packages/devtools/src/gate/pass-record.ts`
- `packages/devtools/src/gate/plan.ts`
- `packages/devtools/src/gate/scope.ts`
- `packages/devtools/src/gate/size.ts`
- `packages/devtools/src/gate/slots.ts`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/autopilot/actions.ts`
- `packages/devtools/src/lead/autopilot/doctor-tick.ts`
- `packages/devtools/src/lead/autopilot/task-info.ts`
- `packages/devtools/src/lead/batch.ts`
- `packages/devtools/src/lead/batch/check.ts`
- `packages/devtools/src/lead/batch/merge.ts`
- `packages/devtools/src/lead/batch/parsers.ts`
- `packages/devtools/src/lead/batch/real.ts`
- `packages/devtools/src/lead/batch/text.ts`
- `packages/devtools/src/lead/batch/types.ts`
- `packages/devtools/src/lead/batch/wave.ts`
- `packages/devtools/src/lead/board.ts`
- `packages/devtools/src/lead/cli.ts`
- `packages/devtools/src/lead/cli/commands.ts`
- `packages/devtools/src/lead/cli/merge.ts`
- `packages/devtools/src/lead/client.ts`
- `packages/devtools/src/lead/client/fake.ts`
- `packages/devtools/src/lead/client/interface.ts`
- `packages/devtools/src/lead/client/opencode-cli.ts`
- `packages/devtools/src/lead/client/payload.ts`
- `packages/devtools/src/lead/collect-snapshot.ts`
- `packages/devtools/src/lead/decide.ts`
- `packages/devtools/src/lead/doctor.ts`
- `packages/devtools/src/lead/fallback.ts`
- `packages/devtools/src/lead/forget.ts`
- `packages/devtools/src/lead/free-pause.ts`
- `packages/devtools/src/lead/fresh-session.ts`
- `packages/devtools/src/lead/git.ts`
- `packages/devtools/src/lead/go-pause.ts`
- `packages/devtools/src/lead/launch.ts`
- `packages/devtools/src/lead/merge.ts`
- `packages/devtools/src/lead/model-schedule.ts`
- `packages/devtools/src/lead/models.ts`
- `packages/devtools/src/lead/policy/classify.ts`
- `packages/devtools/src/lead/policy/curl.ts`
- `packages/devtools/src/lead/policy/filters.ts`
- `packages/devtools/src/lead/policy/rm.ts`
- `packages/devtools/src/lead/policy/rules.ts`
- `packages/devtools/src/lead/policy/shell-parse.ts`
- `packages/devtools/src/lead/policy/types.ts`
- `packages/devtools/src/lead/processes.ts`
- `packages/devtools/src/lead/prompts.ts`
- `packages/devtools/src/lead/reply.ts`
- `packages/devtools/src/lead/repo-root.ts`
- `packages/devtools/src/lead/session.ts`
- `packages/devtools/src/lead/snapshot.ts`
- `packages/devtools/src/lead/spec-check.ts`
- `packages/devtools/src/lead/start-prereview.ts`
- `packages/devtools/src/lead/state.ts`
- `packages/devtools/src/lead/status.ts`
- `packages/devtools/src/lead/sweeper.ts`
- `packages/devtools/src/lead/switch-model.ts`
- `packages/devtools/src/lead/task-file.ts`
- `packages/devtools/src/lead/types.ts`
- `packages/devtools/src/lead/watch-app.tsx`
- `packages/devtools/src/lead/watch-app/chrome.tsx`
- `packages/devtools/src/lead/watch-app/lines.tsx`
- `packages/devtools/src/lead/watch-app/live.tsx`
- `packages/devtools/src/lead/watch-app/segments.tsx`
- `packages/devtools/src/lead/watch-app/view.tsx`
- `packages/devtools/src/lead/watch-format.ts`
- `packages/devtools/src/lead/watch.ts`
- `packages/devtools/src/lead/watch/changed-files.ts`
- `packages/devtools/src/lead/watch/cli.ts`
- `packages/devtools/src/lead/watch/collect.ts`
- `packages/devtools/src/lead/watch/format.ts`
- `packages/devtools/src/lead/watch/live-step.ts`
- `packages/devtools/src/lead/watch/speed.ts`
- `packages/devtools/src/lead/watch/view.ts`
- `packages/devtools/src/lead/worktree-git.ts`
- `packages/devtools/src/plan-page/cli.ts`
- `packages/devtools/src/plan-page/collect.ts`
- `packages/devtools/src/plan-page/findings.ts`
- `packages/devtools/src/plan-page/page-findings.js`
- `packages/devtools/src/plan-page/parity.ts`
- `packages/devtools/src/smoke-lib.ts`
- `packages/devtools/src/smoke.ts`
- `packages/devtools/src/xmpp-e2e.ts`
- `packages/devtools/src/xmpp-e2e/connect.ts`
- `packages/devtools/src/xmpp-e2e/harness.ts`
- `packages/devtools/src/xmpp-e2e/main.ts`
- `packages/devtools/src/xmpp-e2e/mam.ts`
- `packages/devtools/src/xmpp-e2e/muc.ts`
- `packages/devtools/src/xmpp-e2e/push-pending.ts`
- `packages/runner-tunnel/src/demo.ts`
- `packages/runner-tunnel/src/desk-frames.ts`
- `packages/runner-tunnel/src/desk-runner.ts`
- `packages/runner-tunnel/src/desk-server.ts`
- `packages/runner-tunnel/src/http-agent.ts`
- `packages/runner-tunnel/src/keys.ts`
- `packages/runner-tunnel/src/mux/errors.ts`
- `packages/runner-tunnel/src/mux/socket-bridge.ts`
- `packages/runner-tunnel/src/mux/stream-mux.ts`
- `packages/runner-tunnel/src/mux/types.ts`
- `packages/runner-tunnel/src/protocol.ts`
- `packages/runner-tunnel/src/runner.ts`
- `packages/runner-tunnel/src/runner/connection.ts`
- `packages/runner-tunnel/src/runner/handshake.ts`
- `packages/runner-tunnel/src/runner/lifecycle.ts`
- `packages/runner-tunnel/src/runner/options.ts`
- `packages/runner-tunnel/src/server.ts`
- `packages/runner-tunnel/src/server/conn.ts`
- `packages/runner-tunnel/src/server/engine.ts`
- `packages/runner-tunnel/src/server/handshake.ts`
- `packages/runner-tunnel/src/server/heartbeat.ts`
- `packages/runner-tunnel/src/server/options.ts`
- `packages/runner-tunnel/src/server/preview.ts`
- `packages/runner-tunnel/src/server/ready.ts`
- `packages/runner-tunnel/src/test-harness.ts`
- `packages/runner-tunnel/src/ws-close.ts`
- `packages/xmpp-core/src/client.ts`
- `packages/xmpp-core/src/core-effect.ts`
- `packages/xmpp-core/src/core-effect/config.ts`
- `packages/xmpp-core/src/core-effect/keepalive.ts`
- `packages/xmpp-core/src/core-effect/lifecycle.ts`
- `packages/xmpp-core/src/core-effect/operations-types.ts`
- `packages/xmpp-core/src/core-effect/operations.ts`
- `packages/xmpp-core/src/core-effect/presence.ts`
- `packages/xmpp-core/src/core-effect/stanza-router.ts`
- `packages/xmpp-core/src/core-effect/suspend.ts`
- `packages/xmpp-core/src/core-effect/token-auth.ts`
- `packages/xmpp-core/src/errors.ts`
- `packages/xmpp-core/src/events.ts`
- `packages/xmpp-core/src/index.ts`
- `packages/xmpp-core/src/jid.ts`
- `packages/xmpp-core/src/mam.ts`
- `packages/xmpp-core/src/stanza/album.ts`
- `packages/xmpp-core/src/stanza/build-control.ts`
- `packages/xmpp-core/src/stanza/build-outgoing.ts`
- `packages/xmpp-core/src/stanza/decode.ts`
- `packages/xmpp-core/src/stanza/parse-context.ts`
- `packages/xmpp-core/src/stanza/parse-fields.ts`
- `packages/xmpp-core/src/stanza/parse-presence.ts`
- `packages/xmpp-core/src/stanza/parse-roster.ts`
- `packages/xmpp-core/src/stanza/payload-element.ts`
- `packages/xmpp-core/src/stanza/reactions.ts`
- `packages/xmpp-core/src/stanza/resolve-sender.ts`
- `packages/xmpp-core/src/stream-management.ts`
- `packages/xmpp-core/src/testing.ts`
- `packages/xmpp-core/src/text.ts`
- `packages/xmpp-core/src/timers.ts`
- `packages/xmpp-core/src/types-ack.ts`
- `packages/xmpp-core/src/types-delivered.ts`
- `packages/xmpp-core/src/types-suspend.ts`
- `packages/xmpp-core/src/types.ts`
- `work/T-2082-comments-devtools-desk-tunnel-xmpp.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1481 lines are removed.

---

## Report (written by the worker when done)

### What I did

Read `docs/COMMENTS.md` and cut comments in every file listed under Allowed files (202 source files).
Only comment lines changed, plus the blank lines a removed block left behind.

- Comment lines: **2963 -> 1479 (-1484)**.
- Source lines in these files: **28,748 -> 27,248 (-1500)**.
- Removed: task IDs and history ("moved unchanged", "size split", "T-xxxx" notes), narration that
  restated the code or the name, parameter-restating JSDoc, references to removed things, commented
  banners. Shortened every multi-line block that had one real "why" to one or two lines.
- Kept: security/permission/privacy notes, protocol and data invariants, library workarounds with the
  bug, units and limits, and tool directives (`// effect-plain:`, `@ts-expect-error`, license/docs).
- No code, string, import, type or formatting change; no tests added (the spec asks for none).
- Commits: one for runner+desk, one for devtools, one for runner-tunnel+xmpp-core with this report.

### Checks run

`pnpm gate` (from the repo root), final run:

```
gate: 188 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (3.8s)
PASS  lint  (1.3s)
PASS  typecheck  (3.6s)
PASS  effect  (11.4s)
PASS  build @zilar/server  (2.1s)
PASS  tests @zilar/desk  (4.5s)
PASS  tests @zilar/devtools  (35.8s)
PASS  tests @zilar/runner  (5.9s)
PASS  tests @zilar/runner-tunnel  (2.4s)
PASS  tests @zilar/xmpp-core  (2.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run by hand: the change touches no code, and `pnpm gate` ran the tests of
every touched package (all passed, as listed above).

### Comments kept longer than 3 lines

Each entry is `file:line` and a few words on why it stayed (all are 4-6 lines).

- `apps/runner/src/desk/driver.ts:7` — no unsandboxed mode; per-OS jail driver.
- `apps/runner/src/desk/handler.ts:46` — clamps server request; no unsandboxed mode.
- `apps/runner/src/desk/policy.ts:5` — local policy can only tighten; corrupt file falls back safe.
- `packages/desk/src/agent/admission.ts:5` — fair queue (FIFO per owner, round-robin across).
- `packages/desk/src/agent/admission.ts:112` — idempotency; synchronous last-slot check.
- `packages/desk/src/agent/docker.ts:49` — one daemon frame line; oversize process is killed.
- `packages/desk/src/agent/docker.ts:296` — runner bridges the daemon socket, never parses it.
- `packages/desk/src/agent/egress.ts:20` — one secret per desk survives re-provision.
- `packages/desk/src/agent/lifecycle.ts:46` — provision idempotent; idle stop; stop all.
- `packages/desk/src/agent/lifecycle.ts:66` — readiness pinned once; new release is a new container.
- `packages/desk/src/agent/lifecycle.ts:107` — DeskRef id must derive from its own key (tenant isolation).
- `packages/desk/src/agent/lifecycle.ts:281` — Stop all clears records even when a release throws.
- `packages/desk/src/agent/main.ts:22` — a failing stop must not crash the sidecar.
- `packages/desk/src/agent/main.ts:60` — sweep keeps workspaces, is bounded and never rejects.
- `packages/desk/src/agent/wire.ts:13` — strict decode rejects undeclared fields.
- `packages/desk/src/agent/workspace.ts:141` — plain-folder workspace for hosts without loop devices.
- `packages/desk/src/capture.ts:43` — bounded read against a file grown after `stat`.
- `packages/desk/src/egress/log.ts:1` — log carries ids only, never URL, header or body.
- `packages/desk/src/egress/policy.ts:55` — every resolved address is checked (rebinding).
- `packages/desk/src/hands.ts:4` — schema boundary rejects undeclared fields.
- `packages/desk/src/hands.ts:115` — queued is not a hard failure; position is desks ahead.
- `packages/desk/src/paths.ts:6` — path escape and symlink following.
- `packages/desk/src/process.ts:82` — process-group kill on timeout or output cap.
- `packages/desk/src/protocol.ts:3` — newline JSON, overlapping ids, transport-agnostic.
- `packages/desk/src/tool.ts:13` — error code vs a normal non-zero exit.
- `packages/desk/src/tools/bash.ts:14` — process group and output cap.
- `packages/desk/src/tools/git.ts:5` — forbidden flags; https transport; the jail is the boundary.
- `packages/devtools/src/gate/cli.ts:1` — what the gate runs and the pass record.
- `packages/devtools/src/gate/migrations.ts:1` — migration numbers must continue from the base tip.
- `packages/devtools/src/gate/plan.ts:1` — which checks run; nearest-test selection.
- `packages/devtools/src/lead/batch.ts:1` — batch check/merge semantics.
- `packages/devtools/src/lead/fallback.ts:22` — fallback chains; pauses skip Go/free steps.
- `packages/devtools/src/lead/free-pause.ts:99` — concurrent config write race.
- `packages/devtools/src/lead/model-schedule.ts:27` — auto model and the free pause.
- `packages/devtools/src/lead/policy/classify.ts:96` — verdicts, worst wins, allow-all switch.
- `packages/devtools/src/lead/policy/curl.ts:98` — read-only GET only; fails closed.
- `packages/devtools/src/lead/policy/rm.ts:33` — `.env` protection and the `--env-file=` exemption.
- `packages/devtools/src/lead/session.ts:47` — quota classification covers Go, auth and free refusals.
- `packages/devtools/src/xmpp-e2e.ts:1` — harness purpose and how to run it.
- `packages/devtools/src/xmpp-e2e/push-pending.ts:1` — pending-session repro setup.
- `packages/devtools/src/xmpp-e2e/push-pending.ts:99` — must wait for SM before suspending.
- `packages/runner-tunnel/src/desk-runner.ts:23` — handler injected; no Docker import here.
- `packages/runner-tunnel/src/desk-runner.ts:31` — bridges the exec socket; rejects unprovisioned.
- `packages/runner-tunnel/src/desk-runner.ts:40` — no unsandboxed mode.
- `packages/runner-tunnel/src/desk-runner.ts:60` — never throws; bad frame answered on the wire.
- `packages/runner-tunnel/src/desk-server.ts:20` — keyed by runner and desk (tenant isolation).
- `packages/runner-tunnel/src/desk-server.ts:28` — server side of the desk frames.
- `packages/runner-tunnel/src/desk-server.ts:93` — reply routing; cross-runner protection.
- `packages/runner-tunnel/src/http-agent.ts:7` — loopback pair keeps normal HTTP behavior.
- `packages/runner-tunnel/src/http-agent.ts:53` — agent selects the runner port; host ignored.
- `packages/runner-tunnel/src/keys.ts:56` — revoking a key must close its live connection.
- `packages/runner-tunnel/src/mux/socket-bridge.ts:7` — backpressure and failure propagation.
- `packages/runner-tunnel/src/mux/stream-mux.ts:14` — parity and end-to-end backpressure.
- `packages/runner-tunnel/src/mux/stream-mux.ts:70` — FIFO sends; teardown always last.
- `packages/runner-tunnel/src/mux/stream-mux.ts:98` — teardown idempotent, never throws.
- `packages/runner-tunnel/src/protocol.ts:14` — version compatibility; desk frames only to v2.
- `packages/runner-tunnel/src/protocol.ts:41` — max message size is an attack bound.
- `packages/runner-tunnel/src/runner.ts:16` — dials out, ed25519 auth, allowlisted ports.
- `packages/runner-tunnel/src/runner/lifecycle.ts:18` — shared mutable state kept private.
- `packages/runner-tunnel/src/server.ts:158` — preview token is the 128-bit capability.
- `packages/runner-tunnel/src/server/conn.ts:35` — shared server state kept private.
- `packages/runner-tunnel/src/server/engine.ts:7` — stream socket and `TunnelClosedError`.
- `packages/runner-tunnel/src/server/preview.ts:9` — token format and its capability role.
- `packages/runner-tunnel/src/test-harness.ts:242` — raw WS client for hostile input.
- `packages/runner-tunnel/src/ws-close.ts:4` — swallows close errors; terminate vs graceful.
- `packages/xmpp-core/src/client.ts:7` — Promise facade over the Effect core.
- `packages/xmpp-core/src/core-effect.ts:38` — rebound means lost stanzas, so resend.
- `packages/xmpp-core/src/core-effect.ts:114` — wait for `<enabled/>` before reporting online.
- `packages/xmpp-core/src/core-effect/config.ts:25` — watchdog schedule rationale.
- `packages/xmpp-core/src/core-effect/config.ts:211` — one retry for a 401/403 deploy race.
- `packages/xmpp-core/src/core-effect/lifecycle.ts:81` — watchdog replacement reports unacked stanzas.
- `packages/xmpp-core/src/core-effect/operations.ts:58` — Deferred and child-fiber send ordering.
- `packages/xmpp-core/src/core-effect/suspend.ts:1` — SM id survives disconnect; suspend/wake.
- `packages/xmpp-core/src/errors.ts:3` — messages are fixed sentences and carry no secrets.
- `packages/xmpp-core/src/stanza/album.ts:14` — album marker invariants.
- `packages/xmpp-core/src/stanza/album.ts:27` — malformed marker is dropped.
- `packages/xmpp-core/src/stanza/decode.ts:45` — archive id kept apart from `stanza-id`.
- `packages/xmpp-core/src/stream-management.ts:3` — xmpp.js counter bug workaround.
- `packages/xmpp-core/src/types-ack.ts:1` — ack/unack events carry the stanza id.
- `packages/xmpp-core/src/types-ack.ts:21` — first watchdog wait for mobile.
- `packages/xmpp-core/src/types-suspend.ts:10` — suspend/wake contract.
- `packages/xmpp-core/src/types.ts:38` — keepalive units and defaults.
- `packages/xmpp-core/src/types.ts:43` — keepalive timeout units and defaults.

### Notes for the lead

- `git diff main...HEAD --shortstat`: **188 files changed, 1342 insertions(+), 2431 deletions(-)**
  when this paragraph was written (this report's own line is part of that count).
  Of that, the source files are **187 changed, 931 insertions(+), 2431 deletions(-), net -1500**
  (`git diff main...HEAD --numstat -- apps packages`), and the remaining +409 lines are this task
  file (268 spec + the report). The 15 allowed files not listed as changed had nothing left to cut.
- The source-only ratios: comment lines **2963 -> 1479 (-1484)**, source lines **28,748 -> 27,248
  (-1500)**, over the 202 allowed files.
- The first gate run failed the Effect ratchet on four `runner-tunnel` files because their
  `// effect-plain:` marker line was removed with the old "moved unchanged" sentence. I restored a
  short `// effect-plain: …` reason in `server/engine.ts`, `server/heartbeat.ts`,
  `server/preview.ts` and `ws-close.ts`; the final gate passes.
- Prettier wanted a few empty `catch {}` blocks collapsed after their only comment was removed; those
  comments are WHY notes ("already gone", "nothing to clean"), so I kept one short line inside each
  block rather than let the code change shape.
- `main` moved while this task ran (another merge), so `git diff main` (two dots) shows unrelated
  files; use the three-dot diff, as the gate does.
- Nothing outside Allowed files was changed; `scope` confirms it.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +931 -2431 net -1500; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
