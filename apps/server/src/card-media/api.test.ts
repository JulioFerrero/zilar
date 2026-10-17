// T-1853: the card media read route is a permission surface. A group card is
// readable by that room's members; a DM card only by the AI's owner; an
// unknown id, an invisible room and a missing file answer the same 404.

import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_MUC_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { seedAi } from '../test-support/seed';
import { cardMediaPath, storeCardMedia } from './service';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe('GET /api/card-media/:id', () => {
  let context: TestContext;
  let app: TestApp;
  let storageDir: string;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'zilar-card-media-route-'));
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      cardMediaStorageDir: storageDir,
    });
  });

  afterEach(async () => {
    await context.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function roomJidOf(groupId: string): Promise<string> {
    const [group] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`
          SELECT room_localpart FROM "groups" WHERE id = ${groupId}
        `;
      }),
    );
    if (group === undefined) {
      throw new Error('group was not created');
    }
    return `${group.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
  }

  function read(id: string, cookie?: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/card-media/${id}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
  }

  it('serves a group card to a member and hides it from everyone else', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id]);
    const { aiId } = await seedAi(context, owner.id);
    const roomJid = await roomJidOf(group.id);

    const card = await storeCardMedia(context.db, storageDir, {
      aiId,
      roomJid,
      mime: 'image/png',
      name: 'card.png',
      bytes: PNG_BYTES,
    });

    // No session: the route is not public.
    expect((await read(card.id)).status).toBe(401);

    // A member gets the bytes and the safe headers.
    const served = await read(card.id, member.cookie);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('content-length')).toBe(String(PNG_BYTES.byteLength));
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(served.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(served.headers.get('etag')).toBe(`"${card.id}"`);
    expect(served.headers.get('content-disposition')).toBeNull();

    // A signed-in non-member and an unknown id answer the same 404.
    const denied = await read(card.id, stranger.cookie);
    const unknown = await read('00000000-0000-4000-8000-000000000000', stranger.cookie);
    expect(denied.status).toBe(404);
    expect(unknown.status).toBe(404);
    const deniedBody = (await denied.json()) as {
      error: { code: string; message: string };
    };
    const unknownBody = (await unknown.json()) as {
      error: { code: string; message: string };
    };
    expect(unknownBody.error.code).toBe(deniedBody.error.code);
    expect(unknownBody.error.message).toBe(deniedBody.error.message);
    expect(deniedBody.error.code).toBe('not_found');
    expect(deniedBody.error.message).toBe('Not found');

    // A row whose file is gone answers the same 404.
    const orphan = await storeCardMedia(context.db, storageDir, {
      aiId,
      roomJid,
      mime: 'image/png',
      name: 'gone.png',
      bytes: PNG_BYTES,
    });
    await unlink(cardMediaPath(storageDir, orphan));
    const missing = await read(orphan.id, member.cookie);
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as typeof deniedBody;
    expect(missingBody.error.code).toBe(deniedBody.error.code);
    expect(missingBody.error.message).toBe(deniedBody.error.message);

    // A non-image is an attachment with a sanitised filename.
    const attachment = await storeCardMedia(context.db, storageDir, {
      aiId,
      roomJid,
      mime: 'application/pdf',
      name: 'card "final".pdf',
      bytes: PDF_BYTES,
    });
    const downloaded = await read(attachment.id, member.cookie);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('application/pdf');
    expect(downloaded.headers.get('content-disposition')).toBe(
      'attachment; filename="card final.pdf"',
    );

    // A DM card is readable only by the AI's owner, even for a group member.
    const dmOwner = await contactOf(context, app, owner.id, 'dm-owner@example.com');
    const dmAi = await seedAi(context, dmOwner.id);
    const dmCard = await storeCardMedia(context.db, storageDir, {
      aiId: dmAi.aiId,
      roomJid: dmAi.jid,
      mime: 'image/png',
      name: 'dm-card.png',
      bytes: PNG_BYTES,
    });
    expect((await read(dmCard.id, dmOwner.cookie)).status).toBe(200);
    expect((await read(dmCard.id, member.cookie)).status).toBe(404);
  });
});
