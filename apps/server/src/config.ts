import { z } from 'zod';
import { loadXmppConfig, type XmppConfig } from './xmpp/config';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const portSchema = z.preprocess(
  (value) => value ?? '3000',
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1 && value <= 65535),
);

const databaseUrlSchema = z
  .string()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), { error: 'invalid database url' });

const webOriginsSchema = z
  .string()
  .default('http://localhost:5173')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url()).min(1))
  .transform((origins) => [...new Set(origins.map((origin) => new URL(origin).origin))]);

const serverConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: portSchema,
    DATABASE_URL: databaseUrlSchema,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().optional(),
    WEB_ORIGINS: webOriginsSchema,
    // LLM gateway (LiteLLM). Both are optional so the server still boots in
    // environments without a gateway; the AI module refuses to call LiteLLM
    // when the master key is absent. The base URL has a default applied there.
    LITELLM_BASE_URL: z.url().optional(),
    // Search (T-0117): connection string for a read-only role on the
    // ejabberd MAM archive. Absent → GET /api/search answers 501 and the
    // web hides the feature.
    XMPP_ARCHIVE_DATABASE_URL: databaseUrlSchema.optional(),
    LITELLM_MASTER_KEY: z.string().min(1).optional(),
    // GitHub App (one App for the platform). Optional so the server still
    // boots without git integration; all three must be set together.
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_INSTALLATION_ID: z.string().min(1).optional(),
    // Invite links (T-0115): the base URL baked into shareable group join
    // links (`${WEB_BASE_URL}/j/<token>`). A plain URL, never echoed in a
    // config error.
    WEB_BASE_URL: z.url().default('http://localhost:5173'),
    // Stickers (T-0120): the directory sticker files are stored under.
    // File names are `<uuid>.<ext>`; the dir must exist or be creatable and
    // writable at startup (checked in `index.ts`).
    STICKER_STORAGE_DIR: z.string().min(1).default('./data/stickers'),
    // Telegram sticker import (T-0123): the token of a bot that may call
    // `getStickerSet`/`getFile` for public packs (Julio creates one with
    // @BotFather and puts it in `infra/.env`). Unset = the import route
    // answers 501 `import_unavailable` and the web hides the feature. The
    // token is never logged or returned (see `logger.ts` redact paths and
    // the scrubbing in `stickers/telegram-import.ts`).
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    // GIFs (T-0122): `GIF_PROVIDER` picks the search adapter (`giphy` today;
    // a second adapter can be added behind the same port later). Unset = the
    // feature is off and every route answers 501 `gifs_unavailable`. The key
    // is never logged or returned; the rating filter narrows provider results
    // (`g` | `pg` | `pg-13` | `r`, default `pg-13`).
    GIF_PROVIDER: z.enum(['giphy']).optional(),
    GIF_API_KEY: z.string().min(1).optional(),
    GIF_RATING: z.enum(['g', 'pg', 'pg-13', 'r']).default('pg-13'),
    // Join limiter behind a proxy (T-0134): how many right-most
    // `x-forwarded-for` hops to trust when resolving the client IP for the
    // per-IP join limiter. 0 (default) ignores proxy headers entirely and
    // uses the socket address; N > 0 takes the Nth address from the right
    // (an attacker controls the left side). Only the join limiter reads it.
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Envelope-encryption master key for provider keys stored in
    // `provider_connections`. Optional so the server still boots without it;
    // the connections module refuses to start when it is absent (mirrors how
    // LITELLM_MASTER_KEY is handled by the AI module). At least 32 bytes, so a
    // weak key fails validation at startup rather than encrypting at rest.
    ZILAR_KEY_ENCRYPTION_KEY: z.string().min(32).optional(),
    // Mail transport (T-0128): `console` writes sign-in codes to the log
    // (development only), `smtp` sends real mail through nodemailer.
    // In production the transport must be chosen explicitly: leaving it
    // unset refuses to start with an error that names these variables.
    MAIL_TRANSPORT: z.enum(['console', 'smtp']).optional(),
    // SMTP host, required when MAIL_TRANSPORT=smtp.
    SMTP_HOST: z.string().min(1, 'must not be empty').optional(),
    // SMTP port in [1, 65535]. Default: 587.
    SMTP_PORT: z.preprocess(
      (value) => value ?? '587',
      z
        .string()
        .regex(/^\d+$/)
        .transform((value) => Number.parseInt(value, 10))
        .refine((value) => value >= 1 && value <= 65535),
    ),
    // `true` = implicit TLS (normally port 465). `false` = STARTTLS is
    // required: the mailer sets `requireTLS: true` and never falls back
    // to plaintext. Default: false.
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // SMTP credentials. Both are optional together (no auth when absent);
    // setting only one is a startup error.
    SMTP_USER: z.string().min(1, 'must not be empty').optional(),
    SMTP_PASSWORD: z.string().min(1, 'must not be empty').optional(),
    // Sender shown on sign-in mails, e.g. `Zilar <no-reply@example.com>`.
    // Required when MAIL_TRANSPORT=smtp.
    MAIL_FROM: z.string().min(1, 'must not be empty').optional(),
    // Optional Reply-To header for sign-in mails.
    MAIL_REPLY_TO: z.string().min(1, 'must not be empty').optional(),
    // Explicit opt-in that lets a single-admin private install run with
    // MAIL_TRANSPORT=console in production. The server then logs a loud
    // startup warning and the codes appear in the log. Off by default and
    // unsuitable for anyone but the operator.
    MAIL_ALLOW_CONSOLE_IN_PRODUCTION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Agent gateway (T-0034): when true, the server keeps every active AI
    // online over XMPP and replies to owner DMs. Off by default; enabling it
    // is one env line.
    AGENT_GATEWAY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Action demo adapter (T-0093): when true, the harmless `demo.echo`
    // adapter is registered so a DM owner can prove the `request_action`
    // tool end-to-end without a real integration. Off by default so
    // production behaviour is unchanged.
    ACTION_DEMO_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Runner hub (T-0071): off by default. When enabled, the server accepts
    // tunnel connections from approved machines on RUNNER_HUB_PORT (default
    // 3189) bound to 127.0.0.1. The HTTP-only gateway requirement is checked
    // in index.ts once the LiteLLM base URL is known.
    RUNNER_HUB_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Routines scheduler (T-0104): when true, `index.ts` starts the
    // scheduler that fires due routines. Off by default; enabling it also
    // needs a tool runner (the sandbox wiring), otherwise the scheduler
    // stays off with one warning.
    ROUTINES_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // AI-built tools and routines (T-0105): when true, `index.ts` builds
    // the real sandbox runner and registers the tool/routine adapters in
    // the action registry (next to the demo adapter when it is on), and
    // passes the runner to the tools routes and the routines scheduler.
    // Off by default: no adapters, no runner, and manual runs answer 501
    // `runner_unavailable`.
    TOOLS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Gateway-level web tools for AIs (T-0125): `web.fetch`,
    // `web.wikipedia`, `web.price`, `web.feed` and a best-effort
    // `web.search`. Keyless, no account: pages, Wikipedia, RSS/Atom
    // feeds and market prices work with nothing to sign up for. Off by
    // default: no adapters are registered.
    WEB_TOOLS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Model-side tool rounds (T-0106): how many tool rounds one AI turn
    // may run. Integer 1 to 10. Unset = 1 when `TOOLS_ENABLED` is off
    // (today's behaviour, byte for byte) and 6 when it is on. Set
    // explicitly to force either value whatever the flag says.
    AGENT_TOOL_MAX_ROUNDS: z.preprocess(
      (value) => value ?? '',
      z
        .string()
        .regex(/^([1-9]|10)?$/)
        .transform((value) => (value === '' ? undefined : Number.parseInt(value, 10))),
    ),
    // The search backend behind the port (T-0125): `duckduckgo-html`
    // parses one DuckDuckGo HTML page per call and may be blocked or
    // change its markup at any time; `none` unregisters `web.search`.
    WEB_SEARCH_PROVIDER: z.enum(['duckduckgo-html', 'none']).default('duckduckgo-html'),
    RUNNER_HUB_PORT: z.preprocess(
      (value) => value ?? '3189',
      z
        .string()
        .regex(/^\d+$/)
        .transform((value) => Number.parseInt(value, 10))
        .refine((value) => value >= 1 && value <= 65535),
    ),
  })
  .superRefine((value, ctx) => {
    const entries = [
      value.GITHUB_APP_ID,
      value.GITHUB_APP_PRIVATE_KEY,
      value.GITHUB_APP_INSTALLATION_ID,
    ];
    const present = entries.map((entry) => entry !== undefined);
    if (present.some(Boolean) && !present.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID must be set together',
      });
    }
    checkMailConfig(value, ctx);
  })
  .transform((value) => ({
    ...value,
    MAIL_TRANSPORT:
      value.MAIL_TRANSPORT ?? (value.NODE_ENV === 'production' ? undefined : 'console'),
    BETTER_AUTH_URL: value.BETTER_AUTH_URL ?? value.PUBLIC_URL,
    // Unset = 1 when tools are off (today's behaviour), 6 when on.
    AGENT_TOOL_MAX_ROUNDS: value.AGENT_TOOL_MAX_ROUNDS ?? (value.TOOLS_ENABLED ? 6 : 1),
  }));

export type ServerConfig = z.infer<typeof serverConfigSchema> & {
  xmpp: XmppConfig;
};

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`),
// which a bare `.min(1).optional()` would reject. For the optional mail
// settings an empty value means "not set".
const EMPTY_MEANS_UNSET_KEYS = [
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
  const normalized = { ...env };
  for (const key of EMPTY_MEANS_UNSET_KEYS) {
    if (normalized[key] === '') {
      delete normalized[key];
    }
  }
  return normalized;
}

export function loadServerConfig(rawEnv: Record<string, string | undefined>): ServerConfig {
  const env = emptyMailSettingsAsUnset(rawEnv);
  const result = serverConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(formatIssues(result.error));
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

  return { ...result.data, xmpp };
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

// Mail transport rules (T-0128). Every issue message names the variable and
// states what is wrong; values are never included, so SMTP_PASSWORD can
// never leak through a configuration error. The custom issues use
// `MAIL_TRANSPORT` as the path so `formatIssues` groups them there.
function checkMailConfig(
  value: {
    NODE_ENV: 'development' | 'test' | 'production';
    MAIL_TRANSPORT?: 'console' | 'smtp' | undefined;
    SMTP_HOST?: string | undefined;
    SMTP_USER?: string | undefined;
    SMTP_PASSWORD?: string | undefined;
    MAIL_FROM?: string | undefined;
    MAIL_REPLY_TO?: string | undefined;
    MAIL_ALLOW_CONSOLE_IN_PRODUCTION: boolean;
  },
  ctx: z.core.$RefinementCtx,
): void {
  const fail = (message: string): void => {
    ctx.addIssue({ code: 'custom', message, path: ['MAIL_TRANSPORT'] });
  };

  if (value.MAIL_TRANSPORT === 'smtp') {
    if (value.SMTP_HOST === undefined) {
      fail('SMTP_HOST is required when MAIL_TRANSPORT=smtp');
    }
    if (value.MAIL_FROM === undefined) {
      fail('MAIL_FROM is required when MAIL_TRANSPORT=smtp');
    }
    const userSet = value.SMTP_USER !== undefined;
    const passwordSet = value.SMTP_PASSWORD !== undefined;
    if (userSet !== passwordSet) {
      fail('SMTP_USER and SMTP_PASSWORD must be set together');
    }
    for (const [name, mailbox] of [
      ['MAIL_FROM', value.MAIL_FROM],
      ['MAIL_REPLY_TO', value.MAIL_REPLY_TO],
    ] as const) {
      if (mailbox !== undefined && !isMailbox(mailbox)) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must be a valid mailbox (for example: Zilar <no-reply@example.com>)`,
          path: [name],
        });
      }
    }
  }
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

function formatIssues(error: z.ZodError): string {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const issue of error.issues) {
    const name = issue.path.join('.') || 'env';
    const detail = `${name} (${reasonFor(issue)})`;
    // One entry per issue so several precise messages survive under one
    // path (for example both SMTP rules); exact duplicates collapse.
    if (!seen.has(detail)) {
      seen.add(detail);
      details.push(detail);
    }
  }
  return `Invalid server configuration: ${details.join(', ')}`;
}

function reasonFor(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return 'missing';
  }
  // superRefine issues carry an exact message (for example the mail rules
  // naming SMTP_HOST); keep it so operators know what to fix. These
  // messages are written in code and never include a value, so a long
  // message cannot leak a secret.
  if (issue.code === 'custom' && typeof issue.message === 'string' && issue.message.length > 0) {
    return issue.message;
  }
  return 'invalid';
}
