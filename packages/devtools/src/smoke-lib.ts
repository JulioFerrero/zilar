export const XMPP_FRAMING_NAMESPACE = 'urn:ietf:params:xml:ns:xmpp-framing';

export type OpenFrameReply = {
  from: string | null;
};

// RFC 7395: the client starts the WebSocket stream with an <open/> frame.
export function buildOpenFrame(domain: string): string {
  if (domain.trim() === '') {
    throw new Error('domain must not be empty');
  }
  return `<open xmlns='${XMPP_FRAMING_NAMESPACE}' to='${domain}' version='1.0'/>`;
}

// Returns the server's <open/> reply, or null when the payload is not one.
export function parseOpenFrame(payload: string): OpenFrameReply | null {
  const match = /^<open\b([^>]*?)\/?>/.exec(payload.trim());
  if (match === null) {
    return null;
  }
  const attributes = match[1] ?? '';
  const namespace = new RegExp(`xmlns=['"]${XMPP_FRAMING_NAMESPACE}['"]`);
  if (!namespace.test(attributes)) {
    return null;
  }
  const from = /\bfrom=['"]([^'"]+)['"]/.exec(attributes);
  return { from: from === null ? null : (from[1] ?? null) };
}

export function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}
