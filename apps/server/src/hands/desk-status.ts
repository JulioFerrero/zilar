// The cached status probe: asks the desk agent whether it is ready and which image it
// pinned. `null` means "no cloud computer for this turn", never an error.
import type { Logger } from 'pino';
import { Schema } from 'effect';
import { ErrorInfoSchema } from '@zilar/desk';
import type { DeskClient } from '../agents/gateway/desk-exec';
import { requestReply, type Hands } from './cloud-hands';

export type DeskProbe = () => Promise<DeskClient | null>;

export interface DeskProbeOptions {
  readonly socketPath: string;
  readonly hands: Hands;
  readonly overrideImage?: string | undefined;
  readonly logger: Logger;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;

// Lenient: `ready`, `imageDigest` and `detail` are absent from an old agent's status,
// and a missing `ready` means ready. Anything the schema refuses reads as "not ready".
const statusReplySchema = Schema.Union([
  Schema.Struct({ id: Schema.Number, ok: Schema.Literal(false), error: ErrorInfoSchema }),
  Schema.Struct({
    id: Schema.Number,
    ok: Schema.Literal(true),
    status: Schema.Struct({
      // A real agent answers `running` as a list and `queued` as a number; the probe reads
      // neither, so accept them loosely.
      running: Schema.optional(Schema.Unknown),
      queued: Schema.optional(Schema.Unknown),
      ready: Schema.optional(Schema.Boolean),
      imageDigest: Schema.optional(Schema.NullOr(Schema.String)),
      detail: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  }),
]);

/**
 * Caches the answer (ready or not) for `ttlMs`; concurrent callers share one in-flight
 * request. Any error, timeout or missing socket is `null`, never thrown. Logs only when
 * availability changes, with a fixed message and the agent's `detail` code.
 */
export function createDeskProbe(options: DeskProbeOptions): DeskProbe {
  const { socketPath, hands, overrideImage, logger } = options;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  let cached: { at: number; value: DeskClient | null } | null = null;
  let inFlight: Promise<DeskClient | null> | null = null;
  let lastAvailable: boolean | null = null;

  function logChange(available: boolean, detail: string | null): void {
    if (lastAvailable === available) {
      return;
    }
    lastAvailable = available;
    if (available) {
      logger.info('desks: the agent is ready');
    } else {
      logger.info({ detail }, 'desks: the agent is not ready');
    }
  }

  async function probeOnce(): Promise<DeskClient | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let available = false;
    let detail: string | null = null;
    let value: DeskClient | null = null;
    try {
      const reply = await requestReply(socketPath, { id: 1, method: 'status' }, controller.signal);
      const decoded = Schema.decodeUnknownSync(statusReplySchema)(reply);
      if (decoded.ok) {
        detail = decoded.status.detail ?? null;
        const ready = decoded.status.ready ?? true;
        const digest = decoded.status.imageDigest ?? overrideImage ?? null;
        if (ready && digest !== null && digest.length > 0) {
          available = true;
          value = { hands, imageDigest: digest };
        }
      }
    } catch {
      available = false;
    } finally {
      clearTimeout(timer);
    }
    logChange(available, detail);
    return value;
  }

  return async function probe(): Promise<DeskClient | null> {
    if (cached !== null && now() - cached.at < ttlMs) {
      return cached.value;
    }
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = probeOnce().then((value) => {
      inFlight = null;
      cached = { at: now(), value };
      return value;
    });
    return inFlight;
  };
}
