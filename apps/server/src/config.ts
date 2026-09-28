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
    LITELLM_MASTER_KEY: z.string().min(1).optional(),
  })
  .transform((value) => ({
    ...value,
    BETTER_AUTH_URL: value.BETTER_AUTH_URL ?? value.PUBLIC_URL,
  }));

export type ServerConfig = z.infer<typeof serverConfigSchema> & {
  xmpp: XmppConfig;
};

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
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

function formatIssues(error: z.ZodError): string {
  const reasons = new Map<string, string>();
  for (const issue of error.issues) {
    const name = issue.path.join('.') || 'env';
    if (!reasons.has(name)) {
      reasons.set(name, reasonFor(issue));
    }
  }
  const details = [...reasons].map(([name, reason]) => `${name} (${reason})`);
  return `Invalid server configuration: ${details.join(', ')}`;
}

function reasonFor(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return 'missing';
  }
  return 'invalid';
}
