import { createPrivateKey, sign } from 'node:crypto';
import os from 'node:os';
import { generateRunnerKeypair, type RunnerKeypair } from '@zilar/runner-tunnel';
import { Exit, Schema } from 'effect';
import { detectCapabilities, type Capabilities } from './capabilities.ts';
import {
  buildIdentity,
  fingerprintOfPublicKey,
  IdentityError,
  type IdentityStorage,
  requireWritableIdentity,
  saveIdentity,
  type RunnerIdentity,
} from './identity.ts';

export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
const NORMALIZED_PATTERN = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

export class PairError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'PairError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface PairOptions {
  code: string;
  serverUrl: string;
  name?: string;
  storage: IdentityStorage;
  fetchImpl?: typeof fetch;
  detect?: () => Promise<Capabilities>;
  generateKeypair?: () => RunnerKeypair;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
  timeoutMs?: number;
  force?: boolean;
}

export interface PairResult {
  machineId: string;
  fingerprint: string;
  identity: RunnerIdentity;
}

export function normalizePairingCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[\s-]+/g, '');
  if (!NORMALIZED_PATTERN.test(normalized)) return null;
  return normalized;
}

// Matches the server's pairingSignatureMessage
// (apps/server/src/machines/codes.ts).
function pairingSignatureMessage(normalized: string): Buffer {
  return Buffer.from(`zilar-pair:v1:${normalized}`, 'ascii');
}

function signPairingMessage(privateKey: RunnerKeypair, normalized: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey.privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, pairingSignatureMessage(normalized), key).toString('base64');
}

function validateServerUrl(serverUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new PairError('invalid_server', `Server URL is not valid: ${serverUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PairError(
      'invalid_server',
      `Server URL must use http:// or https:// (got ${parsed.protocol}).`,
    );
  }
  return parsed;
}

function defaultName(): string {
  const host = os.hostname().trim();
  return host.length > 0 ? host.slice(0, 64) : 'zilar-runner';
}

const pairResponseSchema = Schema.Struct({
  machineId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  status: Schema.Literal('pending'),
});

export async function pairRunner(options: PairOptions): Promise<PairResult> {
  const code = options.code.trim();
  const normalized = normalizePairingCode(code);
  if (normalized === null) {
    throw new PairError(
      'invalid_code_format',
      'That does not look like a Zilar pairing code (expect 8 letters/digits, dashes optional).',
    );
  }

  validateServerUrl(options.serverUrl);
  await requireWritableIdentity(options.storage, options.force === true);

  const name = (options.name ?? defaultName()).trim();
  if (name.length === 0) {
    throw new PairError('invalid_name', 'Machine name must have at least one character.');
  }
  const trimmedName = name.slice(0, 64);

  const fetchImpl = options.fetchImpl ?? fetch;
  const detect = options.detect ?? (() => detectCapabilities());
  const generateKeypair = options.generateKeypair ?? generateRunnerKeypair;

  const [capabilities, keypair] = await Promise.all([detect(), generateKeypair()]);
  const signature = signPairingMessage(keypair, normalized);

  const body = JSON.stringify({
    code: normalized,
    publicKey: keypair.publicKey,
    signature,
    name: trimmedName,
    capabilities,
  });

  const timeoutMs = options.timeoutMs ?? 15000;
  const endpoint = new URL('/api/runner/pair', options.serverUrl);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new PairError('timeout', `The server did not answer within ${timeoutMs} ms.`, true);
    }
    throw new PairError(
      'network',
      `Could not reach ${endpoint.origin}: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }

  if (response.status === 201) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PairError(
        'malformed_response',
        'The server returned 201 but the body was not JSON.',
      );
    }
    const parsed = Schema.decodeUnknownExit(pairResponseSchema, { onExcessProperty: 'error' })(
      payload,
    );
    if (Exit.isFailure(parsed)) {
      throw new PairError(
        'malformed_response',
        'The server response did not include a machine id.',
      );
    }
    const identity = buildIdentity({
      serverUrl: options.serverUrl,
      machineId: parsed.value.machineId,
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: trimmedName,
    });
    try {
      if (options.logger !== undefined) {
        await saveIdentity(options.storage, identity, { logger: options.logger });
      } else {
        await saveIdentity(options.storage, identity);
      }
    } catch (err) {
      if (err instanceof IdentityError) {
        throw new PairError('storage', err.message);
      }
      throw err;
    }
    return {
      machineId: parsed.value.machineId,
      fingerprint: fingerprintOfPublicKey(keypair.publicKey),
      identity,
    };
  }

  if (response.status === 400) {
    throw new PairError(
      'invalid_code',
      'That pairing code is invalid or expired. Get a new one from Settings → Machines.',
    );
  }
  if (response.status === 409) {
    // Never echo server-provided text: a hostile or buggy server body could
    // trick the CLI into printing something we don't want on the user's
    // terminal. Map the known 409 codes to fixed sentences; fall back to a
    // single generic line for anything else.
    let detail = 'Another machine already uses this key.';
    try {
      const data = (await response.json()) as { code?: string };
      if (data?.code === 'key_in_use') {
        detail = 'This machine key is already registered with the server.';
      } else if (data?.code === 'machine_limit') {
        detail = 'You already have the maximum number of machines registered.';
      } else if (data?.code === 'pending_limit') {
        detail = 'You already have the maximum number of pending machines.';
      } else if (data?.code === 'pairing_code_limit') {
        detail = 'You have too many outstanding pairing codes.';
      } else {
        detail = 'The server refused this machine.';
      }
    } catch {
      detail = 'The server refused this machine.';
    }
    throw new PairError('key_in_use', detail);
  }
  if (response.status === 429) {
    throw new PairError('rate_limited', 'Too many attempts, wait a minute and try again.', true);
  }

  throw new PairError(
    `http_${response.status}`,
    `The server returned ${response.status}. Try again in a moment.`,
    response.status >= 500,
  );
}
