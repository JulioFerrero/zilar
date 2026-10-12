import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

// A 24-byte PNG header (magic, IHDR length, `IHDR`, 64x64). The avatar probe
// reads the header only, so this is enough to store and serve a picture.
const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40,
]);

describe('avatar access (T-1174, SEC-8)', () => {
  let context: TestContext;
  let app: TestApp;
  let storageDir: string;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = mkdtempSync(join(tmpdir(), 'zilar-avatars-'));
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      avatarStorageDir: storageDir,
    });
  });

  afterEach(async () => {
    await context.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  async function createGroup(
    cookie: string,
    title: string,
    memberIds: string[],
    extra: { visibility?: 'private' | 'public'; handle?: string } = {},
  ) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds, ...extra }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function uploadGroupAvatar(cookie: string, groupId: string): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/avatars/group/${groupId}`, {
      method: 'PUT',
      headers: { cookie },
      body: PNG_HEADER,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { url: string }).url;
  }

  it('serves a private group picture to a member and a public one to a non-member', async () => {
    const owner = await bootstrapUser(context, app, 'avatar-owner@example.com');
    const member = await contactOf(context, app, owner.id, 'avatar-member@example.com');
    const stranger = await bootstrapUser(context, app, 'avatar-stranger@example.com');
    const group = await createGroup(owner.cookie, 'Private team', [member.id]);

    const url = await uploadGroupAvatar(owner.cookie, group.id);

    const memberRead = await app.request(`${TEST_BASE_URL}${url}`, {
      headers: { cookie: member.cookie },
    });
    expect(memberRead.status).toBe(200);

    // A private group's non-member and an unknown id answer the same 404.
    const strangerRead = await app.request(`${TEST_BASE_URL}${url}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(strangerRead.status).toBe(404);

    const unknownRead = await app.request(
      `${TEST_BASE_URL}/api/avatars/00000000-0000-0000-0000-000000000000`,
      { headers: { cookie: stranger.cookie } },
    );
    expect(unknownRead.status).toBe(404);

    // A public group's picture stays readable by a non-member: Explore,
    // people/group search and the `/@handle` join card show it.
    const publicGroup = await createGroup(owner.cookie, 'Public team', [], {
      visibility: 'public',
      handle: 'publicavatars',
    });
    const publicUrl = await uploadGroupAvatar(owner.cookie, publicGroup.id);
    const publicRead = await app.request(`${TEST_BASE_URL}${publicUrl}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(publicRead.status).toBe(200);
  });
});
