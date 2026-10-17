---
id: T-1861
title: "Web: an @mention chip in a message opens that person like their avatar does (PersonLink: the DM for a contact or your own AI, /u/<handle> otherwise); a chip of you stays plain"
status: merged
milestone: M5
branch: task/T-1861-web-mention-links
model: auto
effort: default
depends_on: [T-1851]
estimate: 20 min
---

# T-1861: @mention chips open the person (web)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** T-1851 made a message's avatar and sender name open the person. An `@Deepseek` or `@Ana` chip inside a message still does nothing when clicked.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/personLink.tsx`** (T-1851) exports `PersonLink({ target, name, className, children })`, with `target` `{ jid?, userId?, handle? }`, and `usePersonHref(target)` (`:26`, `:107`).
  - Yourself, occupant JIDs and unknown targets render `children` unchanged.
  - The link carries an inline `color: inherit; text-decoration: none`, so the bubble's `a` rule doesn't restyle it.
- **The chips:** `apps/web/src/components/LinkText.tsx` (146 lines) renders a mention segment as `<span className={mine ? 'raised-pill mention-me' : 'mention-chip'}>{segment.text}</span>` in both `renderPlain` (`:66-74`) and `renderFormatted` (`:100-108`). `segment.jid` is the mentioned bare JID, and `mine` comes from `isMentionOfMe(segment.jid, meJid)`.

### Steps
1. **In both places,** when `mine` is false, wrap the chip `span` in `<PersonLink target={{ jid: segment.jid }} name={segment.text.replace(/^@/, '')}>`. When `mine` is true, leave it as it is.
2. **The chip's look must not change:** keep its classes on the span, and the link adds no styles.
3. **No tests** (UI). The file stays at most 400 lines.

### Allowed files
- `apps/web/src/components/LinkText.tsx`
- `work/T-1861-web-mention-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Clicking another person's or an AI's @chip** opens the same target their avatar opens.
- **Your own chip** and unknown JIDs do nothing.
- **Chips look the same.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- In `apps/web/src/components/LinkText.tsx`, both `renderPlain` and `renderFormatted` now wrap a mention chip in `<PersonLink target={{ jid: segment.jid }} name={segment.text.replace(/^@/, '')}>` when the mention is not mine. The chip stays the same `span` with `className="mention-chip"`; `PersonLink` adds only its own focus ring and inline `color: inherit; text-decoration: none`.
- A mention of me keeps the old plain `<span className="raised-pill mention-me">`, so my own chip stays unclickable.
- Unknown JIDs and occupant JIDs fall back to plain children inside `PersonLink`, so they render exactly as before (the chip span) and do nothing.
- No tests added, per the spec (UI only). File is 163 lines (limit 400).

### Checks run
- `pnpm install`: done, no changes needed (20s).
- `pnpm gate`: **GATE PASS** (exit 0).
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (1.4s)
  PASS  lint  (1.8s)
  PASS  typecheck  (7.2s)
  PASS  effect  (2.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No single test file was run: no `LinkText` test exists, and the spec says no tests (UI).
- `PersonLink` already suppresses self, full JIDs and unknown targets, so the "chip of you stays plain" behaviour comes from both the `mine` branch and `PersonLink`'s own guards.
- I did not smoke-test in a browser; the gate covers typecheck/lint only. Live click behaviour is for your smoke.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `47786db11`.
- **The diff:** both renderers wrap a non-self chip in `PersonLink`, keeping `mention-chip` on the inner span, and a self chip is unchanged. `PersonLink` is an inline `<a>` with the colour inherited and no underline, so the chip looks the same.
- **Mock mode can't show it:** its messages carry no mention data, so they draw no chips. **The live click on a chip** in "cards test" is checked after the deploy (see NOW.md).
