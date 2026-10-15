# Lean settings (approved 2026-10-15)

Julio approved this design ("the lean settings also looks good no changes") on the canvas https://claude.ai/artifact/3WnTiRt4EiUHEywTMjz8Bf. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`).

## Boards
- `Main.dc.html`: the web Settings home at 1280 wide, in a 560 px column.
- `Phone.dc.html`: the phone Settings tab at 390 wide.

## What the page holds
1. **The profile card:** a picture, the name, the e-mail, and a chevron.
2. **Account:** Contact requests (count pill), Contacts, Blocked people, Devices, Notifications.
3. **AIs and tools:** Approvals (count pill), Machines, Connections.
4. **Chats:** Chat folders, Stickers.
5. **Server:** Integrations. This group is web only.
6. **Sign out:** one red row with a red icon tile.

## Rules
- **Every row** is an icon tile, a single-line title, an optional count pill and a chevron.
- **No descriptions or subtitles under any row,** and no status words.
- **Group labels** are small uppercase.
- **Build every row from the kit's `ListRow`:**
  - the tile size comes from the kit: web 32 px with a 10 px radius (`apps/web/src/components/ui/list-row.tsx:39`); mobile `IconTile` 34 px with 10 (`apps/mobile/src/components/ui/icon-tile.tsx:14`);
  - the boards draw 28 and 30 px tiles, so keep the kit's sizes, not the drawing's.
