---
id: T-1357
title: "No push while the phone's XMPP session is pending (hibernated): ejabberd never publishes to the push component for DMs, and the group notifier skips members whose only resource is a pending session — reproduce with the xmpp-e2e harness, fix, and prove a DM and a group/channel post to a pending push-enabled session reach the component"
status: merged
milestone: M5
branch: task/T-1357-push-pending-sessions
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1357: Push for pending sessions

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: the Android app never gets notifications. The lead's evidence from the live VPS (SSH, read-only):
1. **The phone registers fine.**
   - ejabberd logs "Enabling push notifications for pzooiu…/zilar-0j2aw18l" at 10:44:32 UTC;
   - the `ejabberd.push_session` row has node `pSdaemA6…` and service `push.chat.zilar.app`;
   - `zilar.push_subscriptions` has the matching `fcm` row;
   - the component handshake was accepted at 10:10:19 ("Accepted external component handshake … push.chat.zilar.app").
2. **The app closes and the session goes pending:** "Closing c2s connection … Connection failed: connection closed; waiting 600 seconds for stream resumption" at 10:45:02. `ejabberdctl user_sessions_info` still lists the session later (the `mod_push_keepalive` extended resumption).
3. **A DM arrives** from @claude_test at 10:45:14. **No push request ever reaches the component:** the server container's log has **0** `push sent` / `push dropped` lines since its 10:10 start (logged at info in `apps/server/src/push/component.ts:176-186`), and the FCM row's `last_used_at` only moved for `POST /api/push/test`.
4. **Group and channel posts don't push either while the session is pending.** `apps/server/src/push/group-notifier.ts:97-112` (`isConnected`) skips any member with `userResources(...) > 0`, and a pending session counts. The comment at `:116-119` expects ejabberd's own publish to cover pending sessions, which (3) shows doesn't happen. A channel post at 09:52 **did** push, because the phone had no session then.

The config is in `deploy/ejabberd/ejabberd.yml:252-277`:
- `mod_stream_mgmt` (`resend_on_timeout: if_offline`, `resume_timeout: 600`);
- `mod_push` (`include_sender: false`, `include_body: false`, `notify_on: messages`);
- `mod_push_keepalive: {}`.

The live container has the same file.

### What to do
1. **Reproduce locally** with the existing XMPP harness (`packages/devtools/src/xmpp-e2e/*`, `packages/devtools/src/xmpp-e2e.ts`) against the dev ejabberd, plus the server's push component:
   - client A enables stream management and XEP-0357 push (the same `enable` IQ the app sends; find it in `apps/mobile/src/lib/push/native.ts` / client-core and cite it);
   - drop A's socket without closing the stream, so the session goes pending;
   - B sends A a DM;
   - **assert** the component receives the publish IQ, and the delivery outcome is `sent` (with a fake FCM sender).
   - Then do the same for a group or channel post.
2. **Find why ejabberd doesn't publish** for the pending session. Check `mod_push`'s behaviour in the ejabberd version we run (the image tag in `deploy/coolify/docker-compose.app.yml`):
   - does it notify for pending sessions, only for offline storage, or only with `include_body`?
   - is `notify_on: messages` filtering out our message shape (e.g. stanzas without a `<body>` or with a custom payload)?
   - is the "contacts only" filter (SG-2 / T-1159, `ejabberd.yml:282+`) involved?
   - Cite the ejabberd source or docs for each conclusion.
3. **Fix it at the right layer.** Choose and justify an ejabberd config change, a change to how the app enables push, or a server-side fallback. For example: the group notifier and a DM path treat a session as "away" when ejabberd reports it pending or CSI-inactive (`ejabberdctl user_sessions_info` exposes the state), not just "has a resource". Keep the dedupe (`recentlyNotified`) so a device never double-buzzes.
4. **Tests:** the e2e reproduction from step 1 becomes a test, run where the existing xmpp-e2e tests run (the message pipeline: tests allowed). Every file stays at most 400 lines.
5. **Report:** the exact cause with citations, what you changed, and anything the lead must do on the live server (an ejabberd config change ships with the deploy; say if a restart is needed).

### Read first
`AGENTS.md`, `deploy/ejabberd/ejabberd.yml`, `apps/server/src/push/component.ts`, `apps/server/src/push/group-notifier.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/delivery.ts`, `packages/devtools/src/xmpp-e2e.ts`, `docs/audit/native-push-plan.md`, `docs/audit/ejabberd-push-enable.md`.

### Allowed files
`deploy/ejabberd/ejabberd.yml`, `deploy/baremetal/ejabberd.yml`, `infra/ejabberd/ejabberd.yml`, `apps/server/src/push/**/*.ts`, `apps/server/src/xmpp/**/*.ts`, `packages/devtools/src/xmpp-e2e.ts`, `packages/devtools/src/xmpp-e2e/**/*.ts`, `apps/mobile/src/lib/push/*.ts`, `packages/client-core/src/**/*.ts`, `docs/audit/native-push-plan.md`, `work/T-1357-push-pending-sessions.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the new e2e test passes locally (show its output).
- **Live after the deploy:** with Julio's app closed, a DM and a channel post each produce `push sent` in the server log, and a wake on his phone.

---

## Report (written by the worker when done)

### Summary

Root cause found and fixed in the ejabberd config: with `include_body: false`
(and `include_sender: false`) plus `notify_on: messages`, ejabberd 26.07's
`mod_push` computes an *undefined* XEP-0357 summary and then **suppresses** the
publish entirely, so nothing ever reached the component — for DMs (pending and
offline) and for group posts to a pending session alike. The production Docker
config had exactly that combination. The fix keeps the message text out with a
static `include_body` string instead of `false`. I reproduced the symptom
end-to-end with the XMPP harness (a real fake push component on the dev stack)
and added a regression test for the config rule. The same fix is applied to the
dev config (`infra/ejabberd/ejabberd.yml`); the e2e steps will go green once the
dev stack loads it (see "Local e2e").

### Root cause (with citations)

Everything below is ejabberd **26.07**, the tag pinned in
`deploy/ejabberd/Dockerfile:19` (`ghcr.io/processone/ejabberd:26.07`) and the one
running on the dev stack.

1. `mod_push.erl` `make_summary/3` returns `undefined` when both
   `include_sender` and `include_body` are `false`:
   ```erlang
   make_summary(Host, #message{from = From0} = Pkt, recv) ->
       case {mod_push_opt:include_sender(Host), mod_push_opt:include_body(Host)} of
           {false, false} -> undefined;          %% <-- our config
           ...
   ```
2. `mod_push.erl` `notify/7` then suppresses the notification for the default
   `notify_on` value, because `notify_on: messages` takes the `{undefined, …}`
   branch:
   ```erlang
   case {make_summary(LServer, Pkt, Dir), mod_push_opt:notify_on(LServer)} of
       {undefined, messages} ->
           ?DEBUG("Suppressing notification for stanza without payload", []),
           ok;                                    %% <-- no publish IQ
       {Summary, _NotifyOn} -> ... route the publish IQ ...
   ```
   So `include_body: false` + `include_sender: false` + `notify_on: messages`
   suppresses **every** message push. `deploy/ejabberd/ejabberd.yml` (the Docker
   / Coolify config the live VPS runs) had exactly this triple since T-1155
   added `notify_on: messages`. That is why the component saw 0 publishes and
   only `POST /api/push/test` moved `last_used_at`.
3. `mod_push`'s own options make the fix obvious: `mod_options/1` defaults are
   `notify_on: all` and `include_body: <<"New message">>`, and the docs say
   `include_body` "can instead be set to a static 'Text' … without leaking
   actual message contents". `include_body` accepts `boolean() | binary()`
   (`mod_opt_type/1`).
4. The pending path is *already* wired and just needed a defined summary:
   `mod_push.erl` `c2s_stanza/3` notifies whenever
   `push_enabled := true, mgmt_state := pending` (any stanza, including
   groupchat), and `mod_stream_mgmt:c2s_handle_send/3` still runs the hook while
   it queues the stanza for resumption. `enable/4` stores the `push_id` in
   `ejabberd_sm`, so the MAM hook (`drop_online_sessions/3`) correctly skips the
   pending session and only the `c2s_stanza` hook fires — one publish, no double.
5. The only shipped config with the *right* shape is `deploy/baremetal`
   (it never set `notify_on`, so it defaulted to `all` and did publish — but for
   typing/presence too). I brought it in line with the fix (`notify_on:
   messages` + static `include_body`).

### The fix

`deploy/ejabberd/ejabberd.yml`, `deploy/baremetal/ejabberd.yml` and
`infra/ejabberd/ejabberd.yml` (the same block in all three):

```yaml
mod_push:
  include_sender: false
  include_body: 'New message'   # was `false`; a static string, never the body
  notify_on: messages
```

`include_sender` stays `false`, `notify_on: messages` stays (T-1155: typing and
presence stay silent), text never leaves ejabberd. The fix lives at the config
layer because that is where the defect is: `make_summary/3` answers `undefined`,
which our own server code (component, archive scan) never saw.

### Files changed

- `deploy/ejabberd/ejabberd.yml` — fix + comment with the mod_push citations.
- `deploy/baremetal/ejabberd.yml` — same fix (it had no `notify_on` before).
- `infra/ejabberd/ejabberd.yml` — the dev-stack copy, same fix (the lead added it
  to Allowed files).
- `apps/server/src/push/mod-push-config.test.ts` (new) — runs the exact
  `make_summary`/`notify` rule against both shipped configs; fails if a future
  edit re-introduces `include_body: false` with `notify_on: messages`.
- `packages/devtools/src/xmpp-e2e/push-pending.ts` (new) — the reproduction:
  a bare XEP-0114 component (handshake on 127.0.0.1:5347) that records publish
  IQs, XEP-0357 `<enable/>`, a socket drop below the stream (`suspendClient`,
  the same thing the app's `suspend()` does), then a DM / a group post.
- `packages/devtools/src/xmpp-e2e/main.ts` — two new spike steps that run it.
- `work/T-1357-push-pending-sessions.md` — this report.

### Commands run (real results)

- `pnpm install` — "Done in 12.6s" (one pre-existing peer-dep warning in
  `apps/mobile`: `@types/react-dom` wants `@types/react@^19.3.0`).
- `pnpm --filter @zilar/server exec vitest run src/push/mod-push-config.test.ts --reporter=dot`
  — `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm xmpp:e2e` (against the shared dev stack) — the 12 pre-existing steps
  PASS; the two new steps FAIL with `timed out waiting for a publish for node
  node-e2e-push-a-…` / `node-e2e-push-ga-…`. **This is the reproduction**: the
  fake component connected (probe handshake, JWT login, `<enable/>` result,
  `suspend`, DM/post all succeeded) and no publish arrived — the exact live
  symptom. **Local e2e not run green: the dev ejabberd can't be restarted under
  the guardrail** (see "Local e2e" below).
- `pnpm gate` — summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.8s)
  PASS  effect  (0.3s)
  SKIP tests @zilar/devtools (no nearby test files)
  PASS  tests @zilar/server  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Why the group notifier is not changed

`apps/server/src/push/group-notifier.ts` skips a member with
`userResources(...) > 0`, and a pending session counts (ejabberd's
`get_user_resources` includes it: `ejabberd_sm.erl:239-244`, `clean_session_list`
only picks the newest session per resource, it does not drop pending ones). That
was a bug **only** because ejabberd did not publish (this task's cause): once
`mod_push` publishes again, a pending MUC occupant is covered by ejabberd's
`c2s_stanza` hook and the notifier must keep skipping it to avoid a double
buzz. The notifier's real job is the fully-offline member, which it already does.

I deliberately did **not** add a "pending detection" branch: 26.07's admin API
has no pending/CSI signal. `user_sessions_info` returns only
`{connection, ip, port, priority, node, uptime, status, resource, statustext}`
(`mod_admin_extra.erl:1479-1496`), `get_user_info/3` carries no state flag
(`ejabberd_sm.erl:284-299`), and `mod_client_state`'s `csi_state` is per-session
and not exposed. Guessing "pending" from `user_resources`/`get_last` is not
possible without false positives, so the config fix is the correct layer.

### What the lead must do on the live server

**Nothing manual — a normal redeploy picks it up.** The config is baked into the
image, not mounted as a volume: `deploy/ejabberd/Dockerfile:21` runs
`COPY ejabberd/ejabberd.yml /opt/ejabberd/conf/ejabberd.yml`, and the Coolify app
compose builds that image straight from the repo
(`deploy/coolify/docker-compose.app.yml:69-71`: `build: {context: deploy,
dockerfile: ejabberd/Dockerfile}`). So a normal auto-deploy rebuilds the
ejabberd image and recreates the container, and the new `mod_push` options take
effect (`mod_push` reads its options at startup; there is no live reload). No
database migration, no session reset. (An install that instead pulls the
prebuilt `ghcr.io/<owner>/zilar-ejabberd` image —
`deploy/coolify/docker-compose.yml:58` — gets the fix with the next release-tag
image build, `.github/workflows/images.yml`.)

After the deploy, with Julio's app closed, a DM and a channel post should each
log `push sent` and wake his phone. A read-only confirmation is that the running
image's `/opt/ejabberd/conf/ejabberd.yml` has `include_body: 'New message'`.

### Local e2e

The reproduction is committed as two `pnpm xmpp:e2e` steps. Against the shared
`zilar-dev` stack they run and fail with "timed out waiting for a publish for
node …": the fake component connects, the client enables XEP-0357 and goes
pending, the DM/post is sent, and no publish arrives — the reported bug.

**Local e2e not run green: the dev ejabberd can't be restarted under the
guardrail.** The shared dev stack mounts another checkout's
(`~/personal-projects/galena/infra`) *unfixed* `infra/ejabberd/ejabberd.yml`,
and the container guardrail forbids stopping/restarting/recreating it, so it
cannot be pointed at the fixed config from here. Once the dev stack loads this
commit's `infra/ejabberd/ejabberd.yml`, `pnpm xmpp:e2e` goes green with no
further code change (the probe also honours `PUSH_COMPONENT_HOST` /
`PUSH_COMPONENT_PORT` for a stack on other ports).

### Notes / deviations

- I did not touch `packages/client-core/**`, `apps/mobile/src/lib/push/*.ts` or
  `apps/server/src/xmpp/**`: the app already enables push correctly (the
  harness sends the same `<enable/>`), so no app change is needed.
- `deploy/baremetal/ejabberd.yml` used to publish for *any* stanza (no
  `notify_on`); it is now `notify_on: messages` like Docker, so a bare-metal
  install stops notifying for typing/presence as well.
- Security: the new test reads only the shipped YAML; nothing logs tokens or
  message text. The spike probe logs only node ids.

### Round (pre-review findings)

- **should-fix 1 (SM not proven before the drop)** — fixed. Added
  `waitForStreamManagement` to `packages/devtools/src/xmpp-e2e/push-pending.ts`:
  it waits (with `waitUntil`, the step timeout) for
  `xmpp.streamManagement.enabled === true` — `@xmpp/client` emits `online`
  right after resource binding, *before* it sends `<enable/>`
  (`@xmpp/resource-binding/index.js:18` calls `entity._ready(false)`; the SM
  stream feature sends `<enable/>` only afterwards,
  `@xmpp/stream-management/stream-feature.js`). Both `pushPendingDm` and
  `pushPendingGroup` now `await waitForStreamManagement(alice)` before
  `enablePush`/`suspendClient`, so the drop can only land on an SM-negotiated
  stream and the `pending` path the live bug is about is actually exercised.
  The repro step itself is the test (devtools has no vitest suite; the gate
  reports "no nearby test files"), so no separate unit test was added.
- Nits 2–4 touched no line this round changes, so they were left as-is (the
  A-rule is not to touch nits outside lines already changed).

Commands run this round:
- `pnpm exec prettier --check packages/devtools/src/xmpp-e2e/push-pending.ts`
  — "All matched files use Prettier code style!".
- `pnpm gate` (repo root) — summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/devtools (no nearby test files)
  PASS  tests @zilar/server  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I did not re-run `pnpm xmpp:e2e`: the shared dev stack still mounts another
  checkout's unfixed `infra/ejabberd/ejabberd.yml` and cannot be restarted under
  the guardrail (same reason the original Report gives), so the step still fails
  for the environment, not the code. The lead's follow-up (reload dev config,
  re-run) is unchanged.

### Disagreements

None — no finding was contested; the only should-fix is fixed and no nit was in
a line this round changed.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean after 1 auto round (2 nits); the packet is current for `e5025806`.**
- **The cause is cited from ejabberd 26.07 `mod_push.erl`** (`make_summary` returns `undefined` with both include flags off, and `notify_on: messages` then suppresses). This matches the live evidence: 0 `push sent` lines and no publish IQs.
- **The component already parses the summary form** (`apps/server/src/push/protocol.ts:10-28`), so a static body is safe.
- **The deploy path:** the image `COPY`s the config (`deploy/ejabberd/Dockerfile:21`), so the auto-deploy picks it up.
- **The local e2e was not run** (the guardrail forbids touching containers). The lead verifies live: `push sent` in the server log, plus Julio's phone with the app closed.
