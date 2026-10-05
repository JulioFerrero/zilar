import { z } from 'zod';

// The browser's PushSubscription JSON (Web Push API), validated at the route
// boundary before anything is stored.
export const WebPushKeysSchema = z.object({
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
});

export const WebPushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: WebPushKeysSchema,
});

export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

// A short human label for the device list ("Pixel 8 · Chrome"), supplied by
// the web app from the user agent. Free text, capped, never trusted.
export const UserAgentSchema = z.string().min(1).max(256);
