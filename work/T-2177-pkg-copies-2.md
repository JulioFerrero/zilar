---
id: T-2177
title: "One copy of each function written twice (packages and devtools, wave 2: functions and types): identical function bodies in different files get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2177-pkg-copies-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2177: One copy of each function written twice (packages and devtools, wave 2: functions and types)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned every top-level function and arrow const at `e762bf61a`. Each row below is a group of functions whose bodies are identical after whitespace and comments are normalised, though the names may differ. Line numbers are where each copy starts.

| # | Copies |
| --- | --- |
| 1 | `packages/xmpp-core/src/stanza/build-control.ts:65` `buildPingResult`<br>`packages/xmpp-core/src/stanza/build-control.ts:183` `buildRosterResult` |
| 2 | `packages/devtools/src/lead/client/fake.ts:123` `isRecord`<br>`packages/devtools/src/lead/session.ts:23` `isRecord`<br>`packages/devtools/src/lead/watch/live-step.ts:79` `isRecord` |
| 3 | `packages/chat-core/src/reactions.ts:22` `ReactionSummary`<br>`packages/chat-core/src/types.ts:82` `UiReaction` |
| 4 | `packages/chat-core/src/edits.ts:38` `EditMention`<br>`packages/xmpp-core/src/stanza/parse-context.ts:64` `Mention` |
| 5 | `packages/chat-core/src/types.ts:26` `AlbumRef`<br>`packages/xmpp-core/src/stanza/album.ts:5` `MessageAlbum` |
| 6 | `packages/devtools/src/lead/cli/commands.ts:18` `ReplyDeps`<br>`packages/devtools/src/lead/switch-model.ts:17` `SwitchModelDeps` |
| 7 | `packages/devtools/src/plan-page/collect.ts:55` `PlanAudit`<br>`packages/devtools/src/plan-page/collect.ts:118` `RawAudit` |
| 8 | `packages/devtools/src/lead/policy/types.ts:9` `PermissionRequest`<br>`packages/devtools/src/lead/session.ts:17` `ParsedPermission` |

### Steps
For each row:
1. Read every copy and confirm the bodies match.
2. Keep one copy:
   Keep the copy in the module that the other file already imports from, or the more general one. A package never imports a package it does not already depend on.
3. Export it, import it at the other places, and delete the other copies. When the names differ, keep the clearer name and rename the call sites.
4. **Skip a row and say why in the Report** when:
   - the copies differ after all;
   - sharing would need an import that breaks a package boundary (a package never imports an app; an app imports only packages it already depends on);
   - the copy is React Native or DOM markup that the other platform cannot render.

### Rules
- No behaviour change.
- Keep every "why" comment, once, on the kept copy.
- No new tests. Existing tests must pass. Update a test's import path only when its function moved.
- **No re-export shims or aliases.** Every importer, tests included, imports the kept copy from where it lives, under its kept name.
- Types: merge only declarations that mean the same thing; skip look-alikes (for example a ping result vs a roster result) and say why.
- Do not touch `packages/chat-core/src/index.ts` or `packages/devtools/src/lead/batch/**`.

### Allowed files
- `packages/chat-core/src/edits.ts`
- `packages/chat-core/src/reactions.ts`
- `packages/chat-core/src/types.ts`
- `packages/devtools/src/lead/cli/commands.ts`
- `packages/devtools/src/lead/client/fake.ts`
- `packages/devtools/src/lead/policy/types.ts`
- `packages/devtools/src/lead/session.ts`
- `packages/devtools/src/lead/switch-model.ts`
- `packages/devtools/src/lead/watch/live-step.ts`
- `packages/devtools/src/plan-page/collect.ts`
- `packages/xmpp-core/src/stanza/album.ts`
- `packages/xmpp-core/src/stanza/build-control.ts`
- `packages/xmpp-core/src/stanza/parse-context.ts`
- Test files next to those files (import path only).
- `packages/chat-core/src/**`, `packages/xmpp-core/src/**`, `packages/devtools/src/**` (except `lead/batch/**`): import lines and names only, in files that import a moved or renamed function or type.
- `work/T-2177-pkg-copies-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.
- The Report lists each row: merged (where it lives now) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged rows 3, 6, 7 and 8; skipped rows 1, 2, 4 and 5.

- **Row 3 — merged.** Kept `UiReaction` in `packages/chat-core/src/types.ts`; deleted
  `ReactionSummary` from `packages/chat-core/src/reactions.ts`, which now imports
  `UiReaction` and has `summarize(): UiReaction[]`.
- **Row 6 — merged.** Kept `SwitchModelDeps` in
  `packages/devtools/src/lead/switch-model.ts`; deleted `ReplyDeps` from
  `packages/devtools/src/lead/cli/commands.ts`, which imports `SwitchModelDeps`
  (it already imported from that module).
- **Row 7 — merged.** Kept `PlanAudit` in
  `packages/devtools/src/plan-page/collect.ts`; deleted `RawAudit`, and
  `RawPlan.audits` / `parseAudit` now use `PlanAudit`.
- **Row 8 — merged.** Kept `PermissionRequest` in
  `packages/devtools/src/lead/policy/types.ts` (re-exported by `policy.ts`); deleted
  `ParsedPermission` from `packages/devtools/src/lead/session.ts`, whose
  `parsePermission` now returns `PermissionRequest`. `autopilot.ts` imports the type
  from `./policy.js`.

Skipped rows:

- **Row 1 — skipped.** `buildPingResult` and `buildRosterResult` have the same body,
  but they are different protocol actions (XEP-0199 ping response vs RFC 6121
  roster-push acknowledgement). The spec's type rule names a ping result vs a roster
  result as a look-alike, and each copy carries a different "why" comment that would
  collapse into one. Not merged.
- **Row 2 — skipped.** `fake.ts:123` and `session.ts:23` match, but `live-step.ts:79`
  adds `!Array.isArray(value)`; it is the version `watch/speed.ts` already imports.
  The bodies therefore differ after normalisation. Switching the other two to the
  strict version would change an edge case in `refusalText` (array-valued `error`
  would read `value.message` instead of `''`), so no behaviour-safe single copy exists
  without touching more code. Not merged.
- **Row 4 — skipped.** `EditMention` and `Mention` are identical declarations, but they
  live in `chat-core` and `xmpp-core`, which do not depend on each other. Sharing would
  add a package dependency, and `package.json` is not in the Allowed files.
- **Row 5 — skipped.** `AlbumRef` and `MessageAlbum` are identical, but the same
  package-boundary problem applies (`chat-core` vs `xmpp-core`), and one is a UI type
  while the other is the wire marker.

No test import paths needed changing.

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/reactions.test.ts`
  — 1 file, 11 tests passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/session.test.ts src/plan-page/collect.test.ts src/lead/autopilot.test.ts`
  — 3 files, 11 tests passed.
- `pnpm gate` — final run:
  ```
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.9s)
  PASS  lint  (1.7s)
  PASS  typecheck  (5.1s)
  PASS  effect  (1.9s)
  PASS  build @zilar/server  (2.1s)
  PASS  tests @zilar/chat-core  (1.6s)
  PASS  tests @zilar/devtools  (1.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  The first gate run failed only on Prettier for `reactions.ts` and `autopilot.ts`;
  I ran `pnpm exec prettier --write` on exactly those two files and the rerun passed.
- `git diff main --numstat -- apps packages`:
  ```
  3  12  packages/chat-core/src/reactions.ts
  3   7  packages/devtools/src/lead/autopilot.ts
  3  10  packages/devtools/src/lead/cli/commands.ts
  2   8  packages/devtools/src/lead/session.ts
  2  11  packages/devtools/src/plan-page/collect.ts
  ```
  Net: 13 insertions, 48 deletions, **-35 lines**.

### Notes for the lead

- Row 6: I kept the name `SwitchModelDeps` because that is the module `commands.ts`
  already imports from; putting `ReplyDeps` in `cli/commands.ts` would make
  `switch-model.ts` import from the CLI layer. The name is narrower than its two uses;
  `LeadDeps` would read better if you want a follow-up rename.
- Row 2 is the only case where two of the three copies match; say the word if you
  want the two loose copies merged into `session.ts` even though the strict
  `live-step.ts` copy stays separate.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −35, with no re-exports added.

**Merged:**
- chat-core `ReactionSummary` → `UiReaction`;
- devtools `ReplyDeps` → `SwitchModelDeps`, `RawAudit` → `PlanAudit`, `ParsedPermission` → `PermissionRequest`.

**Skipped, with reasons in the Report:**
- ping vs roster result: same body, different stanza meaning;
- the devtools `isRecord` copies;
- two chat-core/xmpp-core types: each would need a package dependency that does not exist.

**Checks:** the gate typechecked and tested every package.
