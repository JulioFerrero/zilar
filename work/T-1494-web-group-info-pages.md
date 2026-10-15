---
id: T-1494
title: "Web group info, step 1 (approved canvas): a root page with picture, count, Mute/Search/Add keys and grouped rows that open subpages holding today's sections; one shared PanelKey that ContactPanel uses too"
status: merged
milestone: M5
branch: task/T-1494-web-group-info-pages
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1494: Web group info as a root page with subpages

## Spec (written by Claude, do not edit)

### Why
Julio approved the Group info canvas on 2026-10-15. The boards are in `docs/design/mockups/group-info/`; read `README.md` there, then `Main.dc.html` and `WebMembers.dc.html`.

Today `apps/web/src/components/GroupPanel.tsx` (335 lines) stacks 14 sections in one scroll. The design turns it into a root page whose rows open subpages, and each subpage holds one of today's sections unchanged.

This is **step 1**. Step 2 (a later task) moves Leave and Delete, adds More, and redraws the member rows. Here, `GroupMembersSection` stays as it is.

### Facts (the lead read them on main, 2026-10-15)
- **`GroupPanel.tsx`:**
  - data and state: `:41-148`;
  - the header: `:152-173` (avatar 44, title, count, and a ghost close `Button`);
  - `memberCount` is already `info.members.length + info.ais.length` (`:47-48`).
- **The sections it renders, with their visibility** (`isManager` is owner or admin; `isOwner` is the owner only):
  - every member: `GroupMembersSection` (`:189-195`), `GroupAiSection` with `AiMemoryDialog` (`:212-233`), `ToolsSection` and `RoutinesSection` (`:247-256`), `PinsSection` (`:258-261`, whose `onOpen` calls `storeApi.getState().setPinsPanel(chat.id)`), and the error `FieldError` (`:320`);
  - managers: `GroupPictureSection` (`:181-188`), `GroupRolesSection` (`:199-210`), `ActivitySection` (`:239`), `AlwaysAllowedList` (`:243`), `InviteLinksSection` (`:265-275`), `GroupTopicSetting` (`:279-281`), `GroupListenerSetting` (`:285-292`), the background `ListRow` (`:296-305`) and `ChatBackgroundDialog` (`:322-329`);
  - the owner: `VisibilitySection` (`:310-318`).
- **Data the root can count:**
  - members: `memberCount`;
  - AIs: `info.ais.length`;
  - invite links: `links.length` (`:66`, managers);
  - pins: `useChatSelector((s) => s.pinsByChat[chat.id]?.length ?? 0)`, as at `PinsPanel.tsx:226`.
  - Tools, routines, activity and always-allowed are loaded inside their own sections, so their rows show no number.
- **Kit:**
  - `ui/icon-button.tsx`: `IconButton`, 36 px with a 10 px radius, the `key-icon` look;
  - `ui/list-row.tsx`: `ListRow` with `icon`, `title`, `trailing`, `chevron`, `onClick`, `danger` and `ariaLabel` (a 32 px key tile);
  - `ui/menu.tsx`: `Menu`.
- **The grouped-list container:** `ContactPanel.tsx:255` uses `divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface`.
- **`ContactPanel.tsx`:**
  - its own key, `ActionButton` (`:43-69`), is a 48 px round tile with a label, used at `:244-251` (Message, Mute/Unmute, Search);
  - mute is `useAction((next) => … storeApi.getState().setMuted(chat.id, next ? 'forever' : null))` (`:134-139`), and `muted = chat.muted === true` (`:133`).
- **`apps/web/src/routes/ChatView.tsx`** (343 lines):
  - `GroupPanel` mounts at `:305-307`;
  - `ContactPanel` gets `onSearch` (`setPanel(undefined); startChatSearch();`) and `onOpenMedia` (`setPanel(undefined); setMediaOpen(true);`) at `:318-331`.
- **`GroupMembersSection.tsx`** (364 lines): its add picker is `const [pickerOpen, setPickerOpen] = useState(false)` (`:43`). The Add members button shows for `isManager && addable.length > 0` (`:221-233`).

### What to build
1. **New `apps/web/src/components/ui/panel-key.tsx`:** `PanelKey({ label, icon, onClick, disabled })`.
   - It is an `IconButton` (36 px) with `aria-label={label}`, holding the lucide icon at `size-[18px]`.
   - Under it sits the label in `text-[12px] text-muted-foreground`, in a 64 px wide column with `gap-1.5`.
   - Add `panel-key.fixture.tsx` modelled on `icon-button.fixture.tsx`.
2. **`ContactPanel.tsx`:** delete `ActionButton` and use `PanelKey` for Message, Mute/Unmute and Search, with the same handlers. Nothing else changes there.
3. **New `apps/web/src/components/group-info/GroupInfoRoot.tsx`,** the root page, drawn like `Main.dc.html`:
   - **Header:**
     - a close `IconButton` (X, `aria-label="Close group info"`) at the top right;
     - centred under it, `EntityAvatar` size 84, the name (20 px semibold) and `{memberCount} members` (13 px muted; "1 member" when one).
   - **A row of `PanelKey`s, centred:**
     - Mute/Unmute (the `ContactPanel` mute pattern);
     - Search (`onSearch`);
     - Add, for managers only: it opens the Members page with the picker open.
   - **Three grouped lists** (the container above, `gap-2.5` between groups). Each row is a `ListRow` with `chevron`, an icon, and a count in `trailing` as mono `text-[12px] text-muted-foreground`:
     - **People:**
       - Members (Users icon; `memberCount`);
       - AIs (Bot; `info.ais.length`);
       - Invite links (Link; `links.length`), for managers only.
     - **Content:**
       - Shared media (Image; it calls `onOpenMedia`);
       - Pinned messages (Pin; the pins count; it calls `setPinsPanel(chat.id)`);
       - Tools and routines (Wrench);
       - Activity (Activity), for managers only;
       - Always allowed (ShieldCheck), for managers only.
     - **Settings:** Settings (Settings icon), for managers only.
4. **New `apps/web/src/components/group-info/GroupInfoPage.tsx`,** the subpage shell:
   - a header with a back `IconButton` (ChevronLeft, `aria-label="Back to group info"`), the page title (16 px semibold), and the close `IconButton`;
   - its children scroll below, with `p-4` and `gap-4`.
5. **`GroupPanel.tsx`:** keep every hook and state. Add `const [page, setPage] = useState<GroupInfoPageId>('root')`, and render either `GroupInfoRoot` or one `GroupInfoPage` holding today's sections, unchanged and with the same visibility:
   - **members:** `GroupMembersSection`, then `GroupRolesSection` for managers;
   - **ais:** `GroupAiSection`, `AiMemoryDialog` and the error `FieldError`;
   - **links:** `InviteLinksSection`;
   - **tools:** `ToolsSection` and `RoutinesSection`;
   - **activity:** `ActivitySection`;
   - **allowed:** `AlwaysAllowedList`;
   - **settings:** `GroupPictureSection`, `GroupTopicSetting`, `GroupListenerSetting`, the background row with `ChatBackgroundDialog`, and `VisibilitySection` (owner).

   `GroupPanel` gains `onSearch` and `onOpenMedia` props, wired in `ChatView.tsx` exactly like `ContactPanel`'s (`:322-331`). If `GroupPanel.tsx` would pass 400 lines, move the page switch into `group-info/GroupInfoPages.tsx`.
6. **`GroupMembersSection.tsx`:** add an optional prop `openPickerOnMount?: boolean` that seeds `pickerOpen`. The root's Add key passes it. Nothing else changes in that file.
7. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/web/src/components/ui/panel-key.tsx`
- `apps/web/src/components/ui/panel-key.fixture.tsx`
- `apps/web/src/components/ContactPanel.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/group-info/GroupInfoPage.tsx`
- `apps/web/src/components/group-info/GroupInfoPages.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/GroupMembersSection.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `docs/design/mockups/group-info/README.md`
- `docs/design/mockups/group-info/Main.dc.html`
- `docs/design/mockups/group-info/WebMembers.dc.html`
- `docs/design/mockups/group-info/Phone.dc.html`
- `docs/design/mockups/group-info/WebChannel.dc.html`
- `docs/design/mockups/group-info/WebChannelSubscribers.dc.html`
- `work/T-1494-web-group-info-pages.md`

(The lead commits the mockups folder on this branch. Don't edit those files.)

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead, headless web `?mock=1` at 1280 and 390, Dev team:**
  - the root matches `Main.dc.html`, except that it has no More key and no Leave row yet;
  - every row opens its page, Back returns to the root, and Close closes;
  - Add opens Members with the picker open;
  - Shared media opens the media panel, and Pinned opens the pins panel;
  - the contact panel's keys are the new 36 px keys.
- No console errors.

---

## Report (written by the worker when done)

### What I did

- **New `apps/web/src/components/ui/panel-key.tsx`:** `PanelKey({ label, icon, onClick, disabled })` — a 36 px `IconButton` with `aria-label={label}` holding the lucide icon at `size-[18px]`, and the label in `text-[12px] text-muted-foreground` under it, in a 64 px column with `gap-1.5`. Fixture `panel-key.fixture.tsx` modelled on `icon-button.fixture.tsx`.
- **`ContactPanel.tsx`:** deleted the local `ActionButton` and switched Message / Mute-Unmute / Search to `PanelKey` with the same handlers and the same `muteBusy` disabling. Nothing else changed.
- **New `apps/web/src/components/group-info/GroupInfoRoot.tsx`:** the root page — top-right close key, centred avatar (84 px), name (20 px semibold) and `{memberCount} members` ("1 member" when one), the centred Mute / Search / Add keys (`Add` for managers only), then three grouped lists using the `ContactPanel` container: People (Members `Users`, AIs `Bot`, Invite links `Link` for managers), Content (Shared media → `onOpenMedia`, Pinned messages `Pin` → `setPinsPanel(chat.id)`, Tools and routines `Wrench`, Activity `Activity` and Always allowed `ShieldCheck` for managers) and Settings (`Settings` icon, managers only). Counts render in mono `text-[12px]`. It also exports `GroupInfoPageId` and `GROUP_INFO_TITLES`, and reads the pins count with the same selector as `PinsPanel.tsx:226`.
- **New `apps/web/src/components/group-info/GroupInfoPage.tsx`:** the subpage shell — back `IconButton` (ChevronLeft, `aria-label="Back to group info"`), the title (16 px semibold), the close key, and the children scrolling below with `p-4` and `gap-4`.
- **`GroupPanel.tsx`:** kept every hook and every piece of state; added `page` and `pickerOnMount`; it now renders `GroupInfoRoot` or one `GroupInfoPage` holding today's sections, unchanged and with the same visibility (members + Roles for managers; AIs + memory dialog + error; invite links; tools + routines; activity; always allowed; settings = picture, topics, AI listener, background row + dialog, visibility for the owner). `GroupPanel` gained `onSearch` and `onOpenMedia`.
- **`GroupMembersSection.tsx`:** added the optional `openPickerOnMount?: boolean`, which seeds `pickerOpen`. Nothing else changed.
- **`ChatView.tsx`:** wired `GroupPanel`'s `onSearch` (`setPanel(undefined); startChatSearch();`) and `onOpenMedia` (`setPanel(undefined); setMediaOpen(true);`) exactly like `ContactPanel`'s, plus a per-chat `key` so the page state resets when the chat changes.
- **Did not create `group-info/GroupInfoPages.tsx`:** spec item 5 asks for it only if `GroupPanel.tsx` would pass 400 lines; it ends at 369, so the page switch stays in `GroupPanel`.

### Checks run

- `pnpm install` (repo root): done, 10.6s.
- `pnpm gate` (repo root), first run: **GATE FAIL** — `FAIL format`, only `apps/web/src/components/group-info/GroupInfoRoot.tsx` flagged. I ran `pnpm exec prettier --write` on the eight files I touched (not the whole repo), then re-ran.
- `pnpm gate` (repo root), final run:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 15 changed files include the seven `docs/design/mockups/group-info/*` files the lead committed on this branch; every one is inside Allowed files.
- No single test files were run: this is UI-only (spec item 7 says no tests), and the gate itself reported no nearby test files for `@zilar/web`.

### Notes for the lead

- **`PinsSection` is gone from `GroupPanel`.** Spec item 5's page list has no pins page and item 3 makes the Pinned messages row call `setPinsPanel(chat.id)` directly, so the old inline section would have been dead code. The `PinsPanel` overlay is a superset of it.
- **Loading state:** `GroupInfoRoot` renders while `info` is still undefined (member count falls back to `chat.memberCount ?? 0`; no Invite/Add keys yet), and the `StateMessage kind="loading"` now shows inside a subpage whose data has not arrived. Navigating can only happen from the root, so in practice the root is shown until `info` loads.
- **Mute failure:** the root shows a fixed-sentence alert under the keys (`Could not update notifications. Try again.`), the `ContactPanel` pattern.
- **The `group:` key on `GroupPanel` in `ChatView.tsx`** is not written out in the spec; I added it so switching chats resets `page`/`pickerOnMount`. Say the word if you want it removed.
- Rows whose count is not loaded show no number (Tools, routines, activity, always allowed), as the README asks.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged. The pre-review packet was clean (0 of everything) for head `6d831d5a9`. The worker's notes are all fine: `PinsPanel` replaces the inline pins, and the `group:` key resets the page when the chat changes.

**Headless web `?mock=1`, Dev team › General (`?panel=group`):**
- **The root page matches `Main.dc.html`** at 1280 and at 390 px:
  - the picture, "Dev team", "6 members";
  - Mute, Search and Add as 36 px keys;
  - People: Members 6, AIs 2, Invite links 1;
  - Content: Shared media, Pinned messages 0, Tools and routines, Activity, Always allowed;
  - Settings.
  - At 390 px there is no horizontal overflow.
- **Every row opens its page with the right heading:** Members, AIs, Invite links, Tools and routines, Activity, Always allowed, Settings. Back returns to the root.
- **Add** opens Members with the "Add members" picker open. Escape closes the picker, and Back is still there.
- **Shared media** opens "Media, files and links", and **Pinned messages** opens the pins panel.
- **Close** closes the panel.
- **Contact panel (Marta):** Message, Mute and Search are 36×36 with a 10 px radius.
- No console errors.

**Noted for step 2 (older than this task):** on the Members page, the second member row shows its role tags but no name. That row comes from the unchanged member section, which step 2 restyles.

