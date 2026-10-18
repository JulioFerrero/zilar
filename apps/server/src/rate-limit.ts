export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimiter {
  allow: (key: string) => boolean;
  readonly size: number;
}

// In-memory and per process: with several server processes a caller gets the limit per
// process, which is acceptable for short-lived, low-stakes caps.
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`createRateLimiter needs max >= 1, got ${max}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`createRateLimiter needs windowMs > 0, got ${windowMs}`);
  }
  const attempts = new Map<string, number[]>();
  let lastPrune = Number.NEGATIVE_INFINITY;

  return {
    allow(key: string): boolean {
      const current = now();
      const cutoff = current - windowMs;
      // Prune expired keys so the map does not grow with every caller who ever hit
      // the route; at most once per window, since entries are filtered per call anyway.
      if (current - lastPrune >= windowMs) {
        lastPrune = current;
        for (const [other, times] of attempts) {
          if (other === key) {
            continue;
          }
          const fresh = times.filter((time) => time > cutoff);
          if (fresh.length === 0) {
            attempts.delete(other);
          } else if (fresh.length !== times.length) {
            attempts.set(other, fresh);
          }
        }
      }
      const recent = (attempts.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(current);
      attempts.set(key, recent);
      return true;
    },
    get size(): number {
      return attempts.size;
    },
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// One budget per route, grouped by the module that spends it.
export const RATE_LIMITS = {
  // agents
  aiMemoryWrite: { max: 60, windowMs: MINUTE },
  // app
  blockRead: { max: 120, windowMs: MINUTE },
  blockWrite: { max: 30, windowMs: 10 * MINUTE },
  contactsWrite: { max: 30, windowMs: 10 * MINUTE },
  directory: { max: 30, windowMs: 10 * MINUTE },
  pinsWrite: { max: 60, windowMs: MINUTE },
  // auth
  authInvite: { max: 10, windowMs: DAY },
  authMe: { max: 10, windowMs: 10 * MINUTE },
  export: { max: 1, windowMs: HOUR },
  // avatars
  avatarRead: { max: 600, windowMs: 10 * MINUTE },
  avatarUpload: { max: 10, windowMs: HOUR },
  // backgrounds
  backgroundUpload: { max: 20, windowMs: HOUR },
  // card-media
  cardMediaRead: { max: 600, windowMs: 10 * MINUTE },
  // chat-folders
  chatFoldersWrite: { max: 60, windowMs: MINUTE },
  // chat-prefs
  chatPrefsWrite: { max: 60, windowMs: MINUTE },
  // chats
  chatHistoryWrite: { max: 60, windowMs: MINUTE },
  chatRead: { max: 600, windowMs: 10 * MINUTE },
  chatReply: { max: 60, windowMs: 10 * MINUTE },
  // connections
  connectionTest: { max: 5, windowMs: MINUTE },
  connectionWrite: { max: 10, windowMs: MINUTE },
  // contact-requests
  byHandle: { max: 30, windowMs: 10 * MINUTE },
  contactRequestCreate: { max: 20, windowMs: DAY },
  contactRequestRead: { max: 60, windowMs: MINUTE },
  userSearch: { max: 120, windowMs: 10 * MINUTE },
  // files
  files: { max: 600, windowMs: MINUTE },
  // gifs
  gif: { max: 30, windowMs: MINUTE },
  gifMedia: { max: 600, windowMs: MINUTE },
  // groups
  groupCreate: { max: 20, windowMs: HOUR },
  publicJoin: { max: 30, windowMs: HOUR },
  roleChange: { max: 30, windowMs: HOUR },
  // handles
  handleCheck: { max: 30, windowMs: 10 * MINUTE },
  handleClaim: { max: 10, windowMs: DAY },
  // integrations
  integrationsEmail: { max: 5, windowMs: 10 * MINUTE },
  integrationsTelegram: { max: 10, windowMs: 10 * MINUTE },
  // invite-links
  joinPerIp: { max: 60, windowMs: HOUR },
  joinPerUser: { max: 20, windowMs: HOUR },
  joinPreviewPerUser: { max: 120, windowMs: HOUR },
  // machines
  machineWrite: { max: 30, windowMs: MINUTE },
  pairGlobal: { max: 30, windowMs: MINUTE },
  pairIp: { max: 10, windowMs: MINUTE },
  pairingCode: { max: 10, windowMs: HOUR },
  // media
  linkPreview: { max: 60, windowMs: MINUTE },
  media: { max: 30, windowMs: MINUTE },
  // message-blocks
  blocksRespond: { max: 120, windowMs: MINUTE },
  // push
  pushPreview: { max: 120, windowMs: MINUTE },
  pushSettings: { max: 60, windowMs: MINUTE },
  pushSubscribe: { max: 30, windowMs: MINUTE },
  pushTest: { max: 5, windowMs: 10 * MINUTE },
  // search
  search: { max: 30, windowMs: MINUTE },
  // setup
  setup: { max: 5, windowMs: 10 * MINUTE },
  // stickers
  stickerUpload: { max: 60, windowMs: HOUR },
  telegramImport: { max: 3, windowMs: HOUR },
  // tools
  toolRun: { max: 5, windowMs: MINUTE },
  toolRunsPerHour: { max: 6, windowMs: HOUR },
  // topics
  topicCreate: { max: 30, windowMs: HOUR },
  topicJoin: { max: 60, windowMs: HOUR },
  topicPreview: { max: 120, windowMs: HOUR },
  // voice-transcription
  voiceTranscript: { max: 10, windowMs: 10 * MINUTE },
  voiceTranscriptOwner: { max: 10, windowMs: 10 * MINUTE },
  // web-tools
  webActionsPerHour: { max: 30, windowMs: HOUR },
  // xmpp
  token: { max: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, { max: number; windowMs: number }>;

export function limiter(name: keyof typeof RATE_LIMITS, now: () => number = Date.now): RateLimiter {
  return createRateLimiter({ ...RATE_LIMITS[name], now });
}
