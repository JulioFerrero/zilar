---
id: T-1826
title: "Question cards: a reply that quotes the question's origin id also counts as its answer, so a chip tapped live (which quotes the origin id) still shows answered after a reload"
status: merged
milestone: M5
branch: task/T-1826-question-origin-id
model: auto
effort: default
depends_on: [T-1825]
estimate: 10 min
---

# T-1826: Match the question by origin id too

## Spec (written by Claude, do not edit)

### Why
**Live check on 2026-10-17 in "cards test", after T-1821 deployed:** the "Pizza or sushi" question answered with "Sushi" still showed open chips after a reload.
- **The reply quotes the origin id:** in the page's props, the reply's `replyTo.id` is the question's origin id `gmvcat84k-5-s4n3jj`, the id the tapper's client had live.
- **The question is stored under its archive id:** after the reload it is `1792235616487629`.
- **So `isQuestionAnswer` never matches:** it compares only `message.replyTo?.id === question.id`.

T-1825 adds `UiMessage.originId`, set from the stanza's `<origin-id/>`.

### Facts (read by the lead on 2026-10-17)
- **`packages/chat-core/src/question-answer.ts`** (33 lines, T-1821):
  ```ts
  export function isQuestionAnswer(message: UiMessage, question: UiMessage): boolean {
    return message.replyTo?.id === question.id && message.senderId !== question.senderId;
  }
  ```
- **`UiMessage.originId?: string`** comes from T-1825, in `packages/chat-core/src/types.ts`. Re-read the line before editing.

### Steps
1. **`isQuestionAnswer`:** the quoted id matches when it equals `question.id`, or `question.originId` when that is set. The sender rule is unchanged. Update the file comment.
2. **No tests** (UI derivation).

### Allowed files
- `packages/chat-core/src/question-answer.ts`
- `work/T-1826-question-origin-id.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A reply quoting the question's origin id counts as its answer.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Updated `isQuestionAnswer` in `packages/chat-core/src/question-answer.ts` so the quoted id matches either `question.id` or `question.originId` (when set); the sender rule (`message.senderId !== question.senderId`) is unchanged.
- Updated the file comment to explain why both ids count: a tap quotes the origin id the tapper had live, while the reloaded question carries its archive id.
- No tests added, as the spec says (UI derivation). Only the two Allowed files were changed.

### Checks run

- `pnpm install --frozen-lockfile`: Done in 11.1s.
- `pnpm gate` from the repo root, last lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run separately: the change adds no test, and the gate ran the `@zilar/chat-core` tests.

### Notes for the lead

- Both sides of the comparison are optional-guarded: `quotedId` may be `undefined`, and `question.originId` is only compared when set. A message quoting neither id does not match.
- Behaviour change is limited to matching; the caller signatures are unchanged, so web and mobile `QuestionCard` need no edits.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `39569a0dc`.
- **`isQuestionAnswer`** matches a quoted id equal to the question's id or its `originId` (T-1825); the sender rule is unchanged.
- **The lead re-checks** the "Pizza or sushi" question in "cards test" after the deploy. Its reply quotes origin id `gmvcat84k-5-s4n3jj`.

