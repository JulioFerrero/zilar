---
id: T-2230
title: "Rewrite map (no code change), messages core B: message list and bubble on web and phone. Behaviour list, twin logic, slop with file:line, and a lean target structure with line budgets"
status: merged
milestone: M5
branch: task/T-2230-audit-messages-list-bubble
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2230: Rewrite map, message list and bubble

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

`apps/web/src/components/MessageList.tsx` is being moved onto virtua by T-2226 right now. Map its behaviours as they are on main, and plan the target with virtua as the web list engine.

### Scope (7,468 lines, counted 2026-10-19)
- `apps/mobile/src/components/chat/message-bubble.tsx` (749)
- `apps/web/src/components/MessageList.tsx` (740)
- `apps/web/src/components/MessageBubble.tsx` (740)
- `apps/mobile/src/components/chat/message-list.tsx` (640)
- `apps/mobile/src/components/chat/plain-bubble-body.tsx` (492)
- `apps/mobile/src/components/chat/message-bubble-content.tsx` (475)
- `apps/mobile/src/components/chat/markdown-text.tsx` (429)
- `packages/chat-core/src/messages.ts` (401)
- `apps/mobile/src/components/chat/message-bubble-actions.tsx` (401)
- `apps/mobile/src/components/chat/use-message-list-scroll.ts` (356)
- `apps/web/src/components/message/MessageMenuBody.tsx` (333)
- `apps/mobile/src/components/chat/album-grid.tsx` (280)
- `packages/chat-core/src/edits.ts` (233)
- `apps/web/src/components/MessageListRow.tsx` (212)
- `packages/chat-core/src/markdown-ast.ts` (190)
- `apps/mobile/src/components/chat/message-bubble-decor.tsx` (164)
- `apps/web/src/components/message/bubbleFlags.ts` (122)
- `packages/chat-core/src/light-markdown.ts` (117)
- `apps/mobile/src/components/chat/message-menu-host.tsx` (116)
- `packages/chat-core/src/reactions.ts` (106)
- `packages/chat-core/src/markdown.ts` (68)
- `apps/web/src/lib/scrollToMessage.ts` (30)
- `apps/web/src/components/message/use-message-menu.ts` (23)
- `apps/mobile/src/components/chat/markdown-decision.ts` (21)
- `apps/mobile/src/components/chat/message-menu-context.tsx` (18)
- `apps/mobile/src/components/chat/message-list-row.tsx` (12)

Read every file in scope fully. Read a file outside scope only to learn how the scope is used, for example the callers, the store selectors and the bubble subparts it renders.

### Write `docs/audit/messages-list-bubble.md`
1. **Behaviour list.** Number every behaviour a user sees or relies on, for example:
   - grouping, day separators, the unread divider;
   - scroll: open at unread, keep the position on older pages, pin to the bottom, jump to a message with a highlight;
   - bubble layout: own and other side, name, time, ticks, edited, deleted;
   - reply quote, forward label, reactions, Markdown, albums, link previews;
   - long-press or right-click menu, selection mode, accessibility labels.

   For each, give where web does it (`file:line`), where the phone does it, and whether shared code does it. Mark platform-only behaviours as such.
2. **Twin logic.** Every piece that web and phone implement separately but that is the same rule (grouping, flags, status ticks, menu items and their conditions, reaction summaries, Markdown decisions). Give both locations and line counts.
3. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs.
4. **Dead code:** exports, props and branches nothing reaches (prove it with `git grep`).
5. **Lean target structure:**
   - the new files, each with its home: a shared bubble view model and menu model in `client-core` or `chat-core`; the app keeps markup, gestures and the list engine (virtua on web; FlatList or LegendList on the phone);
   - what each file owns, and a line budget;
   - the files to delete;
   - the total budget against today's 7,468. Aim for at least 40% fewer lines with every behaviour from part 1 kept.

   Be concrete: someone must be able to write the rewrite spec from this part alone.
6. **Risks:** behaviours that are easy to lose in a rewrite, and how the lead should check each one (web mock, the phone emulator, or live).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/messages-list-bubble.md`
- `work/T-2230-audit-messages-list-bubble.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all six parts.
- The target structure has budgets per file and a total.

---

## Report (written by the worker when done)

### What I did

- Read all 26 files in scope in full, plus the adjacent files needed to map call sites:
  `apps/web/src/components/MarkdownText.tsx`, `message/MessageMeta.tsx`,
  `message/AlbumGrid.tsx` (layout half), `apps/mobile/src/lib/message-a11y.ts`,
  `components/chat/ticks.tsx`, `meta-time.ts`, `chat-row-facts.tsx`, and
  `packages/chat-core/src/types.ts`.
- Wrote `docs/audit/messages-list-bubble.md` with all six requested parts:
  1. 53 numbered behaviours with web, phone and shared `file:line`, covering grouping, day
     separators, divider, scroll/paging/jumps, bubble layout, status ticks, tombstones, quotes,
     forwards, routines, Markdown, albums, attachments, link previews, reactions, menu, selection
     and accessibility. Platform-only rows are marked `platform`.
  2. Twin logic table with both locations and line counts (17 rules, 270 lines of duplicated
     menu conditions, 203 lines of duplicated album layout, 153 lines of duplicated bubble
     flags, and the rest).
  3. Slop by every rule in `docs/LEAN_CODE.md` with `file:line` and line costs, including the
     three copies of the payload-priority chain, the manual web window/anchor code that virtua
     replaces, the manual phone scroll hook, dead props, and stale comments.
  4. Dead code proved with `git grep` (five removed mobile props, unexported one-file types,
     unused exports, `beyondDraft`, `busy`/`busyLabel`).
  5. Lean target structure: 13 chat-core files, 1 client-core file, 9 web files and 12 mobile
     files, each with its owner and line budget; 9 files deleted; total
     **7,468 → 3,943 (−3,525, −47.2%)**, above the 40% floor, with every behaviour assigned.
  6. 17 rewritten-behaviour risks, each with a web mock, phone emulator or live check.
- No code changed.

### Files changed

- `docs/audit/messages-list-bubble.md` (new, 457 lines).
- `work/T-2230-audit-messages-list-bubble.md` (status + this Report).

### Commands

- `pnpm install` — completed, 1,155 packages linked, peer warning for `@types/react-dom`
  in `apps/mobile` (`@types/react` 19.2.18 vs `^19.3.0`); no install failure.
- No single test file was run: this task changes no source, so there is no near test to run.
- `pnpm gate` from the repo root:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.5s)
PASS  lint  (1.5s)
PASS  typecheck  (1.2s)
SKIP effect (no source files changed)
SKIP build @zilar/server (no server, package or manifest change)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Problems and deviations

- None blocking. The report is a map, so all budgets in part 5 are estimates from the
  behaviour list, not measurements of code that does not exist yet; the "today" numbers are
  measured with `wc -l` (7,468 total).
- `C/messages.ts` also holds four helpers unrelated to this feature (`firstName`, `canPostTo`,
  `withoutId`, `withKey`). The target keeps them in `C/preview.ts`/`C/chat-rules.ts` so the
  file can be deleted whole; deleting the file without a home for them would break chat-list
  and request rows.
- The web `MessageTicks` glyph mapping and the phone `ticks.tsx` mapping are still separate;
  the audit flags them in part 3.4 but keeps the glyphs platform, because they are markup
  (lucide imports). Only the status type is shared.

### Blocked / needs a decision

Nothing.


## Review (written by Claude)

Approved; clean. The map:
- a behaviour list in four groups with web, phone and shared `file:line`;
- twin rules;
- a target of 3,943 lines against 7,468 (−47%), with web −60% and phone −57%;
- six rewrite steps and 17 risks, each with a check.

**Lead notes for the rewrite specs:**
1. Part 5.2 splits `chat-core/messages.ts` into seven small files. The specs keep them in as few files as the callers need (`docs/LEAN_CODE.md`: no file per helper), within the same total.
2. The chat-list rewrite (T-2237, running) adds `chat-core/chat-list.ts` with a `previewFor`. The bubble step must reuse it rather than add a second `preview.ts`.
3. Step 2 (the web list engine) is T-2226, in its fix round now.
