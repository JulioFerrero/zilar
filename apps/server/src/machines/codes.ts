import { createHash, randomInt } from 'node:crypto';

// 8 characters from an alphabet without ambiguous ones (no I, L, O, 0 or 1),
// shown to the owner as XXXX-XXXX, e.g. K7QX-M2PA.
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

// Accepts whatever the runner pastes (lowercase, spaces, dashes) and returns
// the canonical 8 characters, or null when the input cannot be a code.
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

// What is stored: a SHA-256 hex hash of the normalized code. The plain code
// is returned once by the create call and never persisted or logged.
export function hashPairingCode(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// The exact bytes the runner signs to prove it holds the private key. The
// normalized code binds the signature to one code, so a signature cannot be
// replayed against another code.
export function pairingSignatureMessage(normalized: string): Buffer {
  return Buffer.from(`galena-pair:v1:${normalized}`, 'ascii');
}
