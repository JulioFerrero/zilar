// The dependency shapes `createApp` and the area route modules share
// (T-1460): `AppDependencies` moved here from `app.ts` and is re-exported
// there, so its surface is unchanged. The route mounting itself lives in the
// `routes-*.ts` siblings.
import type { Logger } from 'pino';
import type { ActionGateway } from '../actions/gateway';
import type { TurnStopper } from '../agents/gateway/stop-types';
import type { AiLogger } from '../ais/service';
import type { AlwaysEligiblePredicate } from '../approvals/service';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { CurrentMailer } from '../auth/mailer';
import type { ServerConfig } from '../config';
import type { ConnectionsLogger } from '../connections/api';
import type { KeyCipher } from '../connections/crypto';
import type { ProviderProbe } from '../connections/probe';
import type { ServerDatabase } from '../db/client';
import type { TestInviteLinksOverrides } from '../invite-links/api';
import type { DbMachineRegistry } from '../machines/registry';
import type { PushConfig } from '../push/config';
import type { SearchRoutesDependencies } from '../search/api';
import type { SetupApiDependencies } from '../setup/api';
import type { ToolRunner } from '../tools/types';
import type { VoiceEngine } from '../voice/engine';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export interface AppDependencies {
  db: ServerDatabase;
  logger: Logger;
  config: ServerConfig;
  auth: Auth;
  adminClient: EjabberdAdminClient;
  /** T-0161: the live mailer (swapped by the setup screen, no restart). */
  mailer?: CurrentMailer;
  /** T-0161: overrides the setup routes (tests inject a fake sender). */
  setup?:
    | Partial<
        Pick<SetupApiDependencies, 'limiter' | 'getClientIp' | 'trustedProxyHops' | 'sendTestCode'>
      >
    | undefined;
  /** Overrides the ffmpeg engine; tests inject a fake. */
  voice?: VoiceEngine;
  /** Overrides the upload size cap; tests use a small one. */
  voiceMaxBytes?: number;
  /** Overrides the connections routes; tests inject a fake probe and key. */
  connections?: {
    cipher?: KeyCipher;
    probe?: ProviderProbe;
    logger?: ConnectionsLogger;
  };
  /** Overrides the AI routes; tests inject a fake cipher. */
  ais?: {
    cipher?: KeyCipher;
    logger?: AiLogger;
    /** T-1425/T-1603: asks the desk probe whether Zilar cloud desks are ready.
     * Defaults to false. */
    cloud?: () => Promise<boolean>;
  };
  /** T-1422: the live agent gateway's turn-stop hook. Read lazily because the
   * app is built before the gateway; absent = the route answers `stopped: false`.
   * T-1514: the same live gateway also carries the `TurnWatcher` read model the
   * topic list reads; `routes-messaging.ts` narrows it there. */
  getGateway?: () => TurnStopper | null;
  /** Injected by index.ts when the runner hub is on; absent = hub off. */
  isMachineOnline?: (machineId: string) => boolean;
  /**
   * Shared with the runner hub so route-level notifies (approve / revoke)
   * reach the same listener set. Defaults to a fresh registry over `db`,
   * which is fine when no hub is running.
   */
  machineRegistry?: DbMachineRegistry;
  /**
   * Audit recorder shared with the approvals and machines routes. Tests may
   * pass a recorder backed by the same database to observe what the routes
   * write; production wires the recorder built above.
   */
  audit?: AuditRecorder;
  /**
   * Action gateway (T-0090): wires `onDecided` into the approvals route so
   * a successful decision executes the matching pending action. Production
   * passes the gateway built in `index.ts` with an empty adapter
   * registry; tests pass their own to inject fake adapters.
   */
  actionGateway?: ActionGateway;
  /**
   * T-0099: predicate the approvals route uses to decide whether an
   * `approve_always` decision is a real choice. Built from the
   * adapter registry by `buildAlwaysEligible` in `actions/registry.ts`.
   * Absent = nothing is always-eligible.
   */
  alwaysEligible?: AlwaysEligiblePredicate;
  /**
   * T-0103: tool runner port the tools routes use for manual runs. Absent
   * = no runner (every run answers 501 `runner_unavailable`); T-0105
   * wires the real sandbox.
   */
  toolRunner?: ToolRunner;
  /**
   * T-0117: read-only pool on the ejabberd MAM archive. Absent = search is
   * unconfigured (every search answers 501 `search_unavailable`).
   */
  archive?: SearchRoutesDependencies['archive'];
  /** T-0117: injected in tests so the search rate window can advance. */
  searchNow?: () => number;
  /** T-0120: sticker storage dir override; defaults to the parsed config. */
  stickerStorageDir?: string;
  /** T-0165: avatar storage dir override; defaults to the parsed config. */
  avatarStorageDir?: string;
  /** T-0165: injected in tests so the avatar upload rate window can advance. */
  avatarNow?: () => number;
  /** T-0165: overrides the avatar upload limiter (tests inject a window). */
  avatarUploadLimiter?: { allow: (key: string) => boolean };
  /** T-0460: background storage dir override; defaults to the parsed config. */
  backgroundStorageDir?: string;
  /** T-0460: injected in tests so the background upload rate window can advance. */
  backgroundNow?: () => number;
  /** T-0460: overrides the background upload limiter (tests inject a window). */
  backgroundUploadLimiter?: { allow: (key: string) => boolean };
  /** T-1853: card media storage dir override; defaults to the parsed config. */
  cardMediaStorageDir?: string;
  /** T-0120: injected in tests so the upload rate window can advance. */
  stickerNow?: () => number;
  /** T-0120: overrides the sticker upload limiter (cap tests inject a pass). */
  uploadLimiter?: { allow: (key: string) => boolean };
  /** T-0123: overrides the Telegram import client (tests inject a fake). */
  telegramClient?: import('../stickers/telegram-import').TelegramClient;
  /** T-0123: overrides the Telegram import limiter (tests inject a window). */
  telegramImportNow?: () => number;
  /** T-0170: overrides the voice transcription routes (tests inject fakes). */
  voiceTranscription?:
    | Partial<
        Pick<
          import('../voice-transcription/routes').VoiceTranscriptionRoutesDependencies,
          'transcriptLimiter' | 'settingsLimiter' | 'now' | 'audioFetcher' | 'transcribe'
        >
      >
    | undefined;
  /** T-0162: overrides the integrations routes (tests inject fake senders). */
  integrations?:
    | Partial<
        Pick<
          import('../integrations/routes').IntegrationsRoutesDependencies,
          | 'createTelegram'
          | 'telegramLimiter'
          | 'emailLimiter'
          | 'now'
          | 'sendTestMail'
          | 'swapMailer'
        >
      >
    | undefined;
  /**
   * T-0119: push env (kept separate from the server config so push stays
   * optional). Absent = push off (every push route answers 404).
   */
  push?: PushConfig;
  /** T-0122: overrides the GIF provider port; tests inject the fake. */
  gifProvider?: import('../gifs/provider').GifProvider;
  /** T-0122: overrides the GIF media fetch; tests inject a fake. */
  gifMediaFetcher?: import('../gifs/routes').GifsRoutesDependencies['mediaFetcher'];
  /** T-0122: injected in tests so token expiry and the rate window advance. */
  gifNow?: () => number;
}

/** The four dependencies every route module repeats, shared as one object. */
export type BaseDeps = Pick<AppDependencies, 'db' | 'config' | 'logger' | 'auth'>;

/** The state an area route module needs, built once by `createApp`. */
export interface RouteWiring {
  /** The full dependencies `createApp` was called with (overrides included). */
  readonly deps: AppDependencies;
  /** `db`, `config`, `logger` and `auth`, spread into each `create*Api`. */
  readonly base: BaseDeps;
  /** The audit recorder built (or injected) once for the app. */
  readonly audit: AuditRecorder;
  /** The live mailer shared by the setup and integrations routes. */
  readonly mailer: CurrentMailer;
  /** The action gateway the approvals route reports its decisions to. */
  readonly gateway: ActionGateway;
  /** T-0115 test seam: the join rate windows for the invite-links routes. */
  readonly inviteLinksOverrides: TestInviteLinksOverrides | undefined;
}
