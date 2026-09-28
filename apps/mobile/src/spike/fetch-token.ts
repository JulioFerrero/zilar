// The one network call the real app makes before connecting XMPP:
// `POST /api/xmpp/token` returns the short-lived JWT plus the service and
// domain to connect to. The mobile app has no auth yet (that is a later task),
// so this spike also supports pasting a JID + token directly. This helper is
// the production-shaped path, kept here so the next task can reuse it, and so
// it can be unit-tested with a mocked fetch.

export type XmppTokenResponse = {
  jid: string;
  token: string;
  expiresAt: string;
  service: string;
  domain: string;
  mucDomain: string;
};

export class XmppTokenError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'XmppTokenError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isXmppTokenResponse(value: unknown): value is XmppTokenResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value['jid'] === 'string' &&
    typeof value['token'] === 'string' &&
    typeof value['expiresAt'] === 'string' &&
    typeof value['service'] === 'string' &&
    typeof value['domain'] === 'string' &&
    typeof value['mucDomain'] === 'string'
  );
}

export async function requestXmppToken(
  apiUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XmppTokenResponse> {
  const response = await fetchImpl(`${apiUrl}/api/xmpp/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
    },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body['error'] === 'object'
        ? (body['error'] as { message?: unknown })['message']
        : undefined;
    throw new XmppTokenError(
      response.status,
      typeof message === 'string' ? message : `POST /api/xmpp/token failed with ${response.status}`,
    );
  }

  if (!isXmppTokenResponse(body)) {
    throw new XmppTokenError(response.status, 'POST /api/xmpp/token returned an unexpected shape');
  }

  return body;
}
