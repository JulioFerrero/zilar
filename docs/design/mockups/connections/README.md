# Connections (approved 2026-10-15)

Julio approved this design on 2026-10-15 ("connects are okay", no changes) on the canvas https://claude.ai/artifact/FVDHKSMiJaWvjxXx5sa8on. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- **`Main.dc.html`,** web Connections:
  - a header with Back, the title, and a primary "Add key";
  - one rounded list of keys. Each row has a status dot (green: working, red: not working), the provider name, a muted line (`Work key · Sep 20`) and a ⋮ key;
  - when a key fails, the line starts with the reason in red plus the host (`Key rejected · api.groq.com · Sep 22`);
  - the ⋮ menu: Test key, Replace key, a divider, and Delete (red).
- **`Phone.dc.html`:** the same list on the phone. Add is a 40 px key at the top right, and the whole row opens the key's sheet.
- **`PhoneSheet.dc.html`:** a key's action sheet with the status dot and name, then Test key (a green check after a passing test), Replace key, and Delete (red).

## Rules
- **The dot is the status.** No status words, except the red reason when a key fails.
- **The lead never enters API keys:** people add them here themselves.
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius (the board draws the ⋮ key at 32 px; use 36);
  - mobile: `IconButton` 40 px with 12.
