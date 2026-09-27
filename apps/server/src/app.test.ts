import { describe, expect, it } from 'vitest';
import { protocolVersion } from '@galena/protocol';
import { app } from './app';
import { serverVersion } from './version';

describe('GET /health', () => {
  it('returns ok with name, version and protocolVersion', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      name: 'galena-server',
      version: serverVersion,
      protocolVersion,
    });
  });

  it('exposes a semver server version', () => {
    expect(serverVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
