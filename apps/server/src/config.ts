import { z } from 'zod';

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

const serverConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: portSchema,
    DATABASE_URL: databaseUrlSchema,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().optional(),
  })
  .transform((value) => ({
    ...value,
    BETTER_AUTH_URL: value.BETTER_AUTH_URL ?? value.PUBLIC_URL,
  }));

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const result = serverConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(formatIssues(result.error));
  }
  return result.data;
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
