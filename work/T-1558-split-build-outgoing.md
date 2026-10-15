---
id: T-1558
title: "Split packages/xmpp-core/src/stanza/build-outgoing.ts (399 lines): the control-stanza builders (status cap, typing, displayed, ping, reactions, presence, carbons, push, upload slot, roster) move to stanza/build-control.ts; build-outgoing.ts keeps the message builders and re-exports every name; no behaviour change"
status: merged
milestone: M5
branch: task/T-1558-split-build-outgoing
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1558: Split build-outgoing.ts

## Spec (written by Claude, do not edit)

### Why
`packages/xmpp-core/src/stanza/build-outgoing.ts` is 399 lines, and it builds every stanza the clients send (the message pipeline). **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **Message builders (`:35-215`):**
  - internal: `forwardElement`, `replyQuotePrefix`, `replyFallbackElement`, `shiftMentions` and `pushMentionReferences` (`:183`);
  - exported: `buildMessage` (`:86`), `buildCorrection` (`:143`), `RETRACTION_FALLBACK_BODY` (`:160`) and `buildRetraction` (`:165`).
- **Control builders (`:217-399`):**
  - `MAX_STATUS_CHARS` (`:217`) and `capStatus` (internal, `:219`);
  - `buildTyping` (`:227`), `buildDisplayed` (`:241`), `buildPingRequest` (`:255`), `buildPingResult` (`:263`), `buildReactions` (`:271`);
  - `buildJoinPresence` (`:291`), `buildLeavePresence` (`:300`), `buildAvailablePresence` (`:308`), `buildCarbonsEnable` (`:312`);
  - `buildPushEnable` (`:320`), `buildPushDisable` (`:332`), `buildUploadSlotRequest` (`:345`), `parseUploadSlot` (`:365`);
  - `buildRosterResult` (`:384`) and `buildRosterError` (`:391`).

### Steps
1. **New `packages/xmpp-core/src/stanza/build-control.ts`:** move everything from `:217` to the end unchanged, including `capStatus` and any type such as `UploadSlot` that only these use, with the imports they need. It must not import from `./build-outgoing`.
2. **`build-outgoing.ts`:** keep the message builders, and re-export every moved name with the same kind (`export { … } from './build-control'`, `export type { … }` for types). Remove the imports only the moved code used.
3. **No behaviour change**, and no importer changes.

### Tests
None new. The xmpp-core stanza tests must pass in the gate.

### Allowed files
- `packages/xmpp-core/src/stanza/build-outgoing.ts`
- `packages/xmpp-core/src/stanza/build-control.ts` (new)
- `work/T-1558-split-build-outgoing.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `build-outgoing.ts` before and after (identical names and kinds);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

Split `packages/xmpp-core/src/stanza/build-outgoing.ts` along the boundary the spec gives.

- **New `packages/xmpp-core/src/stanza/build-control.ts`:** the control-stanza block moved verbatim (the `// T-1406` doc comment together with `MAX_STATUS_CHARS`, `capStatus`, `buildTyping`, `buildDisplayed`, `buildPingRequest`, `buildPingResult`, `buildReactions`, the presence helpers, `buildCarbonsEnable`, `buildPushEnable`/`buildPushDisable`, `buildUploadSlotRequest`, `parseUploadSlot`, `buildRosterResult`, `buildRosterError`). It imports only what it needs (`xml`/`XmppElement`, the control namespaces, `ChatKind`/`UploadSlot` from `../types`, `sanitizeReactions` from `./reactions`) and does **not** import from `./build-outgoing`.
- **`build-outgoing.ts` (now the barrel for this module):** keeps all message builders (`buildMessage`, `buildCorrection`, `RETRACTION_FALLBACK_BODY`, `buildRetraction` and the internal helpers) and re-exports every moved name in an `export { … } from './build-control'` block. Imports only the moved code used were dropped (`AGENT_NAMESPACE`, `CARBONS_NAMESPACE`, `CHAT_MARKERS_NAMESPACE`, `CHAT_STATES_NAMESPACE`, `HTTP_UPLOAD_NAMESPACE`, `MUC_NAMESPACE`, `PING_NAMESPACE`, `PUSH_NAMESPACE`, `REACTIONS_NAMESPACE`, `STANZA_NAMESPACE`, `UploadSlot`, `sanitizeReactions`); shared ones stayed.
- **No behaviour change:** I diffed the moved text against `HEAD` — the control block (`orig :213-399`) is byte-identical to `build-control.ts` from the `// T-1406` comment to the end, and the message block (`orig :28-211`) is byte-identical to the body of the new `build-outgoing.ts`. The only additions are the barrel's re-export block and a `Control stanzas` section header comment in the new file.
- **No importer was changed** and no test was touched.

### Checks run

**`wc -l`** (`HEAD` → after):
- `packages/xmpp-core/src/stanza/build-outgoing.ts`: 399 → **220**
- `packages/xmpp-core/src/stanza/build-control.ts`: *(new)* → **208**

**Export list before → after.** All exports are values (function/const); there were no type exports before and none added.

| before (`grep -E "^export"` on HEAD) | after (barrel + `build-control.ts`) |
| --- | --- |
| `buildMessage`, `buildCorrection`, `RETRACTION_FALLBACK_BODY`, `buildRetraction` | same (defined in `build-outgoing.ts`) |
| `MAX_STATUS_CHARS`, `buildTyping`, `buildDisplayed`, `buildPingRequest`, `buildPingResult`, `buildReactions`, `buildJoinPresence`, `buildLeavePresence`, `buildAvailablePresence`, `buildCarbonsEnable`, `buildPushEnable`, `buildPushDisable`, `buildUploadSlotRequest`, `parseUploadSlot`, `buildRosterResult`, `buildRosterError` | same names/kinds, now defined in `build-control.ts` and re-exported by `build-outgoing.ts` |

20 names before, 20 after — identical set and kinds.

**Focused test:** `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts` → `Test Files 1 passed (1) / Tests 90 passed (90)`.

**`pnpm gate`** (repo root):
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (5.1s)
PASS  format  (9.1s)
PASS  lint  (3.1s)
PASS  typecheck  (5.2s)
PASS  effect  (1.3s)
SKIP tests @zilar/xmpp-core (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The 3 changed files are the two `stanza/` files and this task file; no files outside the Allowed list. No `// effect-plain` marker was needed (`effect` passed).

### Notes for the lead

- The spec said "move everything from `:217`"; the `// T-1406` doc comment on `:213-216` documents `MAX_STATUS_CHARS`, so I moved the comment with its constant to keep the pair together. Everything from that comment to the end of the file is unchanged.
- The gate reported `SKIP tests @zilar/xmpp-core (no nearby test files)` because the gate's "nearby" heuristic did not map the changed `stanza/` files to a test; I ran `stanza.test.ts` by hand as above (90 passed), so the module is covered.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `build-outgoing.ts` 220 and `build-control.ts` 208 lines (was 399).
  - **Exports:** `build-outgoing.ts` still exports all 20 names it had on main. 15 are re-exported from `./build-control` (`MAX_STATUS_CHARS`, `buildTyping` … `buildRosterError`, `parseUploadSlot`). 5 stay local (`buildMessage`, `buildCorrection`, `RETRACTION_FALLBACK_BODY`, `buildRetraction`, plus the internals).
  - **No cycle:** `build-control.ts` doesn't import `build-outgoing.ts`.
- **Tests:** the gate skipped the xmpp-core tests (its nearby-test rule didn't map `stanza/`), so the lead ran the whole xmpp-core suite on this branch: 4 files, 150 tests passed.
