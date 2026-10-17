---
id: T-1892
title: "Share into Zilar, task 2: a pure parser turns the untrusted expo-share-intent payload into a ShareDraft {text?, files[]} with Effect Schema — bounded text (32 KiB), at most 10 files, safe names, mime shape, only file:// or content:// paths, null size → unknown — or a fixed refusal sentence"
status: merged
milestone: M5
branch: task/T-1892-share-draft-parser
model: auto
effort: default
depends_on: [T-1891]
estimate: 30 min
---

# T-1892: The share payload parser (share plan task 2)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/share-into-zilar.md` §2, §4 and §6 task 2** (Julio approved the feature on 2026-10-17). Whatever another app shares is untrusted input, so the `/share` screen (task 4) and the send path (task 6) must only ever see a validated draft.
- **Lead correction to the plan:** the repo uses Effect `Schema`, not zod (zod was replaced on 2026-10-07).
- **Plan task 3 (a pending-share holder) is dropped.** The root `ShareIntentProvider` (T-1891) already keeps the payload in memory across the in-app login.

### Facts (read by the lead on 2026-10-17)
- **`expo-share-intent` 8.0.1 is installed** (T-1891). Read its payload type `ShareIntent` and the file type in your worktree's `apps/mobile/node_modules/expo-share-intent/build/` (the `*.types.d.ts`). The plan's §2 table:
  - `type`: `text` | `weburl` | `media` | `file` | `null`;
  - `text`: the raw text or the URL;
  - `webUrl`;
  - `files`: `{ path, mimeType, fileName, size, width, height, duration }[] | null`, where `size` may be `null`;
  - `meta`.
- **The upload input** is `PickedFile` (`apps/mobile/src/lib/attachment-ports.ts:10-21`): `{ uri, name, mimeType, size?: number }`. An unknown size is `undefined`, never 0.
- **The per-file cap is enforced downstream** (`apps/mobile/src/lib/attachments.ts:25` `MAX_ATTACHMENT_BYTES`, plus the store guard). The parser does not duplicate it.
- **The Effect Schema idiom** in this app: `Schema.decodeUnknownExit(...)` + `Exit.isSuccess` (`apps/mobile/src/lib/topics-api.ts:146-149`).

### Steps
1. **New `apps/mobile/src/lib/share-intent.ts`:**
   - `export interface ShareDraft { text?: string; files: PickedFile[] }`;
   - `export type ShareDraftResult = { ok: true; draft: ShareDraft } | { ok: false; message: string }`;
   - `export function toShareDraft(intent: unknown): ShareDraftResult`. It takes `unknown` on purpose; decode with an Effect `Schema` for the fields you use.
2. **The rules** (each refusal is one fixed sentence, never echoing the input):
   - **text:** trim it. Empty means absent. Over 32,768 characters → `That text is too long to share.`
   - **files:** at most 10, else `You can share up to 10 files at once.` Each file:
     - **`path`** must start with `file://` or `content://`, else `That file cannot be shared.`;
     - **`fileName`:** trimmed, cut to 255 characters; empty or missing → `file`;
     - **`mimeType`** must match `^[\w.+-]+/[\w.+-]+$`, else use `application/octet-stream`;
     - **`size`:** a finite number ≥ 0 is kept; `null` or missing → `undefined`.
   - **Nothing usable** (no text and no files) → `There is nothing to share.`
   - **A malformed payload** (fails the schema) → `That share could not be read.`
   - Map each file to `PickedFile` (`uri` = `path`, `name` = the cleaned file name).
3. **New `apps/mobile/src/lib/share-intent.test.ts`.** This is the input boundary of the message pipeline, so tests are wanted; keep it to these four:
   - a text-only share;
   - two files with a `null` size and a bad mime;
   - an `http://` path refused;
   - 11 files refused.
4. **No UI and no other files.** Each file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/share-intent.ts`
- `apps/mobile/src/lib/share-intent.test.ts`
- `work/T-1892-share-draft-parser.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/share-intent.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`toShareDraft`** returns a clean `ShareDraft` or one fixed refusal sentence for every rule above.
- The 4 tests pass.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/lib/share-intent.ts`** (new, ~100 lines): `ShareDraft`, `ShareDraftResult` and `toShareDraft(intent: unknown)`.
  - Decodes the fields we use with an Effect `Schema` (`Schema.decodeUnknownExit` + `Exit.isFailure`, the `topics-api.ts` idiom): `text: string | null` optional, `files: ShareIntentFile[] | null` optional with `path` required and `fileName`/`mimeType`/`size` nullable/optional. A payload that fails the schema gets `That share could not be read.`
  - Text is trimmed; empty is absent; over 32,768 characters → `That text is too long to share.`
  - More than 10 files → `You can share up to 10 files at once.`
  - Each file: `path` must start with `file://` or `content://` else `That file cannot be shared.`; name via `cleanFilename` (trim, 255 cap, fallback `file`); `mimeType` must match `^[\w.+-]+/[\w.+-]+$` else `application/octet-stream`; `size` kept only when finite and ≥ 0, `null`/missing/non-finite → `undefined`.
  - No text and no files → `There is nothing to share.` Refusals are fixed sentences and never include the input.
  - Maps each file to `PickedFile` (`uri` = `path`).
- **`apps/mobile/src/lib/share-intent.test.ts`** (new): the four tests the spec lists — text-only share; two files with `null` size and a bad mime; an `http://` path refused; 11 files refused.
- No other files were changed. No dependencies added.

### Checks run

- `pnpm install` — passed: `Done in 11.6s using pnpm v10.32.1`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/share-intent.test.ts` — `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (first run) — `FAIL format`: `[warn] apps/mobile/src/lib/share-intent.test.ts` (`Code style issues`). Fixed by running `pnpm exec prettier --write` on the two new files.
- `pnpm gate` (second run) — ended with:
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/mobile  (5.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation (defensive, same outcome):** file names use the existing `cleanFilename` from `@zilar/chat-core`, which trims and caps at 255 with the `file` fallback as specified, and also strips directory parts and control characters. If you want the literal spec behaviour (`dir/a.txt` → `dir/a.txt`), say so and I will inline the two steps instead.
- The parser reads only `text` and `files`, as Spec step 2 says; `webUrl` is not used (plan §2 says the shared URL arrives in `text`).
- Non-finite or negative `size` values are treated as unknown (`undefined`) rather than refused; the per-file byte cap stays downstream in `attachments.ts`, as the spec says.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `c9b0ee5b9`. The lead read `share-intent.ts` in full.
- **Validation:** the payload is decoded with Effect `Schema` before any field is used. Every refusal is a fixed sentence, and only `file://` or `content://` paths are accepted.
- **Names** go through chat-core `cleanFilename`, which strips path segments and control characters and caps at 255 (the pre-review nit). That is stricter than the spec, and accepted.
- **Tests:** 4.
- **Next:** share task 4/6, the `/share` route using `toShareDraft` + `ChatPickerList single` + send.

