---
id: T-1852
title: "Web chat header: the topic people line (avatars + 'group · N') opens the topic panel instead of a dead #in-this-topic anchor, and the header avatar opens the chat's panel like the title does"
status: merged
milestone: M5
branch: task/T-1852-web-header-opens-panel
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1852: The header people line and avatar open the panel (web)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** The lead tried it live in "ai test › cards test":
- **The people line:** clicking the small avatars and "ai test · 4" under the title only changes the URL to `#in-this-topic`. Nothing has that id, so nothing opens.
- **The header avatar:** the chat's round avatar at the left of the header does nothing. Telegram opens the chat info from it.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/topic/TopicPeopleLine.tsx`** (169 lines): when nobody is writing, it renders `<a href="#in-this-topic" className="flex h-5 min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">` around the `AvatarStack` and the label (`:160-167`). The writing state is a `role="status"` span (`:143-154`).
- **`apps/web/src/components/ChatHeader.tsx`** (395 lines):
  - `openPanel = onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel ?? onOpenContactPanel` (`:88`);
  - `line2` renders `<TopicPeopleLine chat groupTitle names />` for a topic (`:161-163`);
  - for a topic, the title button and `line2` are siblings (`:184-197`);
  - the header avatar is `<EntityAvatar chat={chat} size={36} online=… ai=… />` at `:182`, not clickable.
- **The fixture** `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx` renders `TopicPeopleLine` without any handler (`:83-98`).

### Steps
1. **`TopicPeopleLine`:** add an optional `onOpen?: () => void` prop.
   - **With it,** the idle line is a `<button type="button" onClick={onOpen} aria-label="People in this topic">` with the same classes, plus `rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`.
   - **Without it,** the line is a plain `<span>` with the same classes.
   - **Remove the `#in-this-topic` href.**
2. **`ChatHeader`:**
   - pass `onOpen={openPanel}` to `TopicPeopleLine`;
   - wrap the header `EntityAvatar` in a `<button type="button" onClick={openPanel} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full">` when `openPanel` is defined. The title button stays the one keyboard stop.
   - **`ChatHeader.tsx` must stay at most 400 lines.** If it would pass that, move the `line1` and `line2` builders into a new `apps/web/src/components/ChatHeaderLines.tsx`.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/topic/TopicPeopleLine.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/ChatHeaderLines.tsx`
- `work/T-1852-web-header-opens-panel.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In a topic,** clicking the people line opens the topic panel.
- **In any chat with a panel,** clicking the header avatar opens it.
- **No `#in-this-topic` URL** remains anywhere.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`TopicPeopleLine.tsx`:** added `onOpen?: (() => void) | undefined`. The idle line now renders a `<button type="button" onClick={onOpen} aria-label="People in this topic">` when a handler is passed, with the previous classes plus `rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`; with no handler it renders a plain `<span>` with the same classes. The dead `href="#in-this-topic"` is gone. The writing state is unchanged.
- **`ChatHeader.tsx`:** passes `onOpen={openPanel}` to the second line; wraps the 36 px header `EntityAvatar` in `<button type="button" onClick={openPanel} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full">` when `openPanel` is defined (plain avatar otherwise). The title button remains the keyboard stop.
- **`ChatHeaderLines.tsx` (new):** the spec's escape hatch for the 400-line cap: `line1` and `line2` moved into `ChatHeaderTitle` and `ChatHeaderSubtitle`. `ChatHeader.tsx` is now 392 lines (new file is 62). The subtitle/typing-dots and connection/AI-line precedence are unchanged.

### Checks run
- `pnpm gate` (final): `GATE PASS`, `gate: 4 changed file(s) against main`, PASS install (frozen), format, lint, typecheck, effect; `SKIP tests @zilar/web (no nearby test files)`; scope, migration, images and size checks all clean; every changed file inside the Allowed files.
- First gate run failed on `prettier` for the new file (fixed with `pnpm exec prettier --write apps/web/src/components/ChatHeaderLines.tsx`), then on `typecheck` with TS2375 because `exactOptionalPropertyTypes` rejects an explicit `undefined` for `onOpen?: () => void`; changed the prop to `onOpen?: (() => void) | undefined`. The final gate above passed with no further changes.
- No unit tests run: the spec says no tests (UI), and the gate reported no nearby test files for `@zilar/web`.
- `grep -rn "in-this-topic"` over `*.ts`/`*.tsx`/`*.html`/`*.md` outside `node_modules`: no app code hit. Remaining hits are the design mockup (`docs/design/mockups/topic-people/WebTopic.dc.html`), the older T-1779 task file and this task's own spec text — all outside the Allowed files and left untouched.

### Notes for the lead
- I did not run the app in a browser, so the click behavior is verified by code reading only, not live. `ChatHeader` passes `openPanel` to both the people line and the avatar, and `openPanel` is the same `onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel ?? onOpenContactPanel` used by the title button.
- The header avatar button is `aria-hidden` + `tabIndex={-1}` as specified; the title button is still the only keyboard stop. Screen readers therefore open the panel through the title button.
- `ChatHeader` is 392 lines, under the 400-line cap; `ChatHeaderLines.tsx` holds the two line builders.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `632ba6b77`.
- **The mock check** ran on the branch in vite at 1440 px, in "Dev team › Checkout button hidden on Safari":
  - clicking the people line ("Dev team · 5") opens the topic panel;
  - on a fresh load, clicking the header avatar opens it too.
- **No `#in-this-topic` is left in `apps/web/src`.**
- **`ChatHeader.tsx`** is 392 lines; the line builders moved to `ChatHeaderLines.tsx`.
