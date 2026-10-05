import { z } from 'zod';

// Push (web push through ejabberd's mod_push) configuration. Everything is
// optional so the server boots without push; the routes answer 404 and the
// component stays off unless `PUSH_ENABLED=true`. When enabled, the VAPID
// keys, the component credentials and the storage key must all be present —
// the wiring in `app.ts`/`index.ts` refuses to start half-configured.
const pushEnvSchema = z.object({
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  PUSH_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  PUSH_VAPID_SUBJECT: z.string().min(1).optional(),
  PUSH_COMPONENT_JID: z.string().min(1).optional(),
  PUSH_COMPONENT_SECRET: z.string().min(1).optional(),
  PUSH_COMPONENT_PORT: z.preprocess(
    (value) => value ?? '5347',
    z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value >= 1 && value <= 65535),
  ),
  // Host of ejabberd's XEP-0114 component listener (T-0172). Compose sets
  // `ejabberd` (the service name); dev keeps the 127.0.0.1 default. A
  // scheme, port or path would build a broken service URL, so anything but
  // letters, digits, dots and hyphens fails startup with the fixed message
  // below (the value is never echoed).
  PUSH_COMPONENT_HOST: z.preprocess(
    (value) => value ?? '127.0.0.1',
    z
      .string()
      .regex(
        /^[A-Za-z0-9.-]+$/,
        'PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)',
      ),
  ),
  // Seals the Web Push subscription keys at rest (AES-256-GCM). At least 32
  // characters, like the provider-key master key. Rotating it orphans
  // existing rows: the component drops (never sends from) undecryptable
  // devices, and the device list invites re-enabling.
  PUSH_STORAGE_KEY: z.string().min(32).optional(),
});

export type PushConfig = z.infer<typeof pushEnvSchema>;

// Docker Compose renders an unset optional as an empty string (`${VAR:-}`),
// which the schema would reject: an empty `PUSH_*` value means "not set".
function emptyPushSettingsAsUnset(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...env };
  for (const key of Object.keys(normalized)) {
    if (key.startsWith('PUSH_') && normalized[key] === '') {
      delete normalized[key];
    }
  }
  return normalized;
}

export function loadPushConfig(env: Record<string, string | undefined>): PushConfig {
  return pushEnvSchema.parse(emptyPushSettingsAsUnset(env));
}

// Like the server's `loadServerConfigOrExit`: an invalid push host refuses
// to boot with one fixed message that names the variable, never its value
// (a secret could be pasted there by mistake). Called before `createApp` so
// no route or component starts on a broken config.
export function loadPushConfigOrExit(env: Record<string, string | undefined>): PushConfig {
  try {
    return loadPushConfig(env);
  } catch (error) {
    const hostInvalid =
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path.includes('PUSH_COMPONENT_HOST'));
    if (!hostInvalid) {
      throw error;
    }
    console.error(
      'Invalid push configuration: PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)',
    );
    process.exit(1);
  }
}

// The enabled config, or null with the reason named when `PUSH_ENABLED=true`
// but a required value is missing. Values are never echoed: the reason names
// the variable, not its content.
export function pushConfigError(config: PushConfig): string | null {
  if (!config.PUSH_ENABLED) {
    return null;
  }
  const missing: string[] = [];
  if (config.PUSH_VAPID_PUBLIC_KEY === undefined) {
    missing.push('PUSH_VAPID_PUBLIC_KEY');
  }
  if (config.PUSH_VAPID_PRIVATE_KEY === undefined) {
    missing.push('PUSH_VAPID_PRIVATE_KEY');
  }
  if (config.PUSH_VAPID_SUBJECT === undefined) {
    missing.push('PUSH_VAPID_SUBJECT');
  }
  if (config.PUSH_COMPONENT_JID === undefined) {
    missing.push('PUSH_COMPONENT_JID');
  }
  if (config.PUSH_COMPONENT_SECRET === undefined) {
    missing.push('PUSH_COMPONENT_SECRET');
  }
  if (config.PUSH_STORAGE_KEY === undefined) {
    missing.push('PUSH_STORAGE_KEY');
  }
  return missing.length === 0 ? null : `push is enabled but missing: ${missing.join(', ')}`;
}
