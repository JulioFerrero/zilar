import { Deferred, Effect, Result } from 'effect';
import {
  CLOSE_AUTH,
  CLOSE_REVOKED,
  CLOSE_VERSION,
  RunnerClient,
  type RunnerKeypair,
} from '@zilar/runner-tunnel';
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

function checkHubUrl(url: string): Result.Result<URL, ConnectError> {
  return Result.try({
    try: () => new URL(url),
    catch: () => new ConnectError('invalid_hub', `Hub URL is not valid: ${url}`),
  }).pipe(
    Result.flatMap((parsed) =>
      parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
        ? Result.succeed(parsed)
        : Result.fail(
            new ConnectError(
              'invalid_hub',
              `Hub URL must use ws:// or wss:// (got ${parsed.protocol}).`,
            ),
          ),
    ),
  );
}

export function validateHubUrl(url: string): URL {
  return Result.getOrThrowWith(checkHubUrl(url), (error) => error);
}

export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.code = code;
  }
}

export const runRunnerEffect = (options: RunOptions): Effect.Effect<RunResult, ConnectError> =>
  Effect.gen(function* () {
    const hub = yield* Effect.fromResult(checkHubUrl(options.hubUrl));
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
    const failed = yield* Deferred.make<void>();
    const offFailed = client.on('failed', (err?: Error) => {
      failureSeen = true;
      failureMessage = err?.message ?? 'unknown';
      log(`disconnected (${failureMessage})`);
      offFailed();
      Deferred.doneUnsafe(failed, Effect.void);
    });
    const offReady = client.on('ready', () => {
      log('online');
    });

    const stopClient = Effect.sync(offReady).pipe(
      Effect.andThen(Effect.ignore(Effect.tryPromise(() => client.stop()))),
    );

    const afterStart = waitForSignalOrFailure(options.signal, failed).pipe(
      Effect.map((): RunResult =>
        failureSeen ? mapFailure(failureMessage) : { status: 'stopped', message: 'runner stopped' },
      ),
    );

    return yield* Effect.tryPromise({
      try: () => client.start(),
      catch: (err) => mapFailure(err instanceof Error ? err.message : String(err)),
    }).pipe(
      Effect.matchEffect({
        onFailure: (result) => Effect.succeed(result),
        onSuccess: () => afterStart,
      }),
      Effect.ensuring(stopClient),
    );
  });

export const runRunner = (options: RunOptions): Promise<RunResult> =>
  Effect.runPromise(runRunnerEffect(options));

export function mapFailure(message: string): RunResult {
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
  // Anything else (a network drop, the server going away) is not an auth
  // failure: say the link was lost.
  return {
    status: 'disconnected',
    message: 'lost the connection to the server',
  };
}

function waitForSignalOrFailure(
  signal: AbortSignal | undefined,
  failed: Deferred.Deferred<void>,
): Effect.Effect<void> {
  // Lazy: the signal may abort while the client is still starting.
  return Effect.suspend(() => {
    if (signal === undefined) return Deferred.await(failed);
    if (signal.aborted) return Effect.void;
    const aborted = Effect.callback<void>((resume) => {
      const onAbort = (): void => resume(Effect.void);
      signal.addEventListener('abort', onAbort);
      return Effect.sync(() => signal.removeEventListener('abort', onAbort));
    });
    return Effect.raceFirst(Deferred.await(failed), aborted);
  });
}
