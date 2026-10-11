---
id: T-1107
title: "Dedup S6: one shared AES-GCM/HKDF envelope for the push, connections and setup ciphers, moved unchanged (each keeps its own label and error class)"
status: todo
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

## Review (written by Claude)
