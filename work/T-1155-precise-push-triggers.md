---
id: T-1155
title: "F6 (audit MP-7): mod_push notify_on: messages (typing/presence no longer trigger pushes), and the archive scan only considers rows from the last 10 minutes and notifies the OLDEST unnotified incoming row first, so an old message is never re-pushed and bursts arrive in order"
status: merged
milestone: M5
branch: task/T-1155-precise-push-triggers
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1155: Precise push triggers (F6)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-7 and fix **F6**.
- **Every stanza publishes:** `mod_push` defaults to `notify_on: all`, and neither ejabberd file sets it (`deploy/ejabberd/ejabberd.yml:270-273`, `infra/ejabberd/ejabberd.yml:216-219`). So every stanza to a pending session, including typing and presence, sends a publish IQ.
- **The scan picks old rows:**
  - the component scans newest-first for the first origin id not yet in this node's `seen` set (`apps/server/src/push/archive-scan.ts:63-105`, the loop at `:72-96`);
  - a message received while online is never in `seen`, so a typing state can re-push an old message;
  - in a burst, IQ 1 notifies the newest message and IQ 2 the next newest, so the phone buzzes in reverse;
  - the comment at `:36-40` ("a burst while offline buzzes once with the latest") is wrong.

### What to build
1. **ejabberd:** in both yml files, under `mod_push`, add `notify_on: messages` with a one-line comment citing this task.
   - Another task (T-1151) adds `resume_timeout` under `mod_stream_mgmt` in the same files. Touch only the `mod_push` block.
2. **`archive-scan.ts` (`newestMessageForUserEffect`):**
   - consider only rows with a timestamp within the last **10 minutes** of `deps.now()`. Older rows are never notified;
   - among the unseen rows in that window, walk **oldest-first** and notify the oldest acceptable incoming row;
   - the rows it skipped as superseded are marked as notified, as today;
   - keep the muted or hidden "sticky" behaviour and the MAM-race retries (`ARCHIVE_LOOKUP_ATTEMPTS`) unchanged;
   - fix the comment at `:36-40` to describe the new rule;
   - keep the exported names, so `candidates.ts`, `delivery.ts` and the preview route are unaffected;
   - if `readNewestCandidates` needs a time bound or order option, add it as an optional parameter. The file stays at most 400 lines.
3. **Tests** (the message pipeline), in `apps/server/src/push/delivery.test.ts` or the scan's existing test file (find it), at most 2:
   - three unseen rows within the window and three IQs notify oldest, then middle, then newest, with no repeat;
   - a row older than 10 minutes is never notified.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (3E MP-7, F6), `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/delivery.ts:240-265`, `apps/server/src/push/delivery.test.ts:1-80` and both `ejabberd.yml` `mod_push` blocks.

### Allowed files
`deploy/ejabberd/ejabberd.yml`, `infra/ejabberd/ejabberd.yml`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/delivery.test.ts`, `apps/server/src/push/candidates.test.ts`, `work/T-1155-precise-push-triggers.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/delivery.test.ts src/push/candidates.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on Julio's phone:** with the app in the background, 3 messages from another account give 3 notifications in order, and typing alone gives none.

---

## Report (written by the worker when done)

### What I did
- `deploy/ejabberd/ejabberd.yml` and `infra/ejabberd/ejabberd.yml`: added
  `notify_on: messages` under `mod_push` with a one-line comment citing T-1155.
  Only the `mod_push` block was touched (`mod_stream_mgmt`/`resume_timeout`
  left to T-1151).
- `apps/server/src/push/archive-scan.ts` (now 212 lines):
  - added `ARCHIVE_FRESH_WINDOW_MS = 10 * 60 * 1000`;
  - the scan computes a microsecond cutoff once from `deps.now()`
    (`Date.getTime() - window`, `* 1000n`, matching the archive's micros
    timestamps) and skips any row older than it — older rows are never
    notified and never marked;
  - walks the newest-first rows oldest-first (`[...rows].reverse()`), notifies
    the first unseen fresh row that resolves `ok`, and marks the older skipped
    rows as notified with it via the existing `superseded` mechanism;
  - muted/hidden sticky behaviour and the `ARCHIVE_LOOKUP_ATTEMPTS` MAM-race
    retries are unchanged; fixed the `:36-40` comment to describe the new rule;
  - kept the exported names, so `candidates.ts`, `delivery.ts` and the preview
    route are untouched.
- `apps/server/src/push/delivery.test.ts` (302 lines): there was no existing
  scan test file, so the 2 allowed tests live here, exercising
  `handleIncomingPush` end to end (seeded user + webpush device, stub archive
  returning keyed DM rows newest-first, fixed `NOW` clock):
  1. three unseen rows in window + three IQs → payloads arrive
     `origin-old, origin-mid, origin-new`, all `sent`; a fourth IQ drops as
     `duplicate` with no extra send (no repeat);
  2. a single 20-minute-old row → outcome `dropped`, zero sender calls.

### Deviation from the spec
- `readNewestCandidates` got no time-bound/order parameter. The spec made that
  conditional ("if ... needs"), and it doesn't need it: the SQL stays
  `ORDER BY timestamp DESC LIMIT 25` (which also avoids a cap bug — with
  oldest-first SQL the newest rows would age out of view behind already-seen
  rows) while the 10-minute window and oldest-first walk happen in the scan
  loop, which is also what makes the window testable with a stub archive.

### Commands and real results
- `pnpm install`: done, 13.6s (peer-dep warning for `@types/react-dom` in
  mobile only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/push/delivery.test.ts`: 7 passed.
- `pnpm --filter @zilar/server exec vitest run src/push/delivery.test.ts
  src/push/candidates.test.ts --reporter=dot`: 2 files, 12 tests, all passed.
- `pnpm gate` (first run): FAIL on typecheck only — my stub archive returned
  `ArchiveCandidate[]` but `ArchivePool.query` is typed on the wider
  `ArchiveRow` (needs `peer`, `headline`). Fixed by widening the stub rows;
  no production code changed for this. Second `pnpm gate`:
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (0.6s)`
  - `PASS  typecheck  (3.5s)`
  - `PASS  effect  (0.9s)`
  - `PASS  tests @zilar/server  (15.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Security checklist
- No secrets, tokens or message text in logs or code (test JIDs are fixed
  fixtures like the rest of the suite).
- No deletes/updates added; the archive stays read-only; `recentlyNotified`
  is keyed per device node as before.
- No new routes; fixed test fixtures; no real external services in tests.

### Open questions
- None. Note for the lead's phone check: with typing alone the publish IQ no
  longer fires (`notify_on: messages`), and a burst now arrives oldest-first.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits.**
- **ejabberd:** `notify_on: messages` in both yml files, `mod_push` block only. It's valid for 26.07 (option since 23.10).
- **The scan:** a 10-minute window, oldest unseen acceptable row first. The SQL stays `DESC LIMIT 25`, reversed in memory, so newest rows aren't hidden behind seen rows. Sticky muted/hidden semantics are kept.
- **Tests:** the lead ran them in the branch: 12 of 12, including the new order and stale-row tests.
- **Accepted nits:** a comment wording, and an all-stale scan uses its retries.
- **Still to do:** the phone check (3 messages give 3 in-order notifications) together with T-1151's APK.
