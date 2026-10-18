---
id: T-2081
title: "Cut comments (chat-core, api-contract, protocol): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2081-comments-chat-core-contract-protocol
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2081: Comment cut — chat-core, api-contract, protocol

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2270 comment lines in 124 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1135** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `packages/api-contract/src/agent-tasks.ts`
- `packages/api-contract/src/ai-memory.ts`
- `packages/api-contract/src/ais.ts`
- `packages/api-contract/src/api.ts`
- `packages/api-contract/src/approvals.ts`
- `packages/api-contract/src/audit.ts`
- `packages/api-contract/src/auth.ts`
- `packages/api-contract/src/backgrounds.ts`
- `packages/api-contract/src/blocks.ts`
- `packages/api-contract/src/chat-folders.ts`
- `packages/api-contract/src/chat-prefs.ts`
- `packages/api-contract/src/chats.ts`
- `packages/api-contract/src/client.ts`
- `packages/api-contract/src/connections.ts`
- `packages/api-contract/src/contact-requests.ts`
- `packages/api-contract/src/contacts.ts`
- `packages/api-contract/src/directory.ts`
- `packages/api-contract/src/errors.ts`
- `packages/api-contract/src/gifs.ts`
- `packages/api-contract/src/groups.ts`
- `packages/api-contract/src/handles.ts`
- `packages/api-contract/src/integrations.ts`
- `packages/api-contract/src/invite-links.ts`
- `packages/api-contract/src/iso-datetime.ts`
- `packages/api-contract/src/lenient-nullable-string.ts`
- `packages/api-contract/src/lenient.ts`
- `packages/api-contract/src/link-preview.ts`
- `packages/api-contract/src/machines.ts`
- `packages/api-contract/src/media.ts`
- `packages/api-contract/src/message-blocks.ts`
- `packages/api-contract/src/middleware.ts`
- `packages/api-contract/src/mutable-struct.ts`
- `packages/api-contract/src/omit-undefined.ts`
- `packages/api-contract/src/pins.ts`
- `packages/api-contract/src/push.ts`
- `packages/api-contract/src/raw-query.ts`
- `packages/api-contract/src/roles.ts`
- `packages/api-contract/src/routines.ts`
- `packages/api-contract/src/search.ts`
- `packages/api-contract/src/stickers.ts`
- `packages/api-contract/src/tools.ts`
- `packages/api-contract/src/topics.ts`
- `packages/api-contract/src/voice-transcription.ts`
- `packages/api-contract/src/xmpp.ts`
- `packages/chat-core/src/ai-activity.ts`
- `packages/chat-core/src/ai-computer.ts`
- `packages/chat-core/src/ai-errors.ts`
- `packages/chat-core/src/ai-form.ts`
- `packages/chat-core/src/ai-health.ts`
- `packages/chat-core/src/ai-limits.ts`
- `packages/chat-core/src/ai-models.ts`
- `packages/chat-core/src/ai-providers.ts`
- `packages/chat-core/src/ai-suggestions.ts`
- `packages/chat-core/src/ai-templates.ts`
- `packages/chat-core/src/ai.ts`
- `packages/chat-core/src/approval-title.ts`
- `packages/chat-core/src/avatar-identity.ts`
- `packages/chat-core/src/avatar-seed.ts`
- `packages/chat-core/src/avatar.ts`
- `packages/chat-core/src/block-charts.ts`
- `packages/chat-core/src/block-content.ts`
- `packages/chat-core/src/block-progress.ts`
- `packages/chat-core/src/block-table.ts`
- `packages/chat-core/src/blocked.ts`
- `packages/chat-core/src/blocks.ts`
- `packages/chat-core/src/chat-labels.ts`
- `packages/chat-core/src/chat-prefs.ts`
- `packages/chat-core/src/connection-check.ts`
- `packages/chat-core/src/edits.ts`
- `packages/chat-core/src/emoji-names.ts`
- `packages/chat-core/src/emoji-table.ts`
- `packages/chat-core/src/emoji.ts`
- `packages/chat-core/src/failures.ts`
- `packages/chat-core/src/files.ts`
- `packages/chat-core/src/format-duration.ts`
- `packages/chat-core/src/format.ts`
- `packages/chat-core/src/handle-errors.ts`
- `packages/chat-core/src/invite-code.ts`
- `packages/chat-core/src/light-markdown.ts`
- `packages/chat-core/src/links.ts`
- `packages/chat-core/src/markdown-ast.ts`
- `packages/chat-core/src/markdown.ts`
- `packages/chat-core/src/media.ts`
- `packages/chat-core/src/mentions.ts`
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/money.ts`
- `packages/chat-core/src/new-ai.ts`
- `packages/chat-core/src/person-link.ts`
- `packages/chat-core/src/photos.ts`
- `packages/chat-core/src/question-answer.ts`
- `packages/chat-core/src/reactions.ts`
- `packages/chat-core/src/routines.ts`
- `packages/chat-core/src/search.ts`
- `packages/chat-core/src/sender-color.ts`
- `packages/chat-core/src/settings-items.ts`
- `packages/chat-core/src/smooth-text.ts`
- `packages/chat-core/src/sticker-motion.ts`
- `packages/chat-core/src/sticker-recents.ts`
- `packages/chat-core/src/stickers.ts`
- `packages/chat-core/src/store/ledger.ts`
- `packages/chat-core/src/text.ts`
- `packages/chat-core/src/topic-activity.ts`
- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/types.ts`
- `packages/chat-core/src/url.ts`
- `packages/chat-core/src/user-agent.ts`
- `packages/protocol/src/attachment.ts`
- `packages/protocol/src/blocks-choices.ts`
- `packages/protocol/src/blocks-content.ts`
- `packages/protocol/src/blocks-numbers.ts`
- `packages/protocol/src/blocks-progress.ts`
- `packages/protocol/src/blocks.ts`
- `packages/protocol/src/common.ts`
- `packages/protocol/src/forward.ts`
- `packages/protocol/src/handles.ts`
- `packages/protocol/src/handoff-line.ts`
- `packages/protocol/src/jid.ts`
- `packages/protocol/src/payload.ts`
- `packages/protocol/src/progress.ts`
- `packages/protocol/src/question.ts`
- `packages/protocol/src/routine.ts`
- `packages/protocol/src/sticker.ts`
- `packages/protocol/src/version.ts`
- `packages/protocol/src/voice.ts`
- `work/T-2081-comments-chat-core-contract-protocol.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1135 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in all 124 allowed files, following `docs/COMMENTS.md`: removed task IDs, history, narration, parameter-restating JSDoc, commented-out code and section banners. Kept and often shortened to one or two lines the security/privacy notes, permission and 404 rules, ordering/idempotency invariants, version-skew parsing rules, platform workarounds, units/limits, and the four `effect-plain:` directives. Code, strings, imports, types and formatting are untouched; the only edits are removed or shortened comment lines (and the blank lines those blocks left doubled).

- `git diff main...HEAD --shortstat`: **124 files changed, 641 insertions(+), 2227 deletions(-)** (123 package files plus this task file; the 641 insertions include the spec/task file. Package-only: 419 insertions(+), 2227 deletions(-), a net 1808 lines removed. Comment lines went from 2270 to 477, so 1793 comment lines were removed).
- `packages/protocol/src/payload.ts` is unchanged because its only comment is a real WHY ("UTF-8 bytes are never fewer than UTF-16 code units, so a longer string is always too large"); the other 123 package files changed.
- Per package: api-contract 44 files, 174 insertions(+), 942 deletions(-); chat-core 62 files, 211 insertions(+), 1131 deletions(-); protocol 17 files, 34 insertions(+), 154 deletions(-).
- Kept comments longer than 3 lines: **none**. Every kept comment is at most 3 lines; most are 1-2.
- I verified mechanically with a script that, for every allowed file, the sequence of non-comment lines (blank lines ignored) is identical to `HEAD`: 124 checked, 0 differ. It still holds after the final edit.

### Checks run

- `pnpm install`: done (27.8s).
- `pnpm gate` (first run): **GATE FAIL** — `format` only, on `packages/chat-core/src/connection-check.ts`. Removing a comment inside an empty `catch` let Prettier collapse it to `catch {}`. I restored that comment, shortened ("Ignored on purpose; the connection stays and a later run can reuse it."), which is a genuine WHY, then `prettier --check` on that file passed.
- `pnpm gate` (second run): **GATE PASS**. Full summary:
  - `gate: 124 changed file(s) against main`
  - `PASS install (frozen) (1.1s)`
  - `PASS format (1.9s)`
  - `PASS lint (1.1s)`
  - `PASS typecheck (3.2s)`
  - `PASS effect (3.7s)`
  - `PASS build @zilar/server (0.4s)`
  - `SKIP tests @zilar/api-contract (no nearby test files)`
  - `PASS tests @zilar/chat-core (2.4s)`
  - `PASS tests @zilar/protocol (0.8s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run separately: this task changes comments only and the spec says "No tests". The gate ran the nearby chat-core and protocol tests as shown above.

### Notes for the lead

- The task file itself is the only non-`packages/*` file changed (status/report), as listed in Allowed files.
- Some kept one-liners are longer than the old wrapping because one-line WHY comments read better than two short lines; Prettier does not wrap comments and lint passes.


## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +419 -2227 net -1808; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
