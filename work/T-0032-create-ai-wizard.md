---
id: T-0032
title: Web "Create an AI" wizard and a My AIs page, on top of /api/ais
status: merged
milestone: M2
branch: task/T-0032-create-ai-wizard
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0028, T-0030]
estimate: 2 days
---

# T-0032: Create an AI from the web app

## Spec (written by Claude, do not edit)

### Goal

The server side of AIs is done and merged. T-0030 added `/api/ais`: creating an AI provisions an XMPP account `ai-<id>`, adds a two-way roster entry with its owner, and issues a capped LiteLLM virtual key. T-0028 added `/settings/connections`, where a person saves a provider key.

There is still no screen that ties these together. **Julio wants to create his first AI from the web app.** Build the wizard from `docs/PROJECT_PLAN.md` §20.2 as far as the server supports it today, and a page that lists, edits and deletes the caller's AIs.

It must work against the real server and not be a mock. Julio is its first user.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §20.2 ("Create an AI (wizard)")
- `apps/server/src/ais/routes.ts`, `service.ts` (`PublicAi`, the error codes), and `templates.ts`. The API contract is in "API contract" below. These files are the source of truth, and you must **not** edit them.
- `apps/web/src/routes/ConnectionsPage.tsx` and its test: the house pattern for a settings screen, its four states and its tests. Match it.
- `apps/web/src/lib/api.ts`: the shared `request` helper and its zod idiom.
- `apps/web/src/routes/AppRoutes.tsx` and `apps/web/src/components/ChatList.tsx` (the main menu, which already has a "Connections" item)
- `docs/design/ui-style.md`: read it before writing any component.

### Allowed files
- `apps/web/src/routes/AisPage.tsx` (new, route `/settings/ais`) and its test
- `apps/web/src/routes/CreateAiPage.tsx` (new, route `/settings/ais/new`) and its test
- `apps/web/src/components/ais/**` (new components for these pages only)
- `apps/web/src/lib/api.ts`: add the AI client functions and schemas only. Don't change existing functions.
- `apps/web/src/routes/AppRoutes.tsx`: add the two routes.
- `apps/web/src/components/ChatList.tsx`: add one "My AIs" menu item next to "Connections". Nothing else.
- `work/T-0032-create-ai-wizard.md`

**Not allowed:**
- `apps/server/**`
- `apps/mobile/**`
- `packages/**`
- `docs/**`
- `ConnectionsPage.tsx`
- any other file

If the API is missing something you need, describe it in the Report under "Blocked / needs a decision". Don't work around it in the client.

### Allowed dependencies
None.

### API contract (already live, don't change it)

All routes need a session cookie. Errors come back as `{ error: { code, message } }`.

- `GET /api/ais` returns `PublicAi[]`.
- `GET /api/ais/:id` returns `PublicAi`, or 404 `not_found`. The 404 also covers another user's AI.
- `POST /api/ais` returns 201 and `PublicAi`. The body is `.strict()`:
  ```json
  { "name": "1–64 chars", "template": "dev|marketing|fun|custom",
    "persona": "≤4000 chars, optional; REQUIRED (non-empty) when template is custom",
    "providerConnectionId": "<id from GET /api/connections>",
    "model": "1–256 chars",
    "limits": { "perDayUsd": >0, "perMonthUsd": >0 } }
  ```
  - `perDayUsd` must be ≤ `perMonthUsd`, and `perMonthUsd` must be ≤ 200.
  - If `persona` is omitted for a non-custom template, the server uses that template's default persona. The defaults are in `templates.ts`.
- `PATCH /api/ais/:id` returns `PublicAi`. The body carries any subset of `{ name, persona, limits }` (strict, same limit rules).
- `DELETE /api/ais/:id` returns 204.
- `PublicAi` is:
  ```
  { id, name, template, persona, model, jid, status: 'active'|'disabled',
    providerConnectionId, limits: { perDayUsd, perMonthUsd }, createdAt (ISO string) }
  ```
- Error codes the UI must map to a clear message:
  - 400 `invalid_request` (show the server's message)
  - 400 `invalid_connection` / `connection_inactive` ("that connection can't be used, pick another or re-add it")
  - 404 `not_found`
  - 502 `ai_provisioning_failed` / `ai_update_failed` / `ai_teardown_failed` ("the server couldn't finish; nothing was left half-created, try again")
  - 503 `ais_unavailable` ("AI management isn't configured on this server"). This is a real state, not a crash.
- `GET /api/connections` returns `{ id, provider, label, status, createdAt }[]`. Only `status: 'active'` connections can be picked.
- `DELETE /api/connections/:id` now returns 409 `connection_in_use` while an AI uses the connection. This task doesn't change the Connections page. Mention in the Report whether its message is already clear.

### What to build

**1. Client** (`lib/api.ts`)
- `listAis`, `getAi`, `createAi`, `updateAi`, `deleteAi` and `listConnections`, using the existing `request` helper and zod schemas that match the contract above.
- Errors must keep the server's `code`, so the UI can branch on it. If the helper throws away the code today, add a typed error for the new functions only, and don't change how existing callers behave.

**2. Wizard** (`/settings/ais/new`): one screen with steps, following §20.2 steps 1–5.
1. **Name and template.** Four cards: Dev, Marketing, Fun, Custom.
2. **Persona.** A textarea prefilled with the template's default persona.
   - Copy the four defaults into the client as display text, and note in a comment that `templates.ts` is the source.
   - Only send `persona` when the user changed it or picked Custom.
   - Custom requires a non-empty persona before Next is enabled.
3. **Provider.** A picker over the caller's **active** connections, with provider and label.
   - With zero connections, show an empty state with a link to `/settings/connections`. Don't build a second key form.
4. **Model.**
   - A text input with a short, static list of suggestions for the chosen connection's provider, as an HTML `datalist`. The input is always editable.
   - A models.dev picker with prices is **out of scope**. Say so in a code comment.
5. **Limits.** USD per day and per month, with sensible defaults (e.g. 2 and 20).
   - Validate on the client with the same rules as the server (>0, day ≤ month, month ≤ 200), and show the reason inline.
   - The currency is USD because the server stores USD. Label it `$`, not `€`.
6. **Review and Create.** A summary, then one primary button.
   - While the request runs, the button is disabled, so a double click never creates two AIs.
   - On 201, go to `/settings/ais` and highlight the new AI.
   - On error, stay on the Review step with the mapped message. Every value the user entered is kept.

§20.2 steps 6 (placement or desk) and 7 (rooms) are **out of scope**: desks and rooms don't exist in the API yet. Don't show fake or disabled steps for them.

**3. My AIs** (`/settings/ais`)
- One row per AI:
  - avatar or initial, name, template, model, and limits as "$2/day · $20/month";
  - a status badge when it isn't `active`.
- Actions:
  - **Open chat** navigates to `/c/<jid>`, the existing chat route. The owner already has the AI in their roster.
  - **Edit** changes name, persona and limits through PATCH, with the same client validation.
  - **Delete** is two-step, the same pattern as Remove on Connections, and warns that the AI's chat account and key are removed.
- A primary "Create AI" button goes to the wizard.
- Handle every state honestly: loading, empty (a call to action to create the first AI), error with the server's message, `ais_unavailable`, and success.
- Reachable from the main menu as "My AIs".

**4. Style.** Follow `docs/design/ui-style.md` and match `ConnectionsPage`: compact, list-driven, one obvious primary action per screen. It must be usable at phone width, 360 px.

### Tests (Vitest, no real network: mock `fetch` the way ConnectionsPage.test.tsx does)
- **Wizard: happy path.** It walks every step and POSTs **exactly** the contract body. Assert the JSON: no extra keys, and `persona` is left out when unchanged.
- **Wizard: Custom.** Next stays disabled until a persona is entered.
- **Wizard: no connections.** It shows the empty state with a link to Connections.
- **Wizard: limits.** Day > month and month > 200 each show an inline error and block Next.
- **Wizard: double click** on Create sends one request.
- **Wizard: server errors.** A 502 `ai_provisioning_failed` shows the mapped message and keeps the inputs. A 503 `ais_unavailable` shows the unavailable state.
- **My AIs:** loading, empty, list, error, and `ais_unavailable`. Edit sends a PATCH with only the changed fields. Delete needs a confirm, then sends DELETE and removes the row.
- **Menu:** "My AIs" navigates to the page.
- If a test depends on timing, use `findBy*` or `waitFor` with the defaults. Machine load has made fixed timeouts flaky here before (T-0029).

### Live check (the lead does this at review)

The live stack is running:
- server on `127.0.0.1:3188`;
- web on `http://localhost:5173`, which proxies `/api` to 3188.

**Don't restart, stop or reconfigure either one, and don't create accounts on it.** Signing up needs OTP codes from the server log, which you can't read.

The lead will click through the wizard live at review. Make that easy:
- In the Report, give the exact clicks to create, edit and delete an AI.
- Mention anything the lead should look for.

You may start your worktree's own Vite dev server on another port (e.g. `pnpm --filter @zilar/web exec vite --port 5199`) to look at the pages with `?mock=1` or with fetch mocked. Stop it before you finish.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The Report gives the lead exact live click-through steps.
- [ ] The POST body matches the contract exactly, and a test proves it.
- [ ] Every error code in the contract maps to a clear message, and there are no raw stack traces or `[object Object]`.
- [ ] Double submit is impossible.
- [ ] No server, mobile or docs file changed.
- [ ] The Report says exactly what was run live and what wasn't.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/web
pnpm build
```

### Out of scope
- The AI actually replying in chat. That's T-0033.
- A models.dev model picker with prices, and fallback models.
- Placement or desks, rooms, and tools (§20.2 steps 6–7).
- Avatars as uploaded images. An initial on a colour is enough.
- Mobile.

## Report (written by the worker when done)

### What I built

**Client (`apps/web/src/lib/api.ts`)** — added `listAis`, `getAi`, `createAi`, `updateAi`, `deleteAi` and `listConnections`, plus zod schemas (`publicAiSchema`, `aiLimitsSchema`, `aiTemplateSchema`, `connectionSchema`) matching the server contract. Existing functions were not touched. Errors already keep the server's `code`/`status` through the existing `ApiError`, so no new error type was needed; the new functions just use the existing `request` helper.

**Wizard (`/settings/ais/new`, `CreateAiPage.tsx`)** — one screen with 6 steps: Name & template → Persona → Provider → Model → Limits → Review. Details:
- Template cards Dev/Marketing/Fun/Custom; the four default personas are copied into `components/ais/templates.ts` with a comment naming `apps/server/src/ais/templates.ts` as the source of truth.
- Persona textarea prefilled from the template. `persona` is sent only when the user edited it (`personaTouched`) or picked Custom; otherwise it is omitted so the server applies its own default. Custom requires a non-empty persona before Next enables.
- Provider picker over **active** connections only. Zero active connections shows an empty state with a link to `/settings/connections` (rendered with react-router `<Link to="/settings/connections">`; the spec said "a link", and a real link is what the test asserts).
- Model: an editable HTML input with a `datalist` of short static per-provider suggestions (`components/ais/models.ts`), plus clickable suggestion rows. A models.dev picker with prices is out of scope, noted in a code comment.
- Limits: USD day/month, defaults 2 and 20, validated on the client with the server's rules (>0, day ≤ month, month ≤ 200) and inline reasons.
- Review shows a summary; Create is disabled while the request runs. On 201 it navigates to `/settings/ais` with `state.highlightId`, and the new row is highlighted. On error it stays on Review with the mapped message and keeps every input.
- §20.2 steps 6 (placement/desk) and 7 (rooms) are not shown at all — no fake or disabled steps.

**My AIs (`/settings/ais`, `AisPage.tsx`)** — one row per AI: avatar initial (existing `Avatar`), name, `AI` badge, status badge when not `active`, template · model (· provider), and limits as `$2/day · $20/month`. Actions: Open chat → `/c/<jid>`, Edit (name/persona/limits via PATCH, only changed fields), Delete (two-step confirm warning that the chat account and key are removed). A primary "Create AI" button goes to the wizard. Handles loading, empty, error, `ais_unavailable` and success. The provider name is decoration fetched best-effort from `/api/connections` and never fails the page.

**Error mapping (`components/ais/errors.ts`)** covers `invalid_request` (server message), `invalid_connection` / `connection_inactive` / `connection_not_llm`, `not_found`, `ai_provisioning_failed` / `ai_update_failed` / `ai_teardown_failed`, `ais_unavailable`, and a `network_error` fallback. No raw codes, stack traces or `[object Object]` reach the UI.

**Navigation** — `AppRoutes.tsx` has the two routes; `ChatList.tsx` gained one "My AIs" menu item next to "Connections".

### Files changed
- `apps/web/src/lib/api.ts` (AI client functions + schemas only)
- `apps/web/src/routes/AisPage.tsx` (new) and `apps/web/src/routes/CreateAiPage.tsx` (new)
- `apps/web/src/routes/CreateAiPage.test.tsx` (new, covers both pages)
- `apps/web/src/components/ais/` (new: `AiPageShell`, `TemplateCards`, `ConnectionPicker`, `ModelPicker`, `LimitsFields`, `WizardSteps`, `templates`, `models`, `limits`, `errors`)
- `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/ChatList.tsx`
- `work/T-0032-create-ai-wizard.md`

No `apps/server/**`, `apps/mobile/**`, `packages/**` or `docs/**` file was changed (verified with `git diff --name-only`).

### Commands run (real results)
- `pnpm install` — done in 7.9s, 909 packages.
- `pnpm format:check` — "All matched files use Prettier code style!"
- `pnpm lint` — clean, no output.
- `pnpm typecheck` — 8 tasks successful.
- `pnpm exec turbo test --force --filter=@zilar/web` — **20 files, 116 tests, all passed** (21 of them in `CreateAiPage.test.tsx`).
- `pnpm build` — 2 tasks successful; web built (`dist/index-RjRNAshP.js`, 614.90 kB, existing chunk-size warning unchanged).

### Tests
`CreateAiPage.test.tsx` (Vitest, `fetch` mocked like `ConnectionsPage.test.tsx`):
- Wizard happy path: walks all 6 steps and asserts the POST JSON has **exactly** the 5 contract keys and no `persona`.
- Custom: Next stays disabled until a persona is entered.
- No connections: empty state + a link to Connections; clicking it navigates.
- Limits: day > month and month > 200 each show an inline error and block Next.
- Double-click Create: exactly one POST.
- Server errors: 502 `ai_provisioning_failed` shows the mapped message and keeps the inputs; 400 `invalid_connection` shows the mapped message; 503 `ais_unavailable` shows the unavailable state.
- My AIs: loading, empty, list (template/model/limits/actions), error, `ais_unavailable`, PATCH sends only changed fields, Delete needs a confirm then sends DELETE and removes the row.
- Menu: "My AIs" navigates to the page.
- Pure `buildBody` / `buildPatch` unit tests, including the no-extra-keys assertion.

Timing-sensitive tests use `findBy*` / `waitFor` with default timeouts; no fixed delays.

### Live check (what I did and what the lead should do)
I did **not** run the live stack or create accounts. The lead's stack is on `127.0.0.1:3188` with the web on `http://localhost:5173`. I started my worktree's own Vite on port 5199 only to confirm it compiles and serves; I could not use the managed browser (no desktop browser is connected to this session), so no real click-through was possible from my side. I stopped that server before finishing; port 5199 is free.

The lead can click through as follows:
1. Open `http://localhost:5173`, sign in, open the ☰ menu, click **My AIs**. Expect the empty state ("You have no AIs yet…") if no AI exists, with a **Create an AI** button.
2. Click **Create an AI** (or the **Create AI** button on a non-empty list). The wizard opens on "Step 1 of 6".
3. Step 1: type a name (e.g. `Dev-1`), keep the **Dev** template, click **Next**.
4. Step 2: the persona is prefilled with the Dev default. Leave it and click **Next** (this is the case where `persona` is *not* sent).
5. Step 3: pick a connection. If there is none, expect the empty state and a **Connections** link. Click **Next**.
6. Step 4: the input suggests models for that provider; pick one or type a model, click **Next**.
7. Step 5: defaults are 2 / 20. Try `30` / `20` to see the day > month error, or `500` month for the cap error; fix them and click **Next**.
8. Step 6: check the summary, click **Create AI** once. The button shows "Creating…" and is disabled. On success you land on **My AIs** with the new row highlighted.
9. **Edit**: click the pencil on the row, change the name only, click **Save**. The row updates; the request is a PATCH with only `name`.
10. **Delete**: click the trash, confirm the "Removes the AI's chat account and its provider key" warning, click **Remove**. The row disappears. (This is real: it revokes the key and unregisters the XMPP account.)
11. **Open chat**: click the chat icon; it navigates to `/c/<jid>` (T-0033 makes the AI actually reply).

Things to look for: the POST body has no extra keys and no `persona` when the persona is untouched; a double click on Create makes only one AI; `ais_unavailable` (turn the LiteLLM/cipher env off) shows a plain message instead of a crash; the layout holds at 360 px width.

### Problems / deviations
- The spec says the no-connections empty state has "a link to `/settings/connections`"; I used a react-router `<Link>` (a real anchor with an href) rather than a button with `navigate`. Behaviour is the same; the test asserts `role="link"`.
- The spec's `PublicAi` note says the default personas may be re-typed client-side; I copied the four values verbatim and added a comment pointing at `templates.ts` as the source.
- `connection_not_llm` is not in the contract's error list but is a real 400 the server can return; I map it to the same message as `invalid_connection`.
- The `connection_in_use` 409 message on the Connections page is already clear without changes: "This connection is used by N AI(s)" (`apps/server/src/connections/routes.ts:139`). No change needed there.

### Blocked / needs a decision
Nothing blocked. The API is enough to build steps 1–5 (all that T-0032 asks for).

### Round 2

**1. Model step got the connection id, not the provider (the bug).**
- `CreateAiPage.tsx` passed `selectedProviderId={selectedConnection?.id ?? null}` into the model step. I now pass `selectedConnection?.provider ?? null`.
- I renamed the prop to `selectedProvider` (and the `ModelPickerStep` prop from `providerId` to `provider`) so a connection id cannot be passed by mistake again.
- The `ModelPicker` placeholder already used `providerLabel(provider)`, so with a real provider it now reads e.g. "OpenAI model name" instead of the UUID.
- File: `apps/web/src/routes/CreateAiPage.tsx`.

**2. Anthropic suggestions updated.**
- `apps/web/src/components/ais/models.ts` now lists `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` for `anthropic`.

**Regression test.** Added `shows provider suggestions and a label placeholder on the model step` to `CreateAiPage.test.tsx`. Its connection fixture has `id: 'c31a71e2-cada-40e3-8705-2fc42929bce7'` and `provider: 'openai'`. It asserts:
- the model input's placeholder is exactly `OpenAI model name` and does **not** contain the connection id;
- the `#ai-model-suggestions` datalist contains `gpt-4o-mini`;
- the clickable suggestion row `gpt-4o-mini` is present.

I confirmed the test fails against the old wiring: temporarily reverting the prop to `selectedConnection?.id` gives `AssertionError: expected 'c31a71e2-cada-40e3-8705-2fc42929bce7 …' to be 'OpenAI model name'`. With the fix it passes.

**Commands run (Round 2, real results).**
- `pnpm install` — up to date, done in 1s.
- `pnpm format:check` — "All matched files use Prettier code style!"
- `pnpm lint` — clean, no output.
- `pnpm typecheck` — 9 tasks successful (8 cached).
- `pnpm exec turbo test --force --filter=@zilar/web` — **20 files, 117 tests, all passed** (`CreateAiPage.test.tsx` now 22).
- `pnpm build` — 2 tasks successful.

**Files changed in Round 2.** `apps/web/src/routes/CreateAiPage.tsx`, `apps/web/src/routes/CreateAiPage.test.tsx`, `apps/web/src/components/ais/models.ts`. No other file changed.

**Notes.** I did not re-run a live click-through (no desktop browser is connected to this session); the regression test covers the exact symptom. The "Open chat shows 'Select a chat'" note is T-0033 server work; the button is unchanged.

## Review (written by Claude)


### Round 1: changes requested (one bug, found live)

Good work. The checks pass on the lead's re-run:
- format:check, lint, typecheck and build;
- `turbo test --force --filter=@zilar/web`: 116/116.

The lead clicked through the wizard live in Chrome, as the throwaway test account, against the real server:

| Step | Result |
|---|---|
| Menu → My AIs → empty state | works |
| Wizard, name and template | works |
| Persona prefill; unchanged, so the server default applied | works |
| Provider (the active connection) | works |
| Limits: 30/20 shows an inline error and disables Next | works |
| Review summary | works |
| **Double-click** Create | exactly **one** POST, 201 |
| Land on My AIs with the new row highlighted | works |
| Edit name and month limit | PATCH 200 |
| Delete: two-step confirm with a warning | DELETE 204, empty state |
| No horizontal scroll at 500 px (Chrome's minimum window) | works |

After the delete, the database had no AI row and no key row.

**Bug (must fix): model suggestions never appear.**
- `CreateAiPage.tsx` passes `selectedProviderId={selectedConnection?.id ?? null}` into the model step. That is the connection's UUID, not its provider.
- The effects:
  - `modelSuggestionsFor()` gets `c31a71e2-…` and returns `[]`, so the `<datalist>` is empty;
  - the placeholder reads "c31a71e2-cada-40e3-8705-2fc42929bce7 model name".
- The tests missed it because their fixture connection seems to use provider-like values.
- Fix:
  - pass `selectedConnection.provider`, and rename the prop so an id can't be passed by mistake;
  - the placeholder should use the provider's label (e.g. "OpenAI model name").
- Regression test: a connection with `id: 'c-123'` and `provider: 'openai'`. The model step offers `gpt-4o-mini` (datalist options or your suggestion rows), and the placeholder doesn't contain the id.

**Also in this round (small):** the Anthropic suggestions are out of date. Use `claude-opus-5-5`, `claude-sonnet-5` and `claude-haiku-4-5-20251001`.

**Not your bug, for the record:** Open chat navigates correctly to `/c/<jid>`, but the chat shell shows "Select a chat". `/api/chats` doesn't list AIs yet; it only lists human contacts and groups. That is server work and belongs to T-0033. Keep the button as it is.

Allowed files are unchanged. Run the same Checks, add a "Round 2" subsection to the Report, then set `status: review` and commit.


### Round 2: approved

- The model step now receives `selectedConnection.provider`. The prop is renamed to `selectedProvider`, so an id can't be passed by mistake again.
- The placeholder uses the provider's label.
- The Anthropic suggestions are updated.
- The regression test uses a UUID connection id with provider `openai`, which is exactly the live symptom. It asserts the label placeholder, the datalist option and the suggestion row, and the Report says it was confirmed to fail on the old wiring.

Lead's re-run after rebasing onto main:
- format:check, lint, typecheck and build pass;
- `turbo test --force --filter=@zilar/web`: 117/117.

Round 1's full live click-through still covers create, edit, delete, double-submit and layout. Round 2 was **not** re-clicked live because the Chrome extension disconnected. The change is a one-line prop fix, and the test reproduces the live symptom.

Follow-ups, on the board:
- AIs must appear in `/api/chats` so Open chat works (T-0033);
- users with an empty name show as blank chat rows.
