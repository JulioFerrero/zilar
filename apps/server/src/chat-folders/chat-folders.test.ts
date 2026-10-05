import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatFolderSeeds, chatFolders } from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

interface FolderView {
  id: string;
  name: string;
  icon: string;
  position: number;
  includeTypes: string[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

describe('chat folders', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  function listFolders(cookie: string) {
    return app.request(`${TEST_BASE_URL}/api/chat-folders`, { headers: { cookie } });
  }

  function createFolder(cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/chat-folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function patchFolder(cookie: string, id: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/chat-folders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function orderFolders(cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/chat-folders/order`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function deleteFolder(cookie: string, id: string) {
    return app.request(`${TEST_BASE_URL}/api/chat-folders/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
  }

  it('seeds Personal and AIs on the first GET and never again', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');

    const first = await listFolders(alice.cookie);
    expect(first.status).toBe(200);
    const folders = ((await first.json()) as { folders: FolderView[] }).folders;
    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({
      name: 'Personal',
      icon: 'user',
      position: 0,
      includeTypes: ['dm'],
      includeChats: [],
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    });
    expect(folders[1]).toMatchObject({
      name: 'AIs',
      icon: 'bot',
      position: 1,
      includeTypes: ['ai'],
    });
    expect(typeof folders[0]?.id).toBe('string');

    // Deleting every folder does not bring the defaults back.
    for (const folder of folders) {
      expect((await deleteFolder(alice.cookie, folder.id)).status).toBe(200);
    }
    const after = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(after).toEqual([]);
    const stillEmpty = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(stillEmpty).toEqual([]);
    expect(await context.db.select().from(chatFolderSeeds)).toHaveLength(1);
  });

  it('creates folders appended last and returns 201', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const seeded = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;

    const created = await createFolder(alice.cookie, {
      name: 'Work',
      icon: 'briefcase',
      includeTypes: ['group', 'channel'],
      includeChats: ['a@example.com'],
      excludeChats: ['b@example.com'],
      excludeMuted: true,
      excludeRead: true,
    });
    expect(created.status).toBe(201);
    const folder = ((await created.json()) as { folder: FolderView }).folder;
    expect(folder).toMatchObject({
      name: 'Work',
      icon: 'briefcase',
      position: 2,
      includeTypes: ['group', 'channel'],
      includeChats: ['a@example.com'],
      excludeChats: ['b@example.com'],
      excludeMuted: true,
      excludeRead: true,
    });

    const listed = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(listed.map((entry) => entry.id)).toEqual([
      ...seeded.map((entry) => entry.id),
      folder.id,
    ]);
  });

  it('refuses the 21st folder with 409 folder_limit', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    await listFolders(alice.cookie);
    for (let index = 0; index < 18; index += 1) {
      const response = await createFolder(alice.cookie, {
        name: `Folder ${index}`,
        icon: 'folder',
      });
      expect(response.status).toBe(201);
    }
    const over = await createFolder(alice.cookie, { name: 'Too many', icon: 'folder' });
    expect(over.status).toBe(409);
    const body = (await over.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('folder_limit');
    expect(body.error.message).toBe('You can have up to 20 folders.');
  });

  it('rejects invalid bodies with 400', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    await listFolders(alice.cookie);

    expect((await createFolder(alice.cookie, { name: 'x', icon: 'nope' })).status).toBe(400);
    expect(
      (await createFolder(alice.cookie, { name: 'x'.repeat(25), icon: 'folder' })).status,
    ).toBe(400);
    expect((await createFolder(alice.cookie, { name: '   ', icon: 'folder' })).status).toBe(400);
    expect(
      (await createFolder(alice.cookie, { name: 'x', icon: 'folder', includeTypes: ['sms'] }))
        .status,
    ).toBe(400);
    expect(
      (
        await createFolder(alice.cookie, {
          name: 'x',
          icon: 'folder',
          includeTypes: ['dm', 'dm'],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createFolder(alice.cookie, {
          name: 'x',
          icon: 'folder',
          includeChats: ['a@example.com', 'a@example.com'],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createFolder(alice.cookie, {
          name: 'x',
          icon: 'folder',
          includeChats: Array.from({ length: 101 }, (_, index) => `chat${index}@example.com`),
        })
      ).status,
    ).toBe(400);
    expect(
      (await createFolder(alice.cookie, { name: 'x', icon: 'folder', nope: true })).status,
    ).toBe(400);
    expect((await createFolder(alice.cookie, { icon: 'folder' })).status).toBe(400);

    // The failures stored nothing beyond the two seeded defaults.
    expect(await context.db.select().from(chatFolders)).toHaveLength(2);
  });

  it("patches my folder but 404s another user's id", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    const aliceFolders = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const target = aliceFolders[0];
    if (!target) {
      throw new Error('no seeded folders');
    }

    const patched = await patchFolder(alice.cookie, target.id, {
      name: 'Mine',
      icon: 'star',
      excludeMuted: true,
    });
    expect(patched.status).toBe(200);
    const view = ((await patched.json()) as { folder: FolderView }).folder;
    expect(view).toMatchObject({ id: target.id, name: 'Mine', icon: 'star', excludeMuted: true });
    expect(view.includeTypes).toEqual(['dm']);

    expect((await patchFolder(alice.cookie, target.id, {})).status).toBe(400);
    expect((await patchFolder(alice.cookie, target.id, { name: 'y'.repeat(25) })).status).toBe(400);

    // Bob's id is unknown to Alice: same 404 as a random id.
    const bobFolders = (
      (await (await listFolders(bob.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const bobTarget = bobFolders[0];
    if (!bobTarget) {
      throw new Error('no seeded folders for bob');
    }
    expect((await patchFolder(alice.cookie, bobTarget.id, { name: 'Hijack' })).status).toBe(404);
    expect((await patchFolder(alice.cookie, 'missing-id', { name: 'Hijack' })).status).toBe(404);
    // Bob's folder is untouched.
    const again = (
      (await (await listFolders(bob.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(again[0]?.name).toBe('Personal');
  });

  it('reorders exactly and rejects missing, extra and duplicate ids', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const seeded = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const third = (
      (await (await createFolder(alice.cookie, { name: 'Extra', icon: 'star' })).json()) as {
        folder: FolderView;
      }
    ).folder;
    const ids = [seeded[0]?.id ?? '', seeded[1]?.id ?? '', third.id];

    const reversed = await orderFolders(alice.cookie, { ids: [...ids].reverse() });
    expect(reversed.status).toBe(200);
    const folders = ((await reversed.json()) as { folders: FolderView[] }).folders;
    expect(folders.map((entry) => entry.id)).toEqual([...ids].reverse());
    expect(folders.map((entry) => entry.position)).toEqual([0, 1, 2]);

    expect((await orderFolders(alice.cookie, { ids: ids.slice(0, 2) })).status).toBe(400);
    expect((await orderFolders(alice.cookie, { ids: [...ids, 'extra-id'] })).status).toBe(400);
    expect((await orderFolders(alice.cookie, { ids: [ids[0], ids[0], ids[2]] })).status).toBe(400);
    expect((await orderFolders(alice.cookie, { ids: [] })).status).toBe(400);

    // Failed orders leave the order alone.
    const listed = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(listed.map((entry) => entry.id)).toEqual([...ids].reverse());
  });

  it('deletes and closes positions, 404ing unknown and foreign ids', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    const seeded = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const middle = seeded[0];
    if (!middle) {
      throw new Error('no seeded folders');
    }

    expect((await deleteFolder(alice.cookie, 'missing-id')).status).toBe(404);
    const bobFolders = (
      (await (await listFolders(bob.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const bobFirst = bobFolders[0];
    if (!bobFirst) {
      throw new Error('no seeded folders for bob');
    }
    expect((await deleteFolder(alice.cookie, bobFirst.id)).status).toBe(404);

    expect((await deleteFolder(alice.cookie, middle.id)).status).toBe(200);
    const deleted = await deleteFolder(alice.cookie, middle.id);
    expect(deleted.status).toBe(404);
    const listed = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.position).toBe(0);
    expect(listed[0]?.name).toBe('AIs');
    // Bob still has both of his.
    expect(
      ((await (await listFolders(bob.cookie)).json()) as { folders: FolderView[] }).folders,
    ).toHaveLength(2);
  });

  it("never shows another user's folders", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    await listFolders(alice.cookie);
    await listFolders(bob.cookie);
    const aliceFolders = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const bobFolders = (
      (await (await listFolders(bob.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    expect(aliceFolders.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining(bobFolders.map((entry) => entry.id)),
    );
    const rows = await context.db.select().from(chatFolders);
    expect(rows.filter((row) => row.userId === alice.id)).toHaveLength(2);
    expect(rows.filter((row) => row.userId === bob.id)).toHaveLength(2);
  });

  it('rate-limits writes per user after 60', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const seeded = (
      (await (await listFolders(alice.cookie)).json()) as {
        folders: FolderView[];
      }
    ).folders;
    const target = seeded[0];
    if (!target) {
      throw new Error('no seeded folders');
    }
    for (let index = 0; index < 60; index += 1) {
      const response = await patchFolder(alice.cookie, target.id, {
        excludeMuted: index % 2 === 0,
      });
      expect(response.status).toBe(200);
    }
    const limited = await patchFolder(alice.cookie, target.id, { excludeMuted: true });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('answers 401 without a session', async () => {
    const anonymous = await app.request(`${TEST_BASE_URL}/api/chat-folders`);
    expect(anonymous.status).toBe(401);
    const anonymousPost = await app.request(`${TEST_BASE_URL}/api/chat-folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', icon: 'folder' }),
    });
    expect(anonymousPost.status).toBe(401);
    const anonymousOrder = await app.request(`${TEST_BASE_URL}/api/chat-folders/order`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    expect(anonymousOrder.status).toBe(401);
    const anonymousPatch = await app.request(`${TEST_BASE_URL}/api/chat-folders/probe`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(anonymousPatch.status).toBe(401);
    const anonymousDelete = await app.request(`${TEST_BASE_URL}/api/chat-folders/probe`, {
      method: 'DELETE',
    });
    expect(anonymousDelete.status).toBe(401);
  });
});
