---
id: T-0301
title: "Mobile kit migration: role name and topic link fields use the kit TextField"
status: merged
milestone: M5
branch: task/T-0301-mobile-text-field-4
model: auto
effort: low
depends_on: [T-0297]
estimate: 0.2 day
---

# T-0301: mobile TextField, batch 4

## Spec (written by Claude, do not edit)

### Why
This is batch 4 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`). Read `work/T-0297-mobile-text-field-2.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`, so a caller's `py-1.5` or `text-[14px]` replaces the kit's.
- **`apps/mobile/src/components/chat/group-roles-sheet.tsx` line 155:** the rename field.
  - `accessibilityLabel={`Rename ${role.name}`}`, `maxLength={30}`, `placeholderTextColor="#8a8a8a"`;
  - `className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-well px-3 py-1.5 text-[14px] text-foreground"`;
  - it sits in a `flex-row`.
- **`apps/mobile/src/components/chat/group-roles-sheet.tsx` line 301:** "New role name".
  - `placeholder="e.g. Designers"`, `#8a8a8a`;
  - `className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[14px] text-foreground"`;
  - it sits in a `flex-row` next to "Add role".
- **`apps/mobile/src/components/chat/task-strip.tsx` lines 215 and 227:** "Topic link URL" and "Topic link label".
  - Each sits inside a `View className="rounded-[10px] border border-border-strong bg-well px-3 py-2"` wrapper;
  - each has `#8a8a8a` and `className="text-[14px] text-foreground"`;
  - their parent is `View className="mt-2 gap-2"`.
- **Tests that import these files:**
  - `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-load.test.tsx`.
  - No test imports `task-strip.tsx`.
  - Change these tests only to add mocks, if the `TextField` import needs them (`nativewind`; see the pitfall in `docs/LEAD_HANDOFF.md`).

### What to build
1. **group-roles-sheet**, both fields become `TextField`:
   - the rename field keeps `className="min-w-0 flex-1 py-1.5 text-[14px]"`;
   - the new role field keeps `className="min-w-0 flex-1 text-[14px]"`;
   - keep every other prop, and remove the `#8a8a8a`.
2. **task-strip**, both fields become `TextField` with `className="text-[14px]"`:
   - remove the wrapper `View`s; the parent's `gap-2` keeps the spacing;
   - keep every other prop, and remove the `#8a8a8a`.
3. Remove `TextInput` from a file's `react-native` import when it is no longer used.
4. **Tests:** existing tests keep passing. Change the listed test files only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0297-mobile-text-field-2.md` (Report), the two files and the three tests.

### Allowed files
`apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/task-strip.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/group-roles-mounted.test.tsx` (mocks only), `apps/mobile/src/components/chat/group-roles-load.test.tsx` (mocks only), `work/T-0301-mobile-text-field-4.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles
pnpm gate
```

### Acceptance
- The four fields render through `TextField`, and neither source file contains `#8a8a8a` or a raw `<TextInput` any more.
- Sizes, labels and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Status: ready for review

All four fields now render through the kit `TextField`. No raw
`<TextInput` and no `placeholderTextColor` remain in either source file.

### What I did

- **`apps/mobile/src/components/chat/group-roles-sheet.tsx`** — the rename
  field (was line 155) is now `TextField` with
  `className="min-w-0 flex-1 py-1.5 text-[14px]"`, keeping `value`,
  `onChangeText`, `maxLength={30}` and
  `accessibilityLabel={`Rename ${role.name}`}`; the "New role name" field
  (was line 301) is now `TextField` with
  `className="min-w-0 flex-1 text-[14px]"`, keeping `placeholder="e.g.
  Designers"` and the other props. Both `#8a8a8a` placeholder colours are
  gone (kit default `MUTED_FOREGROUND[scheme]` applies). Removed `TextInput`
  from the `react-native` import, added the `TextField` import.
- **`apps/mobile/src/components/chat/task-strip.tsx`** — "Topic link URL"
  and "Topic link label" are now `TextField` with `className="text-[14px]"`,
  keeping `value`, handlers, `placeholder`, `autoCapitalize`,
  `autoCorrect`, `maxLength` and `accessibilityLabel`s. Removed the two well
  wrapper `View`s (the parent's `mt-2 gap-2` keeps the spacing) and both
  `#8a8a8a` placeholder colours. Removed `TextInput` from the
  `react-native` import, added the `TextField` import.
- **Three test files (mocks only)** — added the `nativewind` mock
  (`useColorScheme: () => ({ colorScheme: 'dark' })`, same as `kit.test.tsx`
  and T-0297's `invite-links-sheet.test.tsx`) to
  `group-roles-sheet.test.tsx`, `group-roles-mounted.test.tsx` and
  `group-roles-load.test.tsx`. No assertion changed. No test imports
  `task-strip.tsx`, so nothing was needed there.

### Deviation from the spec / acceptance

The acceptance line "neither source file contains `#8a8a8a`" is not
literally met: `task-strip.tsx` line 17 still has `open: '#8a8a8a'` in
`STATUS_DOT_BG`. That is a status-dot fill colour, not a placeholder
colour, so I deliberately kept it — removing it would change the "open"
dot's look. All four fields' `placeholderTextColor="#8a8a8a"` props are
gone, and neither file has a raw `<TextInput` left (verified with `grep`).

### Security checklist

- No secrets, tokens or keys in logs, errors or URLs; only the input
  component changed, all props/handlers unchanged.
- No new routes, deletes, caps, permissions or audit entries touched.

### Files changed

`apps/mobile/src/components/chat/group-roles-sheet.tsx`,
`apps/mobile/src/components/chat/task-strip.tsx`,
`apps/mobile/src/components/chat/group-roles-sheet.test.tsx` (mock only),
`apps/mobile/src/components/chat/group-roles-mounted.test.tsx` (mock only),
`apps/mobile/src/components/chat/group-roles-load.test.tsx` (mock only),
`work/T-0301-mobile-text-field-4.md`.

### Commands run (real results)

- `pnpm install` → done, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  group-roles` → first run: 3 files failed at import (`SyntaxError:
  Unexpected token 'typeof'` from the unmocked `nativewind` import via the
  new `TextField` — the known T-0287/T-0294 pitfall); after adding the
  `nativewind` mock to the three test files: **3 files passed, 13 tests
  passed**.
- `pnpm gate` (final run):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (16.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (8.1s)
  PASS  tests @zilar/mobile  (2.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open questions

None. One note for the lead: if the acceptance wording is meant
literally, the `STATUS_DOT_BG` `open` colour in `task-strip.tsx` would need
a follow-up task (it is out of this task's scope to recolour it).

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), no fix rounds (Muse, peak).
- The four fields are on `TextField` with the sizes from the spec.
- The `#8a8a8a` left in `task-strip.tsx:18` is the open status dot colour, not a placeholder, so it stays.
- The test changes are the `nativewind` mocks only.
