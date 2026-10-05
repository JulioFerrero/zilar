import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  formatPairingCode,
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  pairingSignatureMessage,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
} from './codes';

const DISPLAY_PATTERN =
  /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('pairing codes', () => {
  it('generates codes shaped XXXX-XXXX from the unambiguous alphabet', () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(DISPLAY_PATTERN);
      expect(code.replace('-', '')).toHaveLength(PAIRING_CODE_LENGTH);
    }
  });

  it('never uses ambiguous characters (I, L, O, 0, 1)', () => {
    for (const char of PAIRING_CODE_ALPHABET) {
      expect('ILO01').not.toContain(char);
    }
    for (let index = 0; index < 100; index += 1) {
      const raw = generatePairingCode().replace('-', '');
      for (const char of raw) {
        expect(PAIRING_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('draws unique codes across many generations', () => {
    const seen = new Set<string>();
    const draws = 5000;
    for (let index = 0; index < draws; index += 1) {
      seen.add(generatePairingCode());
    }
    expect(seen.size).toBe(draws);
  });

  it('normalizes pasted codes (lowercase, spaces, dashes)', () => {
    expect(normalizePairingCode('k7qx-m2pa')).toBe('K7QXM2PA');
    expect(normalizePairingCode('K7QX-M2PA')).toBe('K7QXM2PA');
    expect(normalizePairingCode('  k7qx m2pa  ')).toBe('K7QXM2PA');
    expect(normalizePairingCode('K7QX--M2PA')).toBe('K7QXM2PA');
  });

  it('rejects codes with wrong characters or length', () => {
    expect(normalizePairingCode('K7QX-M2P')).toBeNull();
    expect(normalizePairingCode('K7QX-M2PAA')).toBeNull();
    expect(normalizePairingCode('K7QX-M2P0')).toBeNull();
    expect(normalizePairingCode('K7QX-M2PI')).toBeNull();
    expect(normalizePairingCode('K7QX-M2PL')).toBeNull();
    expect(normalizePairingCode('K7QX-M2PO')).toBeNull();
    expect(normalizePairingCode('')).toBeNull();
    expect(normalizePairingCode('********')).toBeNull();
  });

  it('formats a normalized code for display', () => {
    expect(formatPairingCode('K7QXM2PA')).toBe('K7QX-M2PA');
  });

  it('hashes with SHA-256 hex and nothing else is stored', () => {
    const hash = hashPairingCode('K7QXM2PA');
    expect(hash).toBe(createHash('sha256').update('K7QXM2PA', 'utf8').digest('hex'));
    expect(hash).toHaveLength(64);
    expect(hashPairingCode('K7QXM2PA')).toBe(hash);
    expect(hashPairingCode('K7QXM2PB')).not.toBe(hash);
  });

  it('expires codes after ten minutes', () => {
    expect(PAIRING_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('builds the signature message over ASCII zilar-pair:v1:<CODE>', () => {
    expect(pairingSignatureMessage('K7QXM2PA').toString('ascii')).toBe('zilar-pair:v1:K7QXM2PA');
  });
});
