# Design brief T-0187: Settings > Stickers (mobile)

Scope: my packs (list, remove, reorder), discover (search, add, remove), favorites (remove). Not the pack editor, not the Telegram import. Web source: `apps/web/src/routes/StickersPage.tsx` (sections at lines 353, 473, 509, 589; reorder at 253-275). The app is dark only today, but use only tokens and classes below, never a literal hex, so a light theme works later.

## 1. Frame and hub row
- Wrap the page in `SettingsScreenShell` (`apps/mobile/src/components/settings/screen-shell.tsx:20-56`): title `Stickers`, subtitle `Your packs, shared packs and favorites.` Back is `router.back()`. No header action.
- Hub row (`settings-items.ts:21-27` pattern; row look is `settings/index.tsx:75-96`, do not restyle): id `stickers`, title `Stickers`, subtitle `Your packs, shared packs and favorites.`, icon id `stickers` mapped to lucide `Sticker` in `HUB_ICONS` (`settings/index.tsx:39-46`).
- Page body (inside the shell's `p-4`) is a `gap-4` column: tabs, then the active tab's content. Content cards are full width, so their left and right edges line up with the hub rows.

## 2. Tabs
A 3-tab segmented control, copied from `components/chat/folder-tabs.tsx:18-34` (well track `mb-2 flex-row gap-0.5 rounded-[10px] p-[3px]`, `style={[well, { borderColor: '#1a1a1a' }]}`; tab `h-[34px] flex-1 rounded-[7px]`; label `text-[13px] font-medium`, `text-foreground` when active, `text-muted-foreground` otherwise). Do not add the `mx-4` (the shell already pads). Labels: `My packs`, `Discover`, `Favorites`. No count pills. Roles: `tab`, `accessibilityState={{ selected }}`.
- PITFALL (RN 0.86 Android crash): the active tab swaps `style={segment}` for `undefined` (folder-tabs.tsx:33). Give each tab `key={`${tab}-${selected ? 'on' : 'off'}`}` so the view remounts when its gradient style changes.
- Remember the selected tab while the screen is open; start on `My packs`. Switching tabs keeps loaded data (no refetch). Discover loads the first time it opens.

## 3. Pack row (shared by all lists)
Card: `rounded-xl border border-border bg-surface px-3 py-2.5` (same as `machines.tsx:556`). Rows are separated by `gap-2`.
- Top line, `flex-row items-center gap-3`:
  - Thumbnail strip: up to 3 stickers, each a 36x36 tile `rounded-[10px] border border-border bg-surface-raised`, overlapped with `-ml-2` on the 2nd and 3rd (first has none), the first on top is not needed. Image inside is `width 28 height 28`, `resizeMode="contain"` (never cover: stickers are PNG or WebP, often transparent, and must not be cropped; the raised tile shows through the transparency). Build the image source exactly like `components/chat/sticker-panel.tsx:285-299` (`stickerImageSource`, `isPanelStickerUrl`). A pack with no stickers shows one 36x36 tile with lucide `Sticker` size 18, color `MUTED_FOREGROUND[scheme]`. Tiles are decorative: `accessibilityElementsHidden`.
  - Text column `min-w-0 flex-1`: title `text-[15px] font-medium text-foreground` (`numberOfLines={1}`), under it `text-[13px] text-muted-foreground`: `1 sticker` or `N stickers`.
  - Discover rows only: the action button sits at the far right, `shrink-0` (section 5).
- My packs rows add a second line (section 4). Keep the card's `gap-1`; the divider is `border-t border-divider pt-2 mt-2` (`border-divider` is used at `explore.tsx:184`).
- Pressed state: buttons use `active:opacity-90` (filled) or `active:bg-surface-raised` (outline), as in `machines.tsx:334,345`. The card itself is not tappable.
- Icons colored with the `ICON[scheme]` map (`lib/colors.ts`); an icon on a filled accent button uses `ACCENT_FOREGROUND` from `lib/depth.ts` (see `ais/index.tsx:199`), NOT `#fff` (white on the light accent is invisible, see the Add machine plus in `_settings_machines.png`).

## 4. My packs tab
- Section heading `My packs`, `text-[16px] font-semibold text-foreground` (`machines.tsx:359`), then the list in panel order (the order the chat panel shows). Show every pack on the panel in ONE list, yours and added ones, because reorder applies to the whole list.
- Second line of each row, `flex-row items-center justify-between`:
  - Left, reorder: two plain buttons 36x36, `items-center justify-center rounded-lg active:bg-surface-raised`, lucide `ChevronUp` and `ChevronDown` size 20, gap 4. Labels `Move {title} up` and `Move {title} down`. The first row's Up and the last row's Down are `disabled` with `opacity-40`. Hit slop 4. No handles, no drag.
  - Right: `Remove` outline pill `rounded-full border border-border-strong px-3 py-1`, text `text-[14px] text-foreground`, label `Remove {title}`. It opens the confirm (section 7).
- Reorder is optimistic: move the row at once, send the complete id list in the new order, and on failure put the old order back and show the error line.
- Empty (list is empty): centered block like `machines.tsx:297-313`, `items-center gap-3 pt-16`: lucide `Sticker` size 32 in `ICON[scheme]`, text `No packs on your panel yet. Look in Discover for shared packs to add.` (`px-4 text-center text-[15px] text-muted-foreground`), and a filled pill `Open Discover` (`rounded-full bg-accent px-5 py-2`, text `text-[15px] font-medium text-accent-foreground`) that switches to the Discover tab.

## 5. Discover tab
- Intro line `Find shared packs from anyone on this server and add them to your panel.` (`text-[14px] text-muted-foreground`).
- Search well, copied from `explore.tsx:198-212` (`h-10 flex-row items-center gap-2 rounded-xl px-3`, `style={well}`), but lucide `Search` size 16 with `color={MUTED_FOREGROUND[scheme]}` (not a hex), placeholder `Search shared packs`, `maxLength={60}`, `returnKeyType="search"`, search runs on submit (no debounce, no button, as web runs on submit). Label `Search sticker packs`. Empty submit lists the default packs.
- Rows per section 3. Action button: not on panel yet = filled pill `Add` (`rounded-full bg-accent px-3 py-1`, `text-[14px] font-medium text-accent-foreground`); already on panel = outline pill `Remove` (same classes as section 4). Labels `Add {title}`, `Remove {title}`.
- Loading (first open or a search): `items-center gap-3 pt-16` with `ActivityIndicator color={ACCENT[scheme]}` and `Searching…` (`text-[15px] text-muted-foreground`), like `explore.tsx:241-246`.
- Empty: `No shared packs found. Try another search.` centered, `px-6 pt-12`, `text-[15px] text-muted-foreground`.
- Error: `Could not load shared packs.` + Retry pill (section 8).

## 6. Favorites tab
- Heading `Favorites`. Grid of square tiles: `flex-row flex-wrap gap-2`; tile width = `Math.floor((windowWidth - 32 - 24) / 4)` (4 columns, from `useWindowDimensions`), height equal. Tile `rounded-[10px] border border-border bg-surface items-center justify-center p-1`, image fills the tile minus padding, `resizeMode="contain"`.
- Remove control: a 24x24 circle at `absolute right-0.5 top-0.5`, `rounded-full bg-black/70 items-center justify-center`, lucide `Star` size 12, `color` and `fill` both `FOREGROUND[scheme]`. `hitSlop={10}`, label `Remove favorite`. Tapping removes at once, no confirm (web does the same, line 613-621). Active: `active:opacity-70`.
- Empty: `No favorites yet. Starred stickers show up here.`, same empty style as Discover. Loading and error as section 8.

## 7. Confirm dialog (Remove a pack, from My packs or Discover)
Use the Modal from `machines.tsx:488-539` unchanged in structure (`bg-black/40` backdrop, `max-w-xs rounded-2xl bg-background p-4`, title `text-[16px] font-semibold`, body `mt-1 text-[14px] leading-5 text-muted-foreground`, buttons `mt-4 flex-row justify-end gap-2`).
- Title: `Remove this pack?`
- Body: `{title} leaves your sticker panel. You can add it again from Discover if it is still shared.`
- Buttons: `Cancel` (`rounded-full px-3 py-1.5`, muted text) and `Remove` (`rounded-full bg-destructive px-3 py-1.5`, `text-[14px] font-medium text-white`). While running: Remove reads `Removing…`, both buttons `disabled opacity-60`. On failure the modal stays open with `Could not remove the pack. Try again.` (`mt-2 text-[13px] text-danger`, role alert).

## 8. Load, error, busy
- First load (packs + favorites): `items-center gap-3 pt-16`, `ActivityIndicator color={ACCENT[scheme]}`, `Loading stickers…` (`machines.tsx:273-278`).
- Load error: `machines.tsx:280-295`: text `Could not load your stickers.` in `text-[15px] text-danger` (role alert) and the `Retry` pill with lucide `RefreshCw` size 16 (`rounded-full border border-border-strong px-4 py-2`, text `text-[15px] text-foreground`, label `Retry loading stickers`).
- Action error (add, reorder, favorite): one line above the active list, `text-[14px] text-danger`, role alert, fixed text only: `Could not add the pack. Try again.`, `Could not reorder your packs. Try again.`, `Could not remove the favorite. Try again.` Cleared when the next action starts.
- Busy: use the one-request-at-a-time guard of `machines.tsx:143-158` (a ref plus `busyId`). While any request runs, every Add, Remove, Move and star button on the screen is `disabled opacity-60`/`opacity-40` and ignores taps; the pressed row's Add reads `Adding…`. Tabs and search stay usable.

## 9. Small touches
- Spacing: tabs, then 16 (`gap-4`) to the content; 8 between rows; 12 between thumbs and text; bottom padding 32 comes from the shell.
- Long titles truncate (one line); counts never wrap.
- Accessibility labels on every control as listed; thumbnails hidden from screen readers.
- No emoji anywhere, no exclamation marks. Do not add Edit, Share, Delete, Create or Import (later task T-0191).
