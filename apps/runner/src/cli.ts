import { parseArgs } from 'node:util';
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

const USAGE = `Usage: galena-runner <command> [options]

Commands:
  pair <CODE> --server <URL> [--name NAME] [--home DIR]
                            Register a new machine with the Galena server.
                            Saves the identity to <home>/identity.json (0600).

  run     [--hub <WS_URL>] [--home DIR]
                            Connect to the server's runner hub and stay online.
                            Uses the identity saved by 'pair'. The first run
                            after pairing requires --hub to record the hub URL.

  status  [--home DIR]      Show the saved identity (never the private key).

  help                       Print this message.

Options:
  --home DIR                Override the identity directory (default ~/.galena-runner
                            or $GALENA_RUNNER_HOME).
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

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<CliResult> {
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

  let exitCode = EXIT_OK;
  try {
    const command = argv[0];
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
      captured.stdout(USAGE);
      return { exitCode: EXIT_OK, stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n') };
    }
    if (command === 'pair') {
      await runPair(argv.slice(1), captured);
    } else if (command === 'run') {
      await runConnect(argv.slice(1), captured);
    } else if (command === 'status') {
      await runStatus(argv.slice(1), captured);
    } else {
      captured.stderr(`Unknown command: ${command}\n\n${USAGE}`);
      exitCode = EXIT_USAGE;
    }
  } catch (err) {
    const { exitCode: code, message } = describeError(err);
    captured.stderr(message);
    exitCode = code;
  }

  return { exitCode, stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n') };
}

function buildStorage(home: string | undefined, env: NodeJS.ProcessEnv): IdentityStorage {
  const dir = resolveHomeDir(home, env['GALENA_RUNNER_HOME']);
  return identityPaths(dir);
}

async function runPair(argv: string[], io: CliIo): Promise<void> {
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
    throw new UsageError('--server <URL> is required.');
  }
  const code = positionals[0];
  if (code === undefined) {
    throw new UsageError('Usage: galena-runner pair <CODE> --server <URL>');
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
  const result: PairResult = await pairRunner(options);
  io.stdout('Paired with the server.');
  io.stdout(`  machine id   ${result.machineId}`);
  io.stdout(`  fingerprint  ${result.fingerprint}`);
  io.stdout(`  identity     ${storage.filePath}`);
  io.stdout('Approve the machine in Settings → Machines to finish.');
}

async function runConnect(argv: string[], io: CliIo): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      hub: { type: 'string' },
      home: { type: 'string' },
    },
  });
  if (positionals.length > 0) {
    throw new UsageError(`Unknown argument: ${positionals[0]}`);
  }
  const storage = buildStorage(values.home, io.env);
  const identity = await loadIdentity(storage);

  let nextHub = values.hub;
  if (nextHub === undefined && identity.hubUrl !== undefined) {
    nextHub = identity.hubUrl;
  }
  if (nextHub === undefined) {
    throw new UsageError(
      'First run needs --hub WS_URL (e.g. ws://your-server:3189/tunnel). It will be saved for next time.',
    );
  }
  validateHubUrl(nextHub);

  if (identity.hubUrl !== nextHub) {
    const updated = { ...identity, hubUrl: nextHub };
    await saveIdentity(storage, updated);
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
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  io.stdout('Connecting to the runner hub…');
  const result = await runRunner({
    identity,
    hubUrl: nextHub,
    signal: controller.signal,
    logger: (line) => io.stdout(line),
  });

  process.removeListener('SIGINT', sigintHandler);
  process.removeListener('SIGTERM', sigtermHandler);
  handleRunResult(result, io);
}

function handleRunResult(result: RunResult, io: CliIo): void {
  switch (result.status) {
    case 'stopped':
      io.stdout('Runner stopped.');
      return;
    case 'revoked':
      throw new ConnectError('revoked', `Revoked: ${result.message}`);
    case 'auth_failed':
      throw new ConnectError('auth_failed', `Auth failed: ${result.message}`);
    case 'version_mismatch':
      throw new ConnectError('version_mismatch', `Protocol mismatch: ${result.message}`);
    case 'disconnected':
      throw new ConnectError('disconnected', `Disconnected: ${result.message}`);
  }
}

async function runStatus(argv: string[], io: CliIo): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      home: { type: 'string' },
    },
  });
  const storage = buildStorage(values.home, io.env);
  const summary = await summarizeIdentity(storage);
  io.stdout('Galena runner identity');
  io.stdout(`  machine id   ${summary.machineId}`);
  io.stdout(`  name         ${summary.name}`);
  io.stdout(`  server       ${summary.serverUrl}`);
  io.stdout(`  fingerprint  ${summary.fingerprint}`);
  io.stdout(`  hub          ${summary.hubUrl ?? '(not set)'}`);
  io.stdout(`  created at   ${summary.createdAt}`);
  io.stdout(`  file         ${summary.filePath}`);
}

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
  const result = await runCli(process.argv.slice(2));
  process.exit(result.exitCode);
}
