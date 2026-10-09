import { parseArgs } from 'node:util';
import { Cause, Effect } from 'effect';
import { CapabilitiesSchema } from './capabilities.ts';
import {
  type IdentityStorage,
  IdentityError,
  identityPaths,
  loadIdentity,
  resolveHomeDir,
  saveIdentity,
  summarizeIdentity,
} from './identity.ts';
import {
  ConnectError,
  hubUrlFromServer,
  runRunner,
  validateHubUrl,
  type RunResult,
} from './connect.ts';
import { pairRunner, PairError, type PairOptions, type PairResult } from './pair.ts';

const EXIT_OK = 0;
const EXIT_RUNTIME = 1;
const EXIT_USAGE = 2;

class UsageError extends Error {
  readonly code: 'usage';
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
    this.code = 'usage';
  }
}

const USAGE = `Usage: zilar-runner <command> [options]

Commands:
  pair <CODE> --server <URL> [--name NAME] [--home DIR]
                            Register a new machine with the Zilar server.
                            Saves the identity to <home>/identity.json (0600).

  run     [--hub <WS_URL>] [--home DIR]
                            Connect to the server's runner hub and stay online.
                            Uses the identity saved by 'pair'. The first run
                            after pairing requires --hub to record the hub URL.

  status  [--home DIR]      Show the saved identity (never the private key).

  help                       Print this message.

Options:
  --home DIR                Override the identity directory (default ~/.zilar-runner
                            or $ZILAR_RUNNER_HOME).
  --server URL              Server base URL, e.g. http://127.0.0.1:3000 (pair only).
  --hub WS_URL              Hub WebSocket URL, e.g. ws://127.0.0.1:3189/tunnel (run only).
  --name NAME               Friendly machine name (pair only).
  --force                   Overwrite an existing identity (pair only).
  --timeout-ms MS           Network timeout for the pair request (default 15000).

Exit codes: 0 ok, 1 runtime failure, 2 usage error.
`;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const defaultIo: CliIo = {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
  env: process.env,
};

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// A rejected Promise from the identity, pairing or connect modules becomes a
// typed failure that carries the original error, so describeError sees it as before.
const attempt = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: thunk, catch: (err) => err });

export const runCliEffect = (argv: string[], io: CliIo = defaultIo): Effect.Effect<CliResult> =>
  Effect.gen(function* () {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const captured: CliIo = {
      stdout: (line) => {
        stdoutLines.push(line);
        io.stdout(line);
      },
      stderr: (line) => {
        stderrLines.push(line);
        io.stderr(line);
      },
      env: io.env,
    };

    // Failures and thrown values (parseArgs, a throwing io) both end here.
    const exitCode = yield* dispatch(argv, captured).pipe(
      Effect.matchCause({
        onSuccess: (code) => code,
        onFailure: (cause) => {
          const { exitCode: code, message } = describeError(Cause.squash(cause));
          captured.stderr(message);
          return code;
        },
      }),
    );

    return { exitCode, stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n') };
  });

export const runCli = (argv: string[], io: CliIo = defaultIo): Promise<CliResult> =>
  Effect.runPromise(runCliEffect(argv, io));

function dispatch(argv: string[], captured: CliIo): Effect.Effect<number, unknown> {
  const command = argv[0];
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return Effect.sync(() => {
      captured.stdout(USAGE);
      return EXIT_OK;
    });
  }
  if (command === 'pair') {
    return runPair(argv.slice(1), captured).pipe(Effect.as(EXIT_OK));
  }
  if (command === 'run') {
    return runConnect(argv.slice(1), captured).pipe(Effect.as(EXIT_OK));
  }
  if (command === 'status') {
    return runStatus(argv.slice(1), captured).pipe(Effect.as(EXIT_OK));
  }
  return Effect.sync(() => {
    captured.stderr(`Unknown command: ${command}\n\n${USAGE}`);
    return EXIT_USAGE;
  });
}

function buildStorage(home: string | undefined, env: NodeJS.ProcessEnv): IdentityStorage {
  const dir = resolveHomeDir(home, env['ZILAR_RUNNER_HOME']);
  return identityPaths(dir);
}

const runPair = (argv: string[], io: CliIo): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        server: { type: 'string' },
        name: { type: 'string' },
        force: { type: 'boolean' },
        home: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (values.server === undefined) {
      return yield* Effect.fail(new UsageError('--server <URL> is required.'));
    }
    const code = positionals[0];
    if (code === undefined) {
      return yield* Effect.fail(new UsageError('Usage: zilar-runner pair <CODE> --server <URL>'));
    }
    const storage = buildStorage(values.home, io.env);
    const options: PairOptions = {
      code,
      serverUrl: values.server,
      storage,
      force: values.force === true,
    };
    if (values.name !== undefined) {
      options.name = values.name;
    }
    if (values['timeout-ms'] !== undefined) {
      options.timeoutMs = Number(values['timeout-ms']);
    }
    const result: PairResult = yield* attempt(() => pairRunner(options));
    io.stdout('Paired with the server.');
    io.stdout(`  machine id   ${result.machineId}`);
    io.stdout(`  fingerprint  ${result.fingerprint}`);
    io.stdout(`  identity     ${storage.filePath}`);
    io.stdout('Approve the machine in Settings → Machines to finish.');
  });

const runConnect = (argv: string[], io: CliIo): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        hub: { type: 'string' },
        home: { type: 'string' },
      },
    });
    if (positionals.length > 0) {
      return yield* Effect.fail(new UsageError(`Unknown argument: ${positionals[0]}`));
    }
    const storage = buildStorage(values.home, io.env);
    const identity = yield* attempt(() => loadIdentity(storage));

    let nextHub = values.hub;
    if (nextHub === undefined && identity.hubUrl !== undefined) {
      nextHub = identity.hubUrl;
    }
    if (nextHub === undefined) {
      return yield* Effect.fail(
        new UsageError(
          'First run needs --hub WS_URL (e.g. ws://your-server:3189/tunnel). It will be saved for next time.',
        ),
      );
    }
    const hubUrl = nextHub;
    yield* Effect.try({ try: () => validateHubUrl(hubUrl), catch: (err) => err });

    if (identity.hubUrl !== hubUrl) {
      const updated = { ...identity, hubUrl };
      yield* attempt(() => saveIdentity(storage, updated));
      io.stdout(`Saved hub URL to ${storage.filePath}`);
    }

    const controller = new AbortController();
    let stopping = false;
    const stop = (signal: NodeJS.Signals): void => {
      if (stopping) return;
      stopping = true;
      io.stdout(`\nReceived ${signal}, stopping…`);
      controller.abort();
    };
    const sigintHandler = (): void => stop('SIGINT');
    const sigtermHandler = (): void => stop('SIGTERM');
    const result = yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigtermHandler);
      }),
      () =>
        Effect.suspend(() => {
          io.stdout('Connecting to the runner hub…');
          return attempt(() =>
            runRunner({
              identity,
              hubUrl,
              signal: controller.signal,
              logger: (line) => io.stdout(line),
            }),
          );
        }),
      () =>
        Effect.sync(() => {
          process.removeListener('SIGINT', sigintHandler);
          process.removeListener('SIGTERM', sigtermHandler);
        }),
    );

    yield* handleRunResult(result, io);
  });

function handleRunResult(result: RunResult, io: CliIo): Effect.Effect<void, ConnectError> {
  switch (result.status) {
    case 'stopped':
      return Effect.sync(() => {
        io.stdout('Runner stopped.');
      });
    case 'revoked':
      return Effect.fail(new ConnectError('revoked', `Revoked: ${result.message}`));
    case 'auth_failed':
      return Effect.fail(new ConnectError('auth_failed', `Auth failed: ${result.message}`));
    case 'version_mismatch':
      return Effect.fail(
        new ConnectError('version_mismatch', `Protocol mismatch: ${result.message}`),
      );
    case 'disconnected':
      return Effect.fail(new ConnectError('disconnected', `Disconnected: ${result.message}`));
  }
}

const runStatus = (argv: string[], io: CliIo): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        home: { type: 'string' },
      },
    });
    const storage = buildStorage(values.home, io.env);
    const summary = yield* attempt(() => summarizeIdentity(storage));
    io.stdout('Zilar runner identity');
    io.stdout(`  machine id   ${summary.machineId}`);
    io.stdout(`  name         ${summary.name}`);
    io.stdout(`  server       ${summary.serverUrl}`);
    io.stdout(`  fingerprint  ${summary.fingerprint}`);
    io.stdout(`  hub          ${summary.hubUrl ?? '(not set)'}`);
    io.stdout(`  created at   ${summary.createdAt}`);
    io.stdout(`  file         ${summary.filePath}`);
  });

function describeError(err: unknown): { exitCode: number; message: string } {
  if (err instanceof UsageError) {
    return { exitCode: EXIT_USAGE, message: err.message };
  }
  if (err instanceof PairError) {
    const exit = err.code === 'invalid_code_format' ? EXIT_USAGE : EXIT_RUNTIME;
    return { exitCode: exit, message: err.message };
  }
  if (err instanceof IdentityError) {
    return { exitCode: EXIT_RUNTIME, message: err.message };
  }
  if (err instanceof Error) {
    return { exitCode: EXIT_RUNTIME, message: err.message };
  }
  return { exitCode: EXIT_RUNTIME, message: String(err) };
}

// Re-export the schema so tests can import it from one place.
export { CapabilitiesSchema };

// Force a tree-shake-friendly re-export of helpers used only by tests.
export const __test_helpers = { hubUrlFromServer };

const entry = process.argv[1];
const isMain =
  typeof entry === 'string' &&
  (entry.endsWith(`${'apps'}/runner/src/cli.ts`) || entry === 'cli.ts');

if (isMain) {
  Effect.runFork(
    runCliEffect(process.argv.slice(2)).pipe(
      Effect.flatMap((result) => Effect.sync(() => process.exit(result.exitCode))),
    ),
  );
}
