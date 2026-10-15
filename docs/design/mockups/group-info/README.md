# Group and channel info (approved 2026-10-15)

Julio approved this design ("looks right") on the canvas https://claude.ai/artifact/Qo4Luy8PKr8auHcxsZEEbH. The canvas is private, so these files are the copy workers read.

The files use the same "Design Component" format as the D24 mockups one folder up: plain HTML with inline styles and the exact values to copy. They are D24 only (`docs/design/ui-style.md`). The ghost bars around the web panel stand in for the chat list and the chat; they are not part of the design.

## Web (1280 wide; the panel is the 380 px column on the right)
- `Main.dc.html`: Dev team info, the root page.
  - Close key; picture; name; "6 members". AIs count as members (Julio, 2026-10-15).
  - Four keys with labels: Mute, Search, Add, More.
  - Three grouped lists:
    - People: Members, AIs, Invite links;
    - Content: Shared media, Pinned messages, Tools and routines, Activity, Always allowed;
    - Settings.
  - Leave group in red.
- `WebMembers.dc.html`: the Members page.
  - Back and close keys; Search; Add members; Invite with a link.
  - People: the owner and admin are icons, never words, and custom roles are small tags.
  - AIs, then Roles.
- `WebChannel.dc.html`: channel info for Acme Announcements.
  - The `@acme` handle, the subscriber count and the description.
  - Keys: Mute, Search, Share, More.
  - People: Admins, Subscribers, AIs, Invite links.
  - Content: Shared media, Pinned messages, Activity.
  - Settings, and Leave channel.
- `WebChannelSubscribers.dc.html`: the Subscribers page.
  - Admins and subscribers, with owner and admin as icons.
  - A row's ⋮ menu holds "Make admin", which replaces the Promote and Demote word keys.

## Phone (390 wide; the page scrolls)
- `Phone.dc.html`: the same root page as web, full screen with a back key.

## Sizes (the app's kit; never other sizes)
- **Web:**
  - icon keys are `IconButton`, 36 px with a 10 px radius;
  - list-row icons are the `ListRow` tile, 32 px with 10.
- **Mobile:**
  - icon keys are `IconButton`, 40 px with 12;
  - list-row icons are `IconTile`, 34 px with 10.
- **Rows:** 44 px rows on web and 48 px on phone, in rounded groups. A count sits at the right in mono, then a chevron.

## Rules the design set
- **Lean:** no section headings inside the root lists, and no hint paragraphs. A status is an icon, never a word.
- **Every row opens a page**, and each page holds one of today's sections unchanged.
  - Settings holds the picture, "Members can create topics", the AI listener and visibility.
  - Roles sits at the end of Members.
- **More** (Julio, 2026-10-15) opens a menu of rare actions: Group background (managers) and Delete group (the owner). A member with neither doesn't see the key.
- **The red bottom row** is Leave group, shown to non-owners only. The owner deletes from More.
- **Counts** come from data the panel already loads. A row whose count isn't loaded shows no number.
