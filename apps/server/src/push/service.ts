import { Data } from 'effect';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { ArchivePool } from '../search/service';
import type { PushCipher } from './crypto';
import type { WebPushDelivery } from './sender';

// The push service used to live here. It is split into `delivery.ts`
// (`handleIncomingPush` and the resolve/send pipeline), `archive-scan.ts`
// (the newest-message scan) and `candidates.ts` (per-row mute/visibility
// resolution). This path keeps the deps and outcome types, the pipeline's
// TaggedErrors, and stays a barrel so every importer keeps working with the
// same names and kinds.

export interface PushLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface PushServiceDeps {
  db: ServerDatabase;
  config: ServerConfig;
  /** Read-only pool on the ejabberd MAM archive. The component only starts
   * when it is configured: without the archive who/where cannot be
   * resolved, so notifications are dropped instead of guessed. */
  archive: ArchivePool;
  cipher: PushCipher;
  sender: WebPushDelivery;
  logger: PushLogger;
  /** Per-process record of notified message origin ids per device node, so
   * a retried publish IQ or a re-scan never buzzes twice. Capped per node.
   * Keyed by node (not user): ejabberd sends one publish IQ per node and
   * each device must buzz independently (S1). */
  recentlyNotified: Map<string, Set<string>>;
  now?: () => Date;
}

export type PushOutcome =
  | { kind: 'sent'; userId: string; deviceId: string }
  | {
      kind: 'dropped';
      userId: string;
      deviceId: string;
      reason:
        | 'muted'
        | 'hidden'
        | 'duplicate'
        | 'no-message'
        | 'archive-unavailable'
        | 'undecryptable'
        | 'send-failed';
    }
  | { kind: 'unknown-device'; node: string };

// Internal failure modes of the delivery pipeline. Exported so the moved
// delivery and archive-scan modules can raise and catch the same classes.
export class Undecryptable extends Data.TaggedError('Undecryptable') {}

export class ArchiveUnavailable extends Data.TaggedError('ArchiveUnavailable') {}

export class SendFailed extends Data.TaggedError('SendFailed') {}

export { handleIncomingPush } from './delivery';
