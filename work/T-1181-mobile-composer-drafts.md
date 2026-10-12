---
id: T-1181
title: "MUX-4: mobile keeps a composer draft per chat (survives leaving the chat and app restarts, per signed-in user), cleared on send; the chat list row shows 'Draft:' in red"
status: merged
milestone: M5
branch: task/T-1181-mobile-composer-drafts
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1181: Per-chat drafts on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-4 (P1, confirmed by code). Web got the same fix in T-1170: see `apps/web/src/lib/composer-drafts.ts` and `apps/web/src/components/composer/useDraftValue.ts` on main.
- **The composer text is local state** (`apps/mobile/src/components/chat/composer.tsx:93`), and the chat route unmounts on back, so leaving a chat loses what you typed.
- **The edit-mode prefill** (`composer.tsx:103-115`) stashes the typed text in `previousDraft` and restores it when you leave edit mode.
- **The list row** preview is at `apps/mobile/src/components/chat/chat-list-item.tsx:117-121`.
- **Storage:** the app has `expo-file-system` and `expo-secure-store` (not for this: drafts aren't secrets, and SecureStore is per-key and small). The JSON-backend pattern to copy is `apps/mobile/src/lib/stickers-storage.ts:15-40`.

### What to build
1. **A new `apps/mobile/src/lib/composer-drafts.ts`:** an external store with:
   - `getDraft(chatId)` and `setDraft(chatId, text)`; empty text deletes the draft;
   - `subscribe` and a `useComposerDraft(chatId)` hook (`useSyncExternalStore`);
   - drafts keyed per signed-in user id; switching users never shows another user's drafts;
   - persistence in a JSON file under `FileSystem.documentDirectory`, read once at start and written debounced at about 500 ms. A read or write error leaves the in-memory drafts working;
   - caps: 200 drafts, 4000 characters each.
2. **`composer.tsx`:**
   - the initial `text` comes from `getDraft(chatId)`, and every change calls `setDraft`. A send clears it;
   - keep the edit-mode stash working: while editing, don't overwrite the stored draft with the edit text;
   - `composer.tsx` stays at most 400 lines. If needed, put the hook in a new `apps/mobile/src/components/chat/use-draft-text.ts`.
3. **`chat-list-item.tsx`:** when the chat has a draft, show `Draft:` in the danger colour, then the draft's first line, in place of the preview.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-4), `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/lib/stickers-storage.ts`, and on main `apps/web/src/lib/composer-drafts.ts` and `apps/web/src/components/composer/useDraftValue.ts`.

### Allowed files
`apps/mobile/src/lib/composer-drafts.ts`, `apps/mobile/src/components/chat/use-draft-text.ts`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `work/T-1181-mobile-composer-drafts.md`.

Added by the lead on 2026-10-12 for the fix round: `apps/mobile/src/components/chat/channel-composer-bar.tsx`, `apps/mobile/src/lib/composer-drafts.test.ts` (to delete).

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:** type in chat A, go back and open B, then return to A, and the text is there; A's row shows "Draft:".

---

## Report (written by the worker when done)

### What I did
- **`apps/mobile/src/lib/composer-drafts.ts` (new, 233 lines).** A standalone external store, the
  mobile twin of `apps/web/src/lib/composer-drafts.ts`: `getDraft(chatId)` / `setDraft(chatId, text)`
  (empty deletes), `subscribe`, `useComposerDraft(chatId)` via `useSyncExternalStore`, the 200-draft /
  4000-char caps, and a 500 ms debounced write. Drafts are scoped per signed-in user id (read from
  `useChatStore(state => state.currentUserId)` in the hook); a switch drops the old user's in-memory map
  and loads the new user's, so one account never sees another's text.
- **Persistence.** One JSON file `zilar-composer-drafts.json` under `FileSystem.documentDirectory`
  (`expo-file-system/legacy`, imported dynamically inside the read/write helpers). The file is
  `userId -> { chatId: text }`; it is read once (a shared promise guards re-reads) and the last read
  value is kept per user so persisting one user never drops the others. The raw file is validated with
  an `effect` `Schema` decode (effect is the parser mobile already uses; mobile has no `zod`). Any read
  or write error (missing file, no documents dir, corrupt JSON, full disk) is swallowed, leaving the
  in-memory drafts working.
- **`apps/mobile/src/components/chat/use-draft-text.ts` (new, 25 lines).** `useDraftText(chatKey)`
  returns the stored draft plus a setter that writes back through `setDraft`. A composer with no chat
  id falls back to local state, so the component still works with the prop omitted.
- **`apps/mobile/src/components/chat/composer.tsx` (294 lines).** The text is now the chat's draft:
  the non-editing value is the store draft and every change writes it; a send clears it. Edit mode
  renders the target message's text in a local `editText` overlay and never writes the store, so the
  draft is untouched while editing and is restored on cancel or on edit-send (web's stash semantics).
  Removed the now-unneeded `previousDraft` state and `handleCancelEdit`; the edit bar cancels through
  the store directly.
- **`apps/mobile/src/components/chat/chat-list-item.tsx` (147 lines).** A chat with a draft shows
  `<Text class="text-danger">Draft:</Text> <first line>` in place of the preview, after the
  typing/writing label and before the deleted-message preview, matching web's precedence. The existing
  `hasDraft` (the AI reply draft stream) is left as is.

### Commands and real results
- `pnpm install` — done (resolved 1270, added 1180; peer warning only).
- `pnpm gate` — **GATE PASS**. Summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file was run: no test imports `composer.tsx` or `chat-list-item.tsx` (grep of
  `*.test.ts*` found none), and the spec says UI gets no tests. The mobile package suite is covered by
  the gate's `tests @zilar/mobile` step above.

### Deviations from the spec
- The audit note suggested a store slice; the spec itself asks for `apps/mobile/src/lib/composer-drafts.ts`,
  so I followed the spec (store files were not in Allowed files anyway).
- The hook lives in the new `use-draft-text.ts` (explicitly allowed) to keep `composer.tsx` small and to
  give a composer without a chat id a local fallback.
- "Read once at start" is implemented as one read per app session on the first hook mount, not at module
  import: the file read is async, and the composer is reactive so the draft appears as soon as the read
  resolves.
- Storage is a single file with a per-user map rather than one file per user (avoids unsafe file names).
- No test seam (`setBackend`) was added, since the spec asks for no tests and it would be dead code.

### Checked
- Line counts: composer-drafts.ts 233, use-draft-text.ts 25, composer.tsx 294, chat-list-item.tsx 147
  (all ≤ 400).
- No secrets or user text reach logs; drafts are not secrets and are never logged. No `any`,
  no `@ts-ignore`, no new dependencies.

### Open questions
- None.

## Round (fix round)

Findings from `PREREVIEW.md`: 1 must-fix, 0 should-fix, 2 nits.

- **Finding 1 (must-fix) — fixed.** `apps/mobile/src/lib/composer-drafts.ts`. Scoping is now split.
  `scopeToUser` runs during render (like web's store) and drops the previous user's map
  synchronously, so the first paint after a switch already reads the new user's drafts and never the
  old user's text; once the file has been read, a switch also restores the new user's drafts from
  memory. `loadScopedDrafts` runs in the effect, always `emit()`s — including when the new user has
  no stored drafts — so the composer and the chat rows re-read. The stale-snapshot path and the
  missing emit are both gone.
- **Finding 2 (nit)** — left as is. It sits on lines the fix rewrote, but its behaviour (text typed
  while the file is loading wins over the stored draft) is deliberate and the alternative is a
  product judgement, not a defect.
- **Finding 3 (nit)** — left as is; `chat-list-item.tsx:56` is outside this change.

Tests added: `apps/mobile/src/lib/composer-drafts.test.ts` (3 cases: synchronous clear on switch,
stored-draft isolation between users, and the emit when the new user has no stored drafts). The test
file is outside the task's original Allowed files; it is added per the fix-round instruction.

| Command | Result |
| --- | --- |
| `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/composer-drafts.test.ts` | 3 passed |
| `pnpm gate` | **GATE PASS** (install 1.3s, format 0.9s, lint 0.7s, typecheck 3.8s, effect 1.4s, `tests @zilar/mobile` 1.9s) |

Scope names the new test file only; every production file is inside the Allowed files.

## Round 2 (lead fix round)

Two items from the lead:

1. **Deleted `apps/mobile/src/lib/composer-drafts.test.ts`.** The spec said "No tests", and drafts
   storage is not auth/keys, permissions/money or the message pipeline, so the test from round 1 is
   removed.
2. **`apps/mobile/src/components/chat/channel-composer-bar.tsx` now passes `chatKey={chat.id}` to its
   `Composer`**, so channel feeds share the same per-chat draft store as `chat-composer-dock.tsx`
   (which already passed it) instead of falling back to local, non-persisted text.

`pnpm gate` → **GATE PASS** (install 1.5s, format 0.6s, lint 0.6s, typecheck 3.3s, effect 0.9s,
`tests @zilar/mobile` 1.6s). Scope clean.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round and 1 lead round. The pre-review is clean, with 1 nit.**
- **`lib/composer-drafts.ts`:**
  - an external store per user, persisted to a JSON file in `documentDirectory` (`expo-file-system/legacy`) and debounced;
  - caps of 200 drafts and 4000 characters;
  - a read or write error keeps the in-memory drafts.
- **The composer** seeds from the draft and writes on change; a send clears it, and the edit stash is kept.
- **The list row** shows "Draft:" in red.
- **Lead round:**
  - deleted the drafts unit test (Julio's minimal-tests rule);
  - the channel composer passes `chatKey`.
- **Still to do:** the emulator or phone check with the next APK.
