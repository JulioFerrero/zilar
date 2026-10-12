---
id: T-1170
title: "WUX-3 + WUX-6: web keeps a composer draft per chat (survives chat switches and reloads, 'Draft:' in red in the list row) and focuses the composer when a chat opens on a wide screen and when the user starts typing with nothing focused"
status: merged
milestone: M5
branch: task/T-1170-web-composer-drafts-focus
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1170: Per-chat drafts and composer focus on web

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-3 and WUX-6 (P1, confirmed). Telegram keeps a draft per chat and focuses the composer.
- **WUX-3:** the composer text is `useState('')` (`apps/web/src/components/Composer.tsx:26`), and `ChatView` is keyed by chat id (`apps/web/src/routes/ChatShell.tsx:58`), so switching chats unmounts the composer and drops the text. The comment at `Composer.tsx:70-71` ("The draft text itself stays") is wrong. The store's `drafts` are AI reply drafts, not user drafts.
- **WUX-6:**
  - the textarea (`apps/web/src/components/composer/ComposerControls.tsx:193-210`, ref at `:194`) has no focus on open;
  - no listener forwards typing to it: there is only Cmd+K in `apps/web/src/components/SearchBar.tsx:15-24` and Esc in `ChatShell.tsx:30-38`.
- **File sizes:** `Composer.tsx` is 394 lines and `apps/web/src/store/store.ts` 394. Neither may grow past 400, so the new logic goes in new files. The localStorage pattern to copy is `apps/web/src/lib/topicsUi.ts:1-30` (`storageStep`: a blocked storage never breaks the UI).

### What to build
1. **A new `apps/web/src/lib/composer-drafts.ts`:** a small external store (no store.ts change), with:
   - `getDraft(chatId)` and `setDraft(chatId, text)`; empty text deletes the draft;
   - `subscribe(listener)` and a `useComposerDraft(chatId)` hook through `useSyncExternalStore`;
   - persistence in `localStorage` under `zilar:composerDrafts:<userId>`, read once and written debounced at about 300 ms, with the `topicsUi.ts` `storageStep` safety;
   - a cap: at most 200 drafts, each at most 4000 characters.
2. **The composer:** create `apps/web/src/components/composer/useDraftValue.ts`, a hook that returns `[value, setValue]`. Its initial value comes from `getDraft(chatId)` and every change writes `setDraft`. Use it in place of `useState('')` at `Composer.tsx:26`.
   - Sending clears the draft. Find where the composer resets `value` after a send, and make sure that path goes through the hook.
   - Fix the comment at `:70-71`.
   - `Composer.tsx` must not grow; move lines into the hook if needed.
3. **The list row** (`apps/web/src/components/ChatListItem.tsx:42-46`): when the chat isn't the open one and has a draft, show `Draft:` in `text-danger`, followed by the draft's first line, in place of the last-message preview.
4. **Focus:**
   - in `useDraftValue.ts`, or a new `apps/web/src/components/composer/useComposerFocus.ts`, focus `textareaRef` when `chatId` changes and the layout is wide. Use the same breakpoint as the Tailwind `wide:` variant; find it, and cite it;
   - in `apps/web/src/routes/ChatView.tsx`, add a `document` `keydown` listener. When `event.target` is `document.body`, there's no modifier (Ctrl, Meta or Alt) and `event.key.length === 1`, focus the textarea so the key lands in it.
   - It never steals focus from an input, a dialog or the search bar.
5. **Tests:** none (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-3, WUX-6), `apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/ComposerControls.tsx:80-110,185-240`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/routes/ChatShell.tsx`, `apps/web/src/components/ChatListItem.tsx` and `apps/web/src/lib/topicsUi.ts`.

### Allowed files
`apps/web/src/lib/composer-drafts.ts`, `apps/web/src/components/composer/useDraftValue.ts`, `apps/web/src/components/composer/useComposerFocus.ts`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/routes/ChatView.tsx`, `work/T-1170-web-composer-drafts-focus.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines, and `Composer.tsx` doesn't grow.
- **The lead's check on the live web:**
  - type in chat A, open B, then back to A: the text is still there;
  - A's row shows "Draft:" while B is open;
  - opening a chat focuses the composer;
  - typing with nothing focused lands in the composer.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/lib/composer-drafts.ts` (new, 150 lines)** — the per-chat draft store, outside React:
  - `getDraft(chatId)` / `setDraft(chatId, text)`; empty text deletes the draft; `subscribe(listener)`; `useComposerDraft(chatId)` via `useSyncExternalStore`.
  - Persists in `localStorage` under `zilar:composerDrafts:<userId>` (the store's `currentUserId`, the same id sibling keys like `zilar:lastRead:<userId>` use). Read once per user, written debounced at `WRITE_DELAY_MS = 300`. `storageStep` mirrors `lib/topicsUi.ts`, so a blocked/corrupt storage never breaks composing.
  - Caps: at most `MAX_DRAFTS = 200` (oldest evicted past the cap), each at most `MAX_DRAFT_LENGTH = 4000` chars (truncated), enforced on write and re-clamped on read.
- **`apps/web/src/components/composer/useDraftValue.ts` (new, 19 lines)** — returns `[value, setValue]`; the value is the stored draft for `chatId` and every call writes it back through `setDraft`. Used in place of `useState('')` in `Composer.tsx`. Every path that resets the composer (send text, send attachment, cancel an edit) goes through this `setValue`, so a send leaves no draft.
- **`apps/web/src/components/Composer.tsx`** — `useState('')` → `useDraftValue(chatId)`; calls `useComposerFocus`; fixed the wrong comment (`The draft text itself stays, as it did before`) to say the text is kept per chat in the drafts store. Added `setValue` to the edit-mode effect's deps (oxlint exhaustive-deps; it is stable via `useCallback[chatId]`). **394 lines, unchanged.**
- **`apps/web/src/components/composer/useComposerFocus.ts` (new, 73 lines)** — registers the composer's textarea and, on a wide layout, focuses it when `chatId` changes (and on first mount). Exports `focusComposer()` for ChatView's listener. Never focuses when the active element is an input/textarea/select, a contenteditable or inside a `[role="dialog"|aria-modal]`. The wide breakpoint is Tailwind's `wide:` variant, **900px** (`apps/web/src/index.css:16`, `--breakpoint-wide`), the same query `ChatShell` uses.
- **`apps/web/src/routes/ChatView.tsx`** — a `document` `keydown` listener: when `event.target === document.body`, there is no Ctrl/Meta/Alt and `event.key.length === 1`, it calls `focusComposer()` so the key lands in the textarea.
- **`apps/web/src/components/ChatListItem.tsx`** — when the chat is not the open one (`!selected`) and has a composer draft, the row shows `Draft:` in `text-danger` followed by the draft's first line, in place of the last-message preview.
- Tests: none written — UI change, and AGENTS.md says UI code gets no tests.

### Files changed
`apps/web/src/lib/composer-drafts.ts` (new), `apps/web/src/components/composer/useDraftValue.ts` (new), `apps/web/src/components/composer/useComposerFocus.ts` (new), `apps/web/src/components/Composer.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/routes/ChatView.tsx`, `work/T-1170-web-composer-drafts-focus.md`. All inside Allowed files. No file exceeds 400 lines (`Composer.tsx` stays at 394).

### Commands and results
- `pnpm install` — Done.
- Single test files: **none run** (no test file is near the change; the change is UI-only).
- `pnpm gate` (final run, from the repo root):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.7s)
PASS  lint  (0.7s)
PASS  typecheck  (3.2s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

(The first `pnpm gate` run failed lint on `Composer.tsx:91 react-hooks(exhaustive-deps)`; I added `setValue` to that effect's deps and re-ran, green.)

### Deviations and notes
- **Edit mode and drafts:** the spec says "every change writes `setDraft`", so entering edit mode prefills the draft with the message's text and leaving edit clears it (via the existing reset). That means editing a message replaces and then drops the in-progress draft. I followed the spec literally and did not add extra state; flagging it as an open question (Telegram keeps the composer draft separate from the edit bar).
- The draft value is the single source of truth: `useDraftValue` returns the store value, so the list row and the composer can never disagree.
- `useComposerDraft` scopes the module store to the store's `currentUserId` during render (the codebase's "adjust state when a prop changes" pattern), loading that user's drafts in the same pass. The debounced write captures the user id and a snapshot of the map when scheduled, so switching accounts inside the debounce window cannot write one user's drafts under another's key.
- Security check (AGENTS.md): no secrets/tokens are involved; drafts are user content keyed per user id, capped in count and length, and storage failures are ignored; the ChatView listener only acts when focus is on `document.body` (never steals from inputs, dialogs or search).

### Round (fix round 1)

Findings fixed (one commit each):
- **Finding 1 (must-fix), commit `cbec94a37`:** entering edit mode clobbered the in-progress draft and leaving it deleted the draft. `useDraftValue.ts` now exports `beginEdit(chatId, text)` (keeps the current draft aside, then shows the edit text) and `endEdit(chatId)` (restores the kept draft). `Composer.tsx`'s edit-mode effect calls them in place of `setValue(text)`/`setValue('')`, and the misleading "leaving it clears" comment is corrected. `Composer.tsx` stays **394 lines**.
- **Finding 2 (should-fix), commit `a9b7ccb94`:** the wide-layout focus guard only inspected `document.activeElement`, so it still stole focus when a dialog was open but focus sat on `document.body`. `useComposerFocus.ts` now also bails whenever an overlay is open (`document.querySelector('[role="dialog"], [aria-modal="true"]')`), in both the chat-switch effect and `focusComposer()` (the type-to-focus path).
- Nits (findings 3–5) were left as they are: they are not in lines this round changed.
- Disagreements: none.

Tests added: **none**. The Spec says "Tests: none (UI)", AGENTS.md says UI code gets no tests, and both findings are UI behaviour; neither finding names a test. A test file is also outside the task's Allowed files, so adding one would leave a file outside scope (the gate's scope report lists such files). No single test file sits next to the changed sources, so none was run individually.

Gate (from the repo root, after both fixes):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (1.3s)
PASS  lint  (1.2s)
PASS  typecheck  (4.4s)
PASS  effect  (1.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Round (fix round 2)

Findings fixed (one commit each):
- **Finding 1 (should-fix), commit `e3d9d9cb8`:** `beginEdit` overwrote the set-aside draft on a second call for the same chat. Repro from the review: chat A has draft "hello"; the user starts editing message 1 (stash `"hello"`, composer `text1`), then opens another message's menu → Edit while still editing. The composer effect saw `editingId` change and called `beginEdit` again, replacing the stash with `text1`; cancelling restored `text1` and "hello" was silently lost. `apps/web/src/components/composer/useDraftValue.ts:15` now stashes only when nothing is set aside for that chat (`if (!draftsSetAside.has(chatId)) { draftsSetAside.set(chatId, getDraft(chatId)); }`), so the first draft survives and `endEdit` restores it. The doc comment names the second-edit case.
- Nits (findings 2–4) were left as they are: none sits in a line this round changed (`useDraftValue.ts:7` the per-user stash gap, `useComposerFocus.ts:74-79` the resize focus, `ChatListItem.tsx:45` the dead `?? ''`).
- Disagreements: none on the finding itself. Finding 2 (the per-user `draftsSetAside` nit) is a real gap but is not in a line this round changed, so per the round rules it was left alone.

Tests added: **none**. This conflicts on the surface with the round instruction "add or adjust a test for each behaviour fix": the Spec says **"Tests: none (UI)"** (line 40), AGENTS.md says UI code gets no tests, and a test file is outside the task's **Allowed files**, so adding one would put a file outside scope (the gate would print `scope: 1 file(s) outside the Allowed files`). A unit test for the stash behaviour would have to be a new `apps/web/src/components/composer/useDraftValue.test.ts`. I treated the Spec and Allowed files as authoritative and did not add it; if the lead wants that unit test, the Allowed files must name it. No single test file sits next to the changed source, so none was run individually.

Gate (from the repo root, after the fix):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (3.1s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Round (fix round 3, lead-requested)

Findings fixed (one commit each):
- **Finding 1 (should-fix), commit `fc9805399`:** `draftsSetAside` in `apps/web/src/components/composer/useDraftValue.ts` is now keyed by user and chat (`${setAsideUserId}:${chatId}`), with `setAsideUserId` taken from the same `currentUserId` the draft store uses (`useChatSelector((s) => s.currentUserId)`, read once in `useDraftValue`). `scopeSetAside` clears the whole map whenever the signed-in user changes, so one account's stashed text can never be restored into another's composer. `endEdit` is now a no-op when nothing is set aside for the current user+chat (a switch dropped the stash), so it cannot write the previous account's text — or an empty string over the new account's draft — into the current composer. Composer.tsx call sites were left unchanged, so it stays at 394 lines.
- **Finding 2 (nit), commit `a1c6a3df3`:** the debounce in `apps/web/src/lib/composer-drafts.ts` is now per user. The scheduled user and map are held in `pendingUserId` / `pendingSnapshot`; `scopeToUser` calls the new `flushPersist()` to write the leaving user's pending draft before `scopedUserId` changes, so a draft typed in the last 300 ms before an account switch is persisted instead of being replaced by the new user's first keystroke.
- **Finding 3 (nit), commit `894674b30`:** `useComposerFocus`'s focus effect now depends on `[chatId, textareaRef]` only. `isWide` is read through a ref (synced in its own effect), so a narrow→wide resize no longer focuses the composer; only a chat change or the first mount does, as the Spec asks. The ref is initialised from `useMediaQuery`'s first render value, so the mount-time focus on a wide layout is unchanged.
- Finding 4 (the `ChatListItem.tsx:45` dead `?? ''`) was not in the lead's list; left as it is.
- Disagreements: none.

Tests added: **none**. The lead's fix round did not ask for tests; the Spec says "Tests: none (UI)", AGENTS.md says UI code gets no tests, and a test file is outside the task's Allowed files (it would appear in the gate's scope report). No test file sits next to the changed sources, so none was run individually.

Gate (from the repo root, after the three fixes):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.9s)
PASS  typecheck  (5.7s)
PASS  effect  (1.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 2 auto rounds and 1 lead round. One should-fix is accepted as a follow-up.**
- **`composer-drafts.ts`:** an external store per user (`zilar:composerDrafts:<userId>`), with a debounced persist that's flushed on a user switch, and caps of 200 drafts and 4000 characters.
- **`useDraftValue`:** the composer value comes from the chat's draft, a send clears it, and the edit stash is keyed by user and chat.
- **The list row** shows "Draft:" in red when the chat isn't open.
- **Focus:** on a chat change in the wide layout, and type-to-focus from the body. It never steals focus from inputs or dialogs.
- **Sizes:** `Composer.tsx` stays at 394 lines.
- **Accepted follow-up:** an orphaned edit stash (switching chats in the middle of an edit, then coming back) can restore the older draft over newer text (`useDraftValue.ts:34`). It's narrow and stays inside one user's data.
- **Still to do:** the live check on web.
