import { Context, Effect, Exit, Layer, Schema, SchemaGetter, SchemaIssue } from 'effect';
import { loadXmppConfig, type XmppConfig } from './xmpp/config';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Decode helpers shared by the string-to-number fields (the ports and the
// trusted-proxy hop count). `Number.parseInt` never throws; the numeric checks
// below reject a NaN result at the field path, so a value never reaches the
// output.
const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
const toText = SchemaGetter.transform((value: number) => String(value));

// `z.url()` accepts any absolute URL; the boolean predicate form keeps the
// failure anonymous so `formatIssues` renders it as `invalid`, never echoing
// the value. `false` is a failure, `true` a success.
function isAnyUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// The custom message is written in code and never contains the value, so a
// non-postgres connection string can never leak through a configuration error.
function isPostgresUrl(value: string): string | undefined {
  return /^postgres(ql)?:\/\//.test(value) ? undefined : 'invalid database url';
}

const anyUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isAnyUrl)));
const databaseUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isPostgresUrl)));
const nonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

// A key that is absent (or `undefined`) falls back to `fallback`, matching
// zod's `.default()` / preprocess `?? default` behaviour, and the decoded type
// has the key required.
function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

function literalWithDefault<const L extends ReadonlyArray<string>>(
  literals: L,
  fallback: L[number],
) {
  return withDefault(Schema.Literals(literals), fallback);
}

// A port in [1, 65535], parsed from a digit-only string. Empty/garbage fails
// the pattern, out-of-range numbers fail the bounds; both render as `invalid`.
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

// `'true'`/`'false'` string flag decoded to a boolean; anything else is invalid.
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

// `LISTENER_MODEL` is trimmed before its length checks, so a whitespace-only
// value fails `min(1)` instead of surviving as a blank model name.
const listenerModelSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

// `AGENT_TOOL_MAX_ROUNDS` is a string, empty meaning unset; the value is
// parsed to a number (and the tools-on/off fallback applied) after decoding.
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
  // LLM gateway (LiteLLM). Both are optional so the server still boots in
  // environments without a gateway; the AI module refuses to call LiteLLM
  // when the master key is absent. The base URL has a default applied there.
  LITELLM_BASE_URL: Schema.optional(anyUrlSchema),
  // Search (T-0117): connection string for a read-only role on the
  // ejabberd MAM archive. Absent → GET /api/search answers 501 and the
  // web hides the feature.
  XMPP_ARCHIVE_DATABASE_URL: Schema.optional(databaseUrlSchema),
  LITELLM_MASTER_KEY: Schema.optional(nonEmptyStringSchema),
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
  // Join limiter behind a proxy (T-0134): how many right-most
  // `x-forwarded-for` hops to trust when resolving the client IP for the
  // per-IP join limiter. 0 (default) ignores proxy headers entirely and
  // uses the socket address; N > 0 takes the Nth address from the right
  // (an attacker controls the left side). Only the join limiter reads it.
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
  // the connections module refuses to start when it is absent (mirrors how
  // LITELLM_MASTER_KEY is handled by the AI module). At least 32 bytes, so a
  // weak key fails validation at startup rather than encrypting at rest.
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
  // 3189) bound to 127.0.0.1. The HTTP-only gateway requirement is checked
  // in index.ts once the LiteLLM base URL is known.
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
  // The LiteLLM model name the listener calls (T-0475, plan §2.2). It is
  // paid with the server's LiteLLM master key, never an AI's own key, so
  // one room costs the platform, not any owner. Unset means the listener
  // stays off even when `LISTENER_ENABLED` is true.
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
});

type RawServerConfig = Schema.Schema.Type<typeof serverConfigSchema>;

// Mail transport rules (T-0128) and the GitHub App trio. Every issue names
// the variable and states what is wrong; values are never included, so
// SMTP_PASSWORD can never leak through a configuration error. These run on
// the raw env map (the values are plain strings at this boundary) and are
// appended after the schema issues, mirroring zod's `superRefine` order.
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

// Accepts a bare address (`no-reply@example.com`) or a display name plus
// angle-addr (`Zilar <no-reply@example.com>`); enough validation to catch a
// typo in MAIL_FROM at startup without pulling in a mail parser.
function isMailbox(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }
  const angle = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (angle?.[2] ?? trimmed).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(address);
}

interface ConfigDetail {
  readonly name: string;
  readonly reason: string;
}

// Maps Effect's issue tree to the same `path (reason)` pairs zod produced:
// `missing` for an absent required key, the custom message for a filter that
// returned one, and `invalid` otherwise. Only names and code-written messages
// are used, never a value.
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
    // One entry per issue so several precise messages survive under one
    // path (for example both SMTP rules); exact duplicates collapse.
    const detail = `${name || 'env'} (${reason})`;
    if (!seen.has(detail)) {
      seen.add(detail);
      parts.push(detail);
    }
  }
  return `Invalid server configuration: ${parts.join(', ')}`;
}

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`),
// which a bare optional would reject. For the optional mail settings and the
// optional key-encryption key an empty value means "not set". Explicit
// `undefined` values are dropped too, so a key-based schema default applies to
// them exactly as zod's `?? default` did.
const EMPTY_MEANS_UNSET_KEYS = [
  'ZILAR_KEY_ENCRYPTION_KEY',
  'MAIL_TRANSPORT',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_REPLY_TO',
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

// Derives `MAIL_TRANSPORT`, `BETTER_AUTH_URL` and `AGENT_TOOL_MAX_ROUNDS`
// after a successful decode, exactly like the zod object transform did, then
// attaches the XMPP config. The returned object's type is the public
// `ServerConfig`.
function finalizeConfig(raw: RawServerConfig, xmpp: XmppConfig) {
  return {
    ...raw,
    WEB_ORIGINS: [...new Set(raw.WEB_ORIGINS.map((origin) => new URL(origin).origin))],
    MAIL_TRANSPORT: raw.MAIL_TRANSPORT ?? (raw.NODE_ENV === 'production' ? undefined : 'console'),
    BETTER_AUTH_URL: raw.BETTER_AUTH_URL ?? raw.PUBLIC_URL,
    // Unset = 1 when tools are off (today's behaviour), 6 when on.
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

// The Effect `Context` tag other services ask for; `ServerConfigLive` builds
// it from `process.env` at provision time (not at import time, so importing
// this module never parses the environment).
export const ServerConfig = Context.Service<ServerConfig>('ServerConfig');

export const ServerConfigLive: Layer.Layer<ServerConfig> = Layer.sync(ServerConfig, () =>
  loadServerConfig(process.env),
);

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
