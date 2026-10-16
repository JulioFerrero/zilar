---
id: T-1625
title: "A group reply never starts '@Name @Name': the gateway always prefixes the asker's @mention, so when the model's text already begins with it, drop the model's copy first"
status: merged
milestone: M5
branch: task/T-1625-no-double-mention
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1625: No doubled @mention at the start of a group reply

## Spec (written by Claude, do not edit)

### Why
On live (2026-10-16, "ai test › General") @Deepseek's reply to @Claude Test began **"@Claude Test @Claude Test Here are the outputs: …"**. The gateway adds `@<asker> ` in front of every group reply, and this time the model had already started its own text with "@Claude Test".

### Facts (the lead read them on 2026-10-16, main after T-1624)
- **`apps/server/src/agents/group-turn.ts`** (319 lines): `:84-112`, `const wire = (text, withHandoff = false) => { const prefix = \`@${name} \`; const mentions = [{ jid: deps.senderJid…, begin: 0, end: name.length + 1 }]; …; return { text: prefix + text, … } }`.
  - Handoff mention offsets are computed as `prefix.length + index`, where `index` comes from `findHandoffIndex(text, nick)`.
  - `wire` is used at `:140`, `:162`, `:170` and `:263`.

### Steps
1. **Add a small exported pure helper** (in `group-turn.ts`, or in a new `apps/server/src/agents/reply-mention.ts` if that keeps the file smaller): `stripLeadingMention(text: string, name: string): string`.
   - It removes, case-insensitively and repeatedly, a leading `@<name>` followed by optional `,` or `:` and whitespace.
   - It returns the rest. It never returns empty for non-empty input: if nothing would be left, it returns the input unchanged.
2. **In `wire`,** apply it to `text` **before** computing handoff indexes and joining, so the mention offsets stay right.
3. **Tests** in the nearest existing group-turn test file (or a new `apps/server/src/agents/reply-mention.test.ts`):
   - `'@Claude Test Here are'` with the name `Claude Test` gives `'Here are'`;
   - `'@claude test, hi'` gives `'hi'`;
   - `'Hi @Claude Test'` is unchanged;
   - `'@Claude Test'` alone is unchanged.

### Allowed files
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/reply-mention.ts`
- `apps/server/src/agents/reply-mention.test.ts`
- `work/T-1625-no-double-mention.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/reply-mention.test.ts src/agents/gateway-group.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A group reply has exactly one leading `@asker`.**
- **Handoff mentions keep correct offsets,** and the existing group tests pass.

---

## Report (written by the worker when done)

### What I did

- Added `stripLeadingMention(text, name)` in the new
  `apps/server/src/agents/reply-mention.ts`. It removes a leading `@<name>`
  (case-insensitively, repeatedly) followed by optional `,` or `:` and
  whitespace, returns the rest, and returns the input unchanged when stripping
  would leave nothing or when the name is empty. The name is regex-escaped.
- In `apps/server/src/agents/group-turn.ts`, `wire()` now runs `text` through
  `stripLeadingMention` into a `body` before measuring handoff offsets, and
  sends `prefix + body`; `findHandoffIndex` and `handoffPayload` use `body`, so
  the mention offsets and the handoff line stay aligned with the sent text.
- Added `apps/server/src/agents/reply-mention.test.ts` with the four spec cases
  (leading mention dropped, `@claude test, hi` case-insensitive, mid-text
  mention kept, lone `@Claude Test` unchanged) plus repeated mentions and an
  empty name.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply-mention.test.ts src/agents/gateway-group.test.ts`
  → `Test Files 2 passed (2)`, `Tests 19 passed (19)`.
- `pnpm gate` (repo root) summary:
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
    `PASS effect`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Round (fix round, prereview finding 1)

- Finding fixed: must-fix 1 — `stripLeadingMention` had no word boundary after
  the name, so an asker name that is a prefix of another word was partially
  eaten (asker `Al` + `@Alice, can you review?` → `@Al ice, can you review?`;
  asker `Claude Test` + `@Claude Testing shows X` → `@Claude Test ing shows X`).
- Fix: the pattern now requires the nick to end at a word boundary
  (`(?=$|[\s.,!?;:'"()[\]{}<>|\u2014\u2013-])`), the same rule
  `findHandoffIndex` uses. `reply-mention.ts` only.
- Test added: `does not eat a longer name that starts with the asker name`
  asserting both examples above are returned unchanged.
- Single tests: `pnpm --filter @zilar/server exec vitest run
  src/agents/reply-mention.test.ts src/agents/gateway-group.test.ts --reporter=dot`
  → `Test Files 2 passed (2)`, `Tests 20 passed (20)`.
- `pnpm gate` (repo root): `GATE PASS`.

### Notes for the lead

- Changed files: `apps/server/src/agents/reply-mention.ts` (new),
  `apps/server/src/agents/reply-mention.test.ts` (new),
  `apps/server/src/agents/group-turn.ts`, and this task file.
- The helper lives in its own file (allowed by the spec) to keep `group-turn.ts`
  under the 400-line cap.
- No deviations from the spec. No new dependencies.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one auto round. That round added a word boundary, so asker `Al` no longer eats `@Alice`.
- **The fix:** `wire` strips the model's leading `@<asker>` before computing handoff offsets, so the live case "@Claude Test @Claude Test Here are …" becomes one mention.
- **The tests:** the lead ran `reply-mention.test.ts` and `gateway-group.test.ts`: 20 passed. `group-turn.ts` is 324 lines.
- **Accepted edge:** a model text that is only `@X @X` keeps one copy, so the reply reads "@X @X". That's harmless.
