---
id: T-1485
title: "Web accessibility fixes from an axe-core audit: the composer textarea drops the disallowed aria-expanded, scrolling code blocks and Markdown tables are keyboard-focusable, and the request Accept key names the person like mobile"
status: merged
milestone: M5
branch: task/T-1485-web-a11y-axe-fixes
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1485: Web axe fixes

## Spec (written by Claude, do not edit)

### Why
The lead ran axe-core 4.10.2 (WCAG 2 A and AA rules) headless over web mock on 2026-10-15, at 1280 and 390 px. The routes were `/`, Marta's and Dev AI's chats, and Settings, My AIs, Connections, Profile and Stickers. Only two rules fail:
- **`aria-allowed-attr` (critical) on `#message-composer`:** "ARIA attribute is not allowed: aria-expanded="false"". A `<textarea>` has the textbox role, which does not support `aria-expanded`.
- **`scrollable-region-focusable` (serious) on the Dev AI reply's code block `pre`:** a region that scrolls sideways must be reachable by keyboard.

Separately, the contact-request Accept key reads only "Accept", while its neighbour reads "Decline Nora". Mobile already says "Accept {name}" (`apps/mobile/src/components/chat/request-rows.tsx:254`).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/composer/ComposerControls.tsx:199`:** `aria-expanded={pickerOpen}` on the textarea, next to `aria-autocomplete="list"`, the conditional `aria-controls` and `aria-activedescendant` (`:196-203`). Those three are allowed on a textbox.
- **Code blocks:**
  - `apps/web/src/components/LinkText.tsx:39-44` renders a code block as `<pre className="… overflow-x-auto …">`;
  - `apps/web/src/components/MarkdownText.tsx` (53 lines) passes `components` with `a` and `img` overrides only (`:18-36`). Markdown `pre` and `table` come from react-markdown's defaults, and `apps/web/src/index.css` styles them `overflow-x: auto` (`.md pre` `:470-484`, `.md table` `:560-566`).
- **`apps/web/src/components/chatList/RequestRows.tsx:259-261`:** `<Button … onClick={onAccept}>Accept</Button>` has no `aria-label`, while Decline has `` aria-label={`Decline ${name}`} `` (`:266`).

### What to build
1. **`ComposerControls.tsx`:** remove `aria-expanded={pickerOpen}` from the textarea. Keep the other ARIA attributes.
2. **`LinkText.tsx`:** the code `pre` gets `tabIndex={0}`.
3. **`MarkdownText.tsx`:** add `pre` and `table` overrides that render the same element with its props and `tabIndex={0}`, so a block that scrolls sideways is reachable by keyboard. One short comment.
4. **`RequestRows.tsx`:** the Accept key gets `` aria-label={`Accept ${name}`} ``. Its visible text stays "Accept".
5. Nothing else changes, and every file stays under 400 lines.

### Tests
None (accessibility attributes).

### Allowed files
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/LinkText.tsx`, `apps/web/src/components/MarkdownText.tsx`
- `apps/web/src/components/chatList/RequestRows.tsx`
- `work/T-1485-web-a11y-axe-fixes.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's axe run over the same routes reports no violations.

---

## Report (written by the worker when done)

### What I did
All four fixes from the spec, nothing else:
1. `apps/web/src/components/composer/ComposerControls.tsx`: removed `aria-expanded={pickerOpen}` from the `#message-composer` textarea (the line at `:199`). The `aria-autocomplete`, `aria-controls` and `aria-activedescendant` attributes stay.
2. `apps/web/src/components/LinkText.tsx`: the fenced-code `pre` now has `tabIndex={0}` (`:39-42`).
3. `apps/web/src/components/MarkdownText.tsx`: added `pre` and `table` overrides to the `components` map that render the same element with `{...props}` plus `tabIndex={0}`, with one short comment (`:32-40`). `react-markdown`'s `node` prop is only passed when `passNode` is on (it is not here), so spreading props does not leak it to the DOM.
4. `apps/web/src/components/chatList/RequestRows.tsx`: the Accept button has `aria-label={`Accept ${name}`}`; its visible text is still "Accept".

No tests were added: the spec says none (accessibility attributes only) and AGENTS.md says UI code gets no tests.

### Files changed
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/LinkText.tsx`
- `apps/web/src/components/MarkdownText.tsx`
- `apps/web/src/components/chatList/RequestRows.tsx`
- `work/T-1485-web-a11y-axe-fixes.md` (this file)

All source files stay well under 400 lines.

### Commands and real results
- `pnpm install`: done in 10.5s, 17 workspace projects, no errors (one pre-existing deprecated `uuid@7.0.3` warning, one peer-dependency warning in `apps/mobile` for `@types/react-dom`).
- `pnpm gate` (from repo root): summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.6s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No per-file tests were run: the change has no nearby test files (gate reports `SKIP tests @zilar/web`).

### Problems / deviations / open questions
None. I did not run axe myself (no headless axe available in this task); the acceptance's axe re-run is the lead's step.

### Fix round 1 (lead's headless check)
The lead found that react-markdown's `node` prop landed in the DOM on the new overrides
(`<pre node="[object Object]" tabindex="0">`). Fixed both overrides in `MarkdownText.tsx`
to take `node` out before spreading, using the repo's unused-name pattern
(`{ node: _node, ...props }` + `void _node;`), same as `pins.ts` and `aiPanelOps.ts`.
Re-ran `pnpm gate`: `GATE PASS` with the same summary lines as above (5 changed files,
all in scope, size OK).

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **axe-core 4.10.2 re-run** (WCAG 2 A and AA, the same 8 routes, headless mock): no violations. Main has two.
- **Fix round 1:** the first head leaked react-markdown's `node` object into the DOM (`<pre node="[object Object]">`). After the fix, the rendered `pre` and `table` carry only `tabindex="0"`.
- **The 1280 px sweep:** 0 console errors.
