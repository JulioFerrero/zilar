# AI work in topics (approved 2026-10-15)

Julio asked for a full rework of topic status, "not just ui but also functionality", because several AIs can work in one chat, and asked to look at how Grok Bot shows that. He approved this proposal: "the ai work in topic looks so much better thanks, i like it". The canvas is https://claude.ai/artifact/Nps8Bw9wgCq8swJZoRx3T7; it is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `Main.dc.html`, web, a topic where two AIs work:
  - **Sidebar:** each topic row ends with the pictures of the AIs working there, with their state marks.
  - **Header:** an "AIs here" key showing those pictures.
  - **In the chat:**
    - Dev-1's work card: title, a step checklist, timer, Stop;
    - a handoff line, "Dev-1 → QA-1 · Check it on an iPhone";
    - QA-1's question with reply chips.
  - **Above the composer,** one status line: "Dev-1 is running the tests · QA-1 is waiting for you".
- `Phone.dc.html`: the same topic on the phone. The status line shows one AI and "+1".
- `PhoneSheet.dc.html`, "AIs here":
  - every AI in the topic with what it is doing;
  - Stop for the working one, and a row to open the waiting one's question;
  - Add.
- `States.dc.html`: the four states.

## The model (what changes)
- **No status picked by hand.** The topic kind (chat/task/bug/ui/routine), the five statuses (open/in progress/in review/blocked/done) and the single owner AI go away. So does the task strip under the topic header.
- **A topic's AI state comes from what its AIs are doing:**
  - **Working:** a turning ring around the AI's picture, while it runs a turn (the task card is in `working`);
  - **Waiting for you:** an amber dot, while it has a pending approval or an open question to people;
  - **Done:** a green check, when the AI finished the work, or a person marked the topic done;
  - **Idle:** no mark.
- **Several AIs per topic, like Grok Bot:**
  - people @mention who should do what;
  - an AI's work is its task card (the progress card exists: title, steps, timer, Stop);
  - one AI handing work to another shows as a small handoff line;
  - a question can offer reply chips.
- **What Grok Bot, Linear and Slack do:**
  - Grok Bot: 2–6 bots per group; bots decide who answers unless one is @mentioned; handoffs show in the conversation; tool activity shows inline.
  - Linear: agent sessions are pending, active, awaiting input, error, complete or stale, set from the agent's activity and never by hand; each has a plan checklist.
  - Slack: an "<app> is …" status line per assistant, cleared when it replies.

## Rules
- **A status is a mark, never a word,** except the one status line above the composer and the sheet's one line per AI.
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius; `ListRow` tile 32 px with 10;
  - mobile: `IconButton` 40 px with 12.
