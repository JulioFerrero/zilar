import { Context, Effect, Exit, Schema, SchemaGetter, SchemaIssue } from 'effect';
import { loadXmppConfig, type XmppConfig } from '../xmpp/config';

// Mail transport and GitHub App cross-field rules. Every issue names the variable and
// states what is wrong, never the value, so `SMTP_PASSWORD` cannot leak through an error.

interface ConfigDetail {
  readonly name: string;
  readonly reason: string;
}

function crossFieldDetails(env: Record<string, string | undefined>): ReadonlyArray<ConfigDetail> {
  const details: ConfigDetail[] = [];

  const githubEntries = [
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_APP_INSTALLATION_ID,
  ];
  const present = githubEntries.map((entry) => entry !== undefined);
  if (present.some(Boolean) && !present.every(Boolean)) {
    details.push({
      name: '',
      reason:
        'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID must be set together',
    });
  }

  if (env.MAIL_TRANSPORT === 'smtp') {
    const fail = (reason: string): void => {
      details.push({ name: 'MAIL_TRANSPORT', reason });
    };
    if (env.SMTP_HOST === undefined) {
      fail('SMTP_HOST is required when MAIL_TRANSPORT=smtp');
    }
    if (env.MAIL_FROM === undefined) {
      fail('MAIL_FROM is required when MAIL_TRANSPORT=smtp');
    }
    const userSet = env.SMTP_USER !== undefined;
    const passwordSet = env.SMTP_PASSWORD !== undefined;
    if (userSet !== passwordSet) {
      fail('SMTP_USER and SMTP_PASSWORD must be set together');
    }
    for (const [name, mailbox] of [
      ['MAIL_FROM', env.MAIL_FROM],
      ['MAIL_REPLY_TO', env.MAIL_REPLY_TO],
    ] as const) {
      if (mailbox !== undefined && !isMailbox(mailbox)) {
        details.push({
          name,
          reason: `${name} must be a valid mailbox (for example: Zilar <no-reply@example.com>)`,
        });
      }
    }
  }

  return details;
}

// A bare address or a display name plus angle-addr; enough to catch a typo in MAIL_FROM
// at startup without a mail parser.
function isMailbox(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }
  const angle = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (angle?.[2] ?? trimmed).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(address);
}
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Maps Effect's issue tree to `path (reason)` pairs: `missing` for an absent required
// key, the custom message for a filter that returned one, `invalid` otherwise. Names and
// code-written messages only, never a value.
function collectDetails(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): ReadonlyArray<ConfigDetail> {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => collectDetails(child, path));
    case 'Pointer':
      return collectDetails(issue.issue, [...path, ...issue.path]);
    case 'MissingKey':
      return [{ name: path.join('.'), reason: 'missing' }];
    case 'InvalidType':
      return [{ name: path.join('.'), reason: issue.input === undefined ? 'missing' : 'invalid' }];
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return [
        {
          name: path.join('.'),
          reason: typeof message === 'string' && message.length > 0 ? message : 'invalid',
        },
      ];
    }
    case 'Filter':
    case 'Encoding':
      return collectDetails(issue.issue, path);
    default:
      return [{ name: path.join('.'), reason: 'invalid' }];
  }
}

function formatIssues(details: ReadonlyArray<ConfigDetail>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const { name, reason } of details) {
    // One entry per issue so several precise messages survive under one path; exact
    // duplicates collapse.
    const detail = `${name || 'env'} (${reason})`;
    if (!seen.has(detail)) {
      seen.add(detail);
      parts.push(detail);
    }
  }
  return `Invalid server configuration: ${parts.join(', ')}`;
}

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`), which a bare
// optional would reject, so empty means "not set" for the optional mail and key settings.
// Explicit `undefined` is dropped too, so a schema default still applies.
const EMPTY_MEANS_UNSET_KEYS = [
  'ZILAR_KEY_ENCRYPTION_KEY',
  'MAIL_TRANSPORT',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_REPLY_TO',
  'DESK_AGENT_SOCKET',
  'DESK_IMAGE',
] as const;

function emptyMailSettingsAsUnset(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  for (const key of EMPTY_MEANS_UNSET_KEYS) {
    if (normalized[key] === '') {
      delete normalized[key];
    }
  }
  return normalized;
}

// Derives `MAIL_TRANSPORT`, `BETTER_AUTH_URL` and `AGENT_TOOL_MAX_ROUNDS` after a
// successful decode, then attaches the XMPP config.
function finalizeConfig(raw: RawServerConfig, xmpp: XmppConfig) {
  return {
    ...raw,
    WEB_ORIGINS: [...new Set(raw.WEB_ORIGINS.map((origin) => new URL(origin).origin))],
    MAIL_TRANSPORT: raw.MAIL_TRANSPORT ?? (raw.NODE_ENV === 'production' ? undefined : 'console'),
    BETTER_AUTH_URL: raw.BETTER_AUTH_URL ?? raw.PUBLIC_URL,
    // Unset = 1 when tools are off, 6 when on.
    AGENT_TOOL_MAX_ROUNDS:
      raw.AGENT_TOOL_MAX_ROUNDS === ''
        ? raw.TOOLS_ENABLED
          ? 6
          : 1
        : Number.parseInt(raw.AGENT_TOOL_MAX_ROUNDS, 10),
    xmpp,
  };
}

export type ServerConfig = ReturnType<typeof finalizeConfig>;

// The tag other services ask for; the live layer builds it from `process.env` at
// provision time, so importing this module never parses the environment.
export const ServerConfig = Context.Service<ServerConfig>('ServerConfig');

export function loadServerConfig(rawEnv: Record<string, string | undefined>): ServerConfig {
  const env = emptyMailSettingsAsUnset(rawEnv);
  const exit = Schema.decodeUnknownExit(serverConfigSchema, { errors: 'all' })(env);

  if (Exit.isSuccess(exit)) {
    const details = crossFieldDetails(env);
    if (details.length > 0) {
      throw new ConfigError(formatIssues(details));
    }

    let xmpp: XmppConfig;
    try {
      xmpp = loadXmppConfig(env);
    } catch (error) {
      if (error instanceof Error) {
        throw new ConfigError(error.message);
      }
      throw error;
    }

    return finalizeConfig(exit.value, xmpp);
  }

  const details: ConfigDetail[] = [];
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      details.push(...collectDetails(reason.error.issue));
    }
  }
  const defect = exit.cause.reasons.find((reason) => reason._tag === 'Die');
  if (details.length === 0 && defect !== undefined && defect._tag === 'Die') {
    throw defect.defect;
  }
  details.push(...crossFieldDetails(env));
  throw new ConfigError(formatIssues(details));
}

export function loadServerConfigOrExit(env: Record<string, string | undefined>): ServerConfig {
  try {
    return loadServerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
// `Number.parseInt` never throws; the checks below reject a NaN result at the field path.
const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
const toText = SchemaGetter.transform((value: number) => String(value));

// The boolean predicate keeps the failure anonymous, so `formatIssues` renders `invalid`
// without echoing the value.
function isAnyUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// The message is code-written and never contains the value, so a connection string cannot
// leak through a config error.
function isPostgresUrl(value: string): string | undefined {
  return /^postgres(ql)?:\/\//.test(value) ? undefined : 'invalid database url';
}

const anyUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isAnyUrl)));
const databaseUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isPostgresUrl)));
const nonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
// A pinned reference (`<name>@sha256:<64 hex>`); a tag-only value is refused.
function isPinnedImage(value: string): string | undefined {
  return /^[^@\s]+@sha256:[0-9a-f]{64}$/.test(value) ? undefined : 'invalid pinned image';
}
const pinnedImageSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isPinnedImage)));

function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

function literalWithDefault<const L extends ReadonlyArray<string>>(
  literals: L,
  fallback: L[number],
) {
  return withDefault(Schema.Literals(literals), fallback);
}

// A port in [1, 65535] parsed from digit-only; empty/garbage or out-of-range both render
// as `invalid`.
function portSchema(defaultPort: string) {
  return withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(65535)),
    ),
    defaultPort,
  );
}

// `'true'`/`'false'` decoded to a boolean; anything else is invalid.
function booleanFlagSchema() {
  return Schema.Literals(['true', 'false']).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('false')),
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value: 'true' | 'false') => value === 'true'),
      encode: SchemaGetter.transform((value: boolean) => (value ? 'true' : 'false')),
    }),
  );
}

const webOriginsSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.makeFilter(isAnyUrl)))).pipe(
      Schema.check(Schema.isMinLength(1)),
    ),
    {
      decode: SchemaGetter.transform((value: string) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
      encode: SchemaGetter.transform((origins: ReadonlyArray<string>) => origins.join(',')),
    },
  ),
);

// Trimmed before the length checks, so a whitespace-only value fails `min(1)`.
const listenerModelSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

// Empty means unset; the value is parsed and the tools-on/off fallback applied after
// decoding.
const agentToolRoundsSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^([1-9]|10)?$/)));
const serverConfigSchema = Schema.Struct({
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

type RawServerConfig = Schema.Schema.Type<typeof serverConfigSchema>;
