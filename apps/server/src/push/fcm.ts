import { Exit, Schema } from 'effect';
import type { FcmFetch, FcmTokenProvider } from './fcm-token';

// The FCM HTTP v1 sender (native-push-plan.md §2.4): a data-only,
// high-priority message carrying ids only, so a headless background task can
// run and FCM never draws a notification the app cannot enrich.

const FCM_HOST = 'https://fcm.googleapis.com';

// The chat kind a wake carries, so the phone posts each notification on the
// matching Android notification channel (T-1302): "Direct messages", "Groups"
// or "Channels". Mirrors the mobile `PushChatKind`.
export type PushChatKind = 'dm' | 'group' | 'channel';

export interface FcmWakeData {
  chatId: string;
  chatKind: PushChatKind;
  messageId?: string;
  serverId: string;
}

export interface FcmSender {
  send(token: string, data: FcmWakeData): Promise<{ gone: boolean }>;
}

export interface FcmSenderInput {
  projectId: string;
  tokens: FcmTokenProvider;
  /** Injected so tests never touch Google; the default is global `fetch`. */
  fetch?: FcmFetch;
}

// Carries the HTTP status and the FCM error code only. The registration token,
// the access token and the request body are never put on the error.
export class FcmSendError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`FCM send failed (HTTP ${status}${code === null ? '' : `, ${code}`})`);
    this.name = 'FcmSendError';
    this.status = status;
    this.code = code;
  }
}

// Exported so the test can assert the exact wire body: data only, ids only,
// `priority: "high"`, `ttl: "3600s"`, and no `notification` block. A wake with
// no message id (the archive row carried none) leaves `messageId` out entirely.
export function fcmMessageBody(token: string, data: FcmWakeData) {
  const messageData: {
    chatId: string;
    chatKind: PushChatKind;
    messageId?: string;
    serverId: string;
  } = {
    chatId: data.chatId,
    chatKind: data.chatKind,
    serverId: data.serverId,
  };
  if (data.messageId !== undefined) {
    messageData.messageId = data.messageId;
  }
  return {
    message: {
      token,
      data: messageData,
      android: { priority: 'high' as const, ttl: '3600s' as const },
    },
  };
}

function messagesEndpoint(projectId: string): string {
  return `${FCM_HOST}/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
}

const errorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    status: Schema.optional(Schema.String),
    details: Schema.optional(
      Schema.Array(Schema.Struct({ errorCode: Schema.optional(Schema.String) })),
    ),
  }),
});

// The FCM error code lives in `error.details[].errorCode`; fall back to
// `error.status`. Only these code strings are read — never the message text.
async function readErrorCode(response: Response): Promise<string | null> {
  const raw: unknown = await response.json().catch(() => null);
  const exit = Schema.decodeUnknownExit(errorResponseSchema)(raw);
  if (!Exit.isSuccess(exit)) {
    return null;
  }
  const { status, details } = exit.value.error;
  if (details !== undefined) {
    for (const detail of details) {
      if (detail.errorCode !== undefined) {
        return detail.errorCode;
      }
    }
  }
  return status ?? null;
}

// `UNREGISTERED` (HTTP 404) means the token is dead: the caller drops the
// device. Every other non-2xx is a send failure that keeps the device.
export function createFcmSender(input: FcmSenderInput): FcmSender {
  const fetchImpl: FcmFetch = input.fetch ?? ((url, init) => fetch(url, init));
  return {
    send: async (token, data) => {
      const accessToken = await input.tokens.token();
      const response = await fetchImpl(messagesEndpoint(input.projectId), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(fcmMessageBody(token, data)),
      });
      if (response.ok) {
        return { gone: false };
      }
      const code = await readErrorCode(response);
      if (response.status === 404 || code === 'UNREGISTERED') {
        return { gone: true };
      }
      throw new FcmSendError(response.status, code);
    },
  };
}
