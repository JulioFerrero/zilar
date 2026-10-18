---
id: T-2073
title: "Cut comments (phone chat components m–z): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2073-comments-phone-chat-m-z
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2073: Comment cut — phone chat components m–z

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **1911 comment lines in 99 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **955** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/mobile/src/components/chat/markdown-decision.ts`
- `apps/mobile/src/components/chat/markdown-table.tsx`
- `apps/mobile/src/components/chat/markdown-text.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/media-frame.ts`
- `apps/mobile/src/components/chat/media-meta-pill.tsx`
- `apps/mobile/src/components/chat/media-rows.tsx`
- `apps/mobile/src/components/chat/media-sheet-content.tsx`
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/chat/mention-picker.tsx`
- `apps/mobile/src/components/chat/mention-text.tsx`
- `apps/mobile/src/components/chat/message-actions-sheet.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/message-menu-context.tsx`
- `apps/mobile/src/components/chat/message-menu-host.tsx`
- `apps/mobile/src/components/chat/message-search-format.ts`
- `apps/mobile/src/components/chat/message-search-list.tsx`
- `apps/mobile/src/components/chat/message-search-scheduler.ts`
- `apps/mobile/src/components/chat/message-search.ts`
- `apps/mobile/src/components/chat/meta-time.ts`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-message-sheet.tsx`
- `apps/mobile/src/components/chat/new-topic-group-sheet.tsx`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/mobile/src/components/chat/pinned-banner.tsx`
- `apps/mobile/src/components/chat/pins-sheet.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/preview-icon.tsx`
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/question-card.tsx`
- `apps/mobile/src/components/chat/reaction-chips.tsx`
- `apps/mobile/src/components/chat/reply-quote.tsx`
- `apps/mobile/src/components/chat/request-rows.tsx`
- `apps/mobile/src/components/chat/role-chips.tsx`
- `apps/mobile/src/components/chat/routine-header.tsx`
- `apps/mobile/src/components/chat/row-gesture.tsx`
- `apps/mobile/src/components/chat/search-header.tsx`
- `apps/mobile/src/components/chat/search-jump.ts`
- `apps/mobile/src/components/chat/search-snippet.tsx`
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `apps/mobile/src/components/chat/selection-delete.tsx`
- `apps/mobile/src/components/chat/sheet-motion.ts`
- `apps/mobile/src/components/chat/skeleton.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx`
- `apps/mobile/src/components/chat/sticker-message.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/components/chat/ticks.tsx`
- `apps/mobile/src/components/chat/topic-actions-sheet.tsx`
- `apps/mobile/src/components/chat/topic-add-sheet.tsx`
- `apps/mobile/src/components/chat/topic-done-row.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-info-roles.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `apps/mobile/src/components/chat/topic-link-row.tsx`
- `apps/mobile/src/components/chat/topic-mute-leave.tsx`
- `apps/mobile/src/components/chat/topic-not-in-row.tsx`
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/typing-dots.tsx`
- `apps/mobile/src/components/chat/unread-badge.tsx`
- `apps/mobile/src/components/chat/unread-divider.tsx`
- `apps/mobile/src/components/chat/use-approvals-api.ts`
- `apps/mobile/src/components/chat/use-back-cancel.ts`
- `apps/mobile/src/components/chat/use-bubble-reveal.ts`
- `apps/mobile/src/components/chat/use-channel-invites.ts`
- `apps/mobile/src/components/chat/use-chat-actions.ts`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/use-composer-mentions.ts`
- `apps/mobile/src/components/chat/use-draft-text.ts`
- `apps/mobile/src/components/chat/use-group-invite-links.ts`
- `apps/mobile/src/components/chat/use-group-new-topic.ts`
- `apps/mobile/src/components/chat/use-group-roles.ts`
- `apps/mobile/src/components/chat/use-group-visibility.ts`
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/use-message-search.ts`
- `apps/mobile/src/components/chat/use-stable-handlers.ts`
- `apps/mobile/src/components/chat/use-voice-transcribe.ts`
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/components/chat/voice-message-bars.tsx`
- `apps/mobile/src/components/chat/voice-message.tsx`
- `apps/mobile/src/components/chat/voice-playback-source.ts`
- `apps/mobile/src/components/chat/voice-player-host.ts`
- `apps/mobile/src/components/chat/voice-player-registry.ts`
- `apps/mobile/src/components/chat/voice-player.ts`
- `apps/mobile/src/components/chat/voice-recorder-flow.ts`
- `apps/mobile/src/components/chat/voice-recorder-gesture.ts`
- `apps/mobile/src/components/chat/voice-recorder.tsx`
- `apps/mobile/src/components/chat/voice-recording-row.tsx`
- `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx`
- `work/T-2073-comments-phone-chat-m-z.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 955 lines are removed.

---

## Report (written by the worker when done)

### What I did

Went through all 99 allowed files and edited comments only, per `docs/COMMENTS.md`:

- kept WHY comments: security/permission notes (trusted-origin file route and bearer, untrusted stickers/snippets, 403/404 denied line), data/protocol invariants (inverted list indexing, album grouping, `nextBefore` cursor, message-menu target), platform workarounds (Android transparent colour, Sheet/TrueSheet present race, Metro env fold, RN 0.86 gradient crash, Effect fibers instead of `setInterval`), units/limits (ms, px, 48 h, 300 chars, 5-minute cap), and tool directives (`eslint-disable`, `effect-plain`, `/// <reference>` untouched);
- deleted task IDs and history, narration restating names/code, parameter-by-parameter JSDoc on props, references to removed code, banners, and multi-line blocks that said one thing;
- shortened long blocks to one or two lines (or a short `/** */`), keeping the reason.

Scope: 100 changed files, all inside Allowed files. Comment lines in the group went from 1911 to 452. No code, string, import, type or formatting outside comments changed; `git diff` contains only comment lines and rewritten comment lines (verified mechanically). While applying the cuts, three edits briefly caught a neighbouring code line in their range; each was restored and the final diff has no non-comment line.

### Checks run

`pnpm gate` (from the repo root, final run):

```
gate: 100 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (1.6s)
PASS  lint  (1.0s)
PASS  typecheck  (1.1s)
PASS  effect  (2.9s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (2.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the change touches comments only and the task asks for no tests.

`git diff main...HEAD --shortstat`:

```
100 files changed, 580 insertions(+), 1830 deletions(-)
```

- Comment lines removed: 1911 -> 452, i.e. **1459 comment lines removed**, above the 955 target.
- Kept comments longer than 3 lines (only two):
  - `apps/mobile/src/components/chat/use-message-list-scroll.ts:40` — inverted-list index/offset rule and the follow-only-at-bottom rule; a reader would break both by simplifying.
  - `apps/mobile/src/components/chat/voice-player-host.ts:1` — one shared native player, why it is created lazily, and why switching sources must not pause the player.

### Notes for the lead

- The shortstat above includes the spec commit that added this task file (about 166 lines) plus this report; the chat-only change is 99 files, 372 insertions and 1830 deletions.
- Files whose comments were all narration now have no comments at all; files with a real WHY kept one or two lines.
- Two kept JSDoc blocks are longer than 3 lines (listed above); everything else kept is 3 lines or fewer.

### Round 2 (fix round, PREREVIEW at HEAD f8643c7)

Findings fixed:

- **Finding 1 (should-fix)**, `message-bubble-content.tsx:170`: deleted the leftover `T-1756` comment above `<PayloadCard>`; it was a task ID plus narration of the `footer` prop.
- **Finding 2 (should-fix)**, `message-bubble-content.tsx:192`: dropped `T-1619` and shortened the three-line block to one line. The WHY stays: a blocks card carries its time inside the card, a progress card has none, so both skip the meta row.
- **Finding 3 (should-fix)**, `progress-card.tsx:207`: deleted the leftover `T-1422` comment; it restated the flex-row layout.

No `T-XXXX` remains in any of the 99 changed files (`grep`, no matches).

Findings 4 and 5 are nits inside this Report, not on lines this round changes, so they were left as written.

Tests added: none. All three fixes are comment-only, the Spec forbids code changes and asks for no tests, and no finding named a test.

`pnpm gate` (from the repo root, this round):

```
gate: 100 changed file(s) against main
PASS  install (frozen)  (3.4s)
PASS  format  (10.7s)
PASS  lint  (2.9s)
PASS  typecheck  (7.9s)
PASS  effect  (5.2s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`git diff --shortstat main...HEAD` after this round: `100 files changed, 581 insertions(+), 1836 deletions(-)`.


## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +372 -1836 net -1464; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
