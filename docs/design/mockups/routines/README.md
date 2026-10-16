# Routines (approved 2026-10-16)

Julio approved these boards on the AI work card canvas (https://claude.ai/artifact/CydmLX7ieYyYdUdsWrPbwW): "i love the routines" for the routine row, and "Build as drawn" for the settings page. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `WebRoutineAsk.dc.html`, `PhoneRoutineAsk.dc.html`: the AI asks to schedule a routine.
  - The work card is one done line: "Check the prices", with its duration and a chevron.
  - The routine approval card holds the repeat icon, the routine's title, its schedule in mono ("every 5 min"), then **Allow**, **Deny** and a details chevron.
  - **No hosts, tool names or URLs on the card:** they sit behind the chevron.
  - **No "Approval needed: …" text under the card, and no separate "approved …" message.**
- `WebRoutineLive.dc.html`, `PhoneRoutineLive.dc.html`: after Allow.
  - The card shrinks to one line: a green check, the title and the schedule.
  - The routine posts **one** message:
    - a header link (the repeat icon, the title, the schedule) that opens the routine;
    - the content, here a compact BTC / Gold / S&P 500 table;
    - "edited 10:45" at the bottom.
  - Every later run **edits** this same message.
- `WebRoutinesList.dc.html`, `PhoneRoutinesList.dc.html`: the Settings › Routines page.
  - Two groups, **Running** and **Paused**.
  - **Each row:**
    - the AI's ball;
    - the title with a status dot (green running, grey paused);
    - one line: the schedule in mono, then the AI, then the chat (on phone, the schedule and the AI only);
    - an **Ask** key (opens the chat with that AI) and a **Pause** or **Resume** key.
  - Tapping a row opens the routine, where Delete lives.
  - The Settings home gets a **Routines** row with a count pill under "AIs and tools" (see `../lean-settings/`).

## Julio's decisions (2026-10-16)
1. **"edited" shows the time of the latest edit,** not the original send time, on web and phone.
2. **Each run bumps the chat:** the routine's edit counts as new activity in the chat list (preview and unread), unlike a normal text edit.
3. **A scheduled run is exactly one message:** no working card and no @mention on its updates.
4. **The settings page is built as drawn.**

## Rules
- Build with the kit, not the drawing's hand-made keys:
  - Allow is the glossy primary key;
  - Deny, Ask, Pause and Resume are the dark icon keys (`apps/web/src/components/ui/*`, mobile `apps/mobile/src/components/ui/*`).
- Keep the kit's sizes (see `../lean-settings/README.md`).
- **Lean:** no subtitles or hint paragraphs. A status is a dot, never a word.
- Server plan for the single edited message: `docs/plan/routine-live-message.md`.
