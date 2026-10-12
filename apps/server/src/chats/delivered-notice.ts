// The live delivered notice (T-1245): when a DM recipient's delivered mark
// moves forward, the server tells the author's online devices at once, so the
// sender's bubble turns into the grey double tick without a chat-list refresh.
//
// The stanza is a bodiless headline sent from the author's own bare JID to
// each of the author's connected resources (never the bare JID, so nothing is
// queued offline). `mod_block_strangers` drops stanzas from anyone outside the
// receiver's roster, but a message from the author's own JID is never a
// stranger (deploy/ejabberd/ejabberd.yml:293-298), which is why this path
// works where a component JID would not (docs/plan/delivered-tick.md).
//
// Push: this stanza is a message with no body. `mod_push`'s `notify/7`
// suppresses `{undefined, messages}` (the summary is `undefined` when there is
// no body text and `include_sender`/`include_body` are false — our config,
// ejabberd.yml:272-276), and the docs say `notify_on: messages` generates
// notifications "only for actual chat messages with a body text". So a bodiless
// headline never publishes a push; no hibernated-session workaround is needed.

import { Effect } from 'effect';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { ArchivePool } from '../search/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { putDeliveredMark } from './deliveries';

export const DELIVERED_NAMESPACE = 'urn:zilar:delivered:0';
const NO_STORE_NAMESPACE = 'urn:xmpp:hints';

/** The data one moved DM mark needs to notify the author's online devices. */
export interface DeliveredNotice {
  /** The author's bare JID: the DM chat id in the confirmer's terms. */
  authorBare: string;
  /** The confirmer's bare JID: the author's own chat id for this DM. */
  chatJid: string;
  /** The archive id the mark moved to, in the author's own-message terms. */
  until: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;');
}

/** The bodiless headline that carries one delivered mark to one resource. */
export function buildDeliveredHeadline(options: {
  from: string;
  to: string;
  chatJid: string;
  until: string;
}): string {
  const { from, to, chatJid, until } = options;
  return (
    `<message type='headline' from='${escapeAttribute(from)}' to='${escapeAttribute(to)}'>` +
    `<delivered xmlns='${DELIVERED_NAMESPACE}' chat='${escapeAttribute(chatJid)}'` +
    ` until='${escapeAttribute(until)}'/>` +
    `<no-store xmlns='${NO_STORE_NAMESPACE}'/>` +
    `</message>`
  );
}

// One resource's send, best effort: a failure is swallowed so the other
// resources still get the notice.
function sendToResource(
  adminClient: EjabberdAdminClient,
  notice: DeliveredNotice,
  resource: string,
): Effect.Effect<void> {
  const to = `${notice.authorBare}/${resource}`;
  return Effect.tryPromise({
    try: () =>
      adminClient.sendStanza(
        notice.authorBare,
        to,
        buildDeliveredHeadline({
          from: notice.authorBare,
          to,
          chatJid: notice.chatJid,
          until: notice.until,
        }),
      ),
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.void));
}

/**
 * Tells the author's online devices about one moved DM mark. Best effort: a
 * failure (ejabberd down, no client) is logged with ids only and never fails
 * the caller. The caller runs this with `Effect.runFork` after the HTTP
 * answer, so nothing waits on ejabberd.
 */
export function notifyDelivered(options: {
  adminClient: EjabberdAdminClient | undefined;
  logger: Logger;
  notice: DeliveredNotice;
}): Effect.Effect<void> {
  const { adminClient, logger, notice } = options;
  return Effect.gen(function* () {
    if (adminClient === undefined) return;
    const at = notice.authorBare.indexOf('@');
    if (at <= 0) return;
    const resources = yield* Effect.tryPromise({
      try: () => adminClient.userResources(notice.authorBare.slice(0, at)),
      catch: (error) => error,
    });
    yield* Effect.forEach(resources, (resource) => sendToResource(adminClient, notice, resource), {
      concurrency: 'unbounded',
      discard: true,
    });
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => {
        logger.warn({ chatJid: notice.chatJid, until: notice.until }, 'delivered notice failed');
      }),
    ),
  );
}

/** The `markDelivered` input the wrapper forwards to `putDeliveredMark`. */
export interface MarkDeliveredInput {
  bare: string;
  userId: string;
  originIds: readonly string[];
}

/**
 * The `markDelivered` handler body (T-1245): stores the delivery mark and, when
 * a DM mark actually moved, tells the author's online devices. Best effort and
 * off the HTTP path: the notice is forked, so the answer never waits on
 * ejabberd. Lives here so `api.ts` (at its 400-line bar) keeps one call.
 */
export async function markDeliveredAndNotify(
  deps: {
    db: ServerDatabase;
    config: ServerConfig;
    archive: ArchivePool | undefined;
    adminClient?: EjabberdAdminClient;
    logger: Logger;
  },
  input: MarkDeliveredInput,
): Promise<void> {
  const notice = await putDeliveredMark(deps.db, deps.config, deps.archive, input);
  if (notice !== undefined) {
    Effect.runFork(notifyDelivered({ adminClient: deps.adminClient, logger: deps.logger, notice }));
  }
}
