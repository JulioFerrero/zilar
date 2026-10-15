# Approvals (approved 2026-10-15)

Julio approved this design ("much better i like it now, the approval part is good") on the canvas https://claude.ai/artifact/E5nfkSk1vJLMq4UXDkQTs7. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`). He rejected the first version for "too many things", so keep it this plain.

## Web (1280×800)
- `Main.dc.html`, **the card in the chat:**
  - a small label, "Dev-1 asks" (the AI's name);
  - the request's summary as the title, 16 px semibold;
  - Deny (secondary key) and Approve (primary key) on the right; "Always allow" is quiet text on the left;
  - a decided request shrinks to one line: a green check (approved) or a red cross (denied), then the summary in muted text.
- `WebInbox.dc.html`, **Approvals:**
  - one row per request in one rounded list: the AI's picture, the summary (one line), and "AI · chat" in muted text;
  - on the right, a Deny key (cross) and an Approve key (check, primary), both 36 px icon keys;
  - the row opens the chat at the request.
- `WebMachines.dc.html`, **Machines:**
  - a new machine is a card with an amber dot, its name, its code in a large mono well, "Approve if the machine shows this code.", and Deny / Approve;
  - the other machines are plain rows: a status dot (green online, grey offline), the name, the assigned AI's picture, and a chevron;
  - a "Revoked" row with its count.
  - OS, CPU and the sandbox chips move to the machine's own page.

## Phone (390×844)
`PhoneCard.dc.html`, `PhoneInbox.dc.html` and `PhoneMachines.dc.html` are the same three screens.
- Keys are 44 px tall and share the width.
- "Always allow" sits centred under the keys.
- The Approvals rows use 40 px icon keys, and the summary wraps to two lines.

## Rules the design set (Julio, 2026-10-15)
- **No money anywhere** on approvals (Julio: "i dont like the money part"). The card and the list never show `worst_case_cost`.
- **The card hides** the tool's action name, the details text, the approvers line and the expiry timer.
- **One request per card,** as today: there are no grouped "task" cards and no per-step checkboxes.
- **"Always allow"** keeps today's two-step confirm (`ApprovalCard.tsx`, T-0100) and its rules: it is shown only when the request is eligible.
- **A status is an icon, never a word.**
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius;
  - mobile: `IconButton` 40 px with 12.
