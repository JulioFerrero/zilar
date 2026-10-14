import net, { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EgressLog, type EgressLogEntry } from './log';
import { createEgressProxy, type EgressProxy } from './proxy';
import { DeskRegistry } from './registry';

const DESK_ID = 'desk-ai1-p1';
const SECRET = 's3cret';
const AUTH = `Basic ${Buffer.from(`${DESK_ID}:${SECRET}`).toString('base64')}`;

/** Sends a raw `CONNECT` and resolves with the status line the proxy writes. */
function connectTo(port: number, target: string, authorization?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    socket.on('connect', () => {
      const request = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`];
      if (authorization !== undefined) {
        request.push(`Proxy-Authorization: ${authorization}`);
      }
      socket.write(`${request.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buffer += String(chunk);
    });
    socket.on('close', () => resolve(buffer));
    socket.on('error', reject);
  });
}

/** Sends a raw plain-HTTP proxy request and resolves with the response text. */
function get(port: number, target: string, authorization?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    socket.on('connect', () => {
      const request = [`GET ${target} HTTP/1.1`, `Host: ${target}`, 'Connection: close'];
      if (authorization !== undefined) {
        request.push(`Proxy-Authorization: ${authorization}`);
      }
      socket.write(`${request.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buffer += String(chunk);
    });
    socket.on('close', () => resolve(buffer));
    socket.on('error', reject);
  });
}

describe('egress proxy', () => {
  let proxy: EgressProxy;
  let port: number;
  const registry = new DeskRegistry();
  const entries: EgressLogEntry[] = [];
  const log = new EgressLog({ write: (line) => entries.push(JSON.parse(line) as EgressLogEntry) });

  beforeEach(async () => {
    entries.length = 0;
    registry.clear();
    registry.register({ deskId: DESK_ID, secret: SECRET, allowedHosts: null });
    proxy = createEgressProxy({
      registry,
      log,
      // Resolving always fails: it keeps the test off the network and still runs
      // after the port check, so the deny reason tells the two ports apart.
      resolver: () => Promise.reject(new Error('no dns in tests')),
    });
    await proxy.listen(0, '127.0.0.1');
    port = (proxy.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await proxy.close();
  });

  it('refuses a CONNECT tunnel to port 80 (443 only)', async () => {
    const response = await connectTo(port, 'example.com:80', AUTH);
    expect(response).toContain('403');
    expect(entries.at(-1)).toMatchObject({ host: 'example.com', allowed: false, reason: 'port' });
  });

  it('lets a CONNECT tunnel to 443 past the port check', async () => {
    const response = await connectTo(port, 'example.com:443', AUTH);
    expect(response).toContain('403');
    expect(entries.at(-1)).toMatchObject({
      host: 'example.com',
      allowed: false,
      reason: 'resolve-failed',
    });
  });

  it('answers 407 without a valid proxy credential', async () => {
    const response = await connectTo(port, 'example.com:443');
    expect(response).toContain('407');
  });

  it('refuses a plain-HTTP forward to port 443 (80 only)', async () => {
    const response = await get(port, 'http://example.com:443/x', AUTH);
    expect(response).toContain('403');
    expect(entries.at(-1)).toMatchObject({ host: 'example.com', allowed: false, reason: 'port' });
  });

  it('lets a plain-HTTP forward to port 80 past the port check', async () => {
    const response = await get(port, 'http://example.com/x', AUTH);
    expect(response).toContain('403');
    expect(entries.at(-1)).toMatchObject({
      host: 'example.com',
      allowed: false,
      reason: 'resolve-failed',
    });
  });
});
