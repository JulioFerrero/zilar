---
id: T-0952
title: "Size split T17: packages/xmpp-core/src/stanza.ts (1,078 lines) into stanza/{reactions,build-outgoing,parse-context,parse-presence,parse-roster,resolve-sender,parse-fields,decode}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0952-split-xmpp-stanza
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0952: Split `stanza.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/xmpp-core/src/stanza.ts` is 1,078 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #13 (task T17 in §4.2): `stanza/reactions.ts`, `stanza/build-outgoing.ts`, `stanza/parse-context.ts`, `stanza/parse-presence.ts`, `stanza/parse-roster.ts`, `stanza/resolve-sender.ts`, `stanza/parse-fields.ts`, `stanza/decode.ts`, under `packages/xmpp-core/src/`. `stanza.ts` becomes the barrel.

T-0951 splits `core-effect.ts` in the same package at the same time. Touch neither it nor `core-effect/`.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #13, and `packages/xmpp-core/src/stanza.ts`.

### Allowed files
`packages/xmpp-core/src/stanza.ts`, `packages/xmpp-core/src/stanza/reactions.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/xmpp-core/src/stanza/parse-context.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/stanza/parse-roster.ts`, `packages/xmpp-core/src/stanza/resolve-sender.ts`, `packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `work/T-0952-split-xmpp-stanza.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot src/stanza.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `packages/xmpp-core/src/stanza.ts` (1,078 lines on main) into the eight
files named in `docs/audit/size-plan.md` §2.1 #13, with `stanza.ts` left as a
barrel that re-exports the same 41 names, value and type kinds unchanged. Code
was moved unchanged; the only code edit is the §2 entry's Dedup: `buildMessage`
now calls `pushMentionReferences` instead of carrying its own copy of the
mention-reference loop.

### Size (`wc -l`)

| file | lines |
| --- | --- |
| old `packages/xmpp-core/src/stanza.ts` (main) | 1,078 |
| `packages/xmpp-core/src/stanza.ts` (barrel) | 54 |
| `packages/xmpp-core/src/stanza/reactions.ts` | 59 |
| `packages/xmpp-core/src/stanza/build-outgoing.ts` | 334 |
| `packages/xmpp-core/src/stanza/parse-context.ts` | 93 |
| `packages/xmpp-core/src/stanza/parse-presence.ts` | 105 |
| `packages/xmpp-core/src/stanza/parse-roster.ts` | 70 |
| `packages/xmpp-core/src/stanza/resolve-sender.ts` | 133 |
| `packages/xmpp-core/src/stanza/parse-fields.ts` | 157 |
| `packages/xmpp-core/src/stanza/decode.ts` | 161 |

Every file is under the 400-line limit; no `max-lines` warning.

### Export list, before → after

`grep -E "^export"` on old `stanza.ts` (main) vs the barrel (the modules also
export a few former-private helpers so siblings can import them; those are not
re-exported from the barrel, so the public `./stanza` surface is identical).

Public API (barrel) diff — empty:

```diff
 sanitizeReactions, ReplyRef
 buildMessage, buildCorrection, RETRACTION_FALLBACK_BODY, buildRetraction,
 buildTyping, buildDisplayed, buildPingRequest, buildPingResult, buildReactions,
 buildJoinPresence, buildLeavePresence, buildAvailablePresence,
 buildCarbonsEnable, buildPushEnable, buildPushDisable, buildUploadSlotRequest,
 parseUploadSlot, buildRosterResult, buildRosterError
 ParseContext, DecodedStanza, MucPresence, SenderResolution,
 isMamResult, mamResultQueryId, stanzaErrorCondition
 occupantIdOf, parseMucPresence, parseContactPresence, parseDirectInvitation
 RosterPush, parseRosterPush
 resolveSender
 parseReactions, parseCorrection, parseRetraction, parseForward, originIdOf
 decodeMessageStanza
```

41 names before, 41 after, same names and kinds. Former-private helpers that a
sibling now imports (exported from their module only, not from the barrel):
`unwrapMessage` (parse-context), `timestamp`/`parseReply`/`parseMentions`
(parse-fields), `messageKind`/`domainAllowed`/`mucUserItem` (parse-presence),
`conversationJid`/`fromNick`/`messageId` (resolve-sender), and
`CHAT_STATES`/`MAX_MENTIONS`/`codePointLength`/`codePointOffset`/`utf16Offset`
(reactions).

### Commands and results

- `pnpm install` → done, 1172 packages (peer warning only, pre-existing).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`
  → `Test Files 1 passed (1)`, `Tests 77 passed (77)`.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (6.1s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/xmpp-core  (1.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

The first `pnpm gate` run failed only on `format` (Prettier wrapping in 3 new
files); I ran `pnpm exec prettier --write` on those three and re-ran gate to the
pass above.

### Notes / deviations

- No `// effect-plain:` marker was needed: `stanza.ts` carried no Effect signal
  on main and the new files do not add one, so the effect ratchet passes.
- No test was added or edited; `stanza.test.ts` and `core-effect.ts` keep
  importing from `./stanza` unchanged.
- Files changed: `packages/xmpp-core/src/stanza.ts` (barrel), the eight new
  files under `packages/xmpp-core/src/stanza/`, and this task file. Nothing
  outside the Allowed files.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `stanza.ts` (1,078 lines) becomes a 54-line barrel plus 8 files under `stanza/`, the largest `build-outgoing.ts` at 334.
- **No change for importers:** the public exports are identical (the pre-review re-checked all 41 names).
- **The one Dedup** the plan allows: `buildMessage` uses `pushMentionReferences`.
- **Check:** the 77 stanza tests pass, and so does the gate.
