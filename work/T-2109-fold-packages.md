---
id: T-2109
title: "Fold 38 small single-use files into the one file that imports each (packages: devtools, xmpp-core, client-core, protocol, desk): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2109-fold-packages
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2109: Fold single-use files (packages: devtools, xmpp-core, client-core, protocol, desk)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 38 files total 2635 lines, 118 of them import lines.

- `packages/devtools/src/lead/watch-app.tsx` (9) → `packages/devtools/src/lead/watch/cli.ts` (65)
- `packages/xmpp-core/src/stanza/payload-element.ts` (11) → `packages/xmpp-core/src/stanza/build-outgoing.ts` (208)
- `packages/client-core/src/store/send/failed.ts` (17) → `packages/client-core/src/store/send.ts` (21)
- `packages/devtools/src/lead/batch.ts` (25) → `packages/devtools/src/lead/cli/merge.ts` (97)
- `packages/client-core/src/store/suspend.ts` (29) → `packages/client-core/src/store/lifecycle.ts` (229)
- `packages/devtools/src/lead/cli/help.ts` (31) → `packages/devtools/src/lead/cli.ts` (72)
- `packages/devtools/src/smoke-lib.ts` (31) → `packages/devtools/src/smoke.ts` (201)
- `packages/devtools/src/effect-map/ratchet.ts` (32) → `packages/devtools/src/effect-map/ratchet-cli.ts` (88)
- `packages/devtools/src/gate/comments.ts` (33) → `packages/devtools/src/gate/cli.ts` (367)
- `packages/xmpp-core/src/text.ts` (36) → `packages/xmpp-core/src/stanza/decode.ts` (242)
- `packages/client-core/src/store/last-read.ts` (39) → `packages/client-core/src/store/lifecycle.ts` (229)
- `packages/devtools/src/lead/board.ts` (44) → `packages/devtools/src/lead/merge.ts` (258)
- `packages/client-core/src/store/send/album.ts` (45) → `packages/client-core/src/store/send/forward.ts` (178)
- `packages/devtools/src/plan-page/parity.ts` (48) → `packages/devtools/src/plan-page/collect.ts` (331)
- `packages/client-core/src/store/activity-refresh.ts` (57) → `packages/client-core/src/store/incoming.ts` (317)
- `packages/xmpp-core/src/core-effect/token-auth.ts` (59) → `packages/xmpp-core/src/core-effect/lifecycle.ts` (290)
- `packages/xmpp-core/src/core-effect/operations-types.ts` (59) → `packages/xmpp-core/src/core-effect/operations.ts` (350)
- `packages/devtools/src/lead/watch/cli.ts` (65) → `packages/devtools/src/lead/watch.ts` (19)
- `packages/devtools/src/xmpp-e2e/mam.ts` (67) → `packages/devtools/src/xmpp-e2e/main.ts` (208)
- `packages/xmpp-core/src/stanza/parse-roster.ts` (69) → `packages/xmpp-core/src/stanza.ts` (57)
- `packages/devtools/src/gate/migrations.ts` (71) → `packages/devtools/src/gate/cli.ts` (367)
- `packages/devtools/src/lead/reply.ts` (74) → `packages/devtools/src/lead/cli/commands.ts` (223)
- `packages/protocol/src/blocks-content.ts` (88) → `packages/protocol/src/blocks.ts` (97)
- `packages/protocol/src/blocks-progress.ts` (92) → `packages/protocol/src/blocks.ts` (97)
- `packages/desk/src/egress/policy.ts` (93) → `packages/desk/src/egress/proxy.ts` (310)
- `packages/devtools/src/lead/cli/merge.ts` (97) → `packages/devtools/src/lead/cli.ts` (72)
- `packages/devtools/src/lead/policy/filters.ts` (97) → `packages/devtools/src/lead/policy/classify.ts` (152)
- `packages/xmpp-core/src/core-effect/suspend.ts` (97) → `packages/xmpp-core/src/core-effect.ts` (320)
- `packages/devtools/src/lead/spec-check.ts` (105) → `packages/devtools/src/lead/cli/commands.ts` (223)
- `packages/devtools/src/lead/batch/report.ts` (105) → `packages/devtools/src/lead/batch/check.ts` (269)
- `packages/xmpp-core/src/core-effect/keepalive.ts` (106) → `packages/xmpp-core/src/core-effect/lifecycle.ts` (290)
- `packages/devtools/src/gate/images.ts` (109) → `packages/devtools/src/gate/cli.ts` (367)
- `packages/client-core/src/store/history-core.ts` (110) → `packages/client-core/src/store/history.ts` (331)
- `packages/xmpp-core/src/stream-management.ts` (112) → `packages/xmpp-core/src/core-effect.ts` (320)
- `packages/desk/src/agent/wire.ts` (116) → `packages/desk/src/agent/server.ts` (185)
- `packages/devtools/src/lead/snapshot.ts` (117) → `packages/devtools/src/lead/collect-snapshot.ts` (250)
- `packages/devtools/src/lead/batch/real.ts` (120) → `packages/devtools/src/lead/batch.ts` (25)
- `packages/xmpp-core/src/core-effect/stanza-router.ts` (120) → `packages/xmpp-core/src/core-effect.ts` (320)

### Steps
1. **Fold each row.**
   - Move the small file's code into its importer, next to where it is used: above the component or function that uses it.
   - Merge the imports: one import per module, no duplicates.
   - Delete the importer's import of the small file, then delete the small file.
   - Keep `export` only on names something else still imports (a test or a fixture). Otherwise drop the keyword.
2. **Skip a row, and list it in the Report with the reason, when:**
   - the importer would go over 800 lines;
   - the importer loads the small file lazily (`lazy(() => import(…))`, `import(…)` or `require(…)`), since code splitting must stay;
   - the small file is named by a config, script or entry point (check with `git grep -n "<path without extension>"` across the repo);
   - folding would create an import cycle.
3. **Tests and fixtures** that import a folded file import the same names from the importer instead.
4. **Change no behaviour:** no logic, no wording, no styling. Formatting follows prettier.
5. **No new tests.** Report the line counts and the skipped rows.

### Allowed files
- `packages/client-core/src/store/activity-refresh.ts`
- `packages/client-core/src/store/history-core.ts`
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/last-read.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/send.ts`
- `packages/client-core/src/store/send/album.ts`
- `packages/client-core/src/store/send/failed.ts`
- `packages/client-core/src/store/send/forward.ts`
- `packages/client-core/src/store/suspend.ts`
- `packages/desk/src/agent/server.ts`
- `packages/desk/src/agent/wire.ts`
- `packages/desk/src/egress/policy.ts`
- `packages/desk/src/egress/proxy.ts`
- `packages/devtools/src/effect-map/ratchet-cli.ts`
- `packages/devtools/src/effect-map/ratchet.ts`
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/comments.ts`
- `packages/devtools/src/gate/images.ts`
- `packages/devtools/src/gate/migrations.ts`
- `packages/devtools/src/lead/batch.ts`
- `packages/devtools/src/lead/batch/check.ts`
- `packages/devtools/src/lead/batch/real.ts`
- `packages/devtools/src/lead/batch/report.ts`
- `packages/devtools/src/lead/board.ts`
- `packages/devtools/src/lead/cli.ts`
- `packages/devtools/src/lead/cli/commands.ts`
- `packages/devtools/src/lead/cli/help.ts`
- `packages/devtools/src/lead/cli/merge.ts`
- `packages/devtools/src/lead/collect-snapshot.ts`
- `packages/devtools/src/lead/merge.ts`
- `packages/devtools/src/lead/policy/classify.ts`
- `packages/devtools/src/lead/policy/filters.ts`
- `packages/devtools/src/lead/reply.ts`
- `packages/devtools/src/lead/snapshot.ts`
- `packages/devtools/src/lead/spec-check.ts`
- `packages/devtools/src/lead/watch-app.tsx`
- `packages/devtools/src/lead/watch.ts`
- `packages/devtools/src/lead/watch/cli.ts`
- `packages/devtools/src/plan-page/collect.ts`
- `packages/devtools/src/plan-page/parity.ts`
- `packages/devtools/src/smoke-lib.ts`
- `packages/devtools/src/smoke.ts`
- `packages/devtools/src/xmpp-e2e/main.ts`
- `packages/devtools/src/xmpp-e2e/mam.ts`
- `packages/protocol/src/blocks-content.ts`
- `packages/protocol/src/blocks-progress.ts`
- `packages/protocol/src/blocks.ts`
- `packages/xmpp-core/src/core-effect.ts`
- `packages/xmpp-core/src/core-effect/keepalive.ts`
- `packages/xmpp-core/src/core-effect/lifecycle.ts`
- `packages/xmpp-core/src/core-effect/operations-types.ts`
- `packages/xmpp-core/src/core-effect/operations.ts`
- `packages/xmpp-core/src/core-effect/stanza-router.ts`
- `packages/xmpp-core/src/core-effect/suspend.ts`
- `packages/xmpp-core/src/core-effect/token-auth.ts`
- `packages/xmpp-core/src/stanza.ts`
- `packages/xmpp-core/src/stanza/build-outgoing.ts`
- `packages/xmpp-core/src/stanza/decode.ts`
- `packages/xmpp-core/src/stanza/parse-roster.ts`
- `packages/xmpp-core/src/stanza/payload-element.ts`
- `packages/xmpp-core/src/stream-management.ts`
- `packages/xmpp-core/src/text.ts`
- `packages/client-core/src/store/activity-refresh.test.ts`
- `packages/desk/src/egress/policy.test.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `packages/devtools/src/plan-page/findings.test.ts`
- `packages/xmpp-core/src/connection-resilience.test.ts`
- `packages/xmpp-core/src/stanza.test.ts`
- `packages/xmpp-core/src/stream-management.test.ts`
- `work/T-2109-fold-packages.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 59 lower.

---

## Report (written by the worker when done)

### What I did

Folded 37 of the 38 rows in the spec: each small file's code now lives in its only production importer, duplicate imports were merged, the importer's import of the small file was removed and the small file was deleted. Test imports now point at the importer. No logic, wording or styling changed.

- Skipped `packages/devtools/src/lead/watch-app.tsx` → `packages/devtools/src/lead/watch/cli.ts`: the importer loads it lazily with `await import('../watch-app.js')`, so folding would remove the code split. The row for `watch/cli.ts` → `watch.ts` was done; its lazy imports were rewritten for the new location (`./watch-app.js`, `./watch-format.js`).
- Only exports still imported elsewhere were kept (for example `checkMigrations`, `checkImages`, `taskIdComments`, `parseParity`, `checkTarget`, `parseRosterPush`, `STREAM_MANAGEMENT_NS`, `isAiActivityMessage`, `deleteFailedMessage`, `readLastRead`, `suspendStore`, `wakeCore`); everything else lost the `export` keyword.
- One comment reworded: the board comment's example row said `T-0038`, which the gate's "no task IDs in added comments" rule flags; it now says `T-XXXX`. Content of the comment is otherwise unchanged.
- Size warnings are soft-limit only (all under 800): `history.ts` 411, `egress/proxy.ts` 401, `gate/cli.ts` 571, `core-effect.ts` 638, `core-effect/lifecycle.ts` 449. No file was split.

Line counts (product files under `packages/`):

```
git diff --numstat -- packages
added 2569, deleted 2751, net -182
37 files deleted, totalling 2626 lines (the 38th file, watch-app.tsx, is the skipped row)
```

### Checks run

- `pnpm install --frozen-lockfile`: Done in 14.9s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/activity-refresh.test.ts`: 1 file passed, 7 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/egress/policy.test.ts`: 1 file passed, 17 tests passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/plan-page/findings.test.ts`: 1 file passed, 3 tests passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`: 1 file passed, 51 tests passed.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stream-management.test.ts src/connection-resilience.test.ts`: 2 files passed, 49 tests passed.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`: 1 file passed, 95 tests passed.
- `pnpm gate` (run twice: the first run failed on format in `history.ts`/`xmpp-e2e/main.ts` and a task-ID comment; both fixed, then):

```
gate: 71 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (3.6s)
PASS  effect  (1.3s)
PASS  build @zilar/server  (0.4s)
PASS  tests @zilar/client-core  (7.1s)
PASS  tests @zilar/desk  (1.5s)
PASS  tests @zilar/devtools  (16.0s)
PASS  tests @zilar/protocol  (0.9s)
PASS  tests @zilar/xmpp-core  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- One row skipped, with the reason in "What I did" above.
- `git grep` found no production config, script or entry point naming a folded path. The only remaining mentions are comments in `apps/server/src/hands/*.test.ts` that point at the old `packages/desk/src/agent/wire.ts` path; those files are outside this task's Allowed files, so I left them.
- The gate's soft size warnings are listed above; every folded importer stayed below 800 lines.

## Review (written by Claude)

Approved; the pre-review was clean (no findings, 2 follow-ups about stale `wire.ts` path comments in files outside this task). Net −182; 37 single-use files folded inside `devtools`, `xmpp-core`, `client-core`, `protocol` and `desk`. These packages have no screens, so the gate's typecheck and tests are the check.
