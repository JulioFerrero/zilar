import { createHash, randomInt } from 'node:crypto';

// 8 characters, no ambiguous ones (no I, L, O, 0 or 1), shown as XXXX-XXXX.
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_GROUP_SIZE = 4;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const NORMALIZED_PAIRING_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

// One fresh pairing code, formatted for display (XXXX-XXXX). Uses
// crypto.randomInt, so each character is uniform over the alphabet.
export function generatePairingCode(): string {
  let raw = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    raw += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return formatPairingCode(raw);
}

// Accepts lowercase, spaces and dashes; null when the input cannot be a code.
export function normalizePairingCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[\s-]+/g, '');
  if (!NORMALIZED_PAIRING_CODE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function formatPairingCode(normalized: string): string {
  return `${normalized.slice(0, PAIRING_CODE_GROUP_SIZE)}-${normalized.slice(PAIRING_CODE_GROUP_SIZE)}`;
}

// A SHA-256 hash is stored; the plain code is returned once and never persisted
// or logged.
export function hashPairingCode(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// The bytes the runner signs. The code binds the signature, so it cannot be
// replayed against another code.
export function pairingSignatureMessage(normalized: string): Buffer {
  return Buffer.from(`zilar-pair:v1:${normalized}`, 'ascii');
}
