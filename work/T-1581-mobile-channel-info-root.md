---
id: T-1581
title: "Phone Group info T5 (plan docs/audit/phone-group-info-plan.md §6): the channel screen becomes the channel info root in the Group info style (picture, name, @handle · N subscribers, description, Mute/Search/Share keys, a Feed row, People rows Admins & subscribers / AIs / Invite links, Leave channel) with a Subscribers page (owner/admin icons, ⋮ Make admin / Remove admin); parser nit from T-1574"
status: merged
milestone: M5
branch: task/T-1581-mobile-channel-info-root
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1581: Phone channel info root

## Spec (written by Claude, do not edit)

### Why
This is step T5 of `docs/audit/phone-group-info-plan.md` §6. The lead's answer (`work/T-1542-*.md` › Review): `ChannelScreen` becomes the channel root.

**The board** is `docs/design/mockups/group-info/WebChannel.dc.html` and `WebChannelSubscribers.dc.html` (README:20-28):
- the `@handle`, the subscriber count and the description;
- the keys Mute, Search, Share and More;
- People: Admins, Subscribers, AIs and Invite links;
- **later (T6):** Content, Settings, and Delete in More;
- Leave channel;
- a row's ⋮ "Make admin" replaces the Promote and Demote word keys.

**The phone shape** follows the group root (T1–T4): full screen with a back key, and the kit sizes in README:33-40.

### Facts (the lead read them on main after T-1574, 2026-10-15)
- **`apps/mobile/src/app/group/[id].tsx`** renders `<ChannelScreen groupId feedId title />` for a channel (`:192-195`).
- **`apps/mobile/src/components/chat/channel-screen.tsx` (257)** is the current channel landing:
  - the 22 px title, the subscriber subtitle and the description (`:170-181`);
  - a **Feed** row that opens `/chat/<feedId>` (`:183-198`);
  - `ChannelMembers` (`:200-211`), then Invite links for managers or Leave channel for subscribers (`:213-234`);
  - it uses `groupDetail`, `listChannelMembers` and `use-channel-invites.ts` (147).
- **`apps/mobile/src/components/chat/channel-members.tsx` (142):** ADMINS or SUBSCRIBERS with Promote and Demote word keys for the owner (`:91-140`).
- **Group info pieces to reuse:**
  - `apps/mobile/src/components/group-info/info-row.tsx` (`InfoRow`, `InfoRowGroup`);
  - `info-keys.tsx`: `InfoKeys({ groupChatId, canManage, isOwner, onSearch, onAdd, onMore })`, with keys Mute, Search, Add and More (`:33-47`);
  - `ais-page.tsx` (the group AIs page, T-1569);
  - `members-page.tsx` (its row with `Crown`/`Shield` icons and ⋮).
- **Share:** the phone shares a handle link as `${WEB_HOST}/@${encodeURIComponent(handle)}` with `Share.share` (`apps/mobile/src/app/settings/contacts.tsx:136-145`). Web copies the same link (`apps/web/src/components/channel-info/ChannelInfoRoot.tsx:136-145`).
- **The mock channel:** `g-acme` "Acme Announcements", `@acme`, "Release notes and team news.", members You (owner), Ana (admin) and Luis (`packages/mock-backend/src/domains/groups/seed.ts:111-125`).
- **The T-1574 nit:** `parseGroupDetail` (`apps/mobile/src/lib/chat-api-schemas.ts:243`) rejects the whole detail when a present `listener` block is malformed.

### Steps
1. **The channel root** (rewrite `channel-screen.tsx`, or a new `apps/mobile/src/components/channel-info/root-page.tsx` that `channel-screen.tsx` renders):
   - a back key; a 96 px picture; the name (22 px); "@acme · 3 subscribers" (the handle part only when set); the description;
   - **keys:**
     - Mute and Search, the same behaviour as the group keys, on the feed chat;
     - Share, only with a handle, which shares the handle link;
     - More is left out until T6;
   - **then:**
     - the **Feed** row (keeps the way to the posts);
     - a People group: **Admins and subscribers** (count = members) → the subscribers page; **AIs** (count) → the existing `AisPage`; **Invite links** (managers) → the existing sheet;
     - the red **Leave channel** row for non-owners (the existing leave flow).
   - `InfoKeys` may gain an optional `shareUrl` / `onShare` and make Add optional, keeping the group root unchanged.
2. **New `apps/mobile/src/components/channel-info/people-page.tsx`:** a search field, then admins first, then subscribers, in one rounded list.
   - Owner and admin show as `Crown` and `Shield` icons.
   - **For the owner:** a ⋮ on others' rows with **Make admin** or **Remove admin**, through the same store action `channel-members.tsx` uses today.
   - The Promote and Demote word keys go.
3. **Delete `channel-members.tsx`** if nothing else uses it (check with `git grep`).
4. **The parser:** in `chat-api-schemas.ts`, a malformed `listener` block drops only `listener` and keeps the detail.
5. **Every file stays under 400 lines.**

### Not in scope
- channel Content and Settings, and Delete in More (T6);
- web;
- the server.

### Tests
None.

### Allowed files
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/channel-info/root-page.tsx` (new)
- `apps/mobile/src/components/channel-info/people-page.tsx` (new)
- `apps/mobile/src/components/chat/channel-members.tsx` (delete if unused)
- `apps/mobile/src/components/group-info/info-keys.tsx`
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `work/T-1581-mobile-channel-info-root.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group/g-acme`:** the round picture; "Acme Announcements"; "@acme · 3 subscribers"; "Release notes and team news."; the Mute, Search and Share keys; the Feed row; then Admins and subscribers `3`, AIs `0`, Invite links.
- **`/group/g-devteam`'s Group info** is unchanged.

---

## Report (written by the worker when done)

### What I did

**The channel root** — `apps/mobile/src/components/chat/channel-screen.tsx` now renders the
new `ChannelInfoRoot` (`apps/mobile/src/components/channel-info/root-page.tsx`) as its root
page and switches between root, the Subscribers page and the reused `AisPage`
(`apps/mobile/src/components/group-info/ais-page.tsx`). The root page is a thin view:
back key; 96 px picture; the name (22 px) with the megaphone; `@acme · 3 subscribers`
(the handle only when set, else just `N subscribers`); the description; the keys
Mute/Search/Share; the Feed row (still opens `/chat/<feedId>`); the People group
(`Admins and subscribers` count, `AIs` count, `Invite links` for managers); and the red
Leave channel row for non-owners. `channel-screen.tsx` keeps owning the data
(`groupDetail`, `listChannelMembers` slice, role change, leave, share) and the
`InviteLinksSheet`.

- **Keys** go through `InfoKeys`: Mute and Search act on the feed chat row (as before);
  Share shares `${WEB_HOST}/@${encodeURIComponent(handle)}` with `Share.share`, the same
  link `settings/contacts.tsx:136-145` and the web root use; More is left out until T6.
- **`info-keys.tsx`**: `onAdd` and `onMore` are now optional and a new optional `onShare`
  adds the Share key. The group root is untouched (it still passes Add and More), so
  `/group/g-devteam` renders no Share and is visually unchanged.
- **`apps/mobile/src/components/channel-info/people-page.tsx`** (new): back key, title
  "Subscribers", a search field, then one rounded list with the owner/admins first
  (`Crown`/`Shield` icons) and the subscribers next. The owner gets a ⋮ on others' rows
  (not the owner row) with **Make admin** / **Remove admin**, through the same
  `changeChannelRole` store action; the Promote and Demote word keys are gone.
- **Deleted** `apps/mobile/src/components/chat/channel-members.tsx` (only `channel-screen.tsx`
  used it; confirmed with `git grep`).
- **Parser** (`apps/mobile/src/lib/chat-api-schemas.ts`): a present-but-malformed `listener`
  block now drops only `listener` and keeps the detail (the T-1574 nit). The raw value is
  decoded with `GroupListener` in `parseGroupDetail`, and only a success is kept.

Files changed (all inside the Allowed files):
- `apps/mobile/src/components/chat/channel-screen.tsx` (rewritten)
- `apps/mobile/src/components/channel-info/root-page.tsx` (new)
- `apps/mobile/src/components/channel-info/people-page.tsx` (new)
- `apps/mobile/src/components/chat/channel-members.tsx` (deleted)
- `apps/mobile/src/components/group-info/info-keys.tsx`
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `work/T-1581-mobile-channel-info-root.md`

### Checks run

- `pnpm install` — `Done in 12.5s` (one peer-dependency warning, unrelated).
- No single test file was run: this round is mobile UI and a small parser nit, and the
  task's Tests section says "None". The gate ran the mobile package's nearest tests.
- `pnpm gate` from the repo root:

  ```text
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  (First gate run was `GATE FAIL` on format for the two new files only; `prettier --write`
  on those two files fixed it, and the rerun above passed.)

### Notes for the lead

- **The People row count.** The spec says "count = members". I pass
  `channelSubscriberCount(feedRow, members.length)`, which is the subscriber count the feed
  row carries, falling back to the loaded members for managers. For the mock manager the
  two agree (`3`); for a subscriber (whose `members` the server strips) it shows the real
  subscriber count instead of `0`. The header subtitle and the row use the same number.
- **`InfoKeys` `onMore` is optional too.** The spec allowed making Add optional and adding
  Share; I also made `onMore` optional so the channel root can leave the owner's More key
  out until T6 without passing `isOwner` falsely. The group root still passes both.
- **For a subscriber** the row is labelled "Admins and subscribers" but the page shows only
  the admins slice (the server hides the audience); that is the existing channel behaviour
  the task keeps, not a new regression.
- **Page title** is "Subscribers", matching `WebChannelSubscribers.dc.html` and the task
  title; the row that opens it is "Admins and subscribers".
- I did not run the app on a phone (out of scope here); the acceptance line is the lead's
  phone smoke.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 3 nits.
- **Phone smoke:** PASS on both routes.
  - **`/group-info/g-devteam`:** unchanged. The keys are Mute, Search, Add and More, then the rows Members, AIs, Invite links, Content and Settings. This checks the shared `InfoKeys` change.
  - **`/group/g-acme` could not show the new screen.** The mock channel's chat row has no `topic`, so `topicsOfGroup` (`apps/mobile/src/app/group/[id].tsx:74`) finds none and the route goes back to the chat list. That route file is unchanged on this branch, so main does the same.
- **What the lead checked in the code instead:** `root-page.tsx:76-160` has:
  - a back key, the 96 px picture, the name with a megaphone icon, "@handle · N subscribers" and the description;
  - the Mute, Search and Share keys (Share only with a handle);
  - the Feed row;
  - Admins and subscribers, AIs, and Invite links for managers;
  - the red Leave channel row for non-owners.
- **Also checked:**
  - **The subscribers page** shows owner and admin as `Crown`/`Shield` icons, and the owner's ⋮ offers Make admin or Remove admin.
  - **`channel-members.tsx` is deleted,** and nothing imports it.
  - **The T-1574 nit is fixed:** a malformed `listener` now drops only that field.
- **Left for T6:**
  - the mock channel needs a feed topic so the channel screen can be smoke-checked;
  - nit 1: counts use the feed row's `subscriberCount`;
  - nit 2: Mute and Search are live before the feed row loads;
  - nit 3: `WEB_HOST` is duplicated in `contacts.tsx`. Move it to one shared constant.

