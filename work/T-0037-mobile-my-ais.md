---
id: T-0037
title: Mobile — My AIs list and Create-AI wizard (same /api/ais contract as the web)
status: in-progress
milestone: M2
branch: task/T-0037-mobile-my-ais
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0032]
estimate: 2 days
---

# T-0037: My AIs on the iPhone

## Spec (written by Claude, do not edit)

### Goal

On the web, a person can create, list, edit and delete their AIs (T-0032). **The mobile app can't do any of it yet.** Bring the same two screens to the Expo app, against the same live API: a **My AIs** list and a **Create an AI** wizard. It must feel native (Telegram-like, per `docs/design/ui-style.md`), not like a web page squeezed onto a phone.

You have vision. Check your own screenshots of every screen and state, and fix what looks wrong before you report.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0032-create-ai-wizard.md`, the whole thing, including the Review. The **API contract**, the error codes and the wizard steps are identical here. Don't redesign them.
- `apps/web/src/routes/CreateAiPage.tsx`, `AisPage.tsx` and `apps/web/src/components/ais/**`: the behaviour to match. That includes limit validation, the persona prefill (and when to leave `persona` out), double-submit protection, error mapping, and model suggestions keyed by the connection's **provider**, never its id. That last one was T-0032's bug.
- `apps/mobile/README.md`: `boot:ios`, `EXPO_PUBLIC_GALENA_MOCK` and `EXPO_PUBLIC_GALENA_API_URL`
- `apps/mobile/src/app/index.tsx` (the chat list screen), `src/app/_layout.tsx`, `src/lib/chat-api.ts` (its bearer-token `request` helper), `src/auth/**`, `src/mock/**`, and `src/components/ui/**`
- `docs/design/ui-style.md`

### Allowed files
- `apps/mobile/src/app/ais/**` (new routes: `index.tsx` for the list, `new.tsx` for the wizard, and an edit screen if you need one)
- `apps/mobile/src/components/ais/**` (new)
- `apps/mobile/src/lib/ais-api.ts` (new) and its test. Use the same `request` idiom as `chat-api.ts`, with zod schemas that match the contract.
- `apps/mobile/src/mock/ais.ts` (new): mock AIs and connections for `EXPO_PUBLIC_GALENA_MOCK` mode.
- `apps/mobile/src/app/index.tsx`: **only** to add one header entry point to My AIs (an icon button, matching the existing header buttons).
- `apps/mobile/src/app/_layout.tsx`: only if the new routes need registering.
- `apps/mobile/screenshots/T-0037/` (new): the final screenshots. These are the only binary files allowed.
- `work/T-0037-mobile-my-ais.md`

**Not allowed:**
- `apps/web/**`
- `apps/server/**`
- `packages/**`
- `infra/**`
- `docs/**`
- `apps/mobile/ios/**`
- other mobile files

### Allowed dependencies
None. Use what the app already has: expo-router, NativeWind, lucide-react-native, and the `components/ui` primitives.

### What to build
1. **API client** (`ais-api.ts`): `listAis`, `createAi`, `updateAi`, `deleteAi` and `listConnections`.
   - Errors keep the server's `code`, so the UI can map them.
   - Test it with Vitest and a mocked `fetch`: the exact POST body (no extra keys, `persona` left out when unchanged), the bearer header, and error-code mapping.
2. **My AIs** (`/ais`)
   - One row per AI: an initial avatar, the name, the template, the model, and the limits as "$2/day · $20/month".
   - Tap a row for actions: Open chat (goes to that AI's chat screen, `/chat/[id]` with the AI's jid), Edit, and Delete.
   - Delete is two-step, using a native-feeling confirm. Not `Alert.alert`, unless the app already uses it elsewhere; say which you chose.
   - A "Create AI" primary action.
   - States: loading, empty (a call to action), error with the server's message, `ais_unavailable`, and success.
3. **Create an AI** (`/ais/new`): the same 6 steps as T-0032.
   - Name and template (Dev, Marketing, Fun, Custom).
   - Persona, prefilled.
   - Provider, from **active** connections only. There's no Connections screen on mobile, so with zero connections the empty state says: "Add a provider key in the web app: menu → Connections".
   - Model: a free-text input plus tappable suggestions for the connection's **provider**.
   - Limits, with the same validation as the web.
   - Review, then Create. One request only, even if tapped twice.
   - On success, go to My AIs with the new AI visible.
   - Handle the keyboard properly: inputs are never hidden behind it.
4. **Edit**: name, persona and limits, through PATCH with only the changed fields.
5. **Mock mode**: with `EXPO_PUBLIC_GALENA_MOCK=1`, the screens run on `mock/ais.ts`, so you can screenshot every state without a server.

### Visual check (you have vision: use it)
- **Simulators.** Create your **own** simulator:
  - `xcrun simctl create "Galena T-0037" "iPhone 17"` (pick any installed iPhone device type), then boot it.
  - **Never** touch the booted iPhone 17 Pro `DB167CD4-…`, which is Julio's, or the booted iPad `A3E0C081-…`.
  - **Never** run `simctl shutdown all` or `erase`.
  - At the end, shut down and delete only the simulator you created, by its UDID.
- **Metro.** `boot:ios` runs its own Metro on 8082. Don't use 8081; that's Julio's.
- Run `pnpm --filter @galena/mobile boot:ios --device <your-udid>` in mock mode, then navigate and screenshot each screen and state:
  - list: empty and with rows;
  - each wizard step;
  - the limits error;
  - the no-connections empty state;
  - the delete confirm;
  - dark mode, if the app supports it.
- Look at every screenshot yourself. Check alignment, clipping, contrast, the keyboard covering inputs, and safe areas.
- Save the final screenshots to `apps/mobile/screenshots/T-0037/`.
- List them in the Report with one line each on what you checked.
- If an iOS build fails for reasons outside your files, say so plainly with the log tail. Don't work around it.

### Tests (Vitest)
- `ais-api.test.ts`: the contract body, the headers, and error mapping.
- Pure helpers, if you extract them (limit validation, building the body or the patch): unit tests, the same cases as the web.

### Live check
The lead does it at review, against the real server on the iPhone. Give exact tap-by-tap steps in the Report.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] Screenshots of every screen and state are in `apps/mobile/screenshots/T-0037/`, and you checked each one visually.
- [ ] The POST body matches the contract exactly (tested). Model suggestions come from the provider.
- [ ] Double submit is impossible.
- [ ] Your simulator is deleted, and Julio's simulators were untouched.
- [ ] The Report gives the lead exact live steps.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/mobile
pnpm build
```

### Out of scope
- A Connections screen on mobile.
- The AI replying (T-0034).
- Android.

## Report (written by the worker when done)

## Review (written by Claude)
