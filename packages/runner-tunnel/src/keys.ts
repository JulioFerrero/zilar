import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export interface RunnerKeypair {
  /** ed25519 public key (SPKI DER), base64. This is what the server registry holds. */
  publicKey: string;
  /** ed25519 private key (PKCS8 DER), base64. Never leaves the runner. */
  privateKey: string;
}

export function generateRunnerKeypair(): RunnerKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** 32 fresh random bytes for one authentication challenge. */
export function randomNonce(): Buffer {
  return randomBytes(32);
}

/** Sign a challenge nonce. Returns the signature as base64. */
export function signNonce(privateKey: string, nonce: Buffer): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, nonce, key).toString('base64');
}

/**
 * Verify a challenge signature. Returns false (never throws) for garbage
 * input, a wrong key, or a signature over a different nonce.
 */
export function verifyNonce(publicKey: string, nonce: Buffer, signatureBase64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length === 0) {
      return false;
    }
    return verify(null, nonce, key, signature);
  } catch {
    return false;
  }
}

/**
 * Approved runner public keys. In-memory for the spike; M3 backs this with
 * Postgres. Revoking a key must also close its live connection, so the
 * server subscribes via onRevoke.
 */
export interface KeyRegistry {
  getPublicKey(runnerId: string): string | null;
  approve(runnerId: string, publicKey: string): void;
  revoke(runnerId: string): void;
  onRevoke(listener: (runnerId: string) => void): () => void;
}

export class InMemoryKeyRegistry implements KeyRegistry {
  private readonly keys = new Map<string, string>();
  private readonly revokeListeners = new Set<(runnerId: string) => void>();

  getPublicKey(runnerId: string): string | null {
    return this.keys.get(runnerId) ?? null;
  }

  approve(runnerId: string, publicKey: string): void {
    this.keys.set(runnerId, publicKey);
  }

  revoke(runnerId: string): void {
    this.keys.delete(runnerId);
    for (const listener of this.revokeListeners) {
      listener(runnerId);
    }
  }

  onRevoke(listener: (runnerId: string) => void): () => void {
    this.revokeListeners.add(listener);
    return () => {
      this.revokeListeners.delete(listener);
    };
  }
}
