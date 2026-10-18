import { Effect, Schema } from 'effect';
import type { DeskRunnerHandler } from '../desk-runner.ts';
import type { RunnerKeypair } from '../keys.ts';

export const stringUrl: Schema.String = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
);

const portSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65535),
);

export const RunnerOptionsSchema = Schema.Struct({
  serverUrl: stringUrl.check(
    Schema.makeFilter((value) => value.startsWith('ws://') || value.startsWith('wss://'), {
      message: 'serverUrl must use ws:// or wss://',
    }),
  ),
  runnerId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  runnerVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).pipe(
    Schema.withDecodingDefault(Effect.succeed('0.1.0')),
  ),
  exposedPorts: Schema.Array(portSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  reconnectBaseMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(10),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(250))),
  reconnectMaxMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(50),
    Schema.isLessThanOrEqualTo(300000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(5000))),
  handshakeTimeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(100),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(10000))),
  highWaterMarkBytes: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(4096),
    Schema.isLessThanOrEqualTo(64 * 1024 * 1024),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(1024 * 1024))),
});

export type RunnerOptionsDecoded = typeof RunnerOptionsSchema.Type;

export interface RunnerOptions {
  serverUrl: string;
  runnerId: string;
  keypair: RunnerKeypair;
  runnerVersion?: string | undefined;
  /** Ports the server may open on this machine. Anything else is refused. */
  exposedPorts?: number[] | undefined;
  /** The runner's desk handler (plan §6.1); absent means the runner refuses desks. */
  deskRunner?: DeskRunnerHandler | undefined;
  reconnectBaseMs?: number | undefined;
  reconnectMaxMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}

export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}
