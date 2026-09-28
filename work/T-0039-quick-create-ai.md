---
id: T-0039
title: Web — quick "New AI" dialog (one screen, safe defaults) and an AI side panel in the chat, replacing the 6-step wizard and the edit page
status: review
milestone: M2
branch: task/T-0039-quick-create-ai
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0032, T-0034]
estimate: 1.5 days
---

# T-0039: Create an AI in five seconds

## Spec (written by Claude, do not edit)

### Goal

Julio tried the T-0032 wizard live and said:
- "not quite polished";
- "will be cool not to be in a completely new page";
- "we need to be faster to create… maybe I can edit the prompt then".

He also found that the model suggestion buttons on step 4 didn't select anything, so he couldn't continue.

Replace the six full-page steps with:
1. **One small dialog, opened over the chat list:** a name, an optional template, and Create. Every other field gets a safe default that can be changed under "More options". On success, go **straight into the AI's chat**.
2. **An AI side panel inside the chat:** opened from the chat header of an AI DM. It edits the persona, model, limits and name, and holds Delete.

The `/api/ais` contract doesn't change. This is a web-only task.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0032-create-ai-wizard.md`, whole: the API contract, error codes, limit validation, double-submit protection, and "persona is left out when unchanged". Keep every one of those behaviours.
- `apps/web/src/routes/CreateAiPage.tsx`, `AisPage.tsx`, `AppRoutes.tsx`, and `apps/web/src/components/ais/**` (reuse `limits.ts`, `models.ts`, `templates.ts`, `errors.ts`, `ConnectionPicker`, `LimitsFields`)
- `apps/web/src/components/NewGroupDialog.tsx` and `NewChatButton.tsx`: the existing Radix dialog and the "new …" menu. The new dialog must look and behave like them.
- `apps/web/src/components/ChatHeader.tsx` and `routes/ChatView.tsx`: where the panel opens. `ChatListEntry.isAi` marks AI DMs, and `GET /api/ais` returns each AI's `jid`.
- `docs/design/ui-style.md` (Telegram-like: compact, calm, no big empty pages)

### Allowed files
- `apps/web/src/components/ais/**`: new dialog and panel components, and helpers with their tests
- `apps/web/src/components/NewChatButton.tsx` and its test: add a "New AI" entry.
- `apps/web/src/components/ChatHeader.tsx`: for AI DMs, make the title area (or an info button) open the panel.
- `apps/web/src/routes/ChatView.tsx`: mount the panel.
- `apps/web/src/routes/AisPage.tsx` and `AppRoutes.tsx`: the Create button opens the dialog; the row action "Edit" opens the chat with the panel open (or the panel on the page, your choice; say which); remove the `/settings/ais/new` route.
- `apps/web/src/routes/CreateAiPage.tsx` and `CreateAiPage.test.tsx`: **delete** them, and move any still-relevant test cases to the new components' tests. No dead code.
- `apps/web/src/lib/api.ts`: only if a helper for the AI endpoints is missing
- `work/T-0039-quick-create-ai.md`

**Not allowed:**
- `apps/server/**`: another task (T-0040) is changing it.
- `apps/mobile/**`
- `packages/**`
- `infra/**`
- `docs/**`

### Allowed dependencies
None. `radix-ui` is already there.

### What to build

**1. The "New AI" dialog** (`components/ais/NewAiDialog.tsx`)
- **Where it opens:**
  - a "New AI" entry in `NewChatButton`'s menu, next to new chat and new group;
  - the "Create AI" button on My AIs.
- **Main screen**, with nothing else visible by default:
  - **Name** (required, max 64), autofocused.
  - **Template chips:** Dev, Marketing, Fun, Custom. Default: Custom. They only set the persona default (`templates.ts`).
  - **Provider:**
    - hidden when the user has exactly one active connection (use it);
    - a compact select when there are several;
    - with zero, the dialog shows "Add a provider key first" with a button to Connections instead of the form.
  - **Create** (primary) and **Cancel**.
- **"More options"** (a disclosure inside the same dialog, collapsed by default):
  - **Model:** a text input prefilled with the provider's **default model**, plus clickable suggestions. Add `defaultModelFor(provider)` to `models.ts`: the first suggestion for that provider, with a unit test for each provider.
  - **Persona:** a textarea prefilled from the template. Keep "left out when unchanged" exactly as T-0032 does.
  - **Limits:** default **$1/day and $10/month**, with the same validation as today (`limits.ts`). Name the defaults as constants.
- **Submit:**
  - exactly one POST even on a double click;
  - server errors are mapped with `errors.ts`;
  - the dialog stays open on error, and the entered values are kept.
- **On success:** close the dialog and navigate to `/c/<the new AI's jid>`, so the chat opens and the user can type immediately. Make the chat list show the new AI without a reload (reuse whatever refresh T-0033 added for AIs).

**2. Fix the model suggestions bug**
Julio clicked `deepseek-chat` on the old step 4 and nothing got selected. Before you delete the wizard, find the **cause**:
- reproduce it in a test of `ModelPicker` if the component survives;
- otherwise write down what the bug was.

Make sure the suggestions in the new dialog and panel **do** set the model, and prove it with a test (click the suggestion, then assert the input's value).

**3. The AI side panel** (`components/ais/AiPanel.tsx`)
- **Opening it:** in an AI DM, clicking the header title (or a small info icon, matching the header's other buttons) opens a right-side panel. It's a sheet, or an inline column on wide screens; pick what fits the existing layout, and say which.
- **Contents:**
  - the AI's avatar, name and AI badge;
  - editable **Name**, **Persona** (a large textarea), **Model** (input plus suggestions) and **Limits**;
  - **Save**, which sends a PATCH with **only the changed fields**, the same as T-0032's edit;
  - **Delete**, with a two-step confirm.
- **The delete confirmation text:** "Delete <name>? This removes the AI and its chat. Your provider connection stays." The old wording ("…and its provider key") made people think their own key would be deleted.
- **After delete:** navigate to `/` and remove the chat from the list.
- **Finding the AI:** use `GET /api/ais` and match the chat's jid. If it's not found (someone else's AI, or deleted), show "This AI no longer exists." in the panel.

**4. My AIs page**
- Keep the list.
- "Create AI" opens the dialog.
- The row's "Edit" goes to the AI's chat with the panel open (e.g. `/c/<jid>?panel=ai`), or opens the panel on the page; say which.
- Remove the `/settings/ais/new` route and the old edit UI.

**5. Polish**
- Everything must look like the rest of the app: the same dialog chrome as `NewGroupDialog`, the same spacing, dark and light themes, and no full-width empty pages.
- It works at 500 px wide, with no horizontal scroll.

### Tests (Vitest and Testing Library, no network)
- **Dialog:**
  - with one connection, the provider is hidden and used;
  - with several, the select appears;
  - with zero, the "Add a provider key first" state shows;
  - the defaults are sent (model = `defaultModelFor`, $1 and $10);
  - persona is left out when unchanged;
  - a double click sends one POST;
  - an error keeps the dialog open with its values;
  - success navigates to `/c/<jid>`.
- **Suggestions:** clicking a suggestion sets the input.
- **Panel:**
  - loads the AI by jid;
  - PATCH contains only the changed fields;
  - Delete shows the new confirmation text, then navigates to `/`;
  - an unknown AI shows the "no longer exists" state.
- **`NewChatButton`:** it has the "New AI" entry.
- **`models.ts`:** `defaultModelFor` for every provider.

### Live check (the lead does it, with Julio)
Give tap-by-tap steps in the Report:
- create an AI from the chat list menu in under 5 seconds;
- land in its chat;
- open the panel, edit the persona and save;
- delete it.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] Creating an AI takes one screen: name, then Create, then you're in its chat.
- [ ] Every T-0032 behaviour is kept (contract, validation, double-submit, persona omission), and tested.
- [ ] Model suggestions select, with a test proving it. The cause of the old bug is written in the Report.
- [ ] The wizard page and `/settings/ais/new` are gone, with no dead code.
- [ ] Only the Allowed files changed (`git diff --name-only main...HEAD`).

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
- Server changes, including new defaults on the server.
- Mobile.
- The AI changing its own persona by chat (T-0040).

## Report (written by the worker when done)

### What I built

**The quick-create dialog (`components/ais/NewAiDialog.tsx`)** — one screen, opened by the
"New AI" entry in `NewChatButton`'s menu and by the "Create AI"/"Create an AI" buttons on My
AIs:
- **Name** (required, max 64, autofocused) and **Template chips** (Dev, Marketing, Fun,
  Custom); the chips only set the persona default from `templates.ts`.
- **Provider**: hidden when the user has exactly one active connection (it is used, and a small
  "Using OpenAI." line confirms which one); `ConnectionPicker` when there are several; and an
  "Add a provider key first" state with a **Connections** button when there are none.
- **More options** (collapsed disclosure, same dialog): the model input prefilled with
  `defaultModelFor(provider)` plus the clickable suggestions, the persona textarea prefilled
  from the template, and the limits fields defaulting to **$1/day** and **$10/month**
  (`DEFAULT_DAILY_USD` / `DEFAULT_MONTHLY_USD` in `aiForm.ts`).
- **Create**: one POST even on a double click (a `submitting` flag plus a synchronous
  `inFlight` ref); server errors go through `errors.ts`; on error the dialog stays open with
  every value kept. On 201 it closes and navigates to `/c/<the new AI's jid>`.
- The new AI is also inserted into the store's chat list immediately (mirroring
  `realStore.summaryFor` for an AI dm) so `/c/<jid>` opens at once; the T-0033 roster refresh
  reconciles it a moment later (a chat already there is kept).

**The AI side panel (`components/ais/AiPanel.tsx`)** — a right-side sheet (chosen over an inline
column: it fits the existing single-column chat and works at narrow widths). It opens from the
chat header: for an AI DM the title area (name + AI badge + subtitle) is a button; it also
opens from `/c/<jid>?panel=ai` (used by the My AIs row action). It finds the AI by matching the
chat's jid against `GET /api/ais`, shows its avatar/name/AI badge, and edits **Name**,
**Persona** (large textarea) and **Limits** with Save. Save sends a PATCH with only the changed
fields (`buildPatch`), updates the chat title in the store when the name changes, and shows
"Saved". **Delete** is two-step with the exact new wording: "Delete <name>? This removes the AI
and its chat. Your provider connection stays." On delete it removes the chat from the store and
navigates to `/`. An AI that is not found shows "This AI no longer exists."

**My AIs (`routes/AisPage.tsx`)** — the list is unchanged; "Create AI" opens the dialog; the
row **Edit** goes to `/c/<jid>?panel=ai` (the panel on the chat, not on the page); the row
delete kept its two-step pattern and its warning now matches the new copy. The old inline edit
form and the `highlightId` plumbing are gone. `/settings/ais/new` and `CreateAiPage.tsx` are
removed from `AppRoutes.tsx`.

**Helpers / reuse** — `aiForm.ts` holds the shared `buildCreateBody`/`buildPatch` and the
default constants; `models.ts` gained `defaultModelFor`. Recycled as-is: `ConnectionPicker`,
`LimitsFields`, `ModelPicker`, `limits.ts`, `templates.ts`, `errors.ts`, `AiPageShell`.
`TemplateCards.tsx` and `WizardSteps.tsx` were only used by the deleted wizard, so they were
deleted too. `lib/api.ts` needed no change; every endpoint helper already existed.

### The model-suggestions bug (cause)

The round-1 T-0032 wizard passed the connection's **UUID** into the model step
(`selectedProviderId={selectedConnection?.id ?? null}`). The step then called
`modelSuggestionsFor(uuid)` (not the provider), which returns `[]`, so both the `<datalist>` and
the clickable suggestion rows were empty and the placeholder read "<uuid> model name". It was
already fixed in T-0032 round 2 by passing `selectedConnection.provider`. The new dialog and
panel always pass `connection.provider`, and `ModelPicker.test.tsx` clicks a suggestion then
asserts the input's value, with a dialog-level test doing the same end to end.

### Files changed (all inside Allowed files)

- New: `apps/web/src/components/ais/NewAiDialog.tsx`, `AiPanel.tsx`, `aiForm.ts`
- New tests: `apps/web/src/components/ais/{NewAiDialog,AiPanel,AisPage,ModelPicker}.test.tsx`,
  `apps/web/src/components/ais/{models,aiForm}.test.ts`
- Modified: `apps/web/src/components/ais/models.ts`,
  `apps/web/src/components/NewChatButton.tsx` (+ its test),
  `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/routes/ChatView.tsx`,
  `apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`
- Deleted: `apps/web/src/routes/CreateAiPage.tsx`, `CreateAiPage.test.tsx`,
  `apps/web/src/components/ais/TemplateCards.tsx`, `WizardSteps.tsx`
- `apps/web/src/lib/api.ts` unchanged.

No `apps/server/**`, `apps/mobile/**`, `packages/**`, `infra/**` or `docs/**` file was touched.
My test files for AisPage live in `components/ais/` (the only test location the Allowed files
list gives), not in `routes/`.

### Tests (Vitest + Testing Library, `fetch` mocked, no network)

`NewAiDialog.test.tsx` (9): one screen creates with the exact contract body
(`{name, template:'dev', providerConnectionId, model:'gpt-4o', limits:{perDayUsd:1,
perMonthUsd:10}}`, no `persona`) and lands in `/c/<jid>` + adds the chat to the store; several
connections show the picker and prefill that provider's `defaultModelFor`; zero connections
shows the add-a-key state and the button reaches Connections; persona omitted when unchanged /
sent when edited; Custom needs a persona; clicking a suggestion sets the input; double click is
one POST; a 502 keeps the dialog open with its values; a 503 shows the unavailable state.
`AiPanel.test.tsx` (5): loads the AI by jid; PATCH has only the changed field; the new delete
text then DELETE → `/` and the chat leaves the list; unknown AI shows the gone state; the
header title opens the panel.
`AisPage.test.tsx` (7): loading→list, empty, error, `ais_unavailable`, Create opens the dialog,
Edit navigates to `?panel=ai`, delete confirms with the new wording then removes the row.
`ModelPicker.test.tsx` (2): clicking a suggestion sets the input; provider label in the
placeholder. `models.test.ts` (3): `defaultModelFor` for every provider + unknown.
`aiForm.test.ts` (6): contract keys, persona omission, PATCH changed-fields, the defaults.
`NewChatButton.test.tsx` (+1): the "New AI" menu entry opens the dialog.

### Commands run (real results)

- `pnpm install` — "Done in 6.9s", 910 packages added.
- `pnpm format:check` — "All matched files use Prettier code style!" (after formatting the new files).
- `pnpm lint` — clean (oxlint, no output). I removed an initial `react(set-state-in-effect)`
  warning by deriving the model default during render and by not re-setting `loading` in an
  effect; no rule was disabled.
- `pnpm typecheck` — 9 tasks successful (8 cached on the last run).
- `pnpm exec turbo test --force --filter=@galena/web` — **25 files, 128 tests, all passed**.
- `pnpm build` — 2 tasks successful; web `dist/assets/index-*.js` 616.04 kB (the existing
  chunk-size warning is unchanged).

One aside, for honesty: while repeatedly stress-running a subset, I twice saw the pre-existing
`NewChatButton` group test hit its 1 s `findByText('Crew')` default under parallel load (T-0036
notes this class of flakiness). It passed in isolation and in every full `turbo test` run.

### Live check (tap-by-tap; the lead does this)

I did not run the pod/public infra or a browser — no live stack or desktop browser is attached
to this session, and the task says the live check is the lead's.

1. Open `http://localhost:5173`, sign in, open the ☰ menu → **My AIs** (or just the pencil
   button at the bottom-right of the chat list → **New AI**).
2. In the dialog type a name (e.g. `Watson`). With one connection you should see "Using OpenAI."
   and no provider picker; with several, pick one.
3. Click **Create** once. You should land in `Watson`'s chat with the composer ready. (Nothing
   else was asked: no steps, no full page.)
4. In that chat, click the **header title** (the name area, next to the avatar) — the right-side
   AI panel opens.
5. Edit **Persona**, click **Save**; the panel shows "Saved". Optionally change the name and
   confirm the header updates.
6. Click **Delete**, read the confirmation
   ("Delete Watson? This removes the AI and its chat. Your provider connection stays."), click
   **Delete**; you return to the chat list and the AI is gone.
7. From **My AIs**, click the pencil (Edit) on a row: it should navigate to `/c/<jid>?panel=ai`
   with the panel already open.

Things to look for: suggestions select when clicked (open **More options**, click a model); a
double click on Create makes only one AI; the dialog and panel hold at 500 px with no horizontal
scroll; the AIs (if any) show under the correct list.

### Problems / deviations

- **Default template is `Dev`, not `Custom`.** The spec says "Default: Custom", but Custom
  requires a non-empty persona (server `resolvePersona`; T-0032's "Custom requires a persona"),
  so defaulting to Custom would make the one-screen "name → Create" path and the "under 5
  seconds" live check impossible. I kept `Dev` as the default (its persona is supplied by the
  server, so `persona` is omitted) and Custom is one chip away. Please confirm; it is a
  one-line change in `NewAiDialog` if you want a different stock default.
- **The panel's Model is read-only.** `PATCH /api/ais/:id` is `.strict()` over
  `{ name, persona, limits }`; a `model` key is a 400. Since this task says the `/api/ais`
  contract does not change, and T-0040 says the model never changes, the panel shows the model
  with the caption "The model is set when the AI is created and can't be changed here yet." and
  Save PATCHes only name/persona/limits. Making the model editable needs the server PATCH to
  accept it — outside this task's Allowed files. Please decide.
- **Provider picker component.** The spec said "a compact select" but also "reuse
  `ConnectionPicker`"; I reused `ConnectionPicker` (a compact radiogroup) for several
  connections.
- **Chat list refresh.** I rely on the T-0033 roster refresh and additionally insert/remove the
  summary in the store via the existing `setState`, so the chat is there immediately after
  create and gone immediately after delete. No store file was changed.
- **Delete wording** on the My AIs row was also updated to the new copy (Julio's complaint was
  about the old "and its provider key" wording). The panel is the primary delete.

### Blocked / needs a decision

Nothing blocked. Two questions for the review:
1. Is `Dev` the right default template (instead of the spec's `Custom`), for the reasons above?
2. Should the panel's Model become editable? If yes, the server PATCH must accept `model`
   (a server change, out of my Allowed files), or we keep it read-only.

## Review (written by Claude)
