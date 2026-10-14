import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DeskRegistry,
  createRegistryClient,
  createRegistryServer,
  type RegistryServer,
} from './registry';

describe('egress registry socket', () => {
  let directory: string;
  let server: RegistryServer;
  const registry = new DeskRegistry();

  beforeEach(async () => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'egress-registry-'));
    registry.clear();
    server = createRegistryServer(registry, path.join(directory, 'egress.sock'));
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('accepts a desk id at the maximum length deskName can build', async () => {
    const deskId = `desk-${'a'.repeat(64)}-${'b'.repeat(64)}`;
    expect(deskId).toHaveLength(134);
    await createRegistryClient(server.socketPath).register({
      deskId,
      secret: 's3cret',
      allowedHosts: null,
    });
    expect(registry.authenticate(deskId, 's3cret')).not.toBeNull();
  });

  it('rejects the caller when the registry refuses the request', async () => {
    const deskId = `desk-${'a'.repeat(200)}`;
    await expect(
      createRegistryClient(server.socketPath).register({
        deskId,
        secret: 's3cret',
        allowedHosts: null,
      }),
    ).rejects.toThrow();
  });
});
