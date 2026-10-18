---
id: T-2084
title: "Cut comments (server push, groups, topics, stickers): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2084-comments-server-push-groups-topics-stickers
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2084: Comment cut — server push, groups, topics, stickers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2197 comment lines in 87 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **1098** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/server/src/groups/access.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/groups/api.ts`
- `apps/server/src/groups/bans.ts`
- `apps/server/src/groups/delete-group.ts`
- `apps/server/src/groups/events.ts`
- `apps/server/src/groups/invites.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/ownership.ts`
- `apps/server/src/groups/queries.ts`
- `apps/server/src/groups/room-reconcile.ts`
- `apps/server/src/groups/room-sync-retry.ts`
- `apps/server/src/groups/schemas.ts`
- `apps/server/src/groups/service.ts`
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/groups/visibility.ts`
- `apps/server/src/push/album-key.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-subscribe.ts`
- `apps/server/src/push/api-test.ts`
- `apps/server/src/push/api-util.ts`
- `apps/server/src/push/api.ts`
- `apps/server/src/push/archive-scan.ts`
- `apps/server/src/push/archives-cache.ts`
- `apps/server/src/push/candidates.ts`
- `apps/server/src/push/component.ts`
- `apps/server/src/push/config.ts`
- `apps/server/src/push/crypto.ts`
- `apps/server/src/push/delivery.ts`
- `apps/server/src/push/failure-reason.ts`
- `apps/server/src/push/fcm-token.ts`
- `apps/server/src/push/fcm.ts`
- `apps/server/src/push/group-notifier.ts`
- `apps/server/src/push/native-sender.ts`
- `apps/server/src/push/notification.ts`
- `apps/server/src/push/payload.ts`
- `apps/server/src/push/preview-delivered.ts`
- `apps/server/src/push/protocol.ts`
- `apps/server/src/push/sender.ts`
- `apps/server/src/push/service.ts`
- `apps/server/src/push/store-save.ts`
- `apps/server/src/push/store.ts`
- `apps/server/src/push/subscriptions.ts`
- `apps/server/src/stickers/api-decode.ts`
- `apps/server/src/stickers/api-handlers.ts`
- `apps/server/src/stickers/api-upload.ts`
- `apps/server/src/stickers/api.ts`
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/stickers/favorites.ts`
- `apps/server/src/stickers/image.ts`
- `apps/server/src/stickers/pack-link.ts`
- `apps/server/src/stickers/packs.ts`
- `apps/server/src/stickers/panel.ts`
- `apps/server/src/stickers/routes.ts`
- `apps/server/src/stickers/schemas.ts`
- `apps/server/src/stickers/service.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/stickers/telegram-import.ts`
- `apps/server/src/stickers/telegram-store.ts`
- `apps/server/src/stickers/telegram.ts`
- `apps/server/src/stickers/telegram/client.ts`
- `apps/server/src/stickers/telegram/errors.ts`
- `apps/server/src/stickers/telegram/pack-input.ts`
- `apps/server/src/stickers/telegram/set.ts`
- `apps/server/src/stickers/telegram/transport.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/ai-access.ts`
- `apps/server/src/topics/ai-activity.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/topics/general-ais.ts`
- `apps/server/src/topics/members.ts`
- `apps/server/src/topics/patch.ts`
- `apps/server/src/topics/preview.ts`
- `apps/server/src/topics/public-compat.ts`
- `apps/server/src/topics/queries.ts`
- `apps/server/src/topics/roles.ts`
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/topics/room-push.ts`
- `apps/server/src/topics/room-sync.ts`
- `apps/server/src/topics/schemas.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/topics/types.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/visible-batch.ts`
- `work/T-2084-comments-server-push-groups-topics-stickers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1098 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in all 86 allowed `.ts` files, following `docs/COMMENTS.md`:
removed task IDs, history, narration, parameter-restating JSDoc and
references to removed code, and shortened multi-line blocks to their WHY.
Code, strings, imports, types and formatting are untouched: a script compared
the non-comment, non-blank line sequence of every allowed file against `main`
(87 files checked, 0 differ). The `effect-plain:` directive in
`topics/preview.ts` was restored after the first gate run caught its removal.

- `git diff main...HEAD --shortstat`: **86 files changed, 1212 insertions(+),
  2068 deletions(-)**. Of that, this task file adds 257 report lines; the
  source-only figure is **`-- apps/server`: 85 files changed, 955
  insertions(+), 2068 deletions(-)**, a net **1113 lines removed**.
- Comment lines in the allowed files went from **2197 to 1098** (1099 removed,
  just over the 1098 target). Two allowed files (`stickers/telegram/set.ts`,
  `topics/schemas.ts`) are unchanged because every comment they carry is a
  unit/tool WHY.
- No tests were added: the task says no tests and only comments changed.
- All edits were comment deletions/shortenings plus doubled blank lines those
  deletions left behind; Prettier was run only on the 13 files the gate named
  for formatting (plus `stickers/storage.ts`, where removing a comment inside
  an empty `catch` let Prettier collapse `catch { ... }` to `catch {}`; I
  restored a one-line WHY there, so the code shape matches `main`).

### Checks run

- `pnpm install`: done (53.6s).
- `pnpm gate` (first run): **GATE FAIL** — `format`, 13 files.
- `pnpm gate` (second run): **GATE FAIL** — `effect`, because
  `apps/server/src/topics/preview.ts` lost its `effect-plain:` directive.
- `pnpm gate` (final run): **GATE PASS**. Summary:
  - `gate: 86 changed file(s) against main`
  - `PASS  install (frozen)  (3.1s)`
  - `PASS  format  (4.1s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (1.1s)`
  - `PASS  effect  (3.8s)`
  - `PASS  build @zilar/server  (0.5s)`
  - `PASS  tests @zilar/server  (138.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- Single test files run while working: none (comments only).

### Notes for the lead

Kept comments longer than 3 lines (file:line, reason):

- `groups/delete-group.ts:1` — delete order and owner/404 rules.
- `groups/delete-group.ts:51` — cascade table list.
- `groups/join.ts:33` — public-join 404, cap lock and 503 rule.
- `groups/member-roles.ts:20` — owner-only rule, voice mapping, last-admin guard.
- `groups/queries.ts:108` — last-admin check is non-atomic (known race).
- `groups/room-reconcile.ts:67` — startup re-sync scope and idempotency.
- `groups/room-sync-retry.ts:7` — retry invariant, in-memory loss on restart.
- `groups/service.ts:168` — handle-claim transaction and race.
- `groups/topic-rooms.ts:24` — archived rooms and best-effort sync.
- `groups/visibility.ts:41` — visibility/handle transaction, locks and intervals.
- `groups/visibility.ts:164` — handle claim/race rules.
- `push/album-key.ts:3` — album dedupe key across pages.
- `push/api-subscribe.ts:1` — token clear vs sealed keys, step order.
- `push/api-subscribe.ts:51` — stale enable-pair and best-effort sync.
- `push/api-subscribe.ts:128` — post-commit sync failure must not 500.
- `push/api.ts:1` — raw decode order and limiter placement.
- `push/archive-scan.ts:38` — one notification per IQ, mute/race silence.
- `push/archive-scan.ts:85` — superseded rows and album marking.
- `push/archive-scan.ts:125` — duplicate vs no-message reporting.
- `push/candidates.ts:108` — own messages and `bare_peer` sender rule.
- `push/candidates.ts:214` — XEP-0461 fallback quote parsing.
- `push/component.ts:32` — component reply/order and per-node serialization.
- `push/component.ts:69` — `from` domain must be ejabberd's.
- `push/config.ts:3` — optional push config and required keys.
- `push/crypto.ts:5` — envelope format, HKDF separation, GCM failure.
- `push/failure-reason.ts:7` — fixed reasons, secrets never in the string.
- `push/group-notifier.ts:18` — why group messages need polling.
- `push/native-sender.ts:1` — FCM setup and private-key handling.
- `push/notification.ts:42` — publish-options deliberately unparsed.
- `push/payload.ts:78` — data-only wake carries ids only.
- `push/protocol.ts:22` — mod_push summary fields and production options.
- `push/sender.ts:18` — Web Push sender, 404/410 drop rule.
- `push/store-save.ts:58` — native token single-account rule.
- `stickers/api-decode.ts:55` — cached body and manual decode routes.
- `stickers/api-upload.ts:1` — capped multipart/raw read order.
- `stickers/api.ts:1` — route step order and raw binary responses.
- `stickers/image.ts:1` — magic-byte-only type detection.
- `stickers/pack-link.ts:1` — pack id as capability and personal imported packs.
- `stickers/routes.ts:23` — token resolver precedence.
- `stickers/storage.ts:32` — storage dir resolves against package root.
- `stickers/storage.ts:45` — package-marker walk and stop condition.
- `stickers/telegram-import.ts:1` — host allowlist, caps, token scrubbing.
- `stickers/telegram-store.ts:13` — import store, duplicates and `pack_full`.
- `stickers/telegram.ts:22` — import limits, conversion and `partial`.
- `stickers/telegram.ts:182` — batches, budget and mid-batch full pack.
- `stickers/telegram/client.ts:18` — client caps, 429 and 401 mapping.
- `stickers/telegram/pack-input.ts:6` — accepted pack link forms.
- `stickers/telegram/transport.ts:46` — abort/timeout behaviour.
- `topics/access.ts:179` — General manager rights follow current owners.
- `topics/ai-access.ts:9` — derived owner rule for AI room membership.
- `topics/ai-activity.ts:1` — precedence, batch cost and best-effort reads.
- `topics/ais.ts:24` — AI topic add permissions and 404 rule.
- `topics/preview.ts:1` — `effect-plain` directive plus archive read reason.
- `topics/preview.ts:34` — page query, overlay and origin id.
- `topics/public-compat.ts:6` — public topics start empty; backfill rule.
- `topics/roles.ts:50` — role attachment permissions and private-only rule.
- `topics/room-members.ts:29` — no person owner/admin affiliation except channel feed.
- `topics/room-members.ts:39` — desired room membership and affiliations.
- `topics/room-members.ts:71` — AI voice rule in a channel feed.
- `topics/room-members.ts:112` — AI affiliations and owner-in-group rule.
- `topics/room-push.ts:13` — MUC/Sub subscription/unsubscription rules.
- `topics/room-sync.ts:15` — desired-members application and 502/503.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +955 -2068 net -1113; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
