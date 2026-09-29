import {
  CLOSE_AUTH,
  CLOSE_REVOKED,
  CLOSE_VERSION,
  RunnerClient,
  type RunnerKeypair,
} from '@galena/runner-tunnel';
import type { RunnerIdentity } from './identity.ts';

export interface RunOptions {
  identity: RunnerIdentity;
  hubUrl: string;
  signal?: AbortSignal;
  logger?: (message: string) => void;
}

export interface RunResult {
  status: 'stopped' | 'revoked' | 'auth_failed' | 'version_mismatch' | 'disconnected';
  message: string;
}

export function hubUrlFromServer(serverUrl: string, hubPort: number): string {
  const parsed = new URL(serverUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.port = String(hubPort);
  return `${parsed.protocol}//${parsed.host}/tunnel`;
}

export function validateHubUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectError('invalid_hub', `Hub URL is not valid: ${url}`);
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new ConnectError(
      'invalid_hub',
      `Hub URL must use ws:// or wss:// (got ${parsed.protocol}).`,
    );
  }
  return parsed;
}

export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.code = code;
  }
}

export async function runRunner(options: RunOptions): Promise<RunResult> {
  const hub = validateHubUrl(options.hubUrl);
  const log = options.logger ?? ((): void => undefined);
  log('connecting');

  const keypair: RunnerKeypair = {
    publicKey: options.identity.publicKey,
    privateKey: options.identity.privateKey,
  };

  const client = new RunnerClient({
    serverUrl: hub.toString(),
    runnerId: options.identity.machineId,
    keypair,
    exposedPorts: [],
    enableModelListener: false,
    reconnectBaseMs: 250,
    reconnectMaxMs: 5000,
  });

  let failureMessage = '';
  let failureSeen = false;
  const onFailure = new Promise<void>((resolve) => {
    const off = client.on('failed', (err?: Error) => {
      failureSeen = true;
      failureMessage = err?.message ?? 'unknown';
      log(`disconnected (${failureMessage})`);
      off();
      resolve();
    });
  });
  const offReady = client.on('ready', () => {
    log('online');
  });

  try {
    try {
      await client.start();
    } catch (err) {
      return mapFailure(err instanceof Error ? err.message : String(err));
    }

    await waitForSignalOrFailure(options.signal, onFailure);

    if (failureSeen) {
      return mapFailure(failureMessage);
    }

    return { status: 'stopped', message: 'runner stopped' };
  } finally {
    offReady();
    await client.stop().catch(() => undefined);
  }
}

function mapFailure(message: string): RunResult {
  if (message.includes(`(${CLOSE_REVOKED})`)) {
    return {
      status: 'revoked',
      message: 'this machine was revoked, run pair again with a new code',
    };
  }
  if (message.includes(`(${CLOSE_AUTH})`)) {
    return {
      status: 'auth_failed',
      message: 'the server refused our identity (auth failure)',
    };
  }
  if (message.includes(`(${CLOSE_VERSION})`)) {
    return {
      status: 'version_mismatch',
      message: 'the server speaks a different protocol version',
    };
  }
  // Anything else (a network drop, the server going away, a malformed frame
  // becoming a fatal close) is not an auth failure. Tell the user the link
  // dropped and let the runner's own backoff reconnect for us.
  return {
    status: 'disconnected',
    message: 'lost the connection to the server',
  };
}

// Exposed for tests so each branch can be asserted directly without standing
// up a real tunnel.
export const __test__mapFailure = mapFailure;

function waitForSignalOrFailure(
  signal: AbortSignal | undefined,
  onFailure: Promise<void>,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => finish();
    signal?.addEventListener('abort', onAbort);
    onFailure.then(finish, finish);
  });
}
