import { Schema } from 'effect';
import {
  agentToolRoundsSchema,
  anyUrlSchema,
  booleanFlagSchema,
  databaseUrlSchema,
  listenerModelSchema,
  literalWithDefault,
  nonEmptyStringSchema,
  pinnedImageSchema,
  portSchema,
  toInt,
  toText,
  webOriginsSchema,
  withDefault,
} from './schema-helpers';

export const serverConfigSchema = Schema.Struct({
  NODE_ENV: literalWithDefault(['development', 'test', 'production'] as const, 'development'),
  PORT: portSchema('3000'),
  DATABASE_URL: databaseUrlSchema,
  LOG_LEVEL: literalWithDefault(
    ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const,
    'info',
  ),
  PUBLIC_URL: withDefault(anyUrlSchema, 'http://localhost:3000'),
  BETTER_AUTH_SECRET: Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
  BETTER_AUTH_URL: Schema.optional(anyUrlSchema),
  WEB_ORIGINS: withDefault(webOriginsSchema, 'http://localhost:5173'),
  // Read-only role on the ejabberd MAM archive; absent means search answers 501.
  XMPP_ARCHIVE_DATABASE_URL: Schema.optional(databaseUrlSchema),
  // Optional so the server boots without git; all three must be set together.
  GITHUB_APP_ID: Schema.optional(nonEmptyStringSchema),
  GITHUB_APP_PRIVATE_KEY: Schema.optional(nonEmptyStringSchema),
  GITHUB_APP_INSTALLATION_ID: Schema.optional(nonEmptyStringSchema),
  // The base URL baked into shareable join links; never echoed in a config error.
  WEB_BASE_URL: withDefault(anyUrlSchema, 'http://localhost:5173'),
  // Sticker files are `<uuid>.<ext>`; the dir must be creatable and writable at startup.
  STICKER_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/stickers'),
  AVATAR_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/avatars'),
  BACKGROUND_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/backgrounds'),
  CARD_MEDIA_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/card-media'),
  // A bot that may read public packs for import. Unset means the route answers 501. The
  // token is never logged or returned (see `logger.ts` redaction).
  TELEGRAM_BOT_TOKEN: Schema.optional(nonEmptyStringSchema),
  // `GIF_PROVIDER` picks the adapter; unset means the feature is off and every route
  // answers 501. The key is never logged or returned. The rating filter is `g` | `pg` |
  // `pg-13` | `r`, default `pg-13`.
  GIF_PROVIDER: Schema.optional(Schema.Literals(['giphy'])),
  GIF_API_KEY: Schema.optional(nonEmptyStringSchema),
  GIF_RATING: literalWithDefault(['g', 'pg', 'pg-13', 'r'] as const, 'pg-13'),
  // How many right-most `x-forwarded-for` hops to trust. 0 (default) ignores proxy
  // headers and uses the socket address; N > 0 takes the Nth address from the right,
  // since an attacker controls only the left side.
  TRUSTED_PROXY_HOPS: withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^-?\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(5)),
    ),
    '0',
  ),
  // Master key for provider keys stored in `provider_connections`; optional so the server
  // boots without it, but the module refuses to start when it is absent. At least 32 bytes.
  ZILAR_KEY_ENCRYPTION_KEY: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
  ),
  // `console` writes sign-in codes to the log (development only), `smtp` sends real mail.
  // Unset means unconfigured: the server boots and sending fails with a clear error until
  // explicit SMTP env or the setup screen's stored settings provide a transport.
  MAIL_TRANSPORT: Schema.optional(Schema.Literals(['console', 'smtp'])),
  // Required when MAIL_TRANSPORT=smtp.
  SMTP_HOST: Schema.optional(nonEmptyStringSchema),
  // In [1, 65535]. Default: 587.
  SMTP_PORT: portSchema('587'),
  // `true` = implicit TLS (normally 465). `false` = STARTTLS required: the mailer sets
  // `requireTLS: true` and never falls back to plaintext.
  SMTP_SECURE: booleanFlagSchema(),
  // Both optional together (no auth when absent); setting only one is a startup error.
  SMTP_USER: Schema.optional(nonEmptyStringSchema),
  SMTP_PASSWORD: Schema.optional(nonEmptyStringSchema),
  // Required when MAIL_TRANSPORT=smtp.
  MAIL_FROM: Schema.optional(nonEmptyStringSchema),
  MAIL_REPLY_TO: Schema.optional(nonEmptyStringSchema),
  // Lets a single-admin private install run with MAIL_TRANSPORT=console in production:
  // it logs a loud warning and codes appear in the log. Off by default.
  MAIL_ALLOW_CONSOLE_IN_PRODUCTION: booleanFlagSchema(),
  // Keeps every active AI online over XMPP and replies to owner DMs. Off by default.
  AGENT_GATEWAY_ENABLED: booleanFlagSchema(),
  // Registers the harmless `demo.echo` adapter to prove `request_action` end-to-end. Off
  // by default.
  ACTION_DEMO_ENABLED: booleanFlagSchema(),
  // Accepts tunnel connections from approved machines on RUNNER_HUB_PORT (default 3189)
  // bound to 127.0.0.1. Off by default.
  RUNNER_HUB_ENABLED: booleanFlagSchema(),
  // Starts the scheduler that fires due routines. Off by default; enabling it also needs a
  // tool runner, otherwise it stays off with one warning.
  ROUTINES_ENABLED: booleanFlagSchema(),
  // Builds the real sandbox runner and registers the tool/routine adapters. Off by
  // default: no adapters or runner, and manual runs answer 501 `runner_unavailable`.
  TOOLS_ENABLED: booleanFlagSchema(),
  // Gateway-level web tools (`web.fetch`, `web.wikipedia`, `web.price`, `web.feed` and a
  // best-effort `web.search`). Keyless and off by default.
  WEB_TOOLS_ENABLED: booleanFlagSchema(),
  // Decides which AI answers a room message without an @mention; the per-group switch is
  // inert while this is off.
  LISTENER_ENABLED: booleanFlagSchema(),
  // Unset means the listener stays off even when `LISTENER_ENABLED` is true.
  LISTENER_MODEL: Schema.optional(listenerModelSchema),
  // How many tool rounds one AI turn may run, 1 to 10. Unset = 1 when `TOOLS_ENABLED` is
  // off and 6 when on; an explicit value wins.
  AGENT_TOOL_MAX_ROUNDS: withDefault(agentToolRoundsSchema, ''),
  // `duckduckgo-html` parses one HTML page per call and may be blocked or change markup;
  // `none` unregisters `web.search`.
  WEB_SEARCH_PROVIDER: literalWithDefault(['duckduckgo-html', 'none'] as const, 'duckduckgo-html'),
  RUNNER_HUB_PORT: portSchema('3189'),
  // How long the server keeps serving after SIGTERM while `/health` reports draining.
  // Milliseconds, 0 to 60000, default 5000; tests set 0.
  SHUTDOWN_DRAIN_MS: withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(60000)),
    ),
    '5000',
  ),
  // The host service that runs the desk jails; the server asks it whether it is ready.
  DESK_AGENT_SOCKET: withDefault(nonEmptyStringSchema, '/run/zilar/desk.sock'),
  // A pinned image (`<name>@sha256:<64 hex>`) used as an override for an old agent that
  // does not report one.
  DESK_IMAGE: Schema.optional(pinnedImageSchema),
});

export type RawServerConfig = Schema.Schema.Type<typeof serverConfigSchema>;
