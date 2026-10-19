---
id: T-2183
title: "Server (server, wave 3): fold single-use files back into their only importer where the split was for size or is one concept — fewer imports, exports and repeated types; no behaviour change"
status: merged
milestone: M5
branch: task/T-2183-fold-server-3
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2183: Fold single-use server files (server, wave 3)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. Each fold below removes the import and export lines, and any type or helper the two files both declare.

The lead listed these at `21e88f8fa`. Each mover has exactly one production importer, the host; the tests listed import it too.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `stickers/routes.ts` (20) | `stickers/api.ts` (50) | 0 |
| `main.ts` (28) | `index.ts` (5) | 0 |
| `contact-requests/errors.ts` (34) | `contact-requests/api.ts` (609) | 0 |
| `agents/tools/tool-params.ts` (50) | `agents/tools/definitions.ts` (313) | 0 |
| `agents/gateway/group-turn-roster.ts` (50) | `agents/gateway/group-turn-body.ts` (404) | 0 |
| `effect/node-serve.ts` (60) | `startup/components.ts` (641) | 0 |
| `actions/canonical.ts` (79) | `actions/gateway.ts` (579) | 0 |
| `agents/dm-tool-turn.ts` (105) | `agents/dm-turn.ts` (143) | 0 |

All paths are under `apps/server/src/`.

### Steps
For each row, read both files.
1. **Fold** when the mover is a slice of the host's concept (a handler, a parser, a schema or a query helper that only the host uses) or was split out for size:
   - move its code into the host, and carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - delete the mover;
   - remove the now-internal `export`s the host no longer needs;
   - drop declarations that become duplicates.
2. **Chains.** Fold in order. For example, `actions/approval-path.ts` goes into `actions/decisions.ts`, which then goes into `actions/gateway.ts`, only if the result stays within the cap.
3. **Cap.** No host may end above 750 lines; skip a fold that would push it over. Several movers into one host count together.
4. **Skip** a fold when the mover is a separate concept a reader looks for by name, or a worker-thread or process entry loaded by path. Check for `new Worker(`, `import.meta.url` or a file-path string that names the mover before folding it.
5. **Tests.** Update the import path, or the `vi.mock(...)` path, in each listed test; change nothing else in it. No new tests.
6. **Skip the `main.ts` → `index.ts` row.** `apps/server/src/auth/export.ts:62` names `main.ts`, and `auth/**` is out of bounds.
7. **Two pass-through exports left on the server.** Delete both; importers import the defining names from the defining module, with no alias:
   - `apps/server/src/agents/tool-loop.ts:36`: `export { ChatCompletionError, MODEL_CHAT_TIMEOUT_MS };` hands on names `tool-loop.ts` imports;
   - `apps/server/src/hands/cloud-hands.ts:19`: `export { DeskError as HandsError, DeskQueued as HandsQueued };` (rename aliases).

### Rules
- No behaviour change: the same SQL, routes, limits, log fields and error strings.
- The diff only moves code, removes import/export lines and removes duplicates. It changes no line of logic.
- Do not touch `apps/server/src/auth/**`. The `agents/**` rows are on the message pipeline: move their code word for word, and their tests must pass unchanged except for import paths.
- Product lines go down by at least 30.

### Allowed files
- `apps/server/src/actions/canonical.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn-roster.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/tool-params.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/contact-requests/errors.ts`
- `apps/server/src/effect/node-serve.ts`
- `apps/server/src/index.ts`
- `apps/server/src/main.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/stickers/api.ts`
- `apps/server/src/stickers/routes.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/hands/cloud-hands.ts`
- `apps/server/src/**` (import lines and names only, in a file or test that imported a folded file or a removed pass-through)
- `apps/runner/src/e2e.test.ts` (import path only; added by the lead after the pre-review)
- `work/T-2183-fold-server-3.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the server tests it runs.
- Product lines go down by at least 30.
- The Report lists each row: folded (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Folded each single-use server file into its only production importer, moving the code word for word and leaving the logic unchanged. Flattened deps interfaces kept their `export` because the host's dependency type still names them (and tests or `app.ts` import that type from the host); other exports stayed as-is so importers do not change.

| Mover -> host | Result |
| --- | --- |
| `stickers/routes.ts` -> `stickers/api.ts` | folded, total 70 -> 67 lines (-3) |
| `main.ts` -> `index.ts` | skipped per spec (`auth/export.ts` names `main.ts`) |
| `contact-requests/errors.ts` -> `contact-requests/api.ts` | folded, 643 -> 636 (-7); dropped the now-duplicate `isPendingPairViolation` from the host's re-export block |
| `agents/tools/tool-params.ts` -> `agents/tools/definitions.ts` | folded, 363 -> 363 (0; the removed import is offset by the new `effect` import) |
| `agents/gateway/group-turn-roster.ts` -> `agents/gateway/group-turn-body.ts` | folded, 454 -> 449 (-5) |
| `effect/node-serve.ts` -> `startup/components.ts` | folded, 701 -> 698 (-3); kept its why-comment above the moved server code |
| `actions/canonical.ts` -> `actions/gateway.ts` | folded, 658 -> 655 (-3) |
| `agents/dm-tool-turn.ts` -> `agents/dm-turn.ts` | folded, 248 -> 239 (-9) |

Pass-through exports removed:

- `agents/tool-loop.ts`: deleted `export { ChatCompletionError, MODEL_CHAT_TIMEOUT_MS };` and the now-unused imports. The four importers (`dm-turn.ts`, `group-turn.ts`, `tool-exec.ts`, `tool-rounds.ts`) and `reply.test.ts` now import `ChatCompletionError` from `../ai/model-client`; no alias.
- `hands/cloud-hands.ts`: deleted `export { DeskError as HandsError, DeskQueued as HandsQueued };`. `cloud-hands.test.ts` now imports `DeskError`/`DeskQueued` from `@zilar/desk`; the identifiers in the test were renamed, no other test lines changed.

Product source lines (non-test files under `apps/server/src`): **+393 / -431, net -38** (requirement: at least -30).

No test had a `vi.mock` for a folded path and none imported a folded file by path. No mover was a worker/process entry (`new Worker(`, `import.meta.url`): checked before folding.

### Checks run

- `pnpm install --frozen-lockfile` -> Done (13.5s).
- Targeted tests, run while working:
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/agents/handoff.test.ts src/agents/gateway/group-turn-access.test.ts src/contact-requests/contact-requests.test.ts src/hands/cloud-hands.test.ts src/stickers/api-upload.test.ts` -> 6 files passed, 37 tests passed.
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/dm-turn.fake-provider.test.ts src/agents/tools/tool-params.test.ts src/agents/tools/desk-definitions.test.ts src/agents/gateway-group.test.ts` -> 4 files passed, 45 tests passed.
- `pnpm gate` (first run) -> GATE FAIL on format (`apps/server/src/contact-requests/api.ts`); scope said every changed file is inside the Allowed files.
- Ran `pnpm exec prettier --write apps/server/src/contact-requests/api.ts` (only formatting; that file was the one gate named).
- `pnpm gate` (final run) -> **GATE PASS**:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`, `PASS tests @zilar/server` (30.7s)
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - size warnings only (all hosts under 750: gateway 655, group-turn-body 449, contact-requests 636, components 698; no file over 800)
  - `comments: no task IDs in added comments`

### Notes for the lead

- The `tool-params.ts` fold saves 0 net lines because `definitions.ts` did not import `effect` before and the moved helper needs `Schema`, `SchemaAST` and `SchemaRepresentation`. It still removes one file and its import.
- `startup/components.ts` ends at 698 lines, under the 750 cap; `actions/gateway.ts` at 655. Both remain over the 400 soft limit, which the task accepts when keeping the file whole saves lines.
- The first gate failure was formatting only and was fixed with Prettier on the single named file; no code changed in that step.
- No deviations from the spec. Nothing pushed, merged or branched.

### Fix round

- Repointed `apps/runner/src/e2e.test.ts:6` to `@zilar/server/src/startup/components.ts` (import path only, as the lead's added Allowed file allows).
- `git grep -nE "effect/node-serve|actions/canonical|dm-tool-turn|group-turn-roster|tools/tool-params|contact-requests/errors|stickers/routes" -- 'apps/**' 'packages/**'` returned exactly that one hit; no other file under `apps/` or `packages/` imports a deleted file.
- The first gate after the repoint failed `@zilar/runner` typecheck: importing `components.ts` pulls `leader/start` -> `push/component`, whose `@xmpp/component` ambient declarations live in `apps/server/src/push/xmpp-component.d.ts`, and the runner tsconfig only includes its own `src` plus the xmpp-core declaration. A `/// <reference path=...>` fixed the typecheck but oxlint rejected it (`typescript(triple-slash-reference)`; fixing it with a lint-disable is not allowed). Fixed with the import style the rule asks for at the top of `apps/server/src/startup/components.ts`: `import '../push/xmpp-component.d.ts';`, with a one-line why comment. TypeScript includes the declarations for every consumer; `tsx` and the esbuild server build both ignore/erase the declaration import. `apps/server/src/startup/components.ts` is now 701 lines, still under the 750 cap.
- Final gate summary:
  - `PASS install (frozen) (1.4s)`, `PASS format (1.2s)`, `PASS lint (0.9s)`, `PASS typecheck (5.5s)`, `PASS effect (1.5s)`, `PASS build @zilar/server (0.6s)`, `PASS tests @zilar/runner (6.8s)`, `PASS tests @zilar/server (32.6s)`
  - `scope: every changed file is inside the Allowed files`; `GATE PASS`.
  - Size warnings only (same four hosts as above; `components.ts` 701).

## Review (written by Claude)

Approved; the pre-review was clean. A lead fix round repointed `apps/runner/src/e2e.test.ts` at the folded `serveEdgeOnNode`; the gate does not check that import, and the pre-review caught it. Net −34.

**Folded into their only importer:**
- `stickers/routes.ts`, `contact-requests/errors.ts`, `actions/canonical.ts`, `effect/node-serve.ts`;
- the AI pieces `dm-tool-turn.ts`, `group-turn-roster.ts` and `tools/tool-params.ts`, moved word for word.

**Pass-throughs removed:** the last two server pass-through exports (`tool-loop.ts`, and the `cloud-hands.ts` rename aliases).

**Skipped:** `main.ts`, because `auth/export.ts` names it.

**Checks:**
- `git grep` finds no import of a deleted file.
- The gate ran the server tests, including the message pipeline.
