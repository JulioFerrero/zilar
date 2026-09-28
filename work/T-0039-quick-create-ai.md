---
id: T-0039
title: Web — quick "New AI" dialog (one screen, safe defaults) and an AI side panel in the chat, replacing the 6-step wizard and the edit page
status: todo
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

## Review (written by Claude)
