# Design brief T-0207: Import from Telegram (mobile)

Scope: one entry on the Stickers screen and one bottom sheet that imports a Telegram sticker pack as a new private pack. Builds on T-0187 (`apps/mobile/src/app/settings/stickers.tsx`) and T-0191 (editor route `/settings/sticker-pack?id=...`). Web source for behaviour and copy: `apps/web/src/components/TelegramImportDialog.tsx`. Only existing tokens and classes, no literal hex. Lucide icons only, no emoji, no exclamation marks. Never use Telegram's logo or name as a brand mark: the text `Telegram` is fine, the lucide `Send` plane is not used.

## 1. Entry
- On the My packs tab, directly under the heading row (heading plus `New pack` from T-0191), a full-width outline row `h-11 flex-row items-center justify-center gap-2 rounded-xl border border-border-strong active:bg-surface-raised`: lucide `Download` size 16 in `ICON[scheme]` + text `Import from Telegram` `text-[15px] text-foreground`, role `button`, label `Import from Telegram`. Spacing: `gap-2` in the tab column. Shown in every My packs state (also empty, above the empty block).
- It stays visible when the server cannot import: tapping then opens the sheet in the not-set-up state (section 5), as web does. It is `disabled opacity-60` while another request runs (`busy`).
- Opening the sheet clears any earlier input, result and error.

## 2. Sheet frame
- `Modal` `transparent animationType="slide"`, backdrop `flex-1 justify-end bg-black/40`, a `KeyboardAvoidingView` (iOS `padding`) so the field stays above the keyboard. Sheet: `rounded-t-2xl bg-background px-4 pb-8 pt-3`, `max-h` 90 percent. A grabber `h-1 w-10 self-center rounded-full bg-border-strong` on top, `mb-3`. Tapping the backdrop or Android back closes it, except while busy (ignored).
- Header `flex-row items-start justify-between gap-2`: title `text-[18px] font-semibold text-foreground` (per state), and a 36x36 close button (`rounded-lg active:bg-surface-raised`), lucide `X` size 20, label `Close`. Close is `disabled opacity-60` while busy.

## 3. Form state (title `Import from Telegram`)
- Intro `mt-1 text-[14px] leading-5 text-muted-foreground`: `Paste a pack link (t.me/addstickers/NAME) or the pack name. Only static stickers are imported. Animated and video stickers are skipped.`
- Field label `Pack link or name` (`mt-3 text-[14px] font-medium text-foreground`), then a well field `h-11 rounded-xl px-3` (`style={well}`), `TextInput` `text-[15px] text-foreground`, placeholder `t.me/addstickers/FunCats`, `maxLength={512}`, `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="url"`, `returnKeyType="go"` (submits), `autoFocus`, label `Pack link or name`.
- Personal-use note (always shown, under the field): lucide `Info` size 14 + `text-[13px] text-muted-foreground`: `Imported packs are for personal use. The pack stays private and cannot be shared with the server. Its art belongs to its creators.`
- Error line (when set) above the buttons: `mt-2 text-[14px] text-danger`, role alert, fixed sentences from section 6, cleared when the next import starts.
- Buttons `mt-4 flex-row justify-end gap-2`: `Cancel` (`rounded-full px-4 py-2 text-[15px] text-muted-foreground`) and `Import` (`rounded-full bg-accent px-5 py-2 active:opacity-90`, `text-[15px] font-medium text-accent-foreground`). An empty field does not disable Import; it shows `Paste a pack link or name first.`

## 4. Busy and result states
- Busy: input and Cancel `disabled opacity-60`, Import reads `Importing…` (`disabled opacity-60`), and above the buttons `flex-row items-center gap-2`: `ActivityIndicator color={ACCENT[scheme]}` + `text-[13px] text-muted-foreground`: `This can take up to 30 seconds.` The sheet cannot be closed while busy. One request at a time (ref guard like `busyRef` in stickers.tsx).
- Result (title `Imported from Telegram: {pack title}`, title wraps up to 2 lines): a summary card `mt-3 gap-1.5 rounded-xl border border-border bg-surface p-3`:
  - Line 1 `text-[15px] text-foreground`: `{n} sticker added` / `{n} stickers added`.
  - If `skippedAnimated > 0`: `{n} animated sticker was skipped` / `{n} animated stickers were skipped` (`text-[14px] text-muted-foreground`).
  - If `skippedInvalid > 0`: `{n} file was skipped as invalid` / `{n} files were skipped as invalid` (same style).
  - If `partial`: `The import ran out of time. Run it again to fill in the rest.` (`text-[14px] text-muted-foreground`, lucide `Clock` size 14 on its left).
  - Last line `text-[13px] text-muted-foreground`: `Imported packs are for personal use. This pack stays private.`
- Result buttons `mt-4 flex-row justify-end gap-2`: when `partial`, outline pill `Import again` (`rounded-full border border-border-strong px-4 py-2`, `text-[15px] text-foreground`) that returns to the busy state with the same input; then `Done` (outline, closes) and filled `Open pack` (`rounded-full bg-accent px-5 py-2`). Without `partial`: `Done` and `Open pack`. `Open pack` closes the sheet and pushes `/settings/sticker-pack?id={result pack id}`. `Done` closes the sheet. Both reload the My packs list (the screen reloads on focus; on `Done` reload explicitly) so the new pack appears.

## 5. Special states (replace the form, same frame, one `Close` filled pill at the bottom right)
- Not set up (`import_unavailable`, HTTP 501): title `Telegram import is not set up`; body `text-[14px] text-muted-foreground`: `Telegram import is not set up on this server.` then `The server owner can turn it on in Settings > Integrations.` (Lead, verified: the app has no owner signal; Integrations only learns it from a 404. So everyone sees the same text and there is no button.)
- Token rejected (`token_invalid`, 409): title `The Telegram token was rejected`; body: `The Telegram token was rejected. The server owner needs to update it.` No button (same reason as above).
- Neither state closes the sheet by itself, and neither is an error line.

## 6. Exact error sentences (form error line, never server text)
- Empty field: `Paste a pack link or name first.`
- Invalid link or name (the app cannot parse it, or the server says it is invalid): `That does not look like a Telegram sticker pack link or name.`
- `pack_not_found`: `That Telegram sticker pack was not found.`
- `custom_emoji_unsupported`: `Custom emoji sets cannot be imported as sticker packs.`
- `try_later`: `Telegram is busy. Try again later.`
- Rate limit (HTTP 429, 3 imports per hour per person): `Too many imports. Try again in an hour.`
- `pack_limit`: `You have reached the limit of 100 packs.`
- Anything else, including no network: `The import failed. Try again.`
- `import_unavailable` and `token_invalid` use the states in section 5, not these lines.

## 7. Small touches
- Spacing: 12 between header and intro, 12 before the field, 16 before buttons; bottom padding 32 on the sheet (safe area).
- Labels on every control as listed; the result title is announced (role `header`); error lines role `alert`; busy line role `status`.
- Loading and error for the My packs list itself are unchanged from T-0187 (`Loading stickers…`, `Could not load your stickers.`); this sheet has no list.
- Not in this task: choosing a visibility for the imported pack, importing animated stickers, a history of imports.
