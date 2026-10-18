// effect-plain: a synchronous ed25519 check.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { pairingSignatureMessage } from './codes';

export function fingerprintOfPublicKey(publicKeyBase64: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyBase64, 'base64'))
    .digest('hex')
    .slice(0, 16);
}

// Proof of possession: an ed25519 signature by `publicKey` over
// `zilar-pair:v1:<code>`. A malformed input or someone else's key answers false,
// never a throw.
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
