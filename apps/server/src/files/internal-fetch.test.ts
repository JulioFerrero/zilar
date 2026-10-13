import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultInternalFetch } from './internal-fetch';

// `defaultInternalFetch` exists because Node's `fetch` drops a `Host` header
// (it is forbidden). These tests run a real `node:http` server that records
// what arrived, proving the helper sends the public host and the Range.
describe('defaultInternalFetch', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const current = server;
    server = undefined;
    if (current === undefined) {
      return;
    }
    current.closeAllConnections();
    await new Promise<void>((resolve) => current.close(() => resolve()));
  });

  it('sends the host and range headers and streams the body through', async () => {
    const seen: { host: string | undefined; range: string | undefined } = {
      host: undefined,
      range: undefined,
    };
    server = createServer((request, response) => {
      seen.host = request.headers.host;
      seen.range = request.headers.range;
      response.setHeader('content-type', 'image/png');
      response.end('png-bytes');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server has no port');
    }

    const response = await defaultInternalFetch(
      `http://127.0.0.1:${address.port}/upload/slot1/photo.png`,
      { host: 'chat.zilar.app', range: 'bytes=0-3' },
    );

    expect(seen.host).toBe('chat.zilar.app');
    expect(seen.range).toBe('bytes=0-3');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await new Response(response.body).text()).toBe('png-bytes');
  });
});
