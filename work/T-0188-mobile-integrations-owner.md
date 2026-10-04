---
id: T-0188
title: Mobile: owner integrations (Telegram bot, email, voice transcription)
status: merged
milestone: M5
branch: task/T-0188-mobile-integrations-owner
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0188: Mobile: owner integrations (Telegram bot, email, voice transcription)

## Spec (written by Claude, do not edit)

### Why
Web has an owner-only Integrations page. The owner cannot configure Telegram, email or the transcription endpoint from the phone. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/IntegrationsPage.tsx` (597 lines), client functions in `apps/web/src/lib/api.ts`: `getIntegrationsStatus()` (~1666), `saveTelegramBotToken(botToken)` (~1670), `removeTelegramBotToken()`, `saveEmailSettings(input)` (~1689), `getVoiceTranscriptionStatus()` (~1712), `saveVoiceTranscriptionSettings(...)` (~1724), `removeVoiceTranscriptionSettings()` (~1741).
- Server: `apps/server/src/integrations/routes.ts`, `apps/server/src/voice-transcription/`. The server answers every non-owner with the same 404 as an unknown route (`apps/server/src/integrations/routes.ts` lines 2-13, `notFound()` at line 134). Mobile has no "am I the owner" check (web has `apps/web/src/lib/useIsServerOwner.ts`, mobile has nothing like it), so the settings row is always shown and the SCREEN handles the 404. Secrets (bot token, SMTP password, API key) are write-only: never shown again, never logged, never stored on the phone.
- The phone now transcribes voice notes on the device (Whistle, T-0179). The web card for the server transcription endpoint is still part of parity: add it, with one line of help that on-device transcription needs no setup.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; error text shown to the user is always a fixed plain sentence, never the server's raw message; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes, keys or message text.
- Settings registry (checked 2026-10-04): `apps/mobile/src/lib/settings-items.ts` is one array `SETTINGS_ITEMS = [ ... ] as const satisfies readonly SettingsItemShape[]` (lines 23-66); each row is `{ id, title, subtitle, icon, href }`, and the icon and route types are derived from the rows, so you never edit a type there. Add your row as the LAST element INSIDE the array, before the closing line. Every row's `icon` needs an entry in `HUB_ICONS` in `apps/mobile/src/app/settings/index.tsx` (line 39), or `pnpm typecheck` fails. There is no `ownerOnly` field.

### What to build
1. `apps/mobile/src/lib/integrations-api.ts` (+ tests): the functions above, zod-validated, `status` and `code` on errors.
2. `apps/mobile/src/app/settings/integrations.tsx`: three cards in the web order (Email, Voice transcription, Telegram bot), each with its configured state and Save; Telegram and Voice also have Remove (confirm before Remove); Email has no Remove, as on web. Secret fields are secure text inputs cleared after a successful save. Follow the design brief `docs/design/briefs/T-0188-integrations.md` exactly for layout, sizes, icons and copy. Row `{ id: 'integrations', title: 'Integrations', subtitle: 'Telegram, email and transcription for this server.', icon: 'integrations', href: '/settings/integrations' }` in `settings-items.ts`, and `integrations: Plug` (lucide `Plug`) in `HUB_ICONS`. If the status call answers 404, the screen shows only the sentence 'Only the server owner can change these settings.' and no cards.
3. Tests (Vitest): API, each card's states, the 404 owner gate, a test that a saved secret is absent from the rendered tree and from every logged call.

### Read first
`AGENTS.md`, `docs/design/briefs/T-0188-integrations.md` (the design brief: follow it), `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), `apps/mobile/src/lib/settings-items.ts` (add your row), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/integrations-api.ts` and tests, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/components/integrations/**`, `apps/mobile/src/lib/settings-items.ts` (one row), `apps/mobile/src/app/settings/index.tsx` (one `HUB_ICONS` entry and its import), `work/T-0188-mobile-integrations-owner.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 integrations settings
pnpm gate
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- The owner can save and remove the Telegram token and the transcription endpoint, and save the email settings, from the phone.
- A non-owner who opens the page sees only the owner sentence; no secret is ever shown back or logged.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
The server-side transcription feature itself (T-0170), the first-run setup page.

---

## Report (written by the worker when done)

Built the owner Integrations settings page on mobile, mirroring web's
`IntegrationsPage` (Email, Voice transcription, Telegram bot, in that order).

What I did:
- `apps/mobile/src/lib/integrations-api.ts` (new): `createIntegrationsApi`
  with the seven web client functions (`getIntegrationsStatus`,
  `saveTelegramBotToken`, `removeTelegramBotToken`, `saveEmailSettings`,
  `getVoiceTranscriptionStatus`, `saveVoiceTranscriptionSettings`,
  `removeVoiceTranscriptionSettings`), zod-validated, `IntegrationsApiError`
  carrying `status` and `code`. Secrets travel only in PUT bodies and are
  never stored; no request logs them.
- `apps/mobile/src/app/settings/integrations.tsx` (new): `RequireAuth` +
  `SettingsScreenShell` screen. Loading / owner-404 / error+Retry states per
  the brief. Cards: Email (From prefilled, not a secret; new Resend key with
  eye toggle; no Remove; `Saved. A test email is on its way to your address.`
  / `Sending a test email…`), Voice (Base URL, Model default `whisper-1`, API
  key, required on-device help line, `Saved. Transcripts are on.`), Telegram
  (Bot token, env shortens pill to `Set by environment` and replaces
  fields/buttons, `Saved. Imports are on.`). Remove on Telegram and Voice
  goes through the machines-style confirm modal. Secret fields clear and hide
  after a successful save; saved lines appear only after the status reload
  succeeds. All user errors are fixed sentences via `describeIntegrationsError`.
- `apps/mobile/src/components/integrations/`: `use-integrations-api.ts`
  (real API handle, no mock scenario — owner settings always hit the server),
  `errors.ts` (error-code mapping mirroring web), plus tests:
  `integrations-api.test.ts` (16 API tests incl. 404 owner gate,
  network_error, unauthorized, invalid_response), `errors.test.ts` (10 code
  mappings incl. fallback never leaking server text),
  `integrations-screen.test.tsx` (8 screen tests: loading, 404 owner gate
  with no cards and no Retry, error+Retry, card order, help lines, saved
  lines, configured Remove + both confirm dialogs, env notices, secret absent
  from the rendered tree).
- Registry: one row appended last in `settings-items.ts` (id `integrations`,
  subtitle `Telegram, email and transcription for this server.`,
  href `/settings/integrations`); `integrations: Plug` added to `HUB_ICONS`
  plus the `Plug` import in `app/settings/index.tsx`. No other rows touched.
- Deviation: the API test lives in `components/integrations/` instead of next
  to the module, because the gate's scope matcher covers `integrations-api.ts`
  itself but not the sibling `.test.ts`; both are in the Allowed files.

Files changed:
- new: `apps/mobile/src/lib/integrations-api.ts`,
  `apps/mobile/src/app/settings/integrations.tsx`,
  `apps/mobile/src/components/integrations/use-integrations-api.ts`,
  `apps/mobile/src/components/integrations/errors.ts`,
  `apps/mobile/src/components/integrations/integrations-api.test.ts`,
  `apps/mobile/src/components/integrations/errors.test.ts`,
  `apps/mobile/src/components/integrations/integrations-screen.test.tsx`
- edited: `apps/mobile/src/lib/settings-items.ts` (one row),
  `apps/mobile/src/app/settings/index.tsx` (one HUB_ICONS entry + import),
  this task file.

Commands (real results):
- `pnpm install --frozen-lockfile`: ok (8s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 integrations settings`:
  8 files, 91 passed.
- `pnpm format:check`: pass (after `pnpm format` fixed 4 of my files).
- `pnpm lint`: pass. `pnpm typecheck`: 11 tasks ok.
- `pnpm gate`: GATE PASS, "scope: every changed file is inside the Allowed
  files" (first run listed `lib/integrations-api.test.ts` outside scope, so
  I moved it to `components/integrations/`; second run is clean).
- Note: `npx prettier --write` was rejected (needs lead approval); used the
  repo's `pnpm format` instead.

Security checklist: no secret reaches logs, errors, or the rendered tree
(tested); deletes are owner-scoped server side (no change); permission check
is the owner's 404 which the screen gates on; audit entries are server side
(ids only, no text). No new dependency, no server change, no emoji.

The lead tests on the emulator and the phone.

### Round 2 (prereview follow-up)

Fixed all 5 findings (0 must-fix, 2 should-fix, 3 nits), one commit each:
- Finding 1 (should-fix, `5a5aaaf`): extracted the card save/remove chains
  into `components/integrations/card-save.ts`
  (`saveEmailCard`/`saveVoiceCard`/`saveTelegramCard`/`removeIntegrationCard`)
  following the `save-connection.ts` pattern, with `card-save.test.ts`
  executing the real chains: saved flag only after the reload, secret cleared
  on success and kept on failure, and every test asserts the typed secret is
  absent from all logged calls of the spied API.
- Finding 2 (should-fix, `e58300d`): the three cards now call those helpers
  (the shipped code is the tested code), and the screen-test `useState` mock
  forces only the page status (`initial === 'loading'`), so prefilled field
  text renders its real value. Added a regression test asserting the From and
  Base URL inputs render the saved values and never `value="ready"`.
- Finding 3 (nit, `d0deb3e`): dropped the discarded `useGlobalSearchParams()`
  call in `use-integrations-api.ts`.
- Finding 4 (nit): folded into the `e58300d` rewire — opening either Remove
  dialog now clears `confirmError` via `openConfirm`, so a failed Remove,
  Cancel, reopen no longer shows the stale error. Same file, lines already
  touched.
- Finding 5 (nit, `a146c7e`): added the missing `getVoiceTranscriptionStatus`
  API test (URL + GET + `{ enabled }` parse).

Tests added: `card-save.test.ts` (9), prefill regression (1), voice status
API (1). `integrations`+`settings` suites: 9 files, 102 passed.
`pnpm gate`: GATE PASS — install/format/lint/typecheck/tests all pass; the
only file outside Allowed files is the untracked `PREREVIEW.md` review
artifact itself, which was never staged or committed.
No disagreements: all findings were correct.

### Round 3 (prereview follow-up)

Fixed both should-fix findings, one commit each:
- Finding 1 (`74737c9f`): replaced the vacuous fake-log assertions in
  `card-save.test.ts` with real `vi.spyOn(console, …)` spies (log/info/
  debug/warn/error) and an `expectNoSecretLogged` assertion per save test.
  Verified the test is not theater: temporarily adding
  `console.log(input.token)` to `saveTelegramCard` failed exactly the
  telegram save test (1 failed, 8 passed); removed the plant, 9 passed.
- Finding 2 (`eb67f1d5`): the three cards now apply
  `setKey`/`setToken(outcome.secretAfterSave)` unconditionally, so a
  save-ok/reload-fail still clears the secret field (only the saved line and
  the status update stay gated on the reload). Added the exact scenario test:
  save succeeds + reload fails → `secretAfterSave === ''`, `saved === false`.

Tests added: 1 (save-ok/reload-fail clears the secret). `integrations`+
`settings` suites: 9 files, 103 passed.
`pnpm gate`: GATE PASS — all checks pass; the only file outside Allowed
files is the untracked `PREREVIEW.md` review artifact itself, never staged
or committed. No disagreements: both findings were correct.

## Review (written by Claude)

**Verdict:** Approved after two automatic rounds. New Integrations screen in mobile settings with the Email, Voice and Telegram cards from the brief; secrets travel only in PUT bodies and clear after a save; every error is a fixed sentence; a 404 shows the owner sentence with no cards. Pre-review clean after the rounds. Emulator (`pnpm phone:smoke`): `/settings` shows the Integrations row with a plug icon, `/settings/integrations` shows the lock and "Only the server owner can change these settings." for the non-owner test user; no crash. The owner view with the cards could not be reached on the emulator (the test user is not the owner) and is covered by the screen tests. Accepted nit: when the save succeeds but the status reload fails, the eye toggle stays in "revealed" over an empty field (cosmetic, no secret shown).
