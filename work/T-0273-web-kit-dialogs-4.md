---
id: T-0273
title: "Web kit migration 6: the NewChatButton pickers and the GroupHandleRoute dialogs render through the kit Dialog"
status: merged
milestone: M5
branch: task/T-0273-web-kit-dialogs-4
model: auto
effort: low
depends_on: [T-0270]
estimate: 0.3 day
---

# T-0273: last chat dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 4. The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`, after T-0270) has:
- the topmost-only Escape, the focus trap and focus return, and `initialFocusRef`;
- `dismissable`, `ariaLabel` and `size: 'sm' | 'md' | 'lg'`;
- an 85vh cap with a scrolling body between a fixed title and a fixed footer.

### Verified facts (do not re-derive)
- `apps/web/src/components/NewChatButton.tsx` has its own Escape handlers at lines 132 and 148 and two shells:
  - `role="dialog"` at line 267, `aria-label="Choose a group"`, with a `max-w-xs … bg-panel p-4` panel;
  - `role="dialog"` at line 298, `aria-label="New message"`.
  - Test: `apps/web/src/components/NewChatButton.test.tsx`. It queries dialogs by name, for example `getByRole('dialog', { name: 'New group' })`; that name comes from `NewGroupDialog`, already on the kit.
- `apps/web/src/routes/GroupHandleRoute.tsx` has two shells:
  - `role="dialog"` at line 108 (`aria-label={`Open @${handle}`}`), panel `max-w-sm … bg-background p-6 text-center`;
  - `role="dialog"` at line 199, with its own Escape at line 157.
  - Test: `apps/web/src/routes/GroupHandleRoute.test.tsx`.

### What to build
1. All four shells render through the kit `Dialog`:
   - keep each accessible name, through `title` or `ariaLabel`;
   - use `size="sm"`; a `max-w-xs` panel may become `sm`, or add `size: 'xs'` to the kit with a fixture case and a kit test if the narrower width matters for the picker;
   - delete the own Escape handlers, backdrops and panel markup;
   - keep every text, list, button and behaviour; GroupHandleRoute's centered text may stay centred inside the body.
2. Existing tests keep passing, changed only where they relied on the old markup. Each migrated dialog has a test that Escape closes it.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `work/T-0270-web-kit-dialogs-3.md` (Report), and the two files with their tests.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/NewChatButton.test.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `work/T-0273-web-kit-dialogs-4.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit NewChatButton GroupHandleRoute fixtures
pnpm gate
```

### Acceptance
- Neither file contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
`AvatarUploader`, `StickerPanel`, `ExplorePage` and the side panels.

---

## Report (written by the worker when done)

### What I did

Moved the last four chat dialog shells onto the kit `Dialog` (all `size="sm"`). Neither file keeps a `role="dialog"`, a backdrop, panel markup or a dialog Escape handler.

- **`NewChatButton.tsx`**
  - The **"Choose a group"** topic picker renders through `<Dialog open onClose={closeDialog} title="New topic in…" ariaLabel="Choose a group" size="sm">`. The visible title stays `New topic in…`; `ariaLabel` keeps the old accessible name `Choose a group` (it differs from the visible title). The group buttons stay as the body.
  - The **"New message"** dialog renders through `<Dialog open onClose={closeDialog} title="New message" description="Invite a friend…" size="sm" actions={Close + Invite a friend}>`. The helper text stays as the kit `description`; both buttons keep their texts and classes.
  - Deleted the inline "New message" Escape effect. The kit now owns Escape, the focus trap and focus return. Kept the **menu's** Escape effect (lines 133–138): it is the new-chat menu, not a dialog, and the T-0062 tests require it.
- **`GroupHandleRoute.tsx`**
  - The **`Open @handle`** error state renders through `<Dialog title="Couldn't open this link" ariaLabel={`Open @${handle}`} size="sm" actions={Retry + Close}>`. The message stays in the body as `<p role="alert">` so the existing `getByRole('alert')` assertion still passes; Retry keeps its lookup behaviour.
  - The **`Join <group>`** card renders through `<Dialog title={entry.title} ariaLabel={`Join ${entry.title}`} size="sm">`. The avatar, `@handle`, description, member count, error, join button and Close stay in the body; the body keeps `text-center` as the spec allows. Deleted the card's own Escape effect.
- **Tests**
  - `NewChatButton.test.tsx`: added `closes the Choose a group picker with Escape and returns focus to the trigger` (seeds two topic-capable groups so the picker, not `NewTopicDialog`, opens). The existing "New message" Escape test now exercises the kit.
  - `GroupHandleRoute.test.tsx`: added `closes the group card with Escape` and `closes the error card with Escape`.
  - No existing assertion needed changing.

### Files changed

`apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/NewChatButton.test.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `work/T-0273-web-kit-dialogs-4.md`.

`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx` and `apps/web/src/components/ui/kit.test.tsx` were allowed but needed no change: `size="sm"` covers the old `max-w-xs` panels, which the spec permits, so I did not add an `xs` size.

### Commands and real results

- `pnpm install`: exit 0; `pnpm-lock.yaml` untouched.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit NewChatButton GroupHandleRoute fixtures`: 4 files passed, 116 tests passed.
- `pnpm exec prettier --check` on the four changed source/test files flagged `GroupHandleRoute.tsx`; `pnpm exec prettier --write apps/web/src/routes/GroupHandleRoute.tsx` fixed it (only whitespace).
- `pnpm gate` (repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (18.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (11.8s)
  PASS  tests @zilar/web  (18.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

- **Accessible names:** the picker's visible title (`New topic in…`) differs from its accessible name (`Choose a group`), so it uses `ariaLabel`; the message, error and card either use `title` or `ariaLabel` where the old `aria-label` differed from the visible heading. All four old names are preserved.
- **`size="sm"` for all four.** The two `NewChatButton` panels were `max-w-xs`; the spec allows these to become `sm`, so no `xs` was added.
- **NewChatButton still has an Escape handler** — the new-chat menu's, not a dialog's (needed by the T-0062 menu tests). The acceptance line "neither file contains … its own Escape handler" is read as the migrated dialog handlers.
- **Chrome/visual:** the kit owns the panel (`border-border bg-panel max-w-sm max-h-[85vh]`, `18px` fixed title, scrolling body, right-aligned footer). On the group card the kit title now sits above the avatar and is left-aligned while the body text stays centred; the error dialog's Retry/Close are a right-aligned footer instead of centred. Texts, buttons and behaviour are unchanged.
- **One transient failure, not reproduced:** on the first combined run right after adding the tests, `closes the group card with Escape` failed once (the card was still in the DOM). It then passed alone, in three more combined runs and in `pnpm gate` (5/5). I could not reproduce it; flagging it honestly.

## Review (written by Claude)

Approved, clean pre-review with no fix rounds. All four shells now go through the kit `Dialog` and keep their accessible names. Each new Escape test checks that the dialog is present before and gone after. The menu keeps its own Escape (`role="menu"`, not a dialog), which is correct. A small visual change: the group card's title now sits in the kit title row, above the avatar, rather than below it. That is acceptable.
