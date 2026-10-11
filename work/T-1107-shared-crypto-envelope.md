---
id: T-1107
title: "Dedup S6: one shared AES-GCM/HKDF envelope for the push, connections and setup ciphers, moved unchanged (each keeps its own label and error class)"
status: merged
milestone: M5
branch: task/T-1107-shared-crypto-envelope
model: auto
effort: default
depends_on: [T-1103]
estimate: 0.2 day
---

# T-1107: One crypto envelope

## Spec (written by Claude, do not edit)

### Why
Julio approved the security dedups, "moved unchanged", on 2026-10-11 (slice S6 in `docs/audit/dedup-status.md` §6.1).

**What the lead read:** three files repeat the same envelope (`deriveKey`, `encryptOnce`, `decryptOnce`):
- `apps/server/src/push/crypto.ts:43-94`;
- `apps/server/src/connections/crypto.ts:47-99`;
- `apps/server/src/setup/crypto.ts:48-100`.

`diff` shows they differ **only** in:
- **the HKDF label:** `PUSH_STORAGE_KDF_LABEL` and `PROVIDER_KEY_KDF_LABEL` from `../kdf-labels`, and `INSTANCE_SETTINGS_KDF_LABEL` (`setup/crypto.ts:25`);
- **the error class thrown:** `PushDecryptionError` (`push/crypto.ts:31`), `DecryptionError` (`connections/crypto.ts:35`) and `SettingsDecryptionError` (`setup/crypto.ts:36`).

Each file ends with a factory: `createPushCipher` (`:95`), `createKeyCipher` (`:100`) and `createSettingsCipher` (`:101`). Tests exist in `apps/server/src/setup/crypto.test.ts` and `apps/server/src/connections/crypto.test.ts`, and `apps/server/src/ais/usage.test.ts` uses a cipher.

### What to build
1. **A new `apps/server/src/effect/crypto-envelope.ts`** exports `makeEnvelope(label: string, fail: () => Error): { encrypt(masterKey, plaintext): string; decrypt(masterKey, envelope): string }`. The body is the current `deriveKey`/`encryptOnce`/`decryptOnce`, **byte-for-byte**: the same algorithm, IV and salt sizes, envelope string format and checks, with `label` in place of the constant and `throw fail()` in place of `throw new XError()`.
2. **Each of the three files** keeps its exports (the label constant, the error class, the interface and the factory) with the same names and behaviour. The factory becomes, for example:
   ```ts
   const envelope = makeEnvelope(PUSH_STORAGE_KDF_LABEL, () => new PushDecryptionError());
   export function createPushCipher(masterKey: string): PushCipher {
     return {
       encrypt: (p) => envelope.encrypt(masterKey, p),
       decrypt: (e) => envelope.decrypt(masterKey, e),
     };
   }
   ```
   Delete the three private copies.
3. **Tests** (keys are a crucial area):
   - keep the existing tests green;
   - add `apps/server/src/effect/crypto-envelope.test.ts` with two cases:
     - a round trip;
     - a blob sealed with one label fails to open with another and throws that envelope's own error class.
   - **Also pin compatibility:** take an envelope string produced by the **old** `createKeyCipher` code before your change (generate it once and paste it as a constant with its master key and plaintext), and show the new code decrypts it. Then stored keys stay readable.
4. **Proof in the Report:**
   - the test output;
   - `git diff main --stat`;
   - one line confirming no envelope format change.
5. **No other files change.**

### Read first
`AGENTS.md`, the three crypto files, `apps/server/src/kdf-labels.ts`, and the two crypto tests.

### Allowed files
`apps/server/src/effect/crypto-envelope.ts`, `apps/server/src/effect/crypto-envelope.test.ts`, `apps/server/src/push/crypto.ts`, `apps/server/src/connections/crypto.ts`, `apps/server/src/setup/crypto.ts`, `work/T-1107-shared-crypto-envelope.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/effect/crypto-envelope.test.ts src/setup/crypto.test.ts src/connections/crypto.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The old-envelope compatibility case passes.

---

## Report (written by the worker when done)

### What I did

1. Added `apps/server/src/effect/crypto-envelope.ts`: `makeEnvelope(label, fail)` returns
   `{ encrypt(masterKey, plaintext), decrypt(masterKey, envelope) }`. The body is the old
   `deriveKey` / `encryptOnce` / `decryptOnce` moved unchanged (same `aes-256-gcm`, SHA-256 HKDF with
   a 32-byte key, 16-byte salt, 12-byte IV, 16-byte tag, 5-part `v1:<salt>:<iv>:<ciphertext>:<tag>`
   base64url format and the same length/version checks), with `label` in place of the constant and
   `throw fail()` in place of `throw new XError()`.
2. Rewrote the three callers to use it, keeping every existing export and its behaviour:
   - `push/crypto.ts`: keeps `PUSH_STORAGE_KDF_LABEL` import, `PushDecryptionError`, `PushCipher`,
     `createPushCipher`.
   - `connections/crypto.ts`: keeps `PROVIDER_KEY_KDF_LABEL` import, `DecryptionError`, `KeyCipher`,
     `createKeyCipher`.
   - `setup/crypto.ts`: keeps `INSTANCE_SETTINGS_KDF_LABEL`, `SettingsDecryptionError`,
     `SettingsCipher`, `createSettingsCipher`.
   The three private copies of the constants and the three helpers are deleted. Each file now holds a
   single module-level `const envelope = makeEnvelope(<label>, () => new <Error>())`.
3. Added `apps/server/src/effect/crypto-envelope.test.ts`: a round trip, label isolation (a blob
   sealed under one label throws the opener's own error class), the three real ciphers isolated, and
   the old-envelope compatibility case.
4. Compatibility: the pinned constant `LEGACY_ENVELOPE` was produced with the old
   `createKeyCipher` provider-key algorithm (`galena/provider-key/v1`) using fixed salt/IV
   (`node -e` replicating the old code byte-for-byte; the real module cannot be run from plain Node
   because its extensionless `../kdf-labels` import fails under type-stripping). Master key
   `legacy-test-master-key-0000000000`, plaintext `sk-legacy-provider-key-abc123`. The test proves
   the new `createKeyCipher` reads it and that the settings cipher still rejects it.

### Files changed

Exactly the Allowed files: `apps/server/src/effect/crypto-envelope.ts`,
`apps/server/src/effect/crypto-envelope.test.ts`, `apps/server/src/push/crypto.ts`,
`apps/server/src/connections/crypto.ts`, `apps/server/src/setup/crypto.ts`,
`work/T-1107-shared-crypto-envelope.md`.

One necessary addition beyond "moved unchanged": `crypto-envelope.ts` carries a
`// effect-plain:` marker (first 15 lines), the same opt-out the three original files already had for
this synchronous decrypt. Without it the gate's effect ratchet fails any new file in
`apps/server/src/effect/` that contains `try {`. No behaviour change.

### Commands and real results

- `pnpm install` (repo root): done, no errors (only the pre-existing `@types/react-dom` peer warning).
- Task Checks:
  `pnpm --filter @zilar/server exec vitest run src/effect/crypto-envelope.test.ts src/setup/crypto.test.ts src/connections/crypto.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 3 passed (3)`, `Tests 20 passed (20)`.
- Single new test: `vitest run src/effect/crypto-envelope.test.ts` →
  `Test Files 1 passed (1)`, `Tests 5 passed (5)`.
- `pnpm gate` (repo root), final run:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (7.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (A first gate run failed on my unused `DecryptionError` test import and on the missing
  `effect-plain` marker; both fixed and the gate was re-run green.)
- `git diff main --stat` (literal command; `main` has moved ahead of where this branch was cut by two
  commits — `61f1fd0e Spec T-1109` and `6f87039b NOW: 11:20` — so it also lists their work/ and
  unrelated app files as "removed". Those are not mine; the gate's merge-base check
  (`main...HEAD`) reports the real scope):
  ```
   apps/mobile/app.json                        |  18 +----
   apps/mobile/src/app/+native-intent.tsx      |   9 ---
   apps/mobile/src/lib/web-link.ts             | 107 ---------------------------
   apps/server/src/connections/crypto.ts       |  70 +-----------------
   apps/server/src/push/crypto.ts              |  70 +-----------------
   apps/server/src/setup/crypto.ts             |  70 +-----------------
   apps/web/public/.well-known/assetlinks.json |  12 ---
   work/BOARD.md                               |   3 +-
   work/NOW.md                                 |  12 ---
   work/T-1106-android-app-links.md            | 110 +---------------------------
   work/T-1107-shared-crypto-envelope.md       |   2 +-
   work/T-1109-xmpp-unavailable-constructor.md |  64 ----------------
   12 files changed, 16 insertions(+), 531 deletions(-)
  ```
  My files only (`git diff main --stat -- apps/server/src/{effect,push,connections,setup}`):
  ```
   apps/server/src/connections/crypto.ts          | 70 ++-------------------
   apps/server/src/effect/crypto-envelope.test.ts | 63 +++++++++++++++++++
   apps/server/src/effect/crypto-envelope.ts      | 86 ++++++++++++++++++++++++++
   apps/server/src/push/crypto.ts                 | 70 ++-------------------
   apps/server/src/setup/crypto.ts                | 70 ++-------------------
   5 files changed, 161 insertions(+), 198 deletions(-)
  ```

### No envelope format change

The shared body keeps the same `v1` version, 16-byte salt, 12-byte IV, 16-byte tag, 5-part
`v1:<salt>:<iv>:<ciphertext>:<tag>` base64url string and the same `hkdfSync('sha256', masterKey,
salt, label, 32)` derivation, so envelopes written before the refactor still decrypt — proven by the
pinned `LEGACY_ENVELOPE` test.

### Problems / deviations

- The compatibility constant was generated by replicating the old code rather than importing the old
  module (see step 4); the crypto is byte-identical to the old `createKeyCipher`, and the test itself
  decrypts it with the real current `createKeyCipher`.
- Gate scope is clean; no other files touched.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `apps/server/src/effect/crypto-envelope.ts` has `makeEnvelope(label, fail)`. The push, connections and setup ciphers keep their labels, error classes, interfaces and factory names, and call it.
- **The lead's line check:** main's push envelope, with its label and error swapped in and indentation ignored, against the new file. The only differences are the import, the `Envelope` interface, the wrapping function and the return. The constants (`v1`, 16/12/16 bytes, 5 parts) and every step are identical.
- **Compatibility, checked by the lead:** the test's fixed "legacy" blob decrypts to `sk-legacy-provider-key-abc123` with **main's old `createKeyCipher`**, and the new code passes the same test. Stored keys stay readable.
- **Tests:** the lead ran `effect/crypto-envelope`, `setup/crypto`, `connections/crypto` and `ais/usage` on the branch: 4 files, 33 green. The gate passed.
