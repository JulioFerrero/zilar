import { describe, expect, it } from 'vitest';
import {
  InMemoryKeyRegistry,
  generateRunnerKeypair,
  randomNonce,
  signNonce,
  verifyNonce,
} from './keys.ts';

describe('ed25519 runner identity', () => {
  it('signs and verifies a nonce', () => {
    const keypair = generateRunnerKeypair();
    const nonce = randomNonce();
    const signature = signNonce(keypair.privateKey, nonce);
    expect(verifyNonce(keypair.publicKey, nonce, signature)).toBe(true);
  });

  it('rejects a signature over a different nonce (replay)', () => {
    const keypair = generateRunnerKeypair();
    const signature = signNonce(keypair.privateKey, randomNonce());
    expect(verifyNonce(keypair.publicKey, randomNonce(), signature)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateRunnerKeypair();
    const b = generateRunnerKeypair();
    const nonce = randomNonce();
    expect(verifyNonce(b.publicKey, nonce, signNonce(a.privateKey, nonce))).toBe(false);
  });

  it('returns false for garbage instead of throwing', () => {
    const keypair = generateRunnerKeypair();
    expect(verifyNonce(keypair.publicKey, randomNonce(), '!!!not-base64!!!')).toBe(false);
    expect(verifyNonce('bogus', randomNonce(), 'eA==')).toBe(false);
  });

  it('generates unique keypairs and 32-byte nonces', () => {
    expect(generateRunnerKeypair().publicKey).not.toBe(generateRunnerKeypair().publicKey);
    expect(randomNonce().length).toBe(32);
  });
});

describe('InMemoryKeyRegistry', () => {
  it('approves, reads and revokes keys, notifying listeners', () => {
    const registry = new InMemoryKeyRegistry();
    expect(registry.getPublicKey('r1')).toBeNull();
    registry.approve('r1', 'pubkey-1');
    expect(registry.getPublicKey('r1')).toBe('pubkey-1');
    const seen: string[] = [];
    const off = registry.onRevoke((id) => {
      seen.push(id);
    });
    registry.revoke('r1');
    expect(registry.getPublicKey('r1')).toBeNull();
    expect(seen).toEqual(['r1']);
    off();
    registry.revoke('r1');
    expect(seen).toEqual(['r1']);
  });
});
