import type { Logger } from 'pino';
import type { ActionGateway } from '../actions/gateway';
import type { TurnStopper } from '../agents/gateway/stop-types';
import type { AiLogger } from '../ais/persona';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { AlwaysEligiblePredicate } from '../approvals/service';
import type { Auth } from '../auth/auth';
import type { CurrentMailer } from '../auth/mailer';
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

export interface AppDependencies {
  db: ServerDatabase;
  logger: Logger;
  config: ServerConfig;
  auth: Auth;
  adminClient: EjabberdAdminClient;
  mailer?: CurrentMailer;
  setup?:
    | Partial<
        Pick<SetupApiDependencies, 'limiter' | 'getClientIp' | 'trustedProxyHops' | 'sendTestCode'>
      >
    | undefined;
  voice?: VoiceEngine;
  voiceMaxBytes?: number;
  connections?: {
    cipher?: KeyCipher;
    probe?: ProviderProbe;
    logger?: ConnectionsLogger;
  };
  ais?: {
    cipher?: KeyCipher;
    logger?: AiLogger;
    cloud?: () => Promise<boolean>;
  };
  getGateway?: () => TurnStopper | null;
  isMachineOnline?: (machineId: string) => boolean;
  machineRegistry?: DbMachineRegistry;
  audit?: AuditRecorder;
  actionGateway?: ActionGateway;
  alwaysEligible?: AlwaysEligiblePredicate;
  toolRunner?: ToolRunner;
  archive?: SearchRoutesDependencies['archive'];
  searchNow?: () => number;
  stickerStorageDir?: string;
  avatarStorageDir?: string;
  avatarNow?: () => number;
  avatarUploadLimiter?: { allow: (key: string) => boolean };
  backgroundStorageDir?: string;
  backgroundNow?: () => number;
  backgroundUploadLimiter?: { allow: (key: string) => boolean };
  cardMediaStorageDir?: string;
  stickerNow?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
  telegramClient?: import('../stickers/telegram/set').TelegramClient;
  telegramImportNow?: () => number;
  voiceTranscription?:
    | Partial<
        Pick<
          import('../voice-transcription/routes').VoiceTranscriptionRoutesDependencies,
          'transcriptLimiter' | 'settingsLimiter' | 'now' | 'audioFetcher' | 'transcribe'
        >
      >
    | undefined;
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
  push?: PushConfig;
  gifProvider?: import('../gifs/provider').GifProvider;
  gifMediaFetcher?: import('../gifs/routes').GifsRoutesDependencies['mediaFetcher'];
  gifNow?: () => number;
}

export type BaseDeps = Pick<AppDependencies, 'db' | 'config' | 'logger' | 'auth'>;

export interface RouteWiring {
  readonly deps: AppDependencies;
  readonly base: BaseDeps;
  readonly audit: AuditRecorder;
  readonly mailer: CurrentMailer;
  readonly gateway: ActionGateway;
  readonly inviteLinksOverrides: TestInviteLinksOverrides | undefined;
}
