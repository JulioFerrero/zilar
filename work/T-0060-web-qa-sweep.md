---
id: T-0060
title: Web QA sweep — click through every screen and state in mock mode, report bugs with evidence (no code changes)
status: planned
milestone: M2
branch: task/T-0060-web-qa-sweep
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0057]
estimate: 0.5 day
---

# T-0060: Web QA sweep

## Spec (written by Claude, do not edit)

### Goal

A lot of web UI landed in two days: the D24 redesign, Markdown, mentions, the model picker and the loading states. Julio cares about quality ("a little more love"). Before the next features, do a careful **QA pass** of the web app and produce a **prioritized bug list with evidence**. **Change no code.** The lead turns your list into tasks.

### Read first
- `AGENTS.md` (mandatory). You don't implement anything in this task.
- `docs/design/ui-style.md` (the D24 bar: tokens, depth recipes, components, motion, accessibility)
- `docs/design/mockups/Main.dc.html` (the desktop target)
- `apps/web/src/mock/**` (the mock chats you can open, and their ids)

### Allowed files
- `work/T-0060-web-qa-sweep.md` (your Report)
- `work/screenshots/T-0060/**` (evidence, at most 25 images)

**Nothing else.** Don't edit the source, and don't "just fix" a typo. Report it.

### How
- Start **your own** Vite from your worktree: `pnpm --filter @galena/web exec vite --port 5251 --strictPort`. Open `http://localhost:5251/?mock=1`. Use `localhost`, not `127.0.0.1`: Vite binds `::1`.
- **Never** use or probe ports 3000, 3188, 5173 or 8081; they are Julio's.
- **Stop your Vite at the end.**
- Check at **1440×900** and **390×844**. With the image budget in mind (gotcha 17), look at each screenshot once, downscaled.

### Checklist (pass or fail, with notes, for each)
1. **Chat list:**
   - the rows (avatar, name, the AI badge, time, preview, unread badge and muted);
   - the folder tabs (All, Personal, AIs, Work: counts, and the filter works);
   - search (typing filters; clearing restores the list);
   - "New chat" (every dialog opens and closes, Esc works).
2. **A DM:**
   - header, bubbles (grouping, tails, ticks, times), date pills, the unread divider;
   - the scroll-to-bottom key;
   - the composer (mic ↔ send, auto-grow, Shift+Enter newline, Enter sends in mock);
   - the reply bar;
   - the actions menu (right-click and the ⋯ button: Reply, Copy).
3. **A group:** sender names and colors, avatars, and the **@ picker** (open, filter, keyboard, pick, backspace) with mention chips.
4. **An AI chat:**
   - Markdown rendering (headings, lists, code block scroll, table, quote, links);
   - the AI panel (name, persona, the model picker with SUGGESTED, limits, delete confirm);
   - the generating state, if the mock has it.
5. **Rich messages:** voice (play, waveform), images, approval (Approve/Deny keys) and progress cards.
6. **Narrow (390):** one pane at a time, back navigation, the panel full screen, the composer and safe areas, and no horizontal scroll anywhere.
7. **Keyboard and accessibility:**
   - tab order through the list and the composer;
   - visible focus rings on keys and wells;
   - Esc closes menus and dialogs;
   - icon buttons have labels (inspect with the accessibility tree).
8. **Motion:** `prefers-reduced-motion` (emulate it): no press translation, no pulsing.
9. **Console:** no errors or React warnings while clicking through. Copy any you see.
10. **Visual polish against D24:**
    - misaligned or clipped text;
    - inconsistent radii or shadows;
    - leftover light or blue colors;
    - text contrast that's too low (flag anything that looks under 4.5:1 for body text).

### Report format (in this file)
- A table for the checklist: `# | Area | Result (pass/fail) | Notes`.
- **Bugs**, most severe first. For each one:
  - a short title;
  - severity (`high`: broken or blocks a flow; `medium`: clearly wrong but has a workaround; `low`: polish);
  - exact steps;
  - expected vs actual;
  - the screenshot file;
  - and, if you can tell from reading the code, the likely file and line.
- **Polish suggestions**, separately (not bugs), at most 10, each one line.
- The commands you ran and the fact that you stopped your Vite.

Then set `status: review` and commit **only** the task file and screenshots: `T-0060: web QA sweep`.

## Report (written by the worker when done)

## Review (written by Claude)
