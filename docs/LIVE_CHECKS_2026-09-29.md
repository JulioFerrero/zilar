# Live checks left open after the night of 2026-09-28/29

Everything below was merged with green checks (format, lint, typecheck, tests, build) and reviewed by the lead, but **has not been tried by a person on real devices or with the real services**. Each block says what to do and what "good" looks like. Nothing here needs a code change unless it fails.

The live API on `127.0.0.1:3188` already runs the latest `main` (restarted after every server merge). The runner hub is **off** there.

## 1. Runner ↔ hub ↔ Machines page (T-0068, T-0070, T-0071, T-0072, T-0075, T-0077)

1. Restart the API with the hub on (in `apps/server`; the `.env` is loaded as usual):
   `RUNNER_HUB_ENABLED=true PORT=3188 pnpm exec tsx --env-file=.env src/index.ts` (the hub listens on `127.0.0.1:3189`).
2. Web → menu → **Machines** → **Add machine**: a pairing code appears (valid 10 minutes).
3. Pair (any spare directory as the runner's home):
   `GALENA_RUNNER_HOME=/tmp/galena-runner-try pnpm --filter @galena/runner start pair <CODE> --server http://127.0.0.1:3188 --name try-mac`
   Good: it prints a machine id and a fingerprint; the Machines page shows the machine as **pending** with the same fingerprint.
4. **Approve** it in the page.
5. Run it: `GALENA_RUNNER_HOME=/tmp/galena-runner-try pnpm --filter @galena/runner start run --hub ws://127.0.0.1:3189/tunnel`
   Good: `connecting`, then `online`; within a minute the machine shows **Online** in the page.
6. **Revoke** it in the page. Good: `run` prints that the machine was revoked and exits non-zero; it does not reconnect.
7. Clean up: `rm -rf /tmp/galena-runner-try`, restart the API without `RUNNER_HUB_ENABLED` if you do not want the hub.

## 2. Kill switch (T-0080, T-0083, T-0084)

With an AI that answers in a DM and in a group:
- Web → the AI's panel → **Stop AI** (confirm). Good: the panel shows "Stopped"; the AI disappears from `docker exec galena-dev-ejabberd-1 ejabberdctl connected_users` (its `…/gateway` session); a message to it gets no answer; ask it something long and stop it while it is answering: **no reply arrives afterwards**.
- **Resume**. Good: it is back online and answers again.
- The panel's **Activity** section shows "Stopped" and "Resumed" entries.

## 3. Approvals (T-0073, T-0076, T-0081, T-0082, T-0087)

No real approval requests exist yet (the engine that creates them is a later task), so use mock mode:
- Web deep link `http://localhost:<free port>/c/c-devteam?mock=1` (run `pnpm --filter @galena/web dev --port <free port>`; not 3000/5173/8081): the card shows **Approve / Deny**; Approve turns it into "Approved".
- `…/settings/approvals?mock=1`: the inbox lists the pending request with a countdown.
- Mobile (dev build, mock scenario): the same card decides in memory.
Nothing further can be verified until the engine creates approvals.

## 4. Web: attachments, budget warning, edit/delete (T-0065, T-0066 and earlier)

Real chats in Helium (do not send messages you do not want sent): upload, paste and drag an image and a file; an image from a tracker-like host must not auto-load; edit and delete one of your own messages and see the "edited" label and the tombstone.

## 5. Mobile on the phone (T-0064, T-0067, T-0078, T-0085)

- Markdown in AI replies renders (bold, lists, code, links).
- Cold start and airplane mode show the loading and error states, not a blank screen.
- A message someone edited or deleted on the web shows the new text with "edited" / the "This message was deleted" tombstone, live and after reopening the chat; reactions from the web show as chips.
- Long-press one of your messages: quick reactions, **Edit** (the input is prefilled, "Save edit"), **Delete** (confirm). Check the result on the web. Cancel an edit and get your draft back; switch chats in the middle of an edit.

## 6. Audit log (T-0079, T-0083, T-0084, T-0086)

- Postgres refuses changes: `docker exec galena-dev-postgres-1 psql -U postgres -d galena -c "truncate audit_log"` must answer `audit_log is append-only` (verified once by the lead on the empty table).
- The AI panel **Activity** section (owner) and the group panel **Activity** section (group owner/admin) list entries after you stop/resume an AI or approve/revoke a machine.

## Known follow-ups (not blockers, also on `work/BOARD.md`)

- `addGroupAi` still lets you add a stopped AI to a room (no wake-up, stale membership).
- Kill switch for room admins and workspace admins (J5), audit entries from the engine and proxy, retention (J4).
- TLS for the runner hub is a deployment task (the client accepts `wss://` now; the hub itself binds to loopback).
- Desks, the docker driver and the approval-creating engine are the next big pieces (M3/M4).
