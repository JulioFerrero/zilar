---
id: T-2042
title: "Reduce (server): one bounds-checked byte-reader module (readU16BE/LE, readU24LE, readU32BE/LE returning null past the end, writeU32LE) replaces the three hand-written copies in card-media/sniff.ts, card-media/strip.ts and stickers/image.ts (the sticker copies have no bounds check and return NaN) — same results on valid input, with a test"
status: merged
milestone: M5
branch: task/T-2042-server-byte-readers
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2042: One server byte-reader module (reduce-scan cluster #13)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. `docs/audit/reduce-scan.md` §1 (cluster #13) found the same image-header byte readers copied in three server files.
- **The sticker copies** don't check bounds: past the end they return `NaN` instead of failing cleanly.
- **These readers parse untrusted uploads** (sticker and card media), so the shared module needs a test.

### Facts (read by the lead on 2026-10-18 at `25c19132d`)
- **`apps/server/src/card-media/sniff.ts`** (214 lines) defines `readU16BE` (`:28`), `readU16LE` (`:35`), `readU24LE` (`:42`), `readU32BE` (`:49`) and `readU32LE` (`:62`). All are bounds-checked and return `number | null`.
- **`apps/server/src/card-media/strip.ts`** (263 lines) defines:
  - `readU16` (`:12`), which is big-endian and bounds-checked;
  - `readU32BE` (`:19`) and `readU32LE` (`:32`), both bounds-checked;
  - `writeU32LE` (`:45-`).
- **`apps/server/src/stickers/image.ts`** defines `readU32BE` (`:125`), `readU24LE` (`:135`), `readU16LE` (`:139`) and `readU32LE` (`:143`). These return `number` with **no** bounds check.
- **Tests** `card-media/strip.test.ts` and `card-media/service.test.ts` exist.

### Steps
1. **The module.** Create `apps/server/src/media-bytes.ts` with:
   - `readU16BE`, `readU16LE`, `readU24LE`, `readU32BE` and `readU32LE`, each `(bytes: Uint8Array, offset: number) => number | null`, bounds-checked, and returning `null` when `offset < 0` or the read passes the end;
   - `writeU32LE`.

   Plain arithmetic like today, or `DataView`: your choice, but results must match on valid input.
2. **card-media.** `sniff.ts` and `strip.ts` import from it and delete their copies. `strip.ts`'s `readU16` is `readU16BE`.
3. **stickers/image.ts.** It imports the same readers. Where a reader can now return `null`, treat `null` as "not this format" or "invalid", the same outcome its callers already give a too-short buffer. Read each call site, and don't change what valid images produce.
4. **The test.** Add `apps/server/src/media-bytes.test.ts`:
   - each reader on a known byte array, in both endianness where it applies;
   - a read past the end gives `null`;
   - a negative offset gives `null`;
   - `writeU32LE` round-trips through `readU32LE`.
5. **Size.** Report the line counts. Product lines must go down. Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/media-bytes.ts`
- `apps/server/src/media-bytes.test.ts`
- `apps/server/src/card-media/sniff.ts`
- `apps/server/src/card-media/strip.ts`
- `apps/server/src/stickers/image.ts`
- `work/T-2042-server-byte-readers.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/media-bytes.test.ts src/card-media src/stickers --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/media-bytes.ts` with bounds-checked `readU16BE`, `readU16LE`,
  `readU24LE`, `readU32BE`, `readU32LE` (each `number | null`, `null` for a negative
  offset or a read past the end) and `writeU32LE`.
- `card-media/sniff.ts` and `card-media/strip.ts` now import the shared readers and
  their local copies are gone. `strip.ts`'s `readU16` was replaced by `readU16BE`.
- `stickers/image.ts` imports the same readers. Every call site got a `null` branch
  that returns the outcome it already gave a too-short buffer (`truncated` in
  `parsePng`/`parseWebp`, `false` in `isAnimatedPng`). All the call sites are already
  guarded by a length check that makes `null` unreachable on valid input, so valid
  images produce exactly the same results.
- Added `apps/server/src/media-bytes.test.ts`: both endiannesses on a known array,
  past-the-end and negative offsets give `null`, and `writeU32LE` round-trips through
  `readU32LE`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/media-bytes.test.ts src/card-media src/stickers`
  → 7 test files passed, 22 tests passed.
- `pnpm gate` → GATE PASS. Summary lines:
  - PASS install (frozen) (6.1s)
  - PASS format (4.2s)
  - PASS lint (5.1s)
  - PASS typecheck (8.7s)
  - PASS effect (2.0s)
  - PASS build @zilar/server (0.6s)
  - PASS tests @zilar/server (21.5s)
  - scope: every changed file is inside the Allowed files
  - migration: every added migration continues from the base
  - images: every workspace package an app image needs is copied into its Dockerfile
  - size: every changed source file is within 400 lines
  - GATE PASS

### Size

Product lines (`media-bytes.ts` + the three callers): 754, down from 791 (−37).
Test file is 58 lines. Before → after per file: `sniff.ts` 214 → 168, `strip.ts`
263 → 224, `stickers/image.ts` 314 → 304. Every file is under 400 lines.

### Notes for the lead

- `media-bytes.test.ts` is 58 lines and has no header comment; the other tests near it
  tend to have one, but I did not see a rule requiring it.
- No dependencies added, no files touched outside the Allowed list.


## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.** `apps/server/src/media-bytes.ts` holds the bounds-checked readers, which return `null` past the end or for a negative offset, plus `writeU32LE`. It has a test.
- **Callers.**
  - card-media `sniff.ts` and `strip.ts` use it.
  - `stickers/image.ts` now treats a `null` read as "truncated" or "not this format", instead of computing with NaN.
- **Size.** About −37 product lines.
