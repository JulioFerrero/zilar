---
id: T-0057
title: Web polish — chat-list Retry keeps the loaded list visible; model picker clearly separates the input from the suggestions (D24)
status: merged
milestone: M2
branch: task/T-0057-web-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0042, T-0052]
estimate: 0.5 day
---

# T-0057: Web polish (Retry, model picker)

## Spec (written by Claude, do not edit)

### Goal

Two small things the lead noticed in reviews.

1. **Retry flashes skeletons over a loaded list** (from the T-0042 review). When the chat list is already on screen and a refresh fails, the error bar shows **Retry**. Clicking it briefly replaces the loaded list with skeleton rows, then brings the list back. A retry of a list that is already loaded must keep the list on screen. It shows a pending state on the Retry button only (disabled, with a spinner or "Retrying…"). Skeletons are only for a list that has never loaded.
2. **The model picker looks like three inputs** (seen live after T-0052). In the AI panel and the New AI dialog, the model text input and the suggestion options have the same look, so the suggestions read as more inputs.
   - Keep the input as a **well**.
   - Label the options as suggestions (a small muted mono `SUGGESTED` caption).
   - Render each option as a **raised segment/pill** row, with the selected one as the pressed or active segment, a check icon, and `aria-checked`.
   - Picking a suggestion fills the input. Typing a custom model deselects them all.
   Keep the behavior and the radiogroup semantics.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0042-web-loading-states.md`: its Review and its "Retry" notes
- `apps/web/src/components/ChatList.tsx` and its test; the store's chat-list load and retry path in `apps/web/src/store/realStore.ts` (read it; change it only if the flash comes from the store, see below)
- `apps/web/src/components/ais/ModelPicker.tsx` and its test; `AiPanel.tsx` and `NewAiDialog.tsx` (only to see how it's used)
- `docs/design/ui-style.md` §4 (the well and raised-segment recipes), and `apps/web/src/index.css` (the utilities to reuse)

### Allowed files
- `apps/web/src/components/ChatList.tsx`, plus its test
- `apps/web/src/store/realStore.ts`: **only** the chat-list retry path, if the flash comes from the store setting a loading state, plus a test in `realStore.test.ts`
- `apps/web/src/components/ais/ModelPicker.tsx`, plus its test
- `work/T-0057-web-polish-retry-models.md` and `work/screenshots/T-0057/**`

**Not allowed:** anything else. In particular, not `markdown.ts`, not the group or mention files (other tasks are editing those), not the server or mobile.

### Tests
- ChatList: with a loaded list and a failed refresh, Retry keeps the rows rendered (no skeleton), the button is pending while retrying, and success clears the bar. A never-loaded list still shows skeletons.
- ModelPicker:
  - the caption is there;
  - picking a suggestion fills the input and marks it `aria-checked`;
  - typing a custom value clears the selection;
  - keyboard selection within the radiogroup works.

### Visual check
Mock mode (`?mock=1`):
- the model picker in the AI panel (1440×900);
- the chat list with the error bar while retrying. Force the error through the mock or test seam; say how.

Save the screenshots to `work/screenshots/T-0057/` and look at them. **Stop any dev server you start.**

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/web
pnpm build
```

## Report (written by the worker when done)

### What I did

**1. Chat-list Retry keeps the loaded list (no skeleton flash)**

The flash came from the view, not the store. `ChatList` rendered `ChatListSkeleton` whenever `chatsState === 'loading'`, and `retryChats()` in `realStore.ts` sets `chatsState: 'loading'` for the whole retry. So a retry of an already-loaded list replaced the rows with skeletons until boot settled. The store path was already correct (it keeps `chats` untouched and only flips the flag), so I did not change `realStore.ts` or its test.

- `ChatList.tsx` now splits "no data yet" from "pending":
  - skeleton only when `chatsState === 'loading' && chats.length === 0` (a list that has never loaded);
  - the full-screen error only when `error && chats.length === 0`;
  - with rows present, an `error` or an in-flight retry shows the inline bar above the list.
- The pending state is a local `retryingChats` flag set when the user presses Retry (the error bar and the full-screen button both go through a `retryChats` handler that sets it). It is deliberately local and not derived from `chatsState`, so a keep-alive background refresh (`loading` with rows) does not disable the button.
- While pending: the bar text and the button read `Retrying…`, the button is `disabled` and `aria-busy="true"`, and a `Loader2` spinner sits in it. Success clears the bar because the store leaves `error`.
- Skeletons stay for a never-loaded list, including when a never-loaded list is retried.

**2. Model picker: input stays a well, options read as suggestions**

`ModelPicker.tsx`:
- the input now uses the `well-surface` recipe (recessed, `ui-style.md` §4) instead of the field look, so it no longer matches the options;
- the options sit under a small muted mono `SUGGESTED` caption (`font-mono`, 10px, uppercase);
- each option is a raised segment/pill row (the `raised-pill` recipe; the selected one uses `segment-raised`), with a `Check` icon and `aria-checked`;
- selecting a suggestion fills the input; typing a custom value checks none of them;
- behavior and radiogroup semantics are kept: `role="radiogroup"` with `aria-label="Model suggestion"`, each option `role="radio"` + `aria-checked`, and arrow/Home/End keys move the selection and focus (roving `tabIndex`).

I left `AiPanel.tsx` and `NewAiDialog.tsx` untouched; both already pass `provider`, `suggestions`, `value` and `onChange`, so they pick up the new look.

### Files changed (all inside Allowed files)
- `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatList.test.tsx`
- `apps/web/src/components/ais/ModelPicker.tsx`, `apps/web/src/components/ais/ModelPicker.test.tsx`
- `work/T-0057-web-polish-retry-models.md` (this report + status)
- `work/screenshots/T-0057/**` (new)
- Not changed: `realStore.ts` (the flash was not from the store) and its test, `AiPanel.tsx`, `NewAiDialog.tsx`, `aiForm.ts`, `markdown.ts`, group/mention files, server, mobile.

### Tests (new)
- `ChatList.test.tsx`
  - "keeps the loaded rows while a retry is in flight and clears the bar on success": error over loaded chats → press Retry → rows still rendered, no `Loading chats` skeleton, button `Retrying…` disabled and `aria-busy`; then `ready` removes the bar and the spinner. (The mock store's `retryChats` is a no-op, so the test overrides it to set `chatsState: 'loading'` exactly like the real store, then presses the real button.)
  - "shows skeletons when a list that never loaded is retried": empty + error → Retry → skeleton appears, error bar gone.
- `ModelPicker.test.tsx`
  - "labels the options as suggestions": the `SUGGESTED` caption is present;
  - "marks the picked suggestion as checked and fills the input": click fills the input and sets `aria-checked="true"` on it, `false` on the other;
  - "clears the selection when a custom value is typed": typing `my-custom-model` unchecks every option;
  - "moves the selection and focus with the arrow keys inside the radiogroup": `ArrowDown` checks the next option, moves focus to it and updates the input;
  - plus the two pre-existing tests (click sets the input; provider placeholder), unchanged and passing.

### Commands (real results)
- `pnpm install`: ok (`Done in 7.4s using pnpm v10.32.1`).
- `pnpm format:check`: pass. Two files needed `prettier --write` first (`ModelPicker.test.tsx`, `ChatList.tsx`); final run `All matched files use Prettier code style!`.
- `pnpm lint` (oxlint): pass (no output).
- `pnpm typecheck`: `9 successful, 9 total`.
- `pnpm exec turbo test --force --filter=@zilar/web`: **35 files, 261 tests, all passed** (up from 255 before this task; +6 new tests).
- `pnpm build`: `2 successful, 2 total`.

### Visual check (mock mode)
Dev server: `pnpm --filter @zilar/web dev --port 5199 --strictPort`, driven with the Chrome DevTools tools at 1440×900; **the dev server was stopped afterwards** (`no listener on 5199`, `no vite process`). Screenshots in `work/screenshots/T-0057/`:

- `model-picker-ai-panel-1440.png` — the AI panel on `/c/c-devai?mock=1&panel=ai`. The Model input is a clear recessed well; below it a mono `SUGGESTED` caption labels four raised pill rows; `gpt-4o-mini` is the pressed/active segment with a check. It reads as suggestions, not as three more inputs.
- `chatlist-error-bar-1440.png` — the chat list with the error bar (`Couldn't load chats` + Retry) over the loaded rows.
- `chatlist-retrying-1440.png` — the same list while retrying: rows still on screen, no skeleton, bar reads `Retrying…` with a spinner and the button is `Retrying…` (disabled).

**How I forced the error:** `?mock=1` uses the mock store, whose `chatsState` is read-only and whose `retryChats` is a no-op, so there is no URL knob to reach the error. I used the real store instead and stubbed `window.fetch` with a page init script: `/api/auth/get-session`, `/api/me` and `/api/contacts` return success, and `/api/chats` fails (500). A cached chat list is seeded in `localStorage` (`zilar:chatList`) so `start()` paints the rows immediately and the failing boot turns `chatsState` to `error`, which is exactly the "loaded list + error bar" case. Pressing Retry makes the second `/api/chats` call hang, so the pending `Retrying…` state stays on screen long enough to shoot. This is a browser-only stub, not a code change.

### Deviations / decisions
- The store already did the right thing, so I could not justify touching `realStore.ts` (Allowed "only if the flash comes from the store"). The fix is entirely in `ChatList`.
- The pending state is a component-local flag rather than a store field. That keeps the store's `loading` meaning "list not ready" for the skeleton rule and avoids a new `ChatStore` field. Trade-off: if the component unmounted mid-retry, the flag would reset — harmless, since the store's `chatsState` still governs the skeleton/error branches.
- I reused the existing `raised-pill` / `segment-raised` / `well-surface` utilities instead of adding new CSS, per `ui-style.md` §4.

### Blocked / needs a decision
Nothing. No new dependencies.

### Round 2 (lead review fixes)

All four review items fixed.

1. **ChatList: reset `retryingChats` when the retry settles.** A manual retry set `retryingChats` to `true` and nothing cleared it, so a later `loading` with rows could leave the button pending. The flag now resets when `chatsState` leaves `loading`, tracked with a `lastChatsState` and adjusted **during render** (an effect tripped oxlint's `react(set-state-in-effect)`; deriving during render is what the rule asks for and avoids a cascading render). New test: manual retry → pending → `error` (retry failed again) → the button is a plain, enabled `Retry` with no `aria-busy`; then a background `loading` with rows on screen keeps the rows and shows no `Retrying…` spinner.

2. **ModelPicker: removed the native `<datalist>`.** The pills replace it and its fixed `id="ai-model-suggestions"` could collide when two pickers are mounted. The `list` attribute on the input is gone too.

3. **`aria-busy`: `undefined` when not retrying.** Was `aria-busy={retrying}` (rendered `aria-busy="false"`); now `aria-busy={retrying || undefined}`, so the attribute is absent unless pending. The Round 2 ChatList test asserts it is `null` after the retry settles.

4. **ModelPicker keyboard tests.** Added ArrowUp wrap (first → last), ArrowDown wrap (last → first), and Home/End (jump to first/last), each asserting `aria-checked`, focus and the filled input. `Home`/`End` were already implemented; the tests now pin them. `ArrowDown` already had a test.

Round 2 commands (real results): `pnpm lint` pass (fixed a `react(set-state-in-effect)` error by moving the reset to render); `pnpm typecheck` `9 successful`; `pnpm exec turbo test --force --filter=@zilar/web` **35 files / 265 tests passed** (261 → 265, +4 new keyboard tests); `pnpm build` `2 successful`.

Note on `pnpm format:check`: it fails on `PREREVIEW.md`, an **untracked** file the lead added; it is neither mine nor in Allowed files, and the instruction is to leave it untracked, so I did not touch it. Every file I changed passes: `prettier --check` on the four source/test files reports `All matched files use Prettier code style!`.

Scope rechecked: only Allowed files changed plus the task file and `work/screenshots/T-0057/`; `PREREVIEW.md` left untracked and uncommitted.

## Review (written by Claude)

**Verdict: approved, merged.**

- The round 1 pre-review had one latent should-fix: `retryingChats` was never reset. Round 2 fixed it, and also removed the duplicate native `<datalist>`, set `aria-busy` to undefined when idle, and added keyboard tests. The round 2 pre-review is clean.
- The lead viewed `model-picker-ai-panel-1440.png`: the input is a well, then the `SUGGESTED` caption, then raised rows with a check on the selected one. It reads clearly as suggestions now.
