---
id: T-0336
title: "Mobile: the inline time + ticks at the end of a text bubble draw icons, not ✓ / ✓✓ / ○ glyphs"
status: merged
milestone: M5
branch: task/T-0336-mobile-inline-ticks
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0336: inline bubble ticks as icons

## Spec (written by Claude, do not edit)

### Why
Julio wants icons, not glyph characters. Web draws message ticks with icons. On mobile, the `BubbleMeta` row (voice and media) already uses the `Ticks` icon component, but plain-text and markdown bubbles still append text glyphs (` ✓`, ` ✓✓`, ` ○`) after the time. That is every ordinary outgoing message.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/message-bubble.tsx`:**
  - lines 109-115: `outgoingTicks(status)` returns `' ○'` for sending or failed, `' ✓✓'` for read, `' ✓'` otherwise;
  - it is used at lines 544 and 568, inside an inline `Text` (`font-mono text-[10px]`, `color={metaColor}`) that also holds `'  '`, the optional `'edited '` and `formatTime(...)`. That `Text` is nested in the bubble's text `Text`, so the time flows inline after the last word.
  - Line 27 imports `Ticks` from `@/components/chat/ticks`, and `BubbleMeta` (lines 82-104) already renders `<Ticks status={message.status} color={color} size={13} />`.
- **`apps/mobile/src/components/chat/ticks.tsx`:** `Ticks({ status, color, size = 15 })` renders `Clock` (size - 2) for sending or failed; otherwise it renders `Check` or `CheckCheck` (read), wrapped in a `View`.
- **Inline views:** React Native renders a `View` nested inside `Text` as an inline element. It needs a fixed width and height.
- **Tests:** `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx` already mocks `lucide-react-native` for this file. No test queries the glyphs.

### What to build
1. At lines 544 and 568, replace `{outgoing ? outgoingTicks(message.status) : ''}` with an inline icon, when outgoing:
   - `<Text>{' '}</Text>` followed by `<View style={{ width: 14, height: 11 }}><Ticks status={message.status} color={metaColor} size={11} /></View>`;
   - or an equivalent fixed-size inline view, placed so the icon sits on the time's baseline.
   - Keep `metaColor`, and keep the `opacity: 0` while generating (apply it to the icon wrapper too).
2. Delete `outgoingTicks`.
3. **New test in `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`,** or a new `message-bubble-ticks.test.tsx` following that file's mocks:
   - an outgoing read text message renders the `Ticks` component (or the `CheckCheck` mock);
   - the text contains no `✓` or `○`.
4. **Report:** say clearly that the alignment needs a look on the emulator. The lead runs QA after the merge.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/message-bubble.tsx:80-140` and `:500-575`, `apps/mobile/src/components/chat/ticks.tsx`, and `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`, `work/T-0336-mobile-inline-ticks.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble
pnpm gate
```

### Acceptance
- `✓` and `○` no longer appear in `message-bubble.tsx`.
- Outgoing text and markdown bubbles show the tick icon inline after the time.
- Existing tests pass, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. Outgoing plain-text and markdown bubbles now draw the `Ticks` icon inline
after the time instead of `✓`/`✓✓`/`○` glyphs. **Alignment needs a look on the
emulator** — I verified the render output in tests only, not the visual
baseline; the lead runs QA after the merge.

What changed:
- `apps/mobile/src/components/chat/message-bubble.tsx`: deleted `outgoingTicks`
  (verified: no `✓`, `○`, or `outgoingTicks` remains in the file). At both
  inline-meta sites (markdown and plain-text branches) the meta `Text` now ends
  after `formatTime(...)`, followed by `<Text>{' '}</Text>` and a fixed-size
  `<View style={{ width: 14, height: 11 }}>` wrapping
  `<Ticks status={message.status} color={metaColor} size={11} />`. The wrapper
  gets `opacity: 0` while `generating`, matching the meta text's hidden state.
- `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx` (new): 3
  tests — outgoing read text renders `Ticks`; no `✓`/`○` for any status
  (`sending`, `sent`, `read`, `failed`); incoming text renders no `Ticks` and
  no glyphs.

Deviations: none from the spec. One fix during work: first draft of the test
used a `delivered` status that does not exist in `MessageStatus`
(`'sending' | 'sent' | 'read' | 'failed'` in `packages/chat-core/src/types.ts:7`);
removed it before the gate.

Commands and results:
- `pnpm install`: exit 0 (11.9s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble`:
  2 files, 10 tests, all passed (7 existing sticker tests + 3 new ticks tests).
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, `@zilar/mobile`
  tests all PASS; "every changed file is inside the Allowed files".

Security checklist: no secrets/tokens touched; no deletes/updates, caps, or
routes involved; no audit entries; no logging changes. Nothing new is
user-facing text (icons only).

## Review (written by Claude)

**Approved** (pre-review clean, 1 nit accepted: the new test covers the plain-text branch more than the markdown branch, and both branches use the same code). Outgoing text and markdown bubbles end with the time plus an inline 14×11 view holding the `Ticks` icon (Clock, Check or CheckCheck, in `metaColor`), hidden while generating. `outgoingTicks` and its glyphs are gone. Baseline alignment is checked on the emulator in QA run 22 after the merge.
