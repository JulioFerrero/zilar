// Side-effect import: `leader/start` reaches `push/component`, and cross-package
// consumers of this module need the ambient `@xmpp/component` declarations.
import '../push/xmpp-component.d.ts';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { createServer, type Server } from 'node:http';
import { type ActionAnnouncer, createActionGateway } from '../actions/gateway';
import { createProductionAnnouncer } from '../actions/production-announcer';
import {
  buildAlwaysEligible,
  buildRegistry,
  type ActionAdapter,
  type ArgsSchema,
} from '../actions/registry';
import { createAgentGateway } from '../agents/gateway';
import { createApp } from '../app';
import { createAuditRecorder } from '../audit/recorder';
import { createEjabberdAdminClient } from '../xmpp/admin/client';
import { createAuth } from '../auth/auth';
import { createKeyCipher } from '../connections/crypto';
import { sharedDraftHub } from '../drafts/hub';
import type { ZilarEdge } from '../effect/edge';
import { markLeader } from '../health';
import { cardCorrectorOf } from '../message-blocks/api';
import { type CorrectCardInput } from '../message-blocks/respond';
import {
  createLeaderLock,
  createPostgresLockConnection,
  LEADER_LOCK_KEY,
  LEADER_LOCK_SCOPE,
  LEADER_POLL_MS,
} from '../leader/lock';
import { createLeaderWork } from '../leader/start';
import { type RunnerHub } from '../machines/hub';
import { createDbMachineRegistry } from '../machines/registry';
import { loadPushConfigOrExit, type PushConfig } from '../push/config';
import { type PromptRunner } from '../routines/execute-prompt';
import { runTool } from '../sandbox/run-tool';
import { createArchivePool } from '../search/service';
import { buildToolAdapters } from '../tools/adapters';
import { type ToolRunner } from '../tools/types';
import { startEjabberdSchemaCheck } from '../xmpp/schema-check';
import { type BootedServer } from './boot';
import { CONNECTION_GRACE_MS, type RunningServer } from './lifecycle';
import { type Logger } from 'pino';
import { type ServerConfig } from '../config/load';
import { createCloudHands, requestReply } from '../hands/cloud-hands';
import { ErrorInfoSchema, type Hands } from '@zilar/desk';
import { type DeskClient } from '../agents/gateway/desk-exec';
import { webPriceAdapter } from '../web-tools/price-adapter';
import {
  createWebToolsState,
  type BuildWebToolsAdaptersDeps,
  MAX_SEARCH_QUERY_CHARS,
  withWebRateLimit,
  type WebToolsState,
  DEFAULT_FETCH_CHARS,
  failureResult,
  guardedOptions,
  hostOf,
  MAX_FETCH_CHARS,
  MAX_FETCH_URL_CHARS,
  DEFAULT_FEED_LIMIT,
  MAX_FEED_LIMIT,
} from '../web-tools/shared';
import { webWikipediaAdapter } from '../web-tools/wikipedia-adapter';
import { truncateChars } from '../text';
import {
  formatSearchResults,
  MAX_SEARCH_RESULTS,
  searchUnavailableText,
  type WebSearchResult,
} from '../web-tools/search';
import { guardedGet } from '../web-tools/guarded-fetch';
import { extractText } from '../web-tools/html';
import { parseFeed } from '../web-tools/feed';
import { type AgentGateway } from '../agents/gateway/contracts';
import { type BuildToolAdaptersDeps } from '../tools/adapter-support';

// A harmless demo adapter, alive only when `ACTION_DEMO_ENABLED=true`; off by default.
// Tier 2 exercises the approval path.

const DEMO_ECHO_ACTION = 'demo.echo';

const DEMO_ECHO_TEXT_MIN = 1;
const DEMO_ECHO_TEXT_MAX = 200;

// Must stay short and say "no side effects" so a model never mistakes it for a real adapter.
const DEMO_ECHO_DESCRIPTION = 'Repeats a short text back (demo, no side effects).';

const DemoEchoArgsSchema = Schema.Struct({
  text: Schema.Trim.check(
    Schema.isMinLength(DEMO_ECHO_TEXT_MIN),
    Schema.isMaxLength(DEMO_ECHO_TEXT_MAX),
  ),
});

type DemoEchoArgs = typeof DemoEchoArgsSchema.Type;

function describeDemoEcho(args: unknown): { summary: string } {
  const text = (args as DemoEchoArgs).text;
  return { summary: `Echo a message: "${text}"` };
}

// Does nothing — no I/O, no state change — and hands the trimmed text back as the summary.
// `allowAlways` opts into standing approval; it reports no cost, so the cost safety rule does not apply.
function buildDemoEchoAdapter(): ActionAdapter<unknown> {
  return {
    name: DEMO_ECHO_ACTION,
    description: DEMO_ECHO_DESCRIPTION,
    tier: 2,
    argsSchema: DemoEchoArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: describeDemoEcho as ActionAdapter<unknown>['describe'],
    allowAlways: true,
    execute: async (_ctx, args) => ({
      summary: `Echoed: ${(args as DemoEchoArgs).text}`,
    }),
  };
}

export function postAsAi(
  getGateway: () => Pick<AgentGateway, 'postToChat'> | null,
): BuildToolAdaptersDeps['post'] {
  return ({ aiId, groupId, topicId, text, payload }) => {
    const gateway = getGateway();
    if (gateway === null) {
      return Effect.runPromise(Effect.succeed(false));
    }
    return gateway.postToChat({
      aiId,
      groupId,
      ...(topicId === undefined ? {} : { topicId }),
      text,
      ...(payload === undefined ? {} : { payload }),
    });
  };
}

// Tier 1: the URL is a data-exfiltration channel, like `web.fetch`.
const webFeedArgsSchema = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_FETCH_URL_CHARS)),
  limit: Schema.optional(
    Schema.Number.pipe(
      Schema.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_FEED_LIMIT),
      ),
    ),
  ),
});

function formatFeedItems(
  items: { title: string; link: string; date: string; snippet: string }[],
): string {
  return items
    .map((item, index) => {
      const head = `${index + 1}. ${item.title.length > 0 ? item.title : '(no title)'}`;
      const link = item.link.length > 0 ? `\n   ${item.link}` : '';
      const date = item.date.length > 0 ? `\n   ${item.date}` : '';
      const snippet = item.snippet.length > 0 ? `\n   ${item.snippet}` : '';
      return `${head}${link}${date}${snippet}`;
    })
    .join('\n');
}

function webFeedAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.feed',
    description: 'Read the newest items of one public RSS or Atom feed.',
    tier: 1,
    argsExample: '{"url":"https://example.com/feed.xml","limit":5}',
    argsSchema: webFeedArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Read the feed at ${hostOf(parsed.url)}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { url: string; limit?: number };
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const feed = parseFeed(fetched.body.text);
      if (!feed.ok) {
        return { summary: feed.summary };
      }
      const items = feed.items.slice(0, parsed.limit ?? DEFAULT_FEED_LIMIT);
      return {
        summary: `feed ${host} (${items.length} item${items.length === 1 ? '' : 's'})`,
        modelText: formatFeedItems(items),
      };
    }),
  };
}

// Tier 1: the URL is a data-exfiltration channel, so the topic's allow rules and
// the kill switch apply.
const webFetchArgsSchema = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_FETCH_URL_CHARS)),
  maxChars: Schema.optional(
    Schema.Number.pipe(
      Schema.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_FETCH_CHARS),
      ),
    ),
  ),
});

function webFetchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.fetch',
    description: 'Fetch one public https page and read it as plain text.',
    tier: 1,
    argsExample: '{"url":"https://example.com"}',
    argsSchema: webFetchArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Fetch ${hostOf(parsed.url)}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { url: string; maxChars?: number };
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const maxChars = parsed.maxChars ?? DEFAULT_FETCH_CHARS;
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const text =
        fetched.body.contentType === 'text/html'
          ? extractText(fetched.body.text)
          : fetched.body.text.trim();
      if (text.length === 0) {
        return { summary: `fetched ${host} (empty page)` };
      }
      return {
        summary: `fetched ${host} (${Math.min(text.length, maxChars)} chars)`,
        modelText: truncateChars(text, maxChars),
      };
    }),
  };
}

// Tier 1: the query leaves the server, so the description warns against private
// text. Any failure or 0 results is "unavailable" with a hint at reliable tools.
const webSearchArgsSchema = Schema.Struct({
  query: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SEARCH_QUERY_CHARS)),
});

function webSearchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.search',
    description:
      'Best-effort web search (unreliable); never put private or sensitive text in the query.',
    tier: 1,
    argsExample: '{"query":"weather in Madrid"}',
    argsSchema: webSearchArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { query: string };
      return { summary: `Search the web for "${parsed.query}"` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { query: string };
      // One attempt: the provider returns `[]` on failure and the adapter answers
      // "unavailable".
      let results: WebSearchResult[];
      try {
        results = await state.searchProvider.search(parsed.query, { limit: MAX_SEARCH_RESULTS });
      } catch {
        results = [];
      }
      if (results.length === 0) {
        return { summary: 'search unavailable right now', modelText: searchUnavailableText() };
      }
      return {
        summary: `search results for "${truncateChars(parsed.query, 80)}" (${results.length})`,
        modelText: formatSearchResults(parsed.query, results),
      };
    }),
  };
}

// `searchProvider: 'none'` unregisters `web.search`; everything else always runs.
export function buildWebToolsAdapters(
  deps: BuildWebToolsAdaptersDeps = {},
): ActionAdapter<unknown>[] {
  const state = createWebToolsState(deps);
  const adapters: ActionAdapter<unknown>[] = [
    webFetchAdapter(state),
    webWikipediaAdapter(state),
    webPriceAdapter(state),
    webFeedAdapter(state),
  ];
  if (deps.searchProviderName !== 'none') {
    adapters.push(webSearchAdapter(state));
  }
  return adapters;
}

export type DeskProbe = () => Promise<DeskClient | null>;

interface DeskProbeOptions {
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

function buildHands(config: ServerConfig): Hands {
  return createCloudHands(config.DESK_AGENT_SOCKET);
}

/**
 * The cached read-only probe: returns a `DeskClient` only when the agent answers ready
 * with a pinned image; `null` covers a stopped or old agent.
 */
export function buildDeskProbe(config: ServerConfig, logger: Logger): DeskProbe {
  return createDeskProbe({
    socketPath: config.DESK_AGENT_SOCKET,
    hands: buildHands(config),
    ...(config.DESK_IMAGE === undefined ? {} : { overrideImage: config.DESK_IMAGE }),
    logger,
  });
}

export function startComponents(boot: BootedServer, running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { config, logger, db, currentMailer } = boot;

    const adminClient = createEjabberdAdminClient(config.xmpp);
    const auth = createAuth({ db, config, mailer: currentMailer, adminClient, logger });

    // One registry shared with the machines routes and the hub, so approve/revoke notifies
    // reach the hub's listener set.
    const machineRegistry = createDbMachineRegistry(db);

    // The leader starts the hub later; this closure reads the holder each request.
    let runnerHub: RunnerHub | null = null;
    const isMachineOnline = (machineId: string): boolean => {
      return runnerHub?.isOnline(machineId) ?? false;
    };

    // One recorder wraps `recordAudit`, so a database write error never propagates into the
    // caller and every auditing route shares it.
    const auditRecorder = createAuditRecorder({ db, logger });

    // The action gateway is built before the agent gateway, so the announcer closes over a
    // `null` holder and resolves at runtime. With the gateway disabled it does nothing.
    const announcer: ActionAnnouncer = createProductionAnnouncer({
      db,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
      logger,
      getGateway: () => running.gateway,
    });

    // Posts as the AI through the agent gateway; `false` while it does not exist yet.
    const post: BuildToolAdaptersDeps['post'] = postAsAi(() => running.gateway);

    const runPrompt: PromptRunner = (input) => {
      const gateway = running.gateway;
      if (gateway === null) {
        return Promise.resolve('offline');
      }
      return gateway.runScheduledTurn(input);
    };

    const correctCard = (input: CorrectCardInput): Promise<boolean> =>
      cardCorrectorOf(running.gateway)?.correctInRoom(input) ?? Promise.resolve(false);

    // Production wires an empty adapter registry, so every action is denied
    // `unknown_action` until a real adapter is registered. The demo adapter exists only
    // with ACTION_DEMO_ENABLED=true to prove the flow end-to-end. When TOOLS_ENABLED=true
    // the real sandbox runner and the tool/routine adapters are added; when false, manual
    // runs answer 501 `runner_unavailable`. AI-written tool code runs in that sandbox.
    const toolRunner: ToolRunner | undefined = config.TOOLS_ENABLED
      ? (params) =>
          runTool({ source: params.source, input: params.input, allowedHosts: params.allowedHosts })
      : undefined;
    // With WEB_TOOLS_ENABLED=true the gateway-level web tools are registered next to the
    // tool adapters. They are separate from the sandbox: AI-written tools still fetch only
    // their approved hosts through `host-fetch`.
    const webToolsAdapters =
      config.WEB_TOOLS_ENABLED === true
        ? buildWebToolsAdapters({ searchProviderName: config.WEB_SEARCH_PROVIDER, logger })
        : [];
    const actionAdapters = [
      ...(config.ACTION_DEMO_ENABLED ? [buildDemoEchoAdapter()] : []),
      ...webToolsAdapters,
      ...(toolRunner === undefined
        ? []
        : buildToolAdapters({
            db,
            runner: toolRunner,
            routinesEnabled: config.ROUTINES_ENABLED,
            audit: auditRecorder,
            post,
          })),
    ];
    const actionRegistry = buildRegistry(actionAdapters);
    const alwaysEligible = buildAlwaysEligible(actionRegistry);
    const actionGateway = createActionGateway({
      db,
      adapters: actionRegistry,
      audit: auditRecorder,
      logger,
      announce: announcer,
    });

    const archivePool =
      config.XMPP_ARCHIVE_DATABASE_URL === undefined
        ? undefined
        : startEjabberdSchemaCheck(createArchivePool(config.XMPP_ARCHIVE_DATABASE_URL), logger);
    // Push env stays separate from the server config so push is optional. An invalid host
    // refuses to boot (fixed message, no value echoed).
    const push: PushConfig = yield* Effect.sync(() => loadPushConfigOrExit(process.env));

    // The cached desk probe, built once: whether the desk agent is ready decides if Zilar
    // cloud desks are offered.
    const deskProbe = buildDeskProbe(config, logger);

    const app = createApp({
      db,
      logger,
      config,
      auth,
      adminClient,
      ais: { cloud: async () => (await deskProbe()) !== null },
      mailer: currentMailer,
      machineRegistry,
      // A separate small pool on the ejabberd archive with a 3 s statement timeout; push
      // shares it to resolve who/where.
      ...(archivePool === undefined ? {} : { archive: archivePool }),
      push,
      ...(config.RUNNER_HUB_ENABLED ? { isMachineOnline } : {}),
      actionGateway,
      alwaysEligible,
      getGateway: () => running.gateway,
      // The same sandbox runner the adapters use; absent means manual runs answer 501.
      ...(toolRunner === undefined ? {} : { toolRunner }),
    });

    // Leader-only work starts through `createLeaderWork` once the advisory lock is held.
    // The agent gateway is off unless AGENT_GATEWAY_ENABLED=true and inert without the key
    // cipher; it connects each active AI to XMPP so owner DMs get replies.
    const gatewayCipher =
      config.ZILAR_KEY_ENCRYPTION_KEY === undefined
        ? undefined
        : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY);
    // The listener is a platform-paid feature and there is no platform key, so it is always
    // off; the flag stays so turning it on names the reason.
    if (config.LISTENER_ENABLED) {
      logger.warn(
        'listener is off until AIs can pay for their own model calls; ignoring LISTENER_ENABLED',
      );
    }
    const gateway = createAgentGateway(
      {
        db,
        xmpp: config.xmpp,
        adminClient,
        ...(gatewayCipher === undefined ? {} : { cipher: gatewayCipher }),
        ...(archivePool === undefined ? {} : { archive: archivePool }),
        logger,
        // The gateway publishes drafts here; `/api/drafts/stream` streams them out.
        drafts: { hub: sharedDraftHub },
        actions: actionGateway,
        // The tool guide rides the system prompt only when tools are enabled; the loop runs
        // `AGENT_TOOL_MAX_ROUNDS` rounds (1 with tools off).
        toolsEnabled: config.TOOLS_ENABLED,
        toolMaxRounds: config.AGENT_TOOL_MAX_ROUNDS,
        desk: deskProbe,
        runnerDesk: () => runnerHub,
        cardMediaDir: boot.cardMediaDir,
      },
      { enabled: config.AGENT_GATEWAY_ENABLED },
    );
    running.gateway = gateway;

    // The Effect edge on its own server; `remoteAddress` comes from the real socket.
    const { port: boundPort, close: closeNodeServer } = yield* Effect.promise(() =>
      serveEdgeOnNode(app, {
        port: config.PORT,
        connectionGraceMs: CONNECTION_GRACE_MS,
      }),
    );
    running.closeHttp = closeNodeServer;
    logger.info({ port: boundPort }, 'zilar-server listening');

    // Everything from here on is leader-only: overlapping instances must not both run it.
    // `createLeaderWork` starts it on winning the lock and stops it on step down.
    const leaderWork = createLeaderWork({
      db,
      config,
      logger,
      adminClient,
      archivePool,
      push,
      machineRegistry,
      gateway,
      actionGateway,
      audit: auditRecorder,
      toolRunner,
      post,
      runPrompt,
      correctCard,
      onRunnerHub: (hub) => {
        runnerHub = hub as RunnerHub | null;
      },
    });

    // If this dedicated lock connection drops while leader, the lock is gone: the lock logs
    // and exits so a restart comes back as a follower.
    const leader = createLeaderLock({
      connection: createPostgresLockConnection({
        url: config.DATABASE_URL,
        scope: LEADER_LOCK_SCOPE,
        key: LEADER_LOCK_KEY,
      }),
      logger,
      pollMs: LEADER_POLL_MS,
      onAcquire: async () => {
        markLeader(true);
        await leaderWork.start();
      },
      onStepDown: async () => {
        await leaderWork.stop();
        markLeader(false);
      },
    });
    running.leader = leader;
    running.drainMs = config.SHUTDOWN_DRAIN_MS;
    leader.start();
  });
}

// Serves a `ZilarEdge`'s `layer` on its own `node:http` server, so `index.ts`
// and tests share one start/stop path. `NodeHttpServer` fills `remoteAddress`
// from the real socket.
export interface ServeEdgeOnNodeOptions {
  readonly port: number;
  /** How long `close()` waits before dropping live connections (SSE never ends). */
  readonly connectionGraceMs?: number;
}

export interface ServedEdgeOnNode {
  readonly httpServer: Server;
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_CONNECTION_GRACE_MS = 3_000;

export async function serveEdgeOnNode(
  edge: Pick<ZilarEdge, 'layer'>,
  options: ServeEdgeOnNodeOptions,
): Promise<ServedEdgeOnNode> {
  const httpServer = createServer();
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(edge.layer, { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => httpServer, { port: options.port })),
    ),
  );
  const port = await runtime.runPromise(
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const address = server.address;
      if (address._tag === 'UnixPathAddress') {
        throw new Error('expected the edge server to listen on a TCP port');
      }
      return address.port;
    }),
  );
  const connectionGraceMs = options.connectionGraceMs ?? DEFAULT_CONNECTION_GRACE_MS;
  return {
    httpServer,
    port,
    close: async () => {
      // `close()` waits for every open connection: drop idle ones at once, live
      // ones after the grace, then release the runtime.
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections();
        setTimeout(() => httpServer.closeAllConnections(), connectionGraceMs).unref();
      });
      await runtime.dispose();
    },
  };
}
