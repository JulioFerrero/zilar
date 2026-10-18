// The server config field map (T-1457): every environment key the server reads,
// with its default and its boundary validation. Split out of `config.ts`; the
// decode helpers live in `./schema-helpers` and the loader in `./load`.

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
  // Search (T-0117): connection string for a read-only role on the
  // ejabberd MAM archive. Absent → GET /api/search answers 501 and the
  // web hides the feature.
  XMPP_ARCHIVE_DATABASE_URL: Schema.optional(databaseUrlSchema),
  // GitHub App (one App for the platform). Optional so the server still
  // boots without git integration; all three must be set together.
  GITHUB_APP_ID: Schema.optional(nonEmptyStringSchema),
  GITHUB_APP_PRIVATE_KEY: Schema.optional(nonEmptyStringSchema),
  GITHUB_APP_INSTALLATION_ID: Schema.optional(nonEmptyStringSchema),
  // Invite links (T-0115): the base URL baked into shareable group join
  // links (`${WEB_BASE_URL}/j/<token>`). A plain URL, never echoed in a
  // config error.
  WEB_BASE_URL: withDefault(anyUrlSchema, 'http://localhost:5173'),
  // Stickers (T-0120): the directory sticker files are stored under.
  // File names are `<uuid>.<ext>`; the dir must exist or be creatable and
  // writable at startup (checked in `index.ts`).
  STICKER_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/stickers'),
  // Avatars (T-0165): the directory profile pictures are stored under.
  // Same rules as `STICKER_STORAGE_DIR`: file names are `<uuid>.<ext>`
  // (never user input), the dir must exist or be creatable and writable
  // at startup (checked in `index.ts`).
  AVATAR_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/avatars'),
  // Background wallpapers (T-0460): the directory uploaded chat background
  // images are stored under. Same rules as `AVATAR_STORAGE_DIR`: file names
  // are `<uuid>.<ext>` (never user input), the dir must exist or be
  // creatable and writable at startup (checked in `index.ts`).
  BACKGROUND_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/backgrounds'),
  // Card media (T-1847): the directory AI card images and files are stored
  // under. Same rules as `AVATAR_STORAGE_DIR`: file names are `<uuid>` (never
  // user input), the dir must exist or be creatable and writable at startup.
  CARD_MEDIA_STORAGE_DIR: withDefault(nonEmptyStringSchema, './data/card-media'),
  // Telegram sticker import (T-0123): the token of a bot that may call
  // `getStickerSet`/`getFile` for public packs (Julio creates one with
  // @BotFather and puts it in `infra/.env`). Unset = the import route
  // answers 501 `import_unavailable` and the web hides the feature. The
  // token is never logged or returned (see `logger.ts` redact paths and
  // the scrubbing in `stickers/telegram-import.ts`).
  TELEGRAM_BOT_TOKEN: Schema.optional(nonEmptyStringSchema),
  // GIFs (T-0122): `GIF_PROVIDER` picks the search adapter (`giphy` today;
  // a second adapter can be added behind the same port later). Unset = the
  // feature is off and every route answers 501 `gifs_unavailable`. The key
  // is never logged or returned; the rating filter narrows provider results
  // (`g` | `pg` | `pg-13` | `r`, default `pg-13`).
  GIF_PROVIDER: Schema.optional(Schema.Literals(['giphy'])),
  GIF_API_KEY: Schema.optional(nonEmptyStringSchema),
  GIF_RATING: literalWithDefault(['g', 'pg', 'pg-13', 'r'] as const, 'pg-13'),
  // Client IP behind a proxy (T-0134, T-1983): how many right-most
  // `x-forwarded-for` hops to trust when resolving the client IP. 0
  // (default) ignores proxy headers entirely and uses the socket address;
  // N > 0 takes the Nth address from the right (an attacker controls the
  // left side). The edge reads it for Better Auth (its rate limits and the
  // stored session IP), and every per-IP limiter reads it too.
  TRUSTED_PROXY_HOPS: withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^-?\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(5)),
    ),
    '0',
  ),
  // Envelope-encryption master key for provider keys stored in
  // `provider_connections`. Optional so the server still boots without it;
  // the connections module refuses to start when it is absent. At least 32
  // bytes, so a weak key fails validation at startup rather than encrypting at
  // rest.
  ZILAR_KEY_ENCRYPTION_KEY: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
  ),
  // Mail transport (T-0128, T-0161): `console` writes sign-in codes to
  // the log (development only), `smtp` sends real mail through
  // nodemailer. Unset means "unconfigured": the server boots (production
  // included) and sending a code fails with a clear logged error until
  // explicit `MAIL_TRANSPORT`/`SMTP_*` env or the setup screen's stored
  // Resend settings provide a transport (see `auth/mailer.ts`).
  MAIL_TRANSPORT: Schema.optional(Schema.Literals(['console', 'smtp'])),
  // SMTP host, required when MAIL_TRANSPORT=smtp.
  SMTP_HOST: Schema.optional(nonEmptyStringSchema),
  // SMTP port in [1, 65535]. Default: 587.
  SMTP_PORT: portSchema('587'),
  // `true` = implicit TLS (normally port 465). `false` = STARTTLS is
  // required: the mailer sets `requireTLS: true` and never falls back
  // to plaintext. Default: false.
  SMTP_SECURE: booleanFlagSchema(),
  // SMTP credentials. Both are optional together (no auth when absent);
  // setting only one is a startup error.
  SMTP_USER: Schema.optional(nonEmptyStringSchema),
  SMTP_PASSWORD: Schema.optional(nonEmptyStringSchema),
  // Sender shown on sign-in mails, e.g. `Zilar <no-reply@example.com>`.
  // Required when MAIL_TRANSPORT=smtp.
  MAIL_FROM: Schema.optional(nonEmptyStringSchema),
  // Optional Reply-To header for sign-in mails.
  MAIL_REPLY_TO: Schema.optional(nonEmptyStringSchema),
  // Explicit opt-in that lets a single-admin private install run with
  // MAIL_TRANSPORT=console in production. The server then logs a loud
  // startup warning and the codes appear in the log. Off by default and
  // unsuitable for anyone but the operator.
  MAIL_ALLOW_CONSOLE_IN_PRODUCTION: booleanFlagSchema(),
  // Agent gateway (T-0034): when true, the server keeps every active AI
  // online over XMPP and replies to owner DMs. Off by default; enabling it
  // is one env line.
  AGENT_GATEWAY_ENABLED: booleanFlagSchema(),
  // Action demo adapter (T-0093): when true, the harmless `demo.echo`
  // adapter is registered so a DM owner can prove the `request_action`
  // tool end-to-end without a real integration. Off by default so
  // production behaviour is unchanged.
  ACTION_DEMO_ENABLED: booleanFlagSchema(),
  // Runner hub (T-0071): off by default. When enabled, the server accepts
  // tunnel connections from approved machines on RUNNER_HUB_PORT (default
  // 3189) bound to 127.0.0.1.
  RUNNER_HUB_ENABLED: booleanFlagSchema(),
  // Routines scheduler (T-0104): when true, `index.ts` starts the
  // scheduler that fires due routines. Off by default; enabling it also
  // needs a tool runner (the sandbox wiring), otherwise the scheduler
  // stays off with one warning.
  ROUTINES_ENABLED: booleanFlagSchema(),
  // AI-built tools and routines (T-0105): when true, `index.ts` builds
  // the real sandbox runner and registers the tool/routine adapters in
  // the action registry (next to the demo adapter when it is on), and
  // passes the runner to the tools routes and the routines scheduler.
  // Off by default: no adapters, no runner, and manual runs answer 501
  // `runner_unavailable`.
  TOOLS_ENABLED: booleanFlagSchema(),
  // Gateway-level web tools for AIs (T-0125): `web.fetch`,
  // `web.wikipedia`, `web.price`, `web.feed` and a best-effort
  // `web.search`. Keyless, no account: pages, Wikipedia, RSS/Atom
  // feeds and market prices work with nothing to sign up for. Off by
  // default: no adapters are registered.
  WEB_TOOLS_ENABLED: booleanFlagSchema(),
  // The listener (T-0474, plan `listener-delegation-plan.md` §2): when true,
  // the server decides which AI answers a room message without an @mention.
  // Off by default; the per-group switch is inert while this is off.
  LISTENER_ENABLED: booleanFlagSchema(),
  // The model name the listener calls (T-0475, plan §2.2). Unset means the
  // listener stays off even when `LISTENER_ENABLED` is true.
  LISTENER_MODEL: Schema.optional(listenerModelSchema),
  // Model-side tool rounds (T-0106): how many tool rounds one AI turn
  // may run. Integer 1 to 10. Unset = 1 when `TOOLS_ENABLED` is off
  // (today's behaviour, byte for byte) and 6 when it is on. Set
  // explicitly to force either value whatever the flag says.
  AGENT_TOOL_MAX_ROUNDS: withDefault(agentToolRoundsSchema, ''),
  // The search backend behind the port (T-0125): `duckduckgo-html`
  // parses one DuckDuckGo HTML page per call and may be blocked or
  // change its markup at any time; `none` unregisters `web.search`.
  WEB_SEARCH_PROVIDER: literalWithDefault(['duckduckgo-html', 'none'] as const, 'duckduckgo-html'),
  RUNNER_HUB_PORT: portSchema('3189'),
  // SIGTERM drain (T-1316): how long the server keeps serving after it gets a
  // signal and `/health` reports draining, before it steps down the leader and
  // closes. Milliseconds, 0 to 60000. Default 5000. Tests set 0.
  SHUTDOWN_DRAIN_MS: withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(60000)),
    ),
    '5000',
  ),
  // Desk sidecar socket (T-1407): the host service that runs the desk jails,
  // spoken by the cloud `Hands` adapter. T-1603: the agent's default location;
  // the server asks the agent whether it is ready instead of requiring this.
  DESK_AGENT_SOCKET: withDefault(nonEmptyStringSchema, '/run/zilar/desk.sock'),
  // The pinned jail image (`<name>@sha256:<64 hex>`, T-1418). T-1603: an
  // override for an old agent that does not report a pinned image; unset means
  // the image comes from the agent's own status.
  DESK_IMAGE: Schema.optional(pinnedImageSchema),
});

export type RawServerConfig = Schema.Schema.Type<typeof serverConfigSchema>;
