// The fail-fast half of `startServer`: config and logger, the mailer, the
// database and migrations, the stored mail settings, and the storage dirs and
// warnings. Everything here must succeed before the HTTP listener starts, so a
// misconfiguration exits with a clear message instead of booting a broken
// server. The later steps (auth, registries, gateways, listen) build on the
// object this returns.
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

/** What `startComponents` needs from the boot steps above it. */
export interface BootedServer {
  config: ServerConfig;
  logger: Logger;
  db: ServerDatabase;
  closeDb: () => Promise<void>;
  currentMailer: CurrentMailer;
  stickerDir: string;
  avatarDir: string;
  backgroundDir: string;
}

/**
 * Runs the fail-fast boot steps in order and fills `running` as soon as each
 * handle exists, so a stop that begins during startup closes exactly what was
 * started.
 */
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
    // `createApp` below reuses this runtime; registering here, before any startup
    // step that reads the database (migrations, stored mail settings, startup
    // checks), keeps them all on the same `effect/sql` client.
    registerSqlRuntime(db, config.DATABASE_URL);
    yield* Effect.promise(() => runMigrations(db));

    // First-run setup (T-0161): the auth flow sends through this holder, so
    // the setup screen can swap the transport without a restart. Stored
    // Resend settings (from a finished setup) take effect here at boot;
    // explicit `MAIL_TRANSPORT`/`SMTP_*` env already set the transport above
    // and stored settings are ignored for it.
    const currentMailer = new CurrentMailer(mailer);
    if (config.MAIL_TRANSPORT === undefined) {
      const stored = yield* Effect.promise(() => getMailSettings(db, settingsCipherFor(config)));
      if (stored) {
        currentMailer.use(createResendMailer(config, logger, stored));
      }
    }

    // Stickers (T-0120): the storage dir must exist or be creatable and
    // writable at startup, so a bad mount fails fast with a clear message
    // instead of failing the first upload. Resolved against the server package
    // root like the routes, so a relative value means the same dir here and there whatever the cwd is. T-0146: when the dir did not exist yet and is
    // created now, the startup helper logs ONE warning line with the resolved
    // path — a relative value resolving to an empty, unexpected directory (e.g.
    // a build step moved the package root) is the "moved base" case, and the
    // resolved path in the line says where the files actually land. Only when
    // the directory holds no stickers while the database has sticker rows is
    // the mismatch certain; that second line is logged below.
    const stickerDir = resolveStorageDir(config.STICKER_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(stickerDir, 'STICKER_STORAGE_DIR'));
    yield* Effect.promise(() =>
      warnOnEmptyStorageDir({
        db,
        storageDir: stickerDir,
        warn: (message) => logger.warn(message),
      }),
    );

    // Avatars (T-0165): same rules as the sticker dir — a missing directory is
    // created, an unwritable one fails fast with a clear message.
    const avatarDir = resolveStorageDir(config.AVATAR_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(avatarDir, 'AVATAR_STORAGE_DIR'));

    // Background wallpapers (T-0460): same rules as the avatar dir.
    const backgroundDir = resolveStorageDir(config.BACKGROUND_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(backgroundDir, 'BACKGROUND_STORAGE_DIR'));

    // T-0156: warn once (ids/paths only) when the file stores sit on the
    // container layer in production (no mount: files lost on replace), and when
    // GIF search is half-configured (provider without a key). Absolute paths
    // are the norm in production (`/data/stickers`, `/data/avatars`); warn
    // anyway, since an unmounted named volume lands on the same device as `/`.
    yield* Effect.promise(() =>
      warnOnContainerLayerStorage({
        dirs: [
          { envName: 'STICKER_STORAGE_DIR', dir: stickerDir },
          { envName: 'AVATAR_STORAGE_DIR', dir: avatarDir },
          { envName: 'BACKGROUND_STORAGE_DIR', dir: backgroundDir },
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
    };
  });
}
