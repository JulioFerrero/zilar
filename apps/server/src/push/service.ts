import type { ServerCore } from '../app/deps';
import { Data } from 'effect';

import type { ArchivePool } from '../search/service';
import type { PushCipher } from './crypto';
import type { FcmSender } from './fcm';
import type { WebPushDelivery } from './sender';

export interface PushLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface PushServiceDeps extends Pick<ServerCore, 'db' | 'config'> {
  /** Read-only pool on the MAM archive; without it who and where cannot be
   * resolved, so notifications are dropped instead of guessed. */
  archive: ArchivePool;
  cipher: PushCipher;
  sender: WebPushDelivery;
  /** The FCM sender for native devices; optional because the server may run
   * without Firebase, in which case a wake is dropped as `send-failed`. */
  nativeSender?: FcmSender;
  logger: PushLogger;
  /** Per-process record of notified origin ids per node, so a retried IQ or
   * re-scan never buzzes twice. Keyed by node: one IQ per node and each device
   * must buzz independently (S1). */
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

// Internal failure modes, exported so delivery and archive-scan raise and
// catch the same classes.
export class Undecryptable extends Data.TaggedError('Undecryptable') {}

export class ArchiveUnavailable extends Data.TaggedError('ArchiveUnavailable') {}

export class SendFailed extends Data.TaggedError('SendFailed')<{
  /** The short reason stored with `failedAt`; see `pushFailureReason`. */
  readonly reason: string;
}> {}

export { handleIncomingPush } from './delivery';
