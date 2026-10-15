# View steps (approved 2026-10-15)

Julio approved the reworked design ("much much much better thanks, this artifact also looks right") on the canvas https://claude.ai/artifact/7YV3tdKH1k8LSBBZtsXzxk. He had said of the first version "something says its not right". The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `Main.dc.html`, web:
  - **In the chat:** a finished task card (a green check, the title, `4:12`, the step names, and a "View steps" row). The open card is outlined.
  - **On the right, the Steps panel:**
    - a header with the AI's picture, the task title, the total time and Close;
    - one row per **card step**, each with its status icon, name, duration and a chevron;
    - an open step lists its **actions**: a mono command, ✓ or ✕, and a duration;
    - a failed action shows its error output in a well;
    - a step you approved carries a shield-check icon.
- `Phone.dc.html`: the same as a bottom sheet.

## Rules
- **The panel lists the same steps as the card** (the task card's `steps`, `apps/server/src/agents/task-card.ts`), never a separate raw log. Tool calls are grouped under the step they belong to.
- **One time format:** `m:ss` durations. No clock times.
- **Never shown:** model-call rows, token counts, money, or an "Answered" row (the answer is already in the chat).
- **A status is an icon, never a word.**
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius;
  - mobile: `IconButton` 40 px with 12.
