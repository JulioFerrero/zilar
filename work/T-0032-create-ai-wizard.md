---
id: T-0032
title: Web "Create an AI" wizard and a My AIs page, on top of /api/ais
status: todo
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

You may start your worktree's own Vite dev server on another port (e.g. `pnpm --filter @galena/web exec vite --port 5199`) to look at the pages with `?mock=1` or with fetch mocked. Stop it before you finish.

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
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- The AI actually replying in chat. That's T-0033.
- A models.dev model picker with prices, and fallback models.
- Placement or desks, rooms, and tools (§20.2 steps 6–7).
- Avatars as uploaded images. An initial on a colour is enough.
- Mobile.

## Report (written by the worker when done)

## Review (written by Claude)
