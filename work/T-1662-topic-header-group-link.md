---
id: T-1662
title: "Phone topic header: the small group name above the topic name opens the group screen (web T-1254 parity, audit gap 4); tapping the topic name still opens topic info"
status: merged
milestone: M5
branch: task/T-1662-topic-header-group-link
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1662: The topic header's group name opens the group

## Spec (written by Claude, do not edit)

### Why
On web, the group name in a topic header is a link to the group panel (T-1254). On the phone, it's plain text: the whole title opens topic info (`docs/audit/parity-2026-10-16.md`, gap 4). The phone's chat menu already has "Open group" (`apps/mobile/src/components/chat/chat-actions-sheet.tsx:197-204`), so the only missing piece is the direct tap on the group name.

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/chat-header.tsx`** (227 lines):
  - the props `topicGroupName?` (`:56`), `onOpenInfo?` (`:58`) and `onOpenGroup?: (groupId: string) => void` (`:60`);
  - `groupTarget = onOpenGroup !== undefined ? (chat.groupId ?? undefined) : undefined` (`:112`);
  - the `title` block renders the group name as a plain `<Text … text-[11px] … text-subtle-foreground>{topicGroupName}</Text>` (`:118-122`);
  - in a topic with `onOpenInfo`, the whole `title` is wrapped in a `Pressable` labelled `Topic info for ${chat.title}` (`:164-172`).
- **`apps/mobile/src/app/chat/[id].tsx:164-166`** passes `topicGroupName={groupName}`, `onOpenInfo={openInfo}` and `onOpenGroup={openGroup}` for topics.

### Steps
1. **In `chat-header.tsx`:** when `isTopic`, the group name is shown, and `groupTarget !== undefined`, wrap the group-name `Text` in its own `Pressable`:
   - `accessibilityRole="button"`;
   - `accessibilityLabel={`Open group ${topicGroupName}`}`;
   - `onPress={() => onOpenGroup?.(groupTarget)}`;
   - `hitSlop={{ top: 6, bottom: 4 }}`;
   - `self-start`, so only the name's width is tappable.

   The inner `Pressable` takes the touch, and the rest of the title still opens topic info. Keep the text style unchanged. Otherwise the plain `Text` stays as today.
2. **No other visual change, no new copy, no tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/chat-header.tsx`
- `work/T-1662-topic-header-group-link.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In a topic, tapping the small group name opens that group's screen;** tapping the topic name opens topic info as before.
- **DMs, groups and channels are unchanged.**

---

## Report (written by the worker when done)

### What I did

In `apps/mobile/src/components/chat/chat-header.tsx`, when the row is a topic, the
group name is shown, and `groupTarget !== undefined`, I wrapped the group-name `Text`
(lines 118-122) in its own `Pressable` with the exact props from the spec:

- `accessibilityRole="button"`;
- `accessibilityLabel={`Open group ${topicGroupName}`}` (uses the group name, not the
  topic title);
- `onPress={() => onOpenGroup?.(groupTarget)}`;
- `hitSlop={{ top: 6, bottom: 4 }}`;
- `className="self-start"` so only the name's measured width is tappable.

The inner `Text` style is byte-for-byte unchanged, and the outer topic-info
`Pressable` (line 173+) still wraps the whole title, so the rest of the title keeps
opening topic info. When `groupTarget === undefined` (no `onOpenGroup` wired, or no
`chat.groupId`) the branch falls back to the previous plain `Text`, so DMs, groups and
channels are unchanged. No new copy, no test (UI-only, per AGENTS.md "Tests").

### Checks run

- `pnpm install` — Done in 24.4s using pnpm v10.32.1 (1 deprecated subdep warning,
  1137 packages added).
- `pnpm gate` (from repo root) — summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (0.8s)
PASS  lint  (1.0s)
PASS  typecheck  (4.2s)
PASS  effect  (0.9s)
PASS  tests @zilar/mobile  (2.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Changed files: `apps/mobile/src/components/chat/chat-header.tsx`,
`work/T-1662-topic-header-group-link.md` — both inside Allowed files.

### Notes for the lead

- I did not run the mobile test file individually: this is a UI-only change with no
  unit test, and `pnpm gate` already ran `tests @zilar/mobile` (PASS).
- I could not verify the tap on a device; acceptance ("tapping the small group name
  opens that group; tapping the topic name opens topic info") needs the lead's phone
  smoke / Julio's live check.
- No deviations from the spec, no dependencies added, no open questions.

## Review (written by Claude)

**Approved and merged.** This is parity gap 4 (web T-1254).

- **Pre-review:** clean, 1 nit, a possible double-fire.
  - **Not an issue:** RN gives the touch to the innermost `Pressable`, so the outer topic-info `Pressable` doesn't fire.
  - **Still to check:** this is confirmed on the emulator in the combined phone QA pass after T-1663, with T-1659, T-1660 and T-1662.
- **The change:** in a topic, the small group name is its own button ("Open group …"), opening the group screen; the rest of the title still opens topic info.
