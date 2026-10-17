---
id: T-1844
title: "Web @ list matches the phone (T-1842, PhoneMention.dc.html): AIs first before the row cap, the AI badge right after the name, handles in mono 12 px muted at the row's end"
status: merged
milestone: M5
branch: task/T-1844-web-mention-parity
model: auto
effort: default
depends_on: [T-1842]
estimate: 15 min
---

# T-1844: The web @ list matches the phone

## Spec (written by Claude, do not edit)

### Why
**T-1842 made the phone @ list follow `docs/design/mockups/topic-people/PhoneMention.dc.html`:**
- AIs first;
- the badge after the name;
- mono handles.

**Web differs (the live "cards test" list, 2026-10-17):**
- Claude Test and JULITO come first and Deepseek last;
- the `AI` badge is at the far right;
- handles are inline sans.

Julio's rule (10-13) is that user-facing changes ship on web, Android and iOS alike.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/composer/useMentions.ts:86-89`:** `candidates = filterMentionMembers(members, picker.query).slice(0, MENTION_MAX_ROWS)`.
- **`apps/web/src/components/MentionPicker.tsx`** (67 lines):
  - rows are `flex w-full items-center gap-2 px-2 py-1.5 text-[14px]`;
  - each row has a 28 px avatar, then a `span.flex-1` with the name plus an inline muted `@handle`, then `{ai && <AiBadge />}` last (`:44-58`).
- **The phone's order** (T-1842, `apps/mobile/src/components/chat/composer-mentions.ts`): AI matches (`isAiJid`) before people, then the slice.

### Steps
1. **`useMentions.ts`:** order the matches AIs first (by `isAiJid(member.jid)`), keeping each group's order, then `slice(0, MENTION_MAX_ROWS)`. Keyboard navigation follows the new order on its own.
2. **`MentionPicker.tsx`:** each row becomes `[avatar] [name, then AiBadge for an AI] … [@handle]`, where:
   - the name and badge sit in a `min-w-0 flex-1` span (the name truncates);
   - the handle is `shrink-0 font-mono text-[12px] text-muted-foreground` at the end;
   - the 28 px avatar, the 264 px panel and the hover and active styles stay.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/composer/useMentions.ts`
- `apps/web/src/components/MentionPicker.tsx`
- `work/T-1844-web-mention-parity.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In web mock mode,** `@` in "Checkout button hidden on Safari" lists Dev-1 first, with the badge after its name, then the people with mono handles on the right.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/composer/useMentions.ts`: imported `isAiJid` from `@zilar/chat-core` and ordered the filtered matches AIs first (`isAiJid`), then people, keeping each group's order, before `slice(0, MENTION_MAX_ROWS)`. Keyboard navigation and `activeRow` follow the new order unchanged.
- `apps/web/src/components/MentionPicker.tsx`: each row is now `[avatar] [name + AiBadge] … [@handle]`. The name and badge sit in a `flex min-w-0 flex-1` span with the name truncating; the handle is `shrink-0 font-mono text-[12px] text-muted-foreground` after it. The 28 px avatar, the 264 px panel and the hover/active styles are untouched.
- No tests added (UI, as the spec says).

### Checks run
- `pnpm install`: Done in 11.1s (pnpm v10.32.1).
- `pnpm gate` (repo root): PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS effect, SKIP tests @zilar/web (no nearby test files). `gate: 3 changed file(s) against main`; scope: every changed file is inside the Allowed files; migrations, images and size checks passed. **GATE PASS**.
- No single test files were run: the change is UI-only and the web package has no tests near these files (gate skipped them).

### Notes for the lead
- The ordering mirrors the phone's `composer-mentions.ts` (T-1842): filter into AIs and people, concatenate, then cap.
- I did not run the web app in mock mode, so the acceptance line about Dev-1 appearing first with the badge after the name and mono handles on the right is covered by code review, not by a live check.

### Blocked / needs a decision
None.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ce4806157`.
- **Checked in web mock mode on the branch:** `@` in "Checkout button hidden on Safari" lists Dev-1 first, with the badge after its name, then the people with mono handles on the right, matching the phone after T-1842.
- **A mock-only "You" row** shows because mock mode has no JID; live excludes yourself.
