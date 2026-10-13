# Navigation plan: fewer doors, like Telegram (2026-10-13)

Julio approved this on 2026-10-13 ("Simplify like Telegram") after the lead's UI audit. Today the same screens are reached from too many places.

## Today

- **Web left rail** (`apps/web/src/components/FolderRail.tsx`, 199 lines): folders (All chats, Personal, AIs, custom), then **New folder**, **Edit**, **My AIs**, **Profile**.
- **Web hamburger menu** (`apps/web/src/components/chatList/ChatListMenu.tsx`, 207 lines):
  - **18 items**: Invite a friend, Requests, Chat folders, Blocked people, Contacts, Explore groups, Stickers, Connections, Machines, Approvals, My AIs, Integrations, Devices, Profile, Notifications, Settings and Sign out;
  - "Settings" goes to `/settings/profile`, the same page as "Profile" (`:182`, `:198`);
  - web has **no settings hub page** (`apps/web/src/routes/AppRoutes.tsx` has only `/settings/<page>` routes).
- **Phone tabs:** Chats, AIs, Settings, **Profile**. The Settings hub already opens with a profile card (`apps/mobile/src/app/(tabs)/settings.tsx`), so the Profile tab repeats it.

## Target (Telegram)

1. **Web rail = folders only**, plus **Edit** at the bottom (Telegram Desktop). New folder lives inside Chat folders settings. My AIs and Profile move to the menu.
2. **Web menu = short:** a profile row (avatar, name, @handle → own profile), then Contacts (the requests badge), My AIs, Explore groups, Invite a friend and Settings (the approvals badge).
3. **Web `/settings` hub**, the same as the phone's:
   - a profile card at the top;
   - grouped rows (Account, AIs and tools, Chats, Server), with Sign out at the bottom in red;
   - every `/settings/<page>` back arrow returns to `/settings`;
   - the row list moves from `apps/mobile/src/lib/settings-items.ts` to `packages/chat-core`, so both apps show the same rows.
4. **Phone tabs = Chats, AIs, Settings.** The Settings profile card opens the own profile screen (today's Profile tab content), and `/profile` keeps working as a deep link.

## Tasks

- **T-1330:** web: rail, menu, `/settings` hub, shared row list.
- **T-1331:** phone: drop the Profile tab; the card opens the own profile screen.
