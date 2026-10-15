# AI health (approved 2026-10-15)

Julio approved this design ("AI health also looks good") on the canvas https://claude.ai/artifact/GjRvtcBhPcRNpqTL6w4Z9b. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `Main.dc.html`: web, My AIs.
- `Phone.dc.html`: phone, My AIs.

## What a row holds
- **The AI's picture,** with a health dot on its lower right:
  - green: working;
  - red: failing (for example, its key was rejected);
  - amber: paused by its daily limit.
- **The name and the "AI" badge.**
- **One muted line:**
  - normally the model and the provider (`gpt-4o · OpenAI`);
  - when failing, the reason in red plus a fix link (`Key rejected · Replace key`);
  - when paused, `Daily limit reached` in amber.
- **Today's spend** in mono. When the AI has a daily limit, it shows `$0.00 / $2` with a thin bar under it, which turns amber when full.
- **A ⋮ key** on web. On the phone, the whole row opens the AI.

## Rules
- **The health dot is the status.** No status words, except the one reason line when something is wrong.
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius (the board draws the ⋮ key at 32 px; use 36);
  - mobile: `IconButton` 40 px with 12.
- **Approvals' "no money" rule does not apply here:** Julio approved the spend column on this page.
