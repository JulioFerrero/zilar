---
id: T-1842
title: "Phone @ list follows PhoneMention.dc.html: AIs first, 48 px rows with 30 px avatars and 16 px names, the AI badge right after the name, handles in mono 12 px, a 16 px-radius #111 panel"
status: merged
milestone: M5
branch: task/T-1842-phone-mention-board
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1842: The phone @ list follows its board

## Spec (written by Claude, do not edit)

### Why
**The lead's emulator check of main** (mock build, "Checkout button hidden on Safari", `@` typed, 2026-10-17) showed the right people (topic members only), but drawn unlike `docs/design/mockups/topic-people/PhoneMention.dc.html`:
- the AI is last, where the board lists it first;
- the AI badge sits at the far right instead of after the name;
- handles use the sans font;
- rows are about 39 px with 28 px avatars and 14 px names.

### Facts (read by the lead on 2026-10-17)
- **The board** (`PhoneMention.dc.html`):
  - **Panel** (`:55`): `border-radius: 16px`, background `#111111`, `1px solid #1f1f1f`, shadow `0 12px 28px -8px rgba(0,0,0,.95)`, a 6 px top spacer, `padding-bottom: 6px`.
  - **Rows** (`.opt`, `:30,57-60`): min-height 48 px, 12 px gap, padding `0 10px 0 14px`, 16 px text, avatar 30 px (`.av`, `:31`).
  - **The AI row** (`:57`): the avatar, `Deepseek` plus the `AI` badge (`.badge`, `:28`), then `@deepseek` in mono, 12 px, `#8a8a8a`.
  - **People rows:** the name, then the mono handle.
  - **The AI is the first row.**
- **The phone pieces:**
  - **`apps/mobile/src/components/chat/mention-picker.tsx`** (52 lines):
    - the panel is `mb-2 overflow-hidden rounded-[12px] border border-[#262626] bg-surface py-1`;
    - rows are `px-2 py-1.5 gap-2`, with `EntityAvatar size={28}` and a 14 px name;
    - the handle is ` @handle` in muted sans inside the name `Text`;
    - `AiBadge` is the last child.
  - **`apps/mobile/src/components/chat/composer-mentions.ts:34-42`:** `mentionCandidates` returns `filterMentionMembers(all, query).slice(0, MENTION_MAX_ROWS)`.
  - **AI detection:** `isAiJid(member.jid)` (`@zilar/chat-core`) tells an AI.

### Steps
1. **`composer-mentions.ts`:** in `mentionCandidates`, put the AI matches before the people, keeping each group's order, **before** the `slice`, so an AI is never cut.
2. **`mention-picker.tsx`:**
   - **The panel:** `rounded-[16px] border border-[#1f1f1f] bg-[#111111] pt-1.5 pb-1.5` plus the board's shadow.
   - **Rows:** `min-h-[48px] gap-3 pl-[14px] pr-[10px]`, with `EntityAvatar size={30}`.
   - **Inside a row:** the name at 16 px, then `AiBadge` for an AI, then the handle as `@handle` in `font-mono text-[12px] text-[#8a8a8a]`, all on one line. The name truncates first.
   - Keep the accessibility labels.
3. **No tests** (UI). Note that `composer-mentions.ts` may have a test file; keep it passing.

### Allowed files
- `apps/mobile/src/components/chat/mention-picker.tsx`
- `apps/mobile/src/components/chat/composer-mentions.ts`
- `work/T-1842-phone-mention-board.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In the mock build,** `@` in "Checkout button hidden on Safari" lists Dev-1 (AI) first, then Ana, Luis and Marco.
- **The rows** are 48 px, with the badge after the name and mono handles, on the board's panel.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/chat/composer-mentions.ts`: `mentionCandidates` now splits the filtered matches into AIs (`isAiJid`) and people, concatenates AIs first and slices to `MENTION_MAX_ROWS` afterwards, so the cap can never drop an AI.
- `apps/mobile/src/components/chat/mention-picker.tsx`:
  - panel is now `rounded-[16px] border border-[#1f1f1f] bg-[#111111] pt-1.5 pb-1.5` with the board's shadow (`boxShadow: '0 12px 28px -8px rgba(0,0,0,.95)'`; kept `mb-2 overflow-hidden`);
  - rows are `min-h-[48px] gap-3 pl-[14px] pr-[10px]` with `EntityAvatar size={30}`;
  - the name is 16 px and truncates first; `AiBadge` follows the name inside the flexible group; the handle is a sibling `@handle` in `font-mono text-[12px] text-[#8a8a8a]`.
  - accessibility labels unchanged.
- No tests added (UI change, as the spec says). `composer-mentions.ts` has no test file in the repo (checked with `find apps/mobile/src -name "*mention*"`), so none needed keeping green.

### Checks run

- `pnpm install` — succeeded.
- `pnpm exec prettier --write` on the changed files — succeeded (the first gate failed only on formatting of `mention-picker.tsx`; fixed, then re-ran the gate; the task file was formatted once more after writing this Report).
- `pnpm gate` — run twice, both ended `GATE PASS`; the last run (after the Report edit) exited 0:

```text
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.5s)
PASS  lint  (0.7s)
PASS  typecheck  (0.8s)
PASS  effect  (0.4s)
PASS  tests @zilar/mobile  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run separately: the only touched package is `@zilar/mobile`, and its nearest tests ran inside the gate.

### Notes for the lead

- I could not run the emulator, so the acceptance check (Dev-1 first, then Ana, Luis and Marco) is verified by code, not by a phone smoke. The ordering now comes from `isAiJid` grouping before the cap.
- The panel keeps the previous `mb-2 overflow-hidden`, which the spec's class list did not name; they were already on the component and the board places the panel above the composer with a bottom margin.
- The AI row order relies on `isAiJid(member.jid)` only, same helper the picker already used for the badge/avatar.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `83b81679a`.
- **Emulator check of the branch's mock build** ("Checkout button hidden on Safari", `@` typed) against `PhoneMention.dc.html`:
  - Dev-1 first, with the AI badge after the name;
  - then Ana, Luis and Marco, on 48 px rows with mono handles, on the dark 16 px panel.
- **AIs are ordered before the cap,** so one is never cut.
- **The Leave sheet** checked in the same pass matches `PhoneLeave.dc.html`.
