# Empty chat and several files (approved 2026-10-15)

Julio reviewed the canvas https://claude.ai/artifact/CTECqZ1VChng6ySBwjjv5w on 2026-10-15. He rejected the Telegram-style greeting sticker on the empty DM ("something simpler will be nice"); the simpler version below was the result, and he then said he had nothing more to review. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `Main.dc.html` (web) and `PhoneAi.dc.html` (phone), **a new AI chat:**
  - the AI's picture in the middle, its name with the "AI" badge, and the mono model line (`deepseek-chat · DeepSeek`);
  - three suggestion chips that send that text.
- `WebDm.dc.html` (web) and `PhoneDm.dc.html` (phone), **an empty DM:** only the person's picture, name and `@handle` in the middle. No greeting sticker, no "No messages yet" card, nothing to tap.
- `WebFiles.dc.html` (web) and `PhoneFiles.dc.html` (phone), **several files at once:**
  - **Before sending:** the composer shows one 72 px tile per file. Photos show the image; other files show an icon, the extension and the size. Each tile has a remove key.
  - Then "Add a caption" and one Send key ("Send 4 files").
  - **In the chat:** the photos go as one album, and every other file goes as its own file bubble.

## Rules
- Empty states are quiet: no word statuses and no extra cards.
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius;
  - mobile: `IconButton` 40 px with 12.
