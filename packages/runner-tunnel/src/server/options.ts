import { Effect, Schema } from 'effect';
import type { KeyRegistry } from '../keys.ts';
import { stringUrl } from '../runner/options.ts';

export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

export const ServerOptionsSchema = Schema.Struct({
  gatewayUrl: stringUrl.check(Schema.isStartingWith('http://')),
  heartbeatIntervalMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(10),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(15000))),
  heartbeatTimeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(50),
    Schema.isLessThanOrEqualTo(300000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(45000))),
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

/** The server options after the schema applied its defaults. */
export type ServerOptionsDecoded = typeof ServerOptionsSchema.Type;

export interface TunnelServerOptions {
  registry: KeyRegistry;
  /** The one gateway model traffic may reach, e.g. `http://127.0.0.1:4000`. HTTP only for the spike. */
  gatewayUrl: string;
  heartbeatIntervalMs?: number | undefined;
  heartbeatTimeoutMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}
