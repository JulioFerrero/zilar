import {
  type EffectApiMount,
  handler,
  mountApi,
  sessionLayer,
  schemaErrorLayer,
  type EffectApiRoute,
  Session,
} from '../effect/http-core';
import { type TurnWatcher } from '../agents/gateway/stop-types';
import { createAgentTasksApi } from '../agents/log/api';
import { createAiMemoryApi } from '../agents/memory/api';
import { createAuthApi } from '../auth/api';
import { createChatFoldersApi } from '../chat-folders/api';
import { createChatPrefsApi } from '../chat-prefs/api';
import { createChatsApi } from '../chats/api';
import { createContactRequestsApi } from '../contact-requests/api';
import { createFilesApi } from '../files/api';
import { createGroupsApi } from '../groups/api';
import { createHandlesApi } from '../handles/api';
import { createInviteLinksApi } from '../invite-links/api';
import { createMachinesApi } from '../machines/api';
import { createDbMachineRegistry } from '../machines/registry';
import { createMediaApi } from '../media/api';
import { cardCorrectorOf, createMessageBlocksApi, type CardCorrector } from '../message-blocks/api';
import { createPushApi } from '../push/api';
import { loadPushConfig } from '../push/config';
import { createSearchApi } from '../search/api';
import { createSetupApi } from '../setup/api';
import { createTopicsApi } from '../topics/api';
import { turnWatcherOf } from '../topics/ai-activity';
import { type RouteWiring } from './deps';
import { opt } from './opt';
import { Layer, Duration, Effect, Queue, Schema, Stream } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  ContactsGroup,
  ContactsWriteRateLimit,
  DirectoryGroup,
  DirectoryRateLimit,
  PinsGroup,
  PinsWriteRateLimit,
  BlocksGroup,
  BlocksReadRateLimit,
  BlocksWriteRateLimit,
  RolesGroup,
} from '@zilar/api-contract';
import { type Logger, pino } from 'pino';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder';
import { type ServerConfig } from '../config/load';
import { type EjabberdAdminClient } from '../xmpp/admin/types';
import { type Auth } from '../auth/auth';
import { type ServerDatabase } from '../db/client';
import { limiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { listContacts, removeContact, type RemoveContactDeps } from '../contacts/service';
import { publicGroupForHandle, searchDirectory, type GroupKind } from '../directory/service';
import { HttpServer, HttpRouter, HttpServerResponse } from 'effect/http';
import { listPins, pinMessage, unpinMessage, type PinsServiceDeps } from '../pins/service';
import { blockUser, listBlockedUsers, unblockUser, type BlocksDeps } from '../blocks/service';
import {
  createRole,
  deleteRole,
  listRoles,
  renameRole,
  setRoleMembers,
  type RolesServiceDeps,
} from '../roles/service';
import { type DraftHubEvent } from '../drafts/events';
import { sharedDraftHub, type DraftHub } from '../drafts/hub';
// A comment line this often keeps the connection (and any proxy buffer) alive between
// turns; event parsers ignore it.
const DRAFT_SSE_HEARTBEAT_MS = 25_000;

// The stream ends after this long: the session is only checked when the request opens,
// so a revoked session would otherwise keep receiving drafts. Both clients reconnect,
// which re-runs the session check.
const DRAFT_STREAM_MAX_MS = 10 * 60_000;

interface DraftsApiDependencies {
  auth: Auth;
  hub?: DraftHub;
  logger?: Logger;
}

const DraftStreamSuccess = Schema.String;

const DraftsGroup = HttpApiGroup.make('drafts')
  .add(HttpApiEndpoint.get('stream', '/drafts/stream', { success: DraftStreamSuccess }))
  .middleware(Session)
  .prefix('/api');

const DraftsApi = HttpApi.make('drafts').add(DraftsGroup);

function encodeSseEvent(event: DraftHubEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function encodeHeartbeat(): string {
  return ': heartbeat\n\n';
}

function createDraftsApi(deps: DraftsApiDependencies): EffectApiMount {
  const logger = deps.logger ?? defaultLogger();
  const hub = deps.hub ?? sharedDraftHub;

  const groupLayer = HttpApiBuilder.group(DraftsApi, 'drafts', (handlers) =>
    handlers.handle(
      'stream',
      handler(logger, (_request, user) =>
        Effect.sync(() => {
          const frames = Stream.unwrap(
            Effect.acquireRelease(
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<DraftHubEvent>();
                const unsubscribe = hub.subscribe(user.id, (event) => {
                  Queue.offerUnsafe(queue, event);
                });
                return { queue, unsubscribe };
              }),
              ({ unsubscribe }) => Effect.sync(unsubscribe),
            ).pipe(
              Effect.map(({ queue }) =>
                Stream.fromEffectRepeat(
                  // The timeout reads full with `Duration`, so vitest's fake timers keep
                  // controlling the heartbeat test.
                  Queue.take(queue).pipe(
                    Effect.timeoutOption(Duration.millis(DRAFT_SSE_HEARTBEAT_MS)),
                    Effect.map((event) =>
                      event._tag === 'Some' ? encodeSseEvent(event.value) : encodeHeartbeat(),
                    ),
                  ),
                ),
              ),
            ),
          );
          return HttpServerResponse.stream(
            frames.pipe(
              // End the response after the cap; the client reconnects and re-auths.
              Stream.interruptWhen(Effect.sleep(Duration.millis(DRAFT_STREAM_MAX_MS))),
              Stream.encodeText,
            ),
            {
              headers: {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
                'transfer-encoding': 'chunked',
                'x-accel-buffering': 'no',
              },
            },
          );
        }),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(DraftsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(DraftsApi, apiLayer);
}

let silentLogger: Logger | undefined;

function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

const RolesApi = HttpApi.make('roles').add(RolesGroup);

interface RolesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
}

function createRolesApi(deps: RolesApiDependencies): EffectApiMount {
  const logger = deps.logger;

  function serviceDeps(): RolesServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
      logger: deps.logger,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(RolesApi, 'roles', (handlers) =>
    handlers
      // The group's roles with their holders; any member may read.
      .handle(
        'list',
        handler(logger, async (request, user) => ({
          roles: await listRoles(deps.db, request.params.id, user.id),
        })),
      )
      // Creates a role (owner/admin only); capped at `MAX_ROLES_PER_GROUP`.
      .handle(
        'create',
        handler(logger, (request, user) =>
          createRole(serviceDeps(), request.params.id, user.id, request.payload.name),
        ),
      )
      .handle(
        'rename',
        handler(logger, (request, user) =>
          renameRole(
            serviceDeps(),
            request.params.id,
            request.params.roleId,
            user.id,
            request.payload.name,
          ),
        ),
      )
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          await deleteRole(serviceDeps(), request.params.id, request.params.roleId, user.id);
        }),
      )
      // Replaces a role's member set (owner/admin only), last write wins.
      .handle(
        'setMembers',
        handler(logger, (request, user) =>
          setRoleMembers(
            serviceDeps(),
            request.params.id,
            request.params.roleId,
            user.id,
            request.payload.userIds,
          ),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(RolesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(RolesApi, apiLayer);
}

interface BlocksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  config?: ServerConfig;
  adminClient?: EjabberdAdminClient;
  now?: () => number;
  writeLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
}

interface BlocksApiDependencies extends BlocksRoutesDependencies {
  logger: Logger;
}

// The write budget runs before the service.
const RATE_LIMIT_MESSAGE = 'Too many attempts, try again later';

const BlocksApi = HttpApi.make('blocks').add(BlocksGroup);

function blocksServiceFor(deps: BlocksRoutesDependencies): BlocksDeps {
  return {
    db: deps.db,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
    ...(deps.config === undefined ? {} : { domain: deps.config.xmpp.domain }),
  };
}

function createBlocksApi(deps: BlocksApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = deps.writeLimiter ?? limiter('blockWrite', now);
  const readLimiter = deps.readLimiter ?? limiter('blockRead', now);
  const service = blocksServiceFor(deps);

  // Roster cleanup after a block warns, never fails; the warn needs the request logger.
  const serviceWithLogger = { ...service, logger };

  const groupLayer = HttpApiBuilder.group(BlocksApi, 'blocks', (handlers) =>
    handlers
      .handle(
        'block',
        handler(logger, (request, user) =>
          blockUser(serviceWithLogger, user.id, request.params.userId),
        ),
      )
      .handle(
        'unblock',
        handler(logger, (request, user) => unblockUser(service, user.id, request.params.userId)),
      )
      .handle(
        'list',
        handler(logger, (_request, user) => listBlockedUsers(service, user.id)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(BlocksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(rateLimitLayer(BlocksWriteRateLimit, writeLimiter, RATE_LIMIT_MESSAGE)),
    Layer.provide(rateLimitLayer(BlocksReadRateLimit, readLimiter, RATE_LIMIT_MESSAGE)),
  );

  return mountApi(BlocksApi, apiLayer);
}

const PinsApi = HttpApi.make('pins').add(PinsGroup);

interface PinsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  audit?: AuditRecorder;
  logger: Logger;
  now?: () => number;
  writeLimiter?: RateLimiter;
}

const PINS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/pins' },
  { method: 'POST', path: '/api/pins' },
  { method: 'DELETE', path: '/api/pins/:id' },
];

function createPinsApi(deps: PinsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const writeLimiter = deps.writeLimiter ?? limiter('pinsWrite', deps.now ?? Date.now);

  function serviceDeps(): PinsServiceDeps {
    return {
      db: deps.db,
      domain: deps.config.xmpp.domain,
      mucDomain: deps.config.xmpp.mucDomain,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(PinsApi, 'pins', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, async (request, user) => ({
          pins: await listPins(serviceDeps(), request.query.chat, user.id),
        })),
      )
      // The write budget was already charged, before the payload decode.
      .handle(
        'create',
        handler(logger, (request, user) =>
          pinMessage(serviceDeps(), { ...request.payload, actorId: user.id }),
        ),
      )
      // The write budget was already charged.
      .handle(
        'remove',
        handler(logger, (request, user) => unpinMessage(serviceDeps(), request.params.id, user.id)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(PinsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    // The write budget runs before the payload is decoded: an invalid body still spends
    // budget.
    Layer.provide(
      rateLimitLayer(PinsWriteRateLimit, writeLimiter, 'Too many pins, try again later'),
    ),
  );

  const { handler: effectHandler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler: effectHandler, routes: PINS_API_ROUTES };
}

interface DirectoryApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  now?: () => number;
  limiter?: RateLimiter;
  logger: Logger;
}

function toEntry(row: {
  id: string;
  kind: GroupKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    handle: row.handle,
    description: row.description,
    memberCount: row.memberCount,
    joined: row.joined,
    ...(row.avatarUrl === undefined ? {} : { avatarUrl: row.avatarUrl }),
  };
}

const DirectoryApi = HttpApi.make('directory').add(DirectoryGroup);

function createDirectoryApi(deps: DirectoryApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const directoryLimiter = deps.limiter ?? limiter('directory', now);

  const groupLayer = HttpApiBuilder.group(DirectoryApi, 'directory', (handlers) =>
    handlers
      // `q` matches handle or title prefix; optional `kind`; 20 per page with a cursor.
      .handle(
        'search',
        handler(logger, async (request, user) => {
          const page = await searchDirectory(deps.db, user.id, {
            query: request.query.q,
            kind: request.query.kind,
            cursor: request.query.cursor,
          });
          return { entries: page.entries.map(toEntry), next: page.next };
        }),
      )
      .handle(
        'byHandle',
        handler(logger, async (request, user) =>
          toEntry(await publicGroupForHandle(deps.db, user.id, request.params.handle)),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(DirectoryApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    // The read budget runs before the query is decoded: an invalid query still spends
    // budget.
    Layer.provide(
      rateLimitLayer(DirectoryRateLimit, directoryLimiter, 'Too many attempts, try again later'),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(DirectoryApi, apiLayer);
}

// The same write budget as the blocks API: removing a contact deletes the pair and
// touches ejabberd.
interface ContactsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  audit?: AuditRecorder;
  adminClient?: EjabberdAdminClient;
  now?: () => number;
  writeLimiter?: RateLimiter;
}

const ContactsApi = HttpApi.make('contacts').add(ContactsGroup);

function serviceFor(deps: ContactsApiDependencies): RemoveContactDeps {
  return {
    db: deps.db,
    domain: deps.config.xmpp.domain,
    audit: deps.audit ?? createAuditRecorder({ db: deps.db, logger: deps.logger }),
    ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
  };
}

function createContactsApi(deps: ContactsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const config = deps.config;
  const writeLimiter = deps.writeLimiter ?? limiter('contactsWrite', deps.now ?? Date.now);
  const service = serviceFor(deps);

  // Roster cleanup after a removal warns, never fails; the warn needs the request logger.
  const serviceWithLogger = { ...service, logger };

  const groupLayer = HttpApiBuilder.group(ContactsApi, 'contacts', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listContacts(deps.db, user.id, config.xmpp.domain)),
      )
      // The write budget runs first; a target that is not a contact answers 404.
      .handle(
        'remove',
        handler(logger, (request, user) =>
          removeContact(serviceWithLogger, user.id, request.params.userId),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ContactsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(rateLimitLayer(ContactsWriteRateLimit, writeLimiter, RATE_LIMIT_MESSAGE)),
  );

  return mountApi(ContactsApi, apiLayer);
}

export function messagingRoutes({
  deps,
  base,
  audit,
  mailer,
  inviteLinksOverrides,
}: RouteWiring): EffectApiMount[] {
  const { db } = base;
  const { adminClient } = deps;
  const mounts: EffectApiMount[] = [];
  const authApi = createAuthApi({ ...base, adminClient });
  mounts.push(authApi);
  // Public while no user exists, the same 404 as an unknown route once setup is done.
  const setupApi = createSetupApi({ ...base, mailer, audit, ...deps.setup });
  mounts.push(setupApi);
  const contactsApi = createContactsApi({ ...base, adminClient });
  mounts.push(contactsApi);
  const handlesApi = createHandlesApi({ ...base, audit });
  mounts.push(handlesApi);
  const contactRequestsApi = createContactRequestsApi({ ...base, adminClient, audit });
  mounts.push(contactRequestsApi);
  const blocksApi = createBlocksApi({ ...base, adminClient, audit });
  mounts.push(blocksApi);
  // Public rows only, session-required and rate limited.
  const directoryApi = createDirectoryApi({ ...base });
  mounts.push(directoryApi);
  const machinesApi = createMachinesApi({
    ...base,
    audit,
    registry: deps.machineRegistry ?? createDbMachineRegistry(db),
    ...opt('isMachineOnline', deps.isMachineOnline),
  });
  mounts.push(machinesApi);
  const groupsApi = createGroupsApi({ ...base, adminClient, audit });
  mounts.push(groupsApi);
  const inviteLinksApi = createInviteLinksApi({
    ...base,
    adminClient,
    audit,
    ...inviteLinksOverrides,
  });
  mounts.push(inviteLinksApi);
  const rolesApi = createRolesApi({ ...base, adminClient, audit });
  mounts.push(rolesApi);
  const aiMemoryApi = createAiMemoryApi({ ...base });
  mounts.push(aiMemoryApi);
  const agentTasksApi = createAgentTasksApi({ ...base });
  mounts.push(agentTasksApi);
  const pinsApi = createPinsApi({ ...base, audit });
  mounts.push(pinsApi);
  // Hand the gateway's `TurnWatcher` read model to the topic-list routes.
  const gateway = deps.getGateway;
  const getTurnWatcher =
    gateway === undefined ? undefined : (): TurnWatcher | null => turnWatcherOf(gateway());
  const topicsApi = createTopicsApi({
    ...base,
    adminClient,
    audit,
    // Reads the MUC archive for non-members; without a pool the route answers 501.
    ...opt('archive', deps.archive),
    ...opt('getGateway', getTurnWatcher),
  });
  mounts.push(topicsApi);
  const getCardCorrector =
    gateway === undefined ? undefined : (): CardCorrector | null => cardCorrectorOf(gateway());
  const messageBlocksApi = createMessageBlocksApi({
    ...base,
    audit,
    ...opt('getGateway', getCardCorrector),
  });
  mounts.push(messageBlocksApi);
  const chatsApi = createChatsApi({
    ...base,
    adminClient,
    archive: deps.archive,
    ...opt('getGateway', getTurnWatcher),
  });
  mounts.push(chatsApi);
  const chatPrefsApi = createChatPrefsApi({ ...base });
  mounts.push(chatPrefsApi);
  const chatFoldersApi = createChatFoldersApi({ ...base });
  mounts.push(chatFoldersApi);
  // Mounted always: with push off or unconfigured every route answers 404/503.
  const pushApi = createPushApi({
    ...base,
    adminClient,
    push: deps.push ?? loadPushConfig({}),
    ...opt('archive', deps.archive),
  });
  mounts.push(pushApi);
  // Without an archive pool every search answers 501, so the web can hide the feature.
  const searchApi = createSearchApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(searchApi);
  // Without an archive pool every request answers 501.
  const mediaApi = createMediaApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(mediaApi);
  const filesApi = createFilesApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(filesApi);
  const draftsApi = createDraftsApi({ ...base });
  mounts.push(draftsApi);

  return mounts;
}
