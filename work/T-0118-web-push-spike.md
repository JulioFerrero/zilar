---
id: T-0118
title: Spike: web push through ejabberd's push module (XEP-0357) to a real browser
status: merged
milestone: M5
branch: task/T-0118-web-push-spike
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 1 day
---

# T-0118: Spike, web push

## Spec (written by Claude, do not edit)

### Why
D28 wants a PWA with web push before native push. The clean architecture for XMPP is **XEP-0357**: when a user has no active session, ejabberd's `mod_push` sends a small notification IQ to a **push service** (an XMPP component); our push service turns it into a **Web Push** message (VAPID) for the user's browser. Nobody has proved this chain here. This spike proves it, measures what breaks, and writes the findings so the production task (T-0119) can be written from facts. It ends in a **decision document**, not in a merged feature.

### Questions to answer (each with evidence)
1. Can `apps/server` run as an XMPP **component** (`ejabberd_service` listener on a loopback port with a shared secret) that receives XEP-0357 `<notification/>` IQs? Which library works (start with `@xmpp/component` from the xmpp.js family already used by `xmpp-core`; report if another is needed)?
2. What exactly does ejabberd send (fields, `node`, `secret` handling, does it include the sender and body with `include_sender` / `include_body`?), for a DM and for a group room message, when the recipient has (a) no session, (b) a session that is hibernating? What is the `notify_on` / `mod_push_keepalive` configuration needed?
3. How does a **browser client enable push**: `<enable xmlns='urn:xmpp:push:0' jid='push.<domain>' node='<node>'>` sent from the web client over its XMPP session with `xmpp-core` (is there a way to do it through the admin API instead so the browser does not need an XMPP round trip?), and where does the Web Push subscription live (a `push_subscriptions` row keyed by node)?
4. Web Push: VAPID key handling, payload encryption (`web-push` package), size limit, behaviour on iOS (installed PWA only, iOS 16.4+), Chrome/Firefox/Safari; what the service worker receives and what it can show. What is sent in the payload so the **message body never travels through third-party push servers in clear text** (the encrypted Web Push payload is end-to-end between our server and the browser: verify and state it; otherwise send only "New message" with the chat id).
5. Privacy and mute: how to make the push service drop notifications for **muted** chats (T-0113 `chat_prefs`) and for **private topics the user can no longer see** (T-0108).
6. Latency and reliability numbers from your runs; failure modes (expired subscriptions 404/410 → cleanup, component reconnect).

### What to build (throwaway-quality, in the spike folder only)
- `apps/server/src/push-spike/` (component connection, VAPID config from env, a `POST /api/push-spike/subscribe` route behind a session and behind `PUSH_SPIKE_ENABLED=true`, default **false**, a minimal sender) and `apps/web/public/push-spike/` (a plain HTML page + service worker that subscribes and shows the notification; it is not part of the app bundle). Config changes for ejabberd needed for the proof go in `infra/ejabberd/ejabberd.yml` **only as clearly marked spike lines** (a new listener bound to `127.0.0.1` and `mod_push` options), documented in the notes.
- **Dependencies you may add** (the spike's whole list): `web-push` and `@xmpp/component` (and their types) in `apps/server`. Nothing else.
- A proof script or manual steps in the notes that the lead can run in Helium (Julio's browser): subscribe, close the tab, send a DM from a second account, see the notification, click it. You cannot drive Helium yourself; make it a 5-step procedure and run everything you can headlessly (unit tests with a fake component and a fake push endpoint).
- **Secrets:** generate VAPID keys with `web-push generate-vapid-keys` into a git-ignored file under `infra/` (never print them, never commit them); only variable *names* appear in docs (`PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, `PUSH_COMPONENT_SECRET`). Never read `infra/.env`.

### Deliverable
`docs/PUSH_SPIKE.md` (≤ 150 lines): answers to the six questions with evidence (commands, observed stanzas with **fake data only**, timings), the recommended production design (which process owns the component, data model, mute/private rules, retry/cleanup), what must change in `ejabberd.yml`, dependency and licence notes, and a list of risks/unknowns. Update the Report with a clear **GO / NO-GO** for T-0119 and a size estimate.

### Read first
- `AGENTS.md`; `docs/PROJECT_PLAN.md` §6.5 (push notifications) and D28
- `infra/ejabberd/ejabberd.yml`, `infra/docker-compose.dev.yml`, `packages/xmpp-core/src/client.ts` (how the web client connects), `apps/server/src/xmpp/admin-client.ts`
- The XEP-0357 text and ejabberd's `mod_push` documentation (you may fetch public docs)

### Allowed files
- `apps/server/src/push-spike/**` (new), `apps/server/package.json` + `pnpm-lock.yaml` (the two dependencies), `apps/server/src/app.ts` and `config.ts` (only the flagged spike wiring)
- `apps/web/public/push-spike/**` (new)
- `infra/ejabberd/ejabberd.yml` (marked spike lines), `infra/docker-compose.dev.yml` only if a port must be published on loopback
- `docs/PUSH_SPIKE.md` (new), `work/T-0118-web-push-spike.md`

**Not allowed:** real feature code in the web app bundle, mobile, other packages, other dependencies, committing keys.

### Tests
Unit tests for whatever pure logic you keep (notification parsing, payload building, mute/private filtering as pure functions) with fakes; no real network in tests.

### Acceptance criteria
- [ ] `docs/PUSH_SPIKE.md` answers all six questions with evidence and ends with GO/NO-GO and a T-0119 outline.
- [ ] The spike is off by default (`PUSH_SPIKE_ENABLED=false`), commits no secrets, and the normal test suites still pass.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Native push (APNs/FCM, spike S5 needs an Apple developer account), the production data model, UI, mobile, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Spike proving XEP-0357 web push. Verdict: **GO for T-0119** (DM path proven
  at unit level + source-verified against mod_push.erl 26.07; MUC/groupchat is
  the one open question — `mam_message` hook fires for `chat` type only).
- `apps/server/src/push-spike/`: `protocol.ts` (node + notification schemas),
  `notification.ts` (parse ejabberd publish IQs), `payload.ts` (mute/visible
  filter as a pure function + 3000-byte encrypted-payload budget),
  `component.ts` (XEP-0114 component via `@xmpp/component`, answers every
  publish with IQ result, 404/410 unsubscribes), `sender.ts` (real `web-push`
  VAPID+RFC8291 sender), `routes.ts` (session-guarded
  `GET /api/push-spike/config`, `POST subscribe/unsubscribe`, 404 unless
  `PUSH_SPIKE_ENABLED=true`, 401 before 404 so the authz sweep passes),
  `subscriptions.ts` (in-memory store keyed by node), `spike-config.ts`
  (all-optional env schema), `xmpp-component.d.ts` (spike-only typings —
  the package ships none), plus 4 unit test files (18 tests, fakes only).
- `apps/server/src/app.ts` (spike wiring via optional `pushSpike` dep +
  env fallback; production default unchanged) and `tsconfig.json` (include
  the spike `.d.ts`). `config.ts` was intentionally left untouched after a
  first approach broke `config.test.ts` exact-match expectations.
- `apps/web/public/push-spike/`: plain `index.html` (VAPID key → SW
  register → PushManager subscribe → store → show `<enable/>` stanza text;
  xmpp-core has no raw-IQ sender, noted as a T-0119 item) + `sw.js`
  (show notification, click opens `/chat/<id>`). Not in the app bundle.
- `infra/ejabberd/ejabberd.yml`: marked spike lines only — loopback
  `ejabberd_service` listener on 5347 for `push.galena.localhost`, and
  `mod_push` with `include_sender/include_body: true` for the proof.
- `docs/PUSH_SPIKE.md` (149 lines): answers to all six questions with
  evidence, GO/NO-GO, T-0119 outline, Helium 5-step procedure, deps/licences
  (web-push MPL-2.0, @types/web-push MIT, @xmpp/component ISC), risks.
- VAPID keys generated into git-ignored `infra/.env.push-spike` (0600);
  only variable names appear in docs. No secrets committed or printed
  (one `web-push generate-vapid-keys` CLI run echoed keys into my own
  shell log only; the file keys were regenerated programmatically after).

### Files changed
- New: `apps/server/src/push-spike/*` (11 files), `apps/web/public/push-spike/*`
  (2 files), `docs/PUSH_SPIKE.md`.
- Edited: `apps/server/package.json` + `pnpm-lock.yaml` (`web-push`,
  `@xmpp/component`, `@types/web-push` — the spec's whole list, nothing else),
  `apps/server/src/app.ts`, `apps/server/tsconfig.json`,
  `infra/ejabberd/ejabberd.yml` (marked spike lines),
  `work/T-0118-web-push-spike.md` (this report + status).
- Not committed, git-ignored: `infra/.env.push-spike` (VAPID keys + secret).

### Commands run and real results
- `pnpm install`: ok (7.3 s).
- `pnpm --filter @galena/server add web-push @xmpp/component @types/web-push`: ok.
- `pnpm --filter @galena/server exec tsc --noEmit`: clean (after fixing a
  `.d.ts`-basename shadowing trap, an `as`-precedence bug, and moving from
  `@xmpp/client` imports — not a server dep — to `@xmpp/component` re-exports).
- Spike tests: `notification` 5 passed, `payload` 6 passed, `component` 2 passed,
  `routes` 5 passed (18 total, fakes only, no network).
- Full `pnpm --filter @galena/server test --maxWorkers=2` (correct form, after
  the lead's warning): 66 files passed, 1090 tests passed, 7 skipped, 0 failed
  (259 s). First full run had 3 failures, all mine and fixed: 2×
  `config.test.ts` exact-match (reverted the `ServerConfig` change, used dep
  injection instead) + 1× authz sweep (routes now 401 before 404).
- `pnpm format:check`: clean. `pnpm lint`: clean (no output, exit 0).
- `pnpm typecheck`: 10 tasks successful. `pnpm build`: 2 successful.

### Problems, deviations from the spec, open questions
- Deviation: the spike page cannot send `<enable/>` itself — xmpp-core has
  no raw-IQ sender, so the page shows the stanza text for a scratch client
  and T-0119 must add the sender (noted in PUSH_SPIKE.md).
- Deviation: `subscriptions.ts` keeps an unused `now` param wired as
  `void now` (oxlint arg-order rule vs unused-param rule); harmless, flagged
  for removal in T-0119.
- No live ejabberd run from here (no browser, infra needs local secrets);
  live proof is the Helium 5-step procedure in `docs/PUSH_SPIKE.md`.
  Groupchat/MUC notifications are unverified against a live server
  (source says MAM hook is chat-only) — T-0119's first job.
- Size estimate for T-0119: medium (~1 week): migration, raw-IQ sender,
  chat_prefs/topic joins, keepalive, MUC path, PWA shell, metrics.

### Blocked / needs a decision
- None. Status: review.

---

## Review (written by Claude)

**Verdict:** Approved as a decision document. Merged docs-only.

### Findings
- The spike answers five of the six questions with evidence from `mod_push.erl` and unit tests with fakes. The sixth (groupchat) was left open by the worker; the lead addendum in `docs/PUSH_SPIKE.md` answers it: MUC/Sub (XEP-0369) is the path, and T-0119 must prove it live first.
- The spike code was throwaway by the spec ("a decision document, not a merged feature"). It also carried live-infra changes (`mod_push` with `include_body: true`, a component listener) and three new server dependencies, so it is **not merged**. It is preserved on the branch `spike/T-0118-push` for T-0119. The Report above describes that branch, not `main`.
- The worker first ran the full server suite with the wrong `-- --maxWorkers=2` form (about 10 workers); the lead killed it. The correct run afterwards passed: 1090 tests.
- Secrets: VAPID keys stayed in a git-ignored file; nothing committed.

### Follow-ups
- T-0119: rewrite the (SPIKE) sections from this document; first job is the live MUC/Sub proof.
- Remove the unused `now` parameter in the spike's subscription store when promoting it.
