---
id: T-0188
title: Mobile: owner integrations (Telegram bot, email, voice transcription)
status: planned
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
2. `apps/mobile/src/app/settings/integrations.tsx`: three cards (Telegram bot, Email, Voice transcription), each with its configured state, Save and Remove (confirm before Remove). Secret fields are secure text inputs cleared after a successful save. Follow the design brief `docs/design/briefs/T-0188-integrations.md` exactly for layout, sizes, icons and copy. Row `{ id: 'integrations', title: 'Integrations', subtitle: 'Telegram, email and transcription for this server.', icon: 'integrations', href: '/settings/integrations' }` in `settings-items.ts`, and `integrations: Plug` (lucide `Plug`) in `HUB_ICONS`. If the status call answers 404, the screen shows only the sentence 'Only the server owner can change these settings.' and no cards.
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
- The owner can save and remove the Telegram token, email settings and transcription endpoint from the phone.
- A non-owner who opens the page sees only the owner sentence; no secret is ever shown back or logged.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
The server-side transcription feature itself (T-0170), the first-run setup page.

---

## Report (written by the worker when done)

## Review (written by Claude)
