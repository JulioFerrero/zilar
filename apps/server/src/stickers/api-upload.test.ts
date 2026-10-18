// T-2005: a multipart sticker upload is buffered by `formData()`, so it is
// only accepted with a valid declared length. A chunked body with no
// Content-Length answers 411 instead of being read whole.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type SignedInUser,
  type TestApp,
  type TestContext,
} from '../test-support';

const BOUNDARY = 'sticker-test-boundary';

function chunkedMultipartRequest(url: string, cookie: string): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="emoji"\r\n\r\nx\r\n--${BOUNDARY}--\r\n`,
        ),
      );
      controller.close();
    },
  });
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      cookie,
    },
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('sticker upload declared length', () => {
  let context: TestContext;
  let app: TestApp;
  let user: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    user = await bootstrapUser(context, app, 'sticker-upload@example.com');
  });

  afterEach(async () => {
    await context.close();
  });

  async function createPack(): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/sticker-packs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: user.cookie },
      body: JSON.stringify({ title: 'Upload', visibility: 'private' }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it('answers 411 for a chunked multipart upload with no Content-Length', async () => {
    const packId = await createPack();
    const request = chunkedMultipartRequest(
      `${TEST_BASE_URL}/api/sticker-packs/${packId}/stickers`,
      user.cookie,
    );

    const response = await app.request(request);

    expect(response.status).toBe(411);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'length_required' },
    });
  });
});
