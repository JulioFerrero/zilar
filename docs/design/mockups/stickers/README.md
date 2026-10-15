# Stickers (approved 2026-10-15)

Julio approved this design ("looks good the sticker part") on the canvas https://claude.ai/artifact/GiBcaeJcuprSGGFBb3Xc3H. The canvas is private, so these files are the copy workers read.

The files use the same "Design Component" format as the D24 mockups one folder up: plain HTML with inline styles and the exact values to copy. They are D24 only (`docs/design/ui-style.md`).

The sticker tiles show the mock's seed art (a gradient tile with an emoji, `packages/mock-backend/src/domains/stickers/seed.ts`). In the app they are the pack's real sticker images, the first ones in pack order.

## Web (1280×800)
- `Main.dc.html`, My packs.
  - Tabs: My packs · Discover · Favorites.
  - Your packs, each with a drag grip, four sticker thumbnails, a name, and a globe icon when shared.
  - Each pack has a ⋮ menu: **Share**, Edit, Make private, Remove from panel, Delete.
  - "Added" lists other people's packs in your panel.
- `WebDiscover.dc.html`, Discover: search as you type over shared packs; Add, or a green check when the pack is in your panel.
- `WebPack.dc.html`, **the page a pack link opens** (`/stickers/<packId>`): the name, the count and owner, the link with a Copy key, the sticker grid, Share and Add.
- `WebNewPack.dc.html`, **New pack**:
  - Name; Private · Shared.
  - The sticker grid with a count ("7 / 120"), ending in a dashed **Add** tile for photos, GIFs and videos.
  - Each tile shows its emoji (or "+"), a loop badge when it moves, a spinner while a video converts, or a red error tile (too long) with a remove key.
  - Clicking a tile opens a popover with emoji choices, Move left / Move right, and Remove.

## Phone (390×844)
- `Phone.dc.html`: My packs.
- `PhoneSheet.dc.html`: a pack's action sheet: its stickers, then **Share**, Edit, Make private, Remove from panel, Delete.
- `PhonePack.dc.html`: the pack link page, with Share at the top right and a full-width Add key at the bottom.
- `PhoneNewPack.dc.html`: New pack with a 4-column grid and a full-width Create key.

## Rules the design set (Julio, 2026-10-15)
- **Pack links:**
  - every pack has a link, `https://chat.zilar.app/stickers/<packId>`;
  - anyone signed in who has the link can open the pack and add it, like Telegram and Signal;
  - "Shared" (the globe) still means listed in Discover.
  - The phone opens the link in the app (a `/stickers/` app-link path).
- **Motion:**
  - GIFs, animated WebP, APNG and videos (`.webm`, and short `.mp4`/`.mov`) keep their motion;
  - the server converts video and GIF to an animated WebP that loops with transparency;
  - videos are up to 3 seconds (Telegram's limit);
  - the apps never flatten a moving file to a still.
- **The phone renders stickers with `expo-image`,** so animated stickers move.
- **The Telegram importer** keeps video (`.webm`) stickers through the same conversion. Lottie (`.tgs`) comes later.
- **Sizes are the kit's:**
  - web: `IconButton` 36 px with a 10 px radius;
  - mobile: `IconButton` 40 px with 12.
