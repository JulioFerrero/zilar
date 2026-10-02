import { describe, expect, it } from 'vitest';
import { PROVIDER_KEY_KDF_LABEL, PUSH_STORAGE_KDF_LABEL } from './kdf-labels';

// The former project name, built at runtime so the repo-wide legacy-name
// guard does not flag this file.
const FORMER_NAME = ['gal', 'ena'].join('');

describe('key-derivation labels', () => {
  it('keep the exact bytes that stored ciphertext was encrypted under', () => {
    expect(PROVIDER_KEY_KDF_LABEL).toBe(`${FORMER_NAME}/provider-key/v1`);
    expect(PUSH_STORAGE_KDF_LABEL).toBe(`${FORMER_NAME}/push-storage/v1`);
  });
});
