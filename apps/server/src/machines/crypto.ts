// effect-plain: moved unchanged from apps/server/src/machines/service.ts (size split)
import { createHash, createPublicKey, verify } from 'node:crypto';
import { pairingSignatureMessage } from './codes';

export function fingerprintOfPublicKey(publicKeyBase64: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyBase64, 'base64'))
    .digest('hex')
    .slice(0, 16);
}

// Proof-of-possession check: `signature` must be an ed25519 signature by
// `publicKey` over `zilar-pair:v1:<NORMALIZED_CODE>`. Returns false (never
// throws) for a malformed key, a malformed signature, or a signature over
// anything else — including someone else's public key.
export function verifyPairingSignature(
  publicKeyBase64: string,
  signatureBase64: string,
  normalizedCode: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length === 0) {
      return false;
    }
    return verify(null, pairingSignatureMessage(normalizedCode), key, signature);
  } catch {
    return false;
  }
}
