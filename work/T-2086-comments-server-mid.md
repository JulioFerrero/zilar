---
id: T-2086
title: "Cut comments (server web-tools, ais, xmpp, machines, effect, sandbox, approvals and more): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2086-comments-server-mid
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2086: Comment cut — server web-tools, ais, xmpp, machines, effect, sandbox, approvals and more

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2601 comment lines in 125 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **1300** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/server/src/ai/catalog-map.ts`
- `apps/server/src/ai/catalog.ts`
- `apps/server/src/ai/cost.ts`
- `apps/server/src/ai/http.ts`
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/ai/model-errors.ts`
- `apps/server/src/ai/model-prompt.ts`
- `apps/server/src/ai/providers.ts`
- `apps/server/src/ais/api-layers.ts`
- `apps/server/src/ais/api.ts`
- `apps/server/src/ais/health.ts`
- `apps/server/src/ais/http-logger.ts`
- `apps/server/src/ais/persona.ts`
- `apps/server/src/ais/provisioning-xmpp.ts`
- `apps/server/src/ais/provisioning.ts`
- `apps/server/src/ais/queries.ts`
- `apps/server/src/ais/service.ts`
- `apps/server/src/ais/status.ts`
- `apps/server/src/ais/stop-turn.ts`
- `apps/server/src/ais/templates.ts`
- `apps/server/src/ais/usage-store.ts`
- `apps/server/src/ais/usage.ts`
- `apps/server/src/approvals/access.ts`
- `apps/server/src/approvals/api-reads.ts`
- `apps/server/src/approvals/api.ts`
- `apps/server/src/approvals/queries.ts`
- `apps/server/src/approvals/rules.ts`
- `apps/server/src/approvals/schemas.ts`
- `apps/server/src/approvals/service.ts`
- `apps/server/src/approvals/sweeper.ts`
- `apps/server/src/approvals/verify.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/connections/base-url.ts`
- `apps/server/src/connections/crypto.ts`
- `apps/server/src/connections/pinned-fetch.ts`
- `apps/server/src/connections/probe.ts`
- `apps/server/src/connections/providers.ts`
- `apps/server/src/connections/service.ts`
- `apps/server/src/connections/smoke-client.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/contact-requests/decide.ts`
- `apps/server/src/contact-requests/errors.ts`
- `apps/server/src/contact-requests/queries.ts`
- `apps/server/src/contact-requests/reads.ts`
- `apps/server/src/contact-requests/search.ts`
- `apps/server/src/contact-requests/service.ts`
- `apps/server/src/effect/crypto-envelope.ts`
- `apps/server/src/effect/edge-request.ts`
- `apps/server/src/effect/edge.ts`
- `apps/server/src/effect/error-utils.ts`
- `apps/server/src/effect/http-core.ts`
- `apps/server/src/effect/node-serve.ts`
- `apps/server/src/effect/rate-limit-middleware.ts`
- `apps/server/src/effect/schema-issues.ts`
- `apps/server/src/effect/sql.ts`
- `apps/server/src/effect/sweep-loop.ts`
- `apps/server/src/machines/api-helpers.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/machines/codes.ts`
- `apps/server/src/machines/crypto.ts`
- `apps/server/src/machines/hub.ts`
- `apps/server/src/machines/machines.ts`
- `apps/server/src/machines/pairing.ts`
- `apps/server/src/machines/registry.ts`
- `apps/server/src/machines/runner-desk.ts`
- `apps/server/src/machines/service.ts`
- `apps/server/src/machines/view.ts`
- `apps/server/src/message-blocks/alert-routine.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/message-blocks/build.ts`
- `apps/server/src/message-blocks/cards.ts`
- `apps/server/src/message-blocks/guide.ts`
- `apps/server/src/message-blocks/media-ids.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/roles/access.ts`
- `apps/server/src/roles/api.ts`
- `apps/server/src/roles/private-topic-guard.ts`
- `apps/server/src/roles/queries.ts`
- `apps/server/src/roles/schemas.ts`
- `apps/server/src/roles/service.ts`
- `apps/server/src/roles/sync.ts`
- `apps/server/src/sandbox/host-fetch.ts`
- `apps/server/src/sandbox/ip-guard.ts`
- `apps/server/src/sandbox/limits.ts`
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/sandbox/tool-prelude.ts`
- `apps/server/src/sandbox/tool-worker-fetch.ts`
- `apps/server/src/sandbox/tool-worker-vm.ts`
- `apps/server/src/sandbox/tool-worker.ts`
- `apps/server/src/sandbox/types.ts`
- `apps/server/src/search/api.ts`
- `apps/server/src/search/archive-query.ts`
- `apps/server/src/search/edit-overlay.ts`
- `apps/server/src/search/match.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/search/service.ts`
- `apps/server/src/search/snippet.ts`
- `apps/server/src/web-tools/adapters.ts`
- `apps/server/src/web-tools/feed-adapter.ts`
- `apps/server/src/web-tools/feed.ts`
- `apps/server/src/web-tools/fetch-adapter.ts`
- `apps/server/src/web-tools/guarded-fetch-helpers.ts`
- `apps/server/src/web-tools/guarded-fetch-pinned.ts`
- `apps/server/src/web-tools/guarded-fetch.ts`
- `apps/server/src/web-tools/html.ts`
- `apps/server/src/web-tools/price-adapter.ts`
- `apps/server/src/web-tools/prices.ts`
- `apps/server/src/web-tools/search-adapter.ts`
- `apps/server/src/web-tools/search.ts`
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/web-tools/wikipedia-adapter.ts`
- `apps/server/src/xmpp/admin-client.ts`
- `apps/server/src/xmpp/admin/client.ts`
- `apps/server/src/xmpp/admin/errors.ts`
- `apps/server/src/xmpp/admin/names.ts`
- `apps/server/src/xmpp/admin/schemas.ts`
- `apps/server/src/xmpp/admin/types.ts`
- `apps/server/src/xmpp/album-xml.ts`
- `apps/server/src/xmpp/api.ts`
- `apps/server/src/xmpp/archive-sender.ts`
- `apps/server/src/xmpp/config.ts`
- `apps/server/src/xmpp/provisioning.ts`
- `apps/server/src/xmpp/schema-check.ts`
- `apps/server/src/xmpp/token.ts`
- `work/T-2086-comments-server-mid.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1300 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in every file under Allowed files, following `docs/COMMENTS.md`: kept
only WHY comments (security/permissions/money/privacy, protocol and data
invariants, platform/library workarounds, units and limits, tool directives) and
deleted task IDs, history, narration, JSDoc that repeats parameters, references to
deleted code, banners and commented-out code. Multi-line blocks with one real
"why" were shortened to one or two lines.

123 of the 125 allowed files changed. The other two keep their single one-line WHY
comment unchanged: `apps/server/src/roles/schemas.ts` (role membership is not
secret) and `apps/server/src/xmpp/admin/names.ts` (a full JID is allowed for
`send_stanza`).

No code, string, import, type or formatting line changed. Checked mechanically
over the whole diff: zero added or removed non-comment lines in `apps/`. The only
non-comment change is the `status:` line of this task file.

`git diff main...HEAD --shortstat`: 124 files changed, 1382 insertions(+), 2448
deletions(-) (the spec's task file is included; the comment cut itself is 123 code
files, 1083 insertions(+), 2449 deletions(-)).

Comments longer than 3 lines that were kept (file:line — reason):

- `apps/server/src/ai/catalog-map.ts:1` — server-only base URLs, loose decode.
- `apps/server/src/ai/catalog-map.ts:169` — mapping order and dropped models.
- `apps/server/src/ai/catalog.ts:1` — effect-plain, cache/fallback invariant.
- `apps/server/src/ai/catalog.ts:149` — shared price warm-up, never rejects.
- `apps/server/src/ai/cost.ts:35` — cache price fallback, unknown costs 0.
- `apps/server/src/ais/status.ts:8` — kill switch DB-only, 409/404 rules.
- `apps/server/src/ais/stop-turn.ts:1` — effect-plain, lazy gateway ordering.
- `apps/server/src/ais/usage-store.ts:48` — settle timeout never rejects.
- `apps/server/src/ais/usage-store.ts:74` — accounting is best effort.
- `apps/server/src/approvals/access.ts:221` — wire enum kept apart from storage.
- `apps/server/src/approvals/verify.ts:14` — timing-safe hash, consume once.
- `apps/server/src/connections/api.ts:1` — keys never in response/log, decode order.
- `apps/server/src/connections/base-url.ts:38` — https shape rules.
- `apps/server/src/connections/base-url.ts:73` — every address must be public.
- `apps/server/src/connections/crypto.ts:5` — envelope format and GCM auth.
- `apps/server/src/connections/pinned-fetch.ts:1` — effect-plain, SSRF pinning.
- `apps/server/src/connections/pinned-fetch.ts:160` — other hosts refused before socket.
- `apps/server/src/connections/pinned-fetch.ts:186` — model call cannot forget guard.
- `apps/server/src/contact-requests/queries.ts:38` — test seam for the insert.
- `apps/server/src/contact-requests/queries.ts:43` — test seam for recovery.
- `apps/server/src/contact-requests/search.ts:1` — handle-only search, no enumeration.
- `apps/server/src/contact-requests/service.ts:35` — refusals and transaction.
- `apps/server/src/contact-requests/service.ts:58` — handle inside tx, PGlite deadlock.
- `apps/server/src/contact-requests/service.ts:165` — recovery reads on fresh connection.
- `apps/server/src/effect/crypto-envelope.ts:1` — per-caller label, GCM auth.
- `apps/server/src/effect/edge.ts:1` — edge order, auth precedence.
- `apps/server/src/effect/http-core.ts:1` — core duties, no edge imports.
- `apps/server/src/effect/http-core.ts:72` — schema-error render contract.
- `apps/server/src/effect/http-core.ts:163` — socket header cannot be forged.
- `apps/server/src/effect/http-core.ts:177` — detail keys cannot overwrite envelope.
- `apps/server/src/effect/http-core.ts:235` — handler contract and envelope.
- `apps/server/src/effect/schema-issues.ts:1` — fold/annotation variants.
- `apps/server/src/effect/sql.ts:1` — effect/sql conventions.
- `apps/server/src/effect/sql.ts:196` — drizzle adoption seed.
- `apps/server/src/machines/runner-desk.ts:4` — desk never carries runner id.
- `apps/server/src/message-blocks/alert-routine.ts:1` — effect-plain, alert manager rules.
- `apps/server/src/message-blocks/respond.ts:1` — record/merge/correct, 404 rule.
- `apps/server/src/search/archive-query.ts:14` — fully bound SQL, prefix matching.
- `apps/server/src/search/edit-overlay.ts:1` — forged edits are ignored.
- `apps/server/src/search/edit-overlay.ts:137` — accepted edits, no time cursor.
- `apps/server/src/search/match.ts:1` — folding parity with SQL.
- `apps/server/src/web-tools/adapters.ts:1` — untrusted content, tier rule.
- `apps/server/src/web-tools/feed.ts:1` — effect-plain, DTD/entity refusal.
- `apps/server/src/web-tools/guarded-fetch.ts:1` — untrusted content, DNS pin, redirects.
- `apps/server/src/web-tools/guarded-fetch.ts:49` — text-only body allowlist.
- `apps/server/src/web-tools/guarded-fetch.ts:58` — anyPublicHost keeps every guard.
- `apps/server/src/web-tools/guarded-fetch.ts:63` — truncate at cap for link previews.
- `apps/server/src/web-tools/html.ts:1` — extractor behaviour and input cap.
- `apps/server/src/web-tools/prices.ts:1` — two fixed hosts, finite numbers.
- `apps/server/src/web-tools/search.ts:1` — port, unwrap, never retried.
- `apps/server/src/xmpp/admin/client.ts:109` — kick ends all streams.
- `apps/server/src/xmpp/admin/types.ts:47` — kick reason only in failures.
- `apps/server/src/xmpp/schema-check.ts:5` — startup shape check, pg_catalog.
- `apps/server/src/xmpp/schema-check.ts:55` — drift vs unknown.
- `apps/server/src/xmpp/schema-check.ts:112` — run once, cache for health.

### Checks run

- `pnpm install`: done, 32.7 s.
- `pnpm gate` (from the repo root), final run:

```text
gate: 124 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (2.9s)
PASS  lint  (0.9s)
PASS  typecheck  (1.2s)
PASS  effect  (6.1s)
PASS  build @zilar/server  (0.9s)
PASS  tests @zilar/server  (68.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No test file was run on its own: the task says no tests and `pnpm gate` ran the
  server package's tests once.

### Notes for the lead

- `apps/server/src/machines/api.ts` keeps the one-line comment
  `// Public route: no session, so it uses the envelope directly.` Removing it
  changes Prettier's layout of the `pair` handler (it collapses the
  `handleRaw('pair', (request) =>` arguments), which would be a code-format
  change. The comment is a real "why", so it stays.
- The gate also checks a 400-line file limit; all changed files stay under it.
- No behaviour, string, import or type changed; only comment lines and the blank
  lines they left behind.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +1082 -2448 net -1366; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
