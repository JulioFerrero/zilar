---
id: T-2164
title: "Clean-up (packages and server): blocks copied between two files of the same app or package get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2164-pkg-clone-pairs
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2164: One home for blocks copied between files (packages and server)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `2044ba9fe` that finds runs of 8 or more normalised lines shared by two files (comments, blanks, imports and lone braces ignored). Each row below is a pair of files with the copied ranges. A row with no ranges is a pair whose files share several small blocks; read both files to find them.

| Copy A | Copy B |
| --- | --- |
| `packages/api-contract/src/chat-folders.ts:9-36` | `packages/chat-core/src/folders.ts:5-32` |
| `packages/xmpp-core/src/stanza.ts:53-66` | `packages/xmpp-core/src/stanza/build-outgoing.ts:21-34` |
| `apps/server/src/media/extract.ts:12-22,26-43` | `packages/chat-core/src/links.ts:6-16,21-38` |
| `apps/server/src/agents/gateway/group-turn-body.ts:165-177` | `apps/server/src/agents/gateway/group-turn.ts:337-349` |
| `packages/devtools/src/lead/free-pause.ts:62-76` | `packages/devtools/src/lead/go-pause.ts:40-54` |

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy where it fits best, usually the file the other already imports from, or the more general one. Export it and make the other file use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the pair.
3. **Look-alikes:** skip a pair whose copies only look alike (different props, different labels, different meaning) and say why.
4. **Keep the sum smaller:** a shared piece must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same values, the same markup, labels and styles, the same order of effects.
- Keep every "why" comment, once.
- Do not create a new file unless both copies have no better home.
- No new tests. Run the nearest existing tests with `--reporter=dot`.
- `packages/xmpp-core` and `apps/server/src/agents` are on the message pipeline. Their existing tests must pass unchanged.
- An app may import a package. A package must never import an app.

### Allowed files
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/media/extract.ts`
- `packages/api-contract/src/chat-folders.ts`
- `packages/chat-core/src/folders.ts`
- `packages/chat-core/src/links.ts`
- `packages/devtools/src/lead/free-pause.ts`
- `packages/devtools/src/lead/go-pause.ts`
- `packages/xmpp-core/src/stanza.ts`
- `packages/xmpp-core/src/stanza/build-outgoing.ts`
- `work/T-2164-pkg-clone-pairs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each pair: merged (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged two of the five pairs and skipped three, with the reason for each. Net source change:
47 lines removed (`git diff main --numstat -- packages apps`: 38 added, 85 removed).

| Pair | Outcome |
| --- | --- |
| `packages/api-contract/src/chat-folders.ts` / `packages/chat-core/src/folders.ts` | **Skipped.** The constants are identical (`FOLDER_ICONS`, `FOLDER_NAME_MAX`, `FOLDER_CHATS_MAX`), but neither package depends on the other and both `package.json` files are outside the Allowed files. Merging would also force a dependency direction between the wire contract and the UI helpers, so the deliberate "Mirrors …" note stays. |
| `packages/xmpp-core/src/stanza.ts` / `packages/xmpp-core/src/stanza/build-outgoing.ts` | **Merged, 39 lines saved.** `stanza.ts` now re-exports `build-control` and `build-outgoing` directly (`export *`) and imports `MAX_STATUS_CHARS` from `build-control`; `build-outgoing.ts` no longer re-exports the control helpers. The exports of `stanza.ts` are the same names as before. |
| `apps/server/src/media/extract.ts` / `packages/chat-core/src/links.ts` | **Skipped.** The punctuation-trimming block is the same code, but `apps/server` does not depend on `@zilar/chat-core`, and its `package.json` is outside the Allowed files. The media extractor is also deliberately dependency-light, so pulling chat-core in is not a free move. |
| `apps/server/src/agents/gateway/group-turn-body.ts` / `apps/server/src/agents/gateway/group-turn.ts` | **Skipped.** Look-alike only: one file constructs the `runGroupTurnBody` input (`log: turnLog`), the other destructures that same type. Same field names, opposite direction and different data, so there is no block to extract. |
| `packages/devtools/src/lead/free-pause.ts` / `packages/devtools/src/lead/go-pause.ts` | **Merged, 8 lines saved.** `go-pause.ts` now owns `readConfigJson` (read the file, parse it, report bad JSON) and `warnBadConfig` (once per config name via a `Set`); `free-pause.ts` imports both. The warning text and the once-only per-config behaviour are unchanged. |

### Checks run

- `pnpm install`: done in 17.7s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/free-pause.test.ts src/lead/go-pause.test.ts`: 2 files, 18 tests passed (run after each edit round).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`: 1 file, 95 tests passed.
- `pnpm gate`: see the summary below.

```text
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (0.4s)
PASS  lint  (0.7s)
PASS  typecheck  (2.1s)
PASS  effect  (0.4s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/devtools  (0.9s)
PASS  tests @zilar/xmpp-core  (0.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- One gate run failed on Prettier formatting in `free-pause.ts` (a double blank line I left); I fixed it and the final gate below is the passing one.
- No tests were added or changed. The message-pipeline tests in `@zilar/xmpp-core` and the devtools lead tests pass unchanged.
- No files outside the Allowed files were touched.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −47:
- `xmpp-core` `stanza.ts` re-exports the two builder modules with `export *` instead of a 20-name list. `build-outgoing` no longer re-exports `build-control`. The gate ran the xmpp-core tests, message pipeline included.
- The devtools pause configs share `readConfigJson`/`warnBadConfig`. The "a typo must never stop the lead" comment survives once.

**Skipped, correctly:**
- the folder constants (neither package depends on the other);
- the server link trimming (the server does not depend on chat-core);
- the group-turn look-alike.
