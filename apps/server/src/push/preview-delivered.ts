// The push preview proves the message reached the device, so the handler
// forks the delivered mark off the HTTP path. The chat id is the same `bare`
// PUT /chats/:jid/delivered stores: the DM author's bare JID or the room JID.

import { Effect } from 'effect';
import type { Logger } from 'pino';
import { markDeliveredAndNotify } from '../chats/delivered-notice';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { errorClassName } from '../effect/error-utils';
import type { ArchivePool } from '../search/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

/** The push deps one forked mark needs; a subset of `PushApiDependencies`. */
export interface PreviewDeliveredDeps {
  db: ServerDatabase;
  config: ServerConfig;
  archive?: ArchivePool;
  adminClient?: EjabberdAdminClient;
  logger: Logger;
}

/** Stores the caller's delivered mark off the HTTP path with
 * `Effect.runFork`, so the preview never waits; every failure is swallowed
 * with a warn of ids only. The message id is the archive origin id. */
export function forkPreviewDelivered(
  deps: PreviewDeliveredDeps,
  input: { chatJid: string; userId: string; messageId: string },
): void {
  Effect.runFork(
    Effect.tryPromise({
      try: () =>
        markDeliveredAndNotify(
          {
            db: deps.db,
            config: deps.config,
            archive: deps.archive,
            logger: deps.logger,
            ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
          },
          { bare: input.chatJid, userId: input.userId, originIds: [input.messageId] },
        ),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          deps.logger.warn(
            { userId: input.userId, chatJid: input.chatJid, err: errorClassName(error) },
            'push preview delivered mark failed',
          );
        }),
      ),
    ),
  );
}
