import type { MockData } from '../../state';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';

// The real store's boot asks for an XMPP token before it opens the core
// (`client-core/store/lifecycle.ts`). The fake core ignores the token; only
// `service`, `domain` and `mucDomain` are read (the media allow-list). Web's
// dispatcher answered this inline before (T-0946); the shared backend owns it
// now, so both apps get it from the one seed-backed source.
const XMPP_TOKEN = {
  jid: 'you@zilar.test',
  token: 'mock-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  service: 'wss://mock.zilar.test/xmpp-ws/ws',
  domain: 'zilar.test',
  mucDomain: 'rooms.zilar.test',
};

/** `POST /xmpp/token` (the boot token); a `GET` is answered too, like the mock. */
export function handleXmppToken(_data: MockData, request: MockHttpRequest): Response | undefined {
  const [first, second] = request.segments;
  if (request.segments.length !== 2 || first !== 'xmpp' || second !== 'token') {
    return undefined;
  }
  if (request.method !== 'POST' && request.method !== 'GET') {
    return undefined;
  }
  return jsonResponse(XMPP_TOKEN);
}
