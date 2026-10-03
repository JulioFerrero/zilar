# Design brief T-0188: Settings > Integrations (mobile, owner only)

Web source used: `apps/web/src/routes/IntegrationsPage.tsx` (page 59-158, Email card 160-289, Voice card 291-460, Telegram card 462-597). Mobile has no new features beyond it. The app is dark only today; use only the tokens and classes named here, no literal hex.

## 1. Frame and hub row
- `SettingsScreenShell` (`apps/mobile/src/components/settings/screen-shell.tsx:20-56`): title `Integrations`, subtitle `Telegram, email and transcription for this server.` No header action.
- Hub row: id `integrations`, title `Integrations`, subtitle `Telegram, email and transcription for this server.`, icon id `integrations` mapped to lucide `Plug` in `HUB_ICONS` (`settings/index.tsx:39-46`). The row is shown to everyone (there is no `ownerOnly`); the screen handles non-owners (section 2). Row look is `settings/index.tsx:75-96`, unchanged.
- Body: one `gap-4` column of cards (section gaps like `machines.tsx:272`). Card order as on web: Email, Voice transcription, Telegram bot.

## 2. Page states
- Loading: `items-center gap-3 pt-16`, `ActivityIndicator color={ACCENT[scheme]}`, `Loading integrations…` (`text-[15px] text-muted-foreground`), as `machines.tsx:273-278`.
- Not the owner (status call answers 404): centered `items-center gap-3 px-6 pt-16`: lucide `Lock` size 32 in `ICON[scheme]`, text `Only the server owner can change these settings.` (`text-center text-[15px] text-muted-foreground`). No Retry, no cards.
- Other load error: `machines.tsx:280-295`: `Could not load integrations.` (`text-[15px] text-danger`, role alert) and the `Retry` pill with lucide `RefreshCw` size 16 (`rounded-full border border-border-strong px-4 py-2`, label `Retry loading integrations`).

## 3. Card (the same frame for all three)
Container `gap-3 rounded-xl border border-border bg-surface p-4` (the form card at `connections.tsx:399`). Order inside:
1. Header row `flex-row items-center justify-between gap-2`: left lucide icon (size 20, `ICON[scheme]`) plus title `text-[16px] font-semibold text-foreground` (icons: `Send` Telegram, `Mail` Email, `Mic` Voice transcription); right a status pill `rounded-full bg-surface-raised px-2 py-0.5`, text `text-[12px] text-muted-foreground`: `Connected` or `Not set up`. Email may also read `Managed by environment`; Telegram `Connected (set by environment variable)` should shorten to `Set by environment`.
2. Description `text-[14px] leading-5 text-muted-foreground`.
3. Optional help `text-[13px] leading-5 text-muted-foreground`.
4. Fields, then error or saved line, then the button row.

Fields (copy `connections.tsx:446-485`): label `text-[14px] font-medium text-foreground`, `gap-1` between label and input; input `rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground`, `placeholderTextColor={MUTED_FOREGROUND[scheme]}`. Secret fields (token, Resend key, API key): `secureTextEntry={!show}`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="off"`, plus the eye toggle at the right of the input (`connections.tsx:462-470`: `rounded-full p-2 active:bg-surface-raised`, lucide `Eye`/`EyeOff` size 16, labels `Show key` / `Hide key`; for the bot token `Show token` / `Hide token`). Secret value is cleared and the eye reset to hidden after a successful save. A secret is never prefilled and never shown back.

Buttons row `flex-row items-center gap-2`: `Save` filled pill `rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60`, text `text-[15px] font-medium text-accent-foreground` (`connections.tsx:495-505`); `Remove` outline pill `rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60`, text `text-[15px] text-foreground`, shown only when configured. Saved line: `text-[14px] text-online` (`connections.tsx:293`). Error line: `text-[14px] text-danger`, role alert. Use plain class buttons; if you use `primaryKey`, `segment`, `iconKey` or `raisedPill` styles for any element that can switch to another style (for example busy), give it a `key` that includes the state (RN 0.86 Android crashes when a live view swaps one gradient style for another).

Busy: while a card saves or removes, that card's inputs are `editable={false}`, both its buttons `disabled opacity-60`, and the eye toggles stay usable. Other cards stay usable. After Save or Remove, reload the status (web does this, lines 189 and 347) and show the saved line only after the reload succeeds.

## 4. Telegram bot card
- Description: `A bot token lets people import public sticker packs into their own private packs.`
- Help: `Open @BotFather in Telegram, send /newbot, and copy the token it gives you.`
- Field `Bot token`, placeholder `123456:ABC-…`, `maxLength={256}`.
- Set by environment variable: replace the field and buttons with `The token is set by environment variable. Remove it there to use a stored one.` (`text-[14px] text-muted-foreground`).
- Empty token on Save: `Paste the bot token first.`
- Busy label `Checking…`. Saved: `Saved. Imports are on.`

## 5. Email card
- Description: `The sender on sign-in emails.` and, when known, a second line `Now: {from}` (`text-[13px] text-muted-foreground`, selectable).
- Fields: `From address` (placeholder `Zilar <no-reply@mail.example.com>`, `maxLength={320}`, `keyboardType="email-address"`, prefilled with the saved sender, it is not a secret); `New Resend API key` (placeholder `re_…`, `maxLength={256}`, secret) with help below `Leave empty to keep the current key.`
- Help under From: `Use an address on a domain you verified in Resend.`
- Managed by environment: replace fields with `Email is managed by environment variables on this server. Change it there, not here.`
- Empty From: `Enter the sender address first.`
- No Remove button (the web card has none). Busy label `Sending a test email…`. Saved: `Saved. A test email is on its way to your address.`

## 6. Voice transcription card
- Description: `Adds a Show transcript control under voice messages.`
- Help (the one required line): `Transcription on this phone needs no setup. This endpoint adds server transcripts.`
- Fields: `Base URL` (placeholder `https://api.openai.com/v1`, `maxLength={512}`, `keyboardType="url"`, `autoCapitalize="none"`); `Model` (placeholder `whisper-1`, `maxLength={128}`, default `whisper-1` when empty); `API key` (placeholder `sk-…`, `maxLength={512}`, secret) with help `Optional. Leave empty for a self-hosted server without one. The key is never shown again after saving.`
- Second help under the fields: `Any OpenAI-compatible transcription endpoint works.`
- Empty Base URL: `Enter the endpoint base URL first.`
- Busy label `Checking…`. Saved: `Saved. Transcripts are on.`

## 7. Confirm dialog for Remove (Telegram and Voice)
Modal exactly as `machines.tsx:488-539` (`bg-black/40`, `max-w-xs rounded-2xl bg-background p-4`, title 16/semibold, body 14 muted, buttons right-aligned `gap-2`, `Cancel` muted text, destructive `Remove` with `bg-destructive`, text `text-[14px] font-medium text-white`, `Removing…` while running, both disabled `opacity-60`). Failure keeps it open with the card's fixed error sentence in `text-[13px] text-danger`.
- Telegram title `Remove the Telegram token?`, body `People can no longer import sticker packs from Telegram until you add a token again.`
- Voice title `Remove the transcription endpoint?`, body `The Show transcript control stops working until you save an endpoint again. Transcription on this phone is not affected.`

## 8. Error sentences (fixed, never the server text)
By error code: `invalid_token` `Telegram rejected the bot token. Check it and try again.`; `mail_send_failed` `The test email could not be sent. Check the Resend key and the sender address.`; `managed_by_environment` `This is managed by environment variables on this server.`; `endpoint_unreachable` `The transcription endpoint could not be reached. Check the URL.`; `endpoint_rejected` `The transcription endpoint rejected the test request. Check the URL, key and model.`; `rate_limited` `Too many tries. Wait a little and try again.`; `network_error` `Could not reach the server.`; anything else `Could not save. Try again.` (Remove: `Could not remove it. Try again.`).

## 9. Small touches
- Keyboard: the shell already handles insets and tap-through (`screen-shell.tsx:44-50`); set `returnKeyType="next"` between fields and `done` on the last.
- Inputs use `maxLength` as listed, labels sit directly above inputs, 12 between fields (`gap-3`).
- No emoji, no exclamation marks. Nothing secret appears in any text, label or log.
