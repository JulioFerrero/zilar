---
id: T-0118
title: Spike: web push through ejabberd's push module (XEP-0357) to a real browser
status: planned
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
