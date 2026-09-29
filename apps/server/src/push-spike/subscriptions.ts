import { z } from 'zod';

// The browser's PushSubscription JSON (Web Push API), validated at the
// route boundary. Stored only in memory for the spike (Map keyed by node);
// the production task (T-0119) persists it in `push_subscriptions`.
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

export type StoredSubscription = {
  userId: string;
  node: string;
  subscription: WebPushSubscription;
  createdAt: Date;
};

export type SubscriptionStore = {
  save(entry: StoredSubscription): void;
  byNode(node: string): StoredSubscription | undefined;
  byUser(userId: string): StoredSubscription[];
  remove(node: string): boolean;
  removeByUser(userId: string): number;
};

export function createMemorySubscriptionStore(
  now: () => Date = () => new Date(),
): SubscriptionStore {
  const byNode = new Map<string, StoredSubscription>();
  return {
    save(entry: StoredSubscription): void {
      void now;
      byNode.set(entry.node, entry);
    },
    byNode(node: string): StoredSubscription | undefined {
      return byNode.get(node);
    },
    byUser(userId: string): StoredSubscription[] {
      const result: StoredSubscription[] = [];
      for (const entry of byNode.values()) {
        if (entry.userId === userId) {
          result.push(entry);
        }
      }
      return result;
    },
    remove(node: string): boolean {
      return byNode.delete(node);
    },
    removeByUser(userId: string): number {
      let removed = 0;
      for (const [node, entry] of byNode) {
        if (entry.userId === userId) {
          byNode.delete(node);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
