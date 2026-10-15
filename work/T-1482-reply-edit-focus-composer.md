---
id: T-1482
title: "Reply and Edit focus the composer on mobile and web: today mobile never focuses it (the user must tap the field after Reply), and web leaves focus on the body, so a touch user gets no keyboard"
status: merged
milestone: M5
branch: task/T-1482-reply-edit-focus-composer
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1482: Reply and Edit focus the composer

## Spec (written by Claude, do not edit)

### Why
In the lead's checks on 2026-10-15:
- **Android emulator (mock):** long-press a message, then Reply. The reply bar shows, but the composer is not focused: the only `EditText` has `focused="false"`, and text typed then goes nowhere. The user has to tap the field first.
- **Web, headless:** after Reply from the message menu, `document.activeElement` is `body`. A desktop keyboard still works through type-to-focus (`apps/web/src/routes/ChatView.tsx:132-142`), but a touch user gets no keyboard.

Telegram focuses the input on Reply and on Edit.

### Facts (the lead read them on main, 2026-10-15)
- **Mobile:**
  - `apps/mobile/src/components/chat/use-chat-screen.ts:183`: `startReply` only calls `setReplyTo(...)`.
  - `apps/mobile/src/components/chat/composer.tsx` (292 lines) has no ref and no `focus()` call. It gets `replyTo` (`:70`, a `ReplyRef` whose `id` is the message id, `packages/chat-core/src/types.ts:38-39`), and `editingId` is the edit key (`:117-118`).
  - `apps/mobile/src/components/chat/composer-input-row.tsx` (179 lines): `ComposerInputRow`'s props are `ComposerInputRowProps` (`:71-90`), and its `TextInput` is at `:123`.
- **Web:**
  - `apps/web/src/components/composer/useComposerFocus.ts` (85 lines) exports `focusComposer()` (`:40-50`). It focuses the textarea unless a dialog is open or another field has focus. The hook `useComposerFocus(chatId, textareaRef)` (`:57`) focuses on a chat change on wide layouts.
  - `apps/web/src/components/Composer.tsx` (393 lines) calls `useComposerFocus(chatId, textareaRef)` at `:33`. It reads `replyTo` (`:15`) and works out `editing` at `:35`.

### What to build
1. **Mobile, `composer-input-row.tsx`:** an optional `inputRef?: RefObject<TextInput | null>` prop passed to the `TextInput`'s `ref`.
2. **Mobile, `composer.tsx`:** create `const inputRef = useRef<TextInput>(null)` and pass it. Add an effect keyed on `replyTo?.id` and `editingId`: when either becomes defined, call `inputRef.current?.focus()`.
3. **Web, `useComposerFocus.ts`:** an optional third argument, `focusKey: string | undefined`. When it changes to a defined value, call `focusComposer()`, on every layout width. One short comment: Reply and Edit focus the composer, as in Telegram.
4. **Web, `Composer.tsx`:** pass `replyTo?.id ?? editingKey`, where `editingKey` is the message id of the edit in progress, or undefined.
   - Move the `useComposerFocus` call below the `editing` lookup if needed.
   - `Composer.tsx` may grow by at most 2 lines and must stay under 400.
5. Nothing else changes.

### Tests
None (focus behaviour).

### Allowed files
- `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-input-row.tsx`
- `apps/web/src/components/composer/useComposerFocus.ts`, `apps/web/src/components/Composer.tsx`
- `work/T-1482-reply-edit-focus-composer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Emulator (lead, mock):** long-press, then Reply or Edit: the keyboard opens with the composer focused, and typed text lands in it.
- **Web (lead, headless at 390 and 1280 px):** after Reply or Edit from the menu, `document.activeElement` is `#message-composer`.

---

## Report (written by the worker when done)

### What I did
Implemented Reply/Edit composer focus on both clients, per the spec.

**Mobile**
- `composer-input-row.tsx`: added an optional `inputRef?: RefObject<TextInput | null>` prop and passed it to the `TextInput`'s `ref` (`ref={inputRef}`).
- `composer.tsx`: added `const inputRef = useRef<TextInput>(null)` and passed it to `ComposerInputRow`. Added an effect keyed on the reply's message id and the edit key that calls `inputRef.current?.focus()` when either is defined. Imported `TextInput` from `react-native`.

**Web**
- `useComposerFocus.ts`: added an optional third argument `focusKey: string | undefined`. A new effect calls `focusComposer()` when `focusKey` is defined, on every layout width (one short comment added).
- `Composer.tsx`: moved the `useComposerFocus` call below the `editing` lookup and passed it `replyTo?.id ?? editingId` (where `editingId` is the edited message's id). Net growth: +1 line (392 → 393, under the 400 cap and within the at-most-2 allowance).

Nothing else changed.

### Files changed
- `apps/mobile/src/components/chat/composer-input-row.tsx` (+5)
- `apps/mobile/src/components/chat/composer.tsx` (+12)
- `apps/web/src/components/composer/useComposerFocus.ts` (+9)
- `apps/web/src/components/Composer.tsx` (+2/−1)
- `work/T-1482-reply-edit-focus-composer.md` (status/report)

### Commands and real results
- `pnpm install` — done in 10.8s, 1251 resolved (one pre-existing peer warning: `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18; unrelated to this task).
- No single test files: `grep` found no test file that references `Composer`, `ComposerInputRow`, `composer-input-row` or `useComposerFocus`. This matches the spec's "Tests: None (focus behaviour)" and AGENTS.md's "UI code gets no tests".
- `pnpm gate` (repo root, against `main`):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviation from the spec
- First gate run failed lint: `react-hooks(exhaustive-deps)` reported the mobile effect was missing the `replyTo` dependency when the deps array was `[replyTo?.id, editingId]`. To keep the effect keyed on the reply id (not the whole object, which would re-focus on every render) while satisfying the enforced rule, I introduced a primitive `const replyId = replyTo?.id` and used `[replyId, editingId]` with the body reading `replyId`. Behaviour is unchanged from the spec's intent.

### Open questions / notes
- None. The focus behaviour itself (emulator and headless web at 390/1280 px) is the lead's/julio's manual check per the Acceptance section; I did not run an emulator or headless browser.

### Fix round 1 (lead's emulator check)
The lead found that Edit focused the composer but the caret landed at the start of the seeded text, because the controlled `selection` state kept `{start: 0, end: 0}` from the empty field.

- `apps/mobile/src/components/chat/composer.tsx` (only file changed): in the render-time seed block, materialised the seeded text in a local `seed`, kept `setEditText(seed)`, and set the selection with it — `setSelection({ start: seed.length, end: seed.length })` on entering edit and `setSelection(undefined)` on leaving. Added the comment "The caret goes to the end of the seeded text, as in Telegram (T-1482)." No new effect. File now 307 lines (< 400).
- `pnpm gate` after the fix: `gate: 5 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/web (no nearby test files)`, scope/migration/images/size all clean, `GATE PASS`.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1, accepted: re-tapping Reply on the same message does not refocus, a rare edge.
- **Emulator, mock, APK of `d2e8f4ca2`:**
  - long-press then Reply opens the keyboard, and typed text lands in the composer;
  - long-press then Edit opens the keyboard with the caret at the end ("Caret test" plus " edited" reads "Caret test edited"), and saving shows "edited".
  - Fix round 1 moved the caret to the end; the first round left it at the start.
- **Web, headless:** after Reply, focus is `#message-composer` (1280 px). After Edit, focus is `#message-composer` with the caret at the end (14 of 14) at 1280 and 390 px.
- **Found while checking (not this task):** on web, one Escape while replying also closes the chat. That is T-1484.
