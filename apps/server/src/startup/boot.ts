// The fail-fast half of `startServer`: everything here must succeed before the HTTP listener
// starts, so a misconfiguration exits with a clear message instead of booting broken.
import { Effect } from 'effect';
import type { Logger } from 'pino';
import {
  createMailer,
  createResendMailer,
  CurrentMailer,
  MailerConfigurationError,
} from '../auth/mailer';
import { loadServerConfigOrExit, type ServerConfig } from '../config';
import { createDb, type ServerDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { registerSqlRuntime } from '../effect/sql';
import { createLogger } from '../logger';
import { getMailSettings, settingsCipherFor } from '../setup/settings';
import {
  ensureWritableDir,
  warnOnContainerLayerStorage,
  warnOnEmptyStorageDir,
  warnOnGifConfig,
} from '../startup';
import { resolveStorageDir } from '../stickers/service';
import type { RunningServer } from './lifecycle';

export interface BootedServer {
  config: ServerConfig;
  logger: Logger;
  db: ServerDatabase;
  closeDb: () => Promise<void>;
  currentMailer: CurrentMailer;
  stickerDir: string;
  avatarDir: string;
  backgroundDir: string;
  cardMediaDir: string;
}

/** Fills `running` as soon as each handle exists, so a stop during startup closes exactly
 * what was started. */
export function bootServer(running: RunningServer): Effect.Effect<BootedServer> {
  return Effect.gen(function* () {
    const config = yield* Effect.sync(() => loadServerConfigOrExit(process.env));
    const logger = createLogger(config);
    running.logger = logger;

    const mailer = yield* Effect.try({
      try: () => createMailer(config, logger),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        error instanceof MailerConfigurationError
          ? Effect.sync(() => {
              console.error(error.message);
              return process.exit(1);
            })
          : Effect.die(error),
      ),
    );

    const { db, close } = createDb(config.DATABASE_URL);
    running.db = db;
    running.closeDb = close;
    // Registered before any step that reads the database, so they all share one client.
    registerSqlRuntime(db, config.DATABASE_URL);
    yield* Effect.promise(() => runMigrations(db));

    // The auth flow sends through this holder, so the setup screen can swap the transport
    // without a restart. Stored Resend settings take effect at boot; explicit SMTP env wins.
    const currentMailer = new CurrentMailer(mailer);
    if (config.MAIL_TRANSPORT === undefined) {
      const stored = yield* Effect.promise(() => getMailSettings(db, settingsCipherFor(config)));
      if (stored) {
        currentMailer.use(createResendMailer(config, logger, stored));
      }
    }

    // The storage dir must exist or be creatable and writable at startup, so a bad mount
    // fails fast. Resolved against the server package root, so a relative value means the
    // same dir here and in the routes. A newly created dir logs ONE warning with the
    // resolved path: a relative value resolved somewhere new is the "moved base" case.
    const stickerDir = resolveStorageDir(config.STICKER_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(stickerDir, 'STICKER_STORAGE_DIR'));
    yield* Effect.promise(() =>
      warnOnEmptyStorageDir({
        db,
        storageDir: stickerDir,
        warn: (message) => logger.warn(message),
      }),
    );

    const avatarDir = resolveStorageDir(config.AVATAR_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(avatarDir, 'AVATAR_STORAGE_DIR'));

    const backgroundDir = resolveStorageDir(config.BACKGROUND_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(backgroundDir, 'BACKGROUND_STORAGE_DIR'));

    const cardMediaDir = resolveStorageDir(config.CARD_MEDIA_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(cardMediaDir, 'CARD_MEDIA_STORAGE_DIR'));

    // Warn once (ids/paths only) when a store sits on the container layer in production
    // (no mount: files are lost on replace), and when GIF search is half-configured.
    yield* Effect.promise(() =>
      warnOnContainerLayerStorage({
        dirs: [
          { envName: 'STICKER_STORAGE_DIR', dir: stickerDir },
          { envName: 'AVATAR_STORAGE_DIR', dir: avatarDir },
          { envName: 'BACKGROUND_STORAGE_DIR', dir: backgroundDir },
          { envName: 'CARD_MEDIA_STORAGE_DIR', dir: cardMediaDir },
        ],
        isProduction: config.NODE_ENV === 'production',
        warn: (message) => logger.warn(message),
      }),
    );
    warnOnGifConfig({
      provider: config.GIF_PROVIDER,
      apiKey: config.GIF_API_KEY,
      warn: (message) => logger.warn(message),
    });

    return {
      config,
      logger,
      db,
      closeDb: close,
      currentMailer,
      stickerDir,
      avatarDir,
      backgroundDir,
      cardMediaDir,
    };
  });
}
