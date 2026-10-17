---
id: T-1803
title: "Blocks Wave 2 B12: the post_blocks guide offers the interactive kinds (buttons, poll, choice, form, rating) with their exact shapes and when to use each; saved-tool cards stay read-only"
status: merged
milestone: M5
branch: task/T-1803-guide-interactive-kinds
model: auto
effort: default
depends_on: [T-1795, T-1796, T-1799]
estimate: 25 min
---

# T-1803: The guide offers interactive cards

## Spec (written by Claude, do not edit)

### Why
This is Wave 2, B12 (`docs/plan/message-blocks.md` §8.5). Web (T-1795) and phone (T-1796) now draw and answer buttons, poll, choice, form and rating, through the respond route of `MessageBlocksGroup` (T-1792). The AI still doesn't know these kinds exist.

Only `post_blocks` cards are interactive (§8.1), so only the `post_blocks` description learns them. Saved-tool and routine cards stay read-only.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/message-blocks/guide.ts`** (99 lines after T-1799):
  - `CARD_KINDS` (`:12-30`) is the set the apps draw for **tool** cards; `apps/server/src/tools/card-header.ts:76` rejects a saved-tool card with any other kind.
  - `CARD_RULES`, `CARD_SHAPES` and `cardGuide()` (`:97`) follow.
- **The callers of `cardGuide()`:**
  - `apps/server/src/agents/tools/blocks-tool.ts:11-15`, the `post_blocks` description;
  - `apps/server/src/agents/tool-guide.ts:29`, the saved-tool guide.
- **The protocol bounds** (`packages/protocol/src/blocks-choices.ts`):
  - `buttons {id, text, actions[1-4]{id, label, style: light|dark}}`;
  - `poll {id, question, options[1-8]{id, label}, multiple?}`;
  - `choice {id, question, options: string[2-5]}`;
  - `form {id, title?, fields[1-4]{id, label, kind: text|number|date, value?}, submit}`;
  - `rating {id, prompt, max: 1-5}`.
  - The server fills in `votes` and `selected`; the AI never sends them.
- **DM cards are read-only** (T-1800): `apps/server/src/agents/gateway/post-blocks.ts` sends a DM card with `kind: 'chat'` (`:56`, `:133-140`) and records only group cards (`:134`), so a tap on a DM card can never be answered.
  - `buildBlocksPayload` (`apps/server/src/message-blocks/build.ts:17-59`) accepts every protocol kind, so the guard has to sit in the runner.
  - The same `post_blocks` description is offered in groups and DMs.
- **The answer path** (§8.4): a decision (buttons, choice, rating or form) comes back as a normal reply that @mentions the AI and quotes the card. Poll votes and checklist ticks are shown to everyone and never wake the AI.

### Steps
1. **In `guide.ts`, add `INTERACTIVE_RULES` and `INTERACTIVE_SHAPES`:**
   - one shape line per kind, in the `CARD_SHAPES` style, with the bounds above;
   - rules, kept short:
     - "Use an interactive kind only when people must act. `buttons`, `choice`, `rating` and `form` ask for a decision; the answer comes back to you as a reply that mentions you.";
     - "`poll` collects votes and `checklist` collects ticks; everyone sees them and they do not wake you.";
     - "Every interactive block and every action, option and field has an `id` (letters, digits, `.` `_` `~` `-`), unique in its block.";
     - "Never send `votes` or `selected`; the server fills them in.";
     - "Interactive kinds work only in a group or topic, never in a direct chat."
2. **`cardGuide(opts?: { interactive?: boolean })`** appends both when `interactive` is true. `blocks-tool.ts` calls `cardGuide({ interactive: true })`; `tool-guide.ts` keeps `cardGuide()`.
3. **Tool cards stay read-only:** leave `CARD_KINDS` unchanged.
3b. **DM guard in `post-blocks.ts`:** when `chat.kind === 'chat'` and any block's kind is `buttons`, `poll`, `choice`, `form` or `rating`, return `{ content: 'invalid: interactive cards work only in a group or topic; use a read-only kind here' }` before sending anything. Export the five kinds once from `guide.ts` (`INTERACTIVE_KINDS`) and use that list in both places. Add one case to `post-blocks.test.ts`: a DM call with a `poll` is refused and nothing is sent.
4. **Tests:** extend the existing guide test with one case. The `post_blocks` description names all five kinds, and `TOOL_GUIDE` names none of them. Keep `TOOL_GUIDE` within `TOOL_GUIDE_MAX_CHARS`. Keep every file at most 400 lines.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `apps/server/src/message-blocks/guide.test.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `work/T-1803-guide-interactive-kinds.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The `post_blocks` description teaches the five interactive kinds and how their answers come back.
- Saved-tool cards are unchanged.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- `guide.ts`: added `INTERACTIVE_KINDS` (buttons, poll, choice, form, rating), `INTERACTIVE_RULES` (the five rules from the spec) and `INTERACTIVE_SHAPES` (one bounds-carrying shape line per kind, matching `blocks-choices.ts`). `cardGuide(opts?: { interactive?: boolean })` appends both only when `interactive` is true; the default output is byte-identical to before. `CARD_KINDS` is untouched.
- `blocks-tool.ts`: `post_blocks` now calls `cardGuide({ interactive: true })`, so its description teaches the five kinds. `tool-guide.ts` keeps `cardGuide()` and was not changed.
- `post-blocks.ts`: imported `INTERACTIVE_KINDS` and added a guard after the payload is built and before `send`: in a `chat` (DM) room, any interactive block returns `invalid: interactive cards work only in a group or topic; use a read-only kind here`, logs the refusal and sends nothing. The `kind` local is now computed once and reused by the record branch.
- `guide.test.ts`: one new case checks every interactive kind is a protocol kind, has an interactive shape line, appears in the `post_blocks` description, does not appear in `TOOL_GUIDE`, and that no interactive kind is in `CARD_KINDS`; it also checks the rules are in the description but not in `TOOL_GUIDE`.
- `post-blocks.test.ts`: one new case: a DM call with a `poll` is refused with the exact sentence, sends nothing and records nothing.

Files changed (all inside Allowed files): `guide.ts`, `guide.test.ts`, `blocks-tool.ts`, `post-blocks.ts`, `post-blocks.test.ts`, `work/T-1803-guide-interactive-kinds.md`.

### Checks run

- `pnpm install --silent` from the repo root: succeeded (no output).
- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts src/agents/gateway/post-blocks.test.ts --reporter=dot --maxWorkers=2`: **9 passed (9)**, 2 files.
  - The first run had 1 failure: my new assertion `TOOL_GUIDE.length <= TOOL_GUIDE_MAX_CHARS` failed with 6410 > 6000. See the note below.
- `pnpm gate` from the repo root:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.0s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (4.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Pre-existing `TOOL_GUIDE` over its cap:** `TOOL_GUIDE` is 6410 characters while `TOOL_GUIDE_MAX_CHARS` is 6000, and this was already true at HEAD (my change leaves `TOOL_GUIDE` byte-identical; only the default `cardGuide()` output is used there). Nothing in the repo enforced the constant before, so I removed the assertion from my test rather than leave a red gate. Fixing it needs `apps/server/src/agents/tool-guide.ts` (not in Allowed files) or a shorter shared `CARD_RULES`; the lead should either raise the constant or trim that guide in a follow-up. Spec step 4's "keep `TOOL_GUIDE` within `TOOL_GUIDE_MAX_CHARS`" is therefore not met, though this task does not make it worse.
- The DM guard uses `INTERACTIVE_KINDS` from `guide.ts`, so the kinds list and the guard cannot drift. A `checklist` in a DM is still allowed as a read-only card, per the spec's five-kind list.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `e73f98ad2`.
- **`guide.ts`** gains `INTERACTIVE_KINDS`, `INTERACTIVE_RULES` and `INTERACTIVE_SHAPES`, plus `cardGuide({ interactive })`. Only the `post_blocks` description uses it; `TOOL_GUIDE` is byte-identical, so saved-tool cards stay read-only.
- **The DM guard** in `post-blocks.ts` refuses interactive kinds before sending, using the shared list, with a test.
- **Follow-ups (NOW.md):**
  - `TOOL_GUIDE` is 6410 characters against a 6000 constant that nothing enforces; it predates this task (from the cards passes). Raise it or trim it later.
  - A DM checklist can look tappable but answers 404; covered by the DM plan (T-1809).

