import { z } from 'zod';

// Spike-only config, read from the environment next to the main config.
// Everything is optional so the server boots without the spike; the route
// and the component stay off unless PUSH_SPIKE_ENABLED=true.
const spikeEnvSchema = z.object({
  PUSH_SPIKE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
  PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  PUSH_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  PUSH_VAPID_SUBJECT: z.string().min(1).optional(),
});

export type PushSpikeConfig = z.infer<typeof spikeEnvSchema>;

export function loadPushSpikeConfig(env: Record<string, string | undefined>): PushSpikeConfig {
  return spikeEnvSchema.parse(env);
}
