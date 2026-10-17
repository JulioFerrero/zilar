---
id: T-1823
title: "When a person asks for buttons, a poll or a form, the AI posts that card with post_blocks instead of an ask_people question: one line in the interactive rules and one sentence in the ask_people description"
status: merged
milestone: M5
branch: task/T-1823-buttons-not-question
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1823: Asked for buttons, post buttons

## Spec (written by Claude, do not edit)

### Why
**Live check on 2026-10-17 in "ai test › cards test":** "@Deepseek ask me with buttons: order pizza or sushi for tonight?" made the AI call `ask_people` (question chips) instead of posting a blocks `buttons` card. The question card has fewer features (no answered state in its data, no card frame). Both tools are offered in a topic, and neither text says which one wins.

### Facts (read by the lead on 2026-10-17)
- **The `ask_people` description:** `apps/server/src/agents/tools/definitions.ts:261-265` (356 lines). It reads: "Ask the people in this room to decide something only they can decide. Ask one short question in plain words; options of one to three words: they can tap one, and a free reply is still allowed. Ask one question at a time and never ask the same thing twice."
- **The interactive rules:** `INTERACTIVE_RULES` in `apps/server/src/message-blocks/guide.ts:112-118` (134 lines), joined with `\n`. `guide.test.ts` checks kinds and shapes, not this text.

### Steps
1. **`INTERACTIVE_RULES`:** add a line after the first one, exactly: `When a person asks for buttons, a poll, a choice, a rating or a form, post that kind with post_blocks; do not use ask_people for it.`
2. **`ask_people` description:** append one sentence, exactly: ` When someone asks you for buttons, a poll or a form, use post_blocks instead.`
3. **No new tests.** The existing `guide.test.ts` must still pass.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `work/T-1823-buttons-not-question.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- Both texts are added exactly as written.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/message-blocks/guide.ts`: added the exact line after the first `INTERACTIVE_RULES` entry: "When a person asks for buttons, a poll, a choice, a rating or a form, post that kind with post_blocks; do not use ask_people for it."
- `apps/server/src/agents/tools/definitions.ts`: appended the exact sentence to the `ask_people` description: " When someone asks you for buttons, a poll or a form, use post_blocks instead."
- No new tests, no other files touched.

### Checks run
- `pnpm install --frozen-lockfile`: done, 19.4s.
- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot`: 1 file passed, 3 tests passed.
- `pnpm gate`: exit 0, ended with `GATE PASS`; 3 changed files against main, every changed file inside the Allowed files; all stages PASS (install, format, lint, typecheck, effect, tests @zilar/server).

### Notes for the lead
- The gate's changed-file count of 3 is this task file plus the two allowed source files; scope check reported no files outside the Allowed files.
- Nothing blocked; no deviations from the spec.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `1b6da84ac`.
- **Both texts** are added exactly as written: the `INTERACTIVE_RULES` line and the `ask_people` sentence.
- **The lead re-runs** "ask me with buttons" live in "cards test" after the deploy.
