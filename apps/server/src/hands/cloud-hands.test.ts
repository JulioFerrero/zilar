import { mkdtempSync, rmSync } from 'node:fs';
import net, { type Server, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCloudHands, HandsError, HandsQueued, type DeskSpec } from './cloud-hands';

/**
 * A minimal stand-in for the desk-agent's unix socket, so the app-side client
 * is tested without Docker. The real protocol lives in
 * `packages/desk/src/agent/wire.ts`.
 */

let directory: string;
let socketPath: string;
let server: Server;
const stops: Array<Record<string, unknown>> = [];

function handle(socket: Socket, line: string): void {
  const request = JSON.parse(line) as {
    id: number;
    method: string;
    params?: Record<string, unknown>;
  };
  const id = request.id;
  if (request.method === 'provision') {
    const spec = request.params?.spec as DeskSpec;
    if (spec.key.projectId === 'queued') {
      socket.write(`${JSON.stringify({ id, ok: true, queued: true, position: 2 })}\n`);
      return;
    }
    if (spec.imageDigest === 'bad') {
      socket.write(
        `${JSON.stringify({ id, ok: false, error: { code: 'jail_unavailable', message: 'no' } })}\n`,
      );
      return;
    }
    socket.write(
      `${JSON.stringify({
        id,
        ok: true,
        ref: { id: `desk-${spec.key.aiId}-${spec.key.projectId}`, key: spec.key },
      })}\n`,
    );
    return;
  }
  if (request.method === 'execute') {
    socket.write(`${JSON.stringify({ id, chunk: { type: 'stdout', data: 'ok\n' } })}\n`);
    socket.write(`${JSON.stringify({ id, chunk: { type: 'exit', code: 0, truncated: false } })}\n`);
    socket.write(`${JSON.stringify({ id, done: true })}\n`);
    return;
  }
  if (request.method === 'stop') {
    stops.push(request.params ?? {});
    socket.write(`${JSON.stringify({ id, ok: true })}\n`);
    return;
  }
  socket.write(
    `${JSON.stringify({ id, ok: false, error: { code: 'tool_failed', message: 'unknown' } })}\n`,
  );
}

function spec(projectId = 'p1'): DeskSpec {
  return {
    key: { aiId: 'ai1', projectId },
    ownerUserId: 'owner-a',
    imageDigest: 'pinned@sha256:abc',
    limits: {
      memoryBytes: 1_073_741_824,
      pids: 256,
      cpuShares: 512,
      diskBytes: 1_048_576,
      commandTimeoutMs: 600_000,
      taskWallClockMs: 600_000,
    },
  };
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'cloud-hands-'));
  socketPath = path.join(directory, 'desk.sock');
  server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (data) => {
      buffer += String(data);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          handle(socket, line);
        }
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('cloud Hands over the sidecar socket', () => {
  it('provisions, streams execute chunks and stops', async () => {
    const hands = createCloudHands(socketPath);
    const ref = await hands.provision(spec());
    expect(ref).toEqual({ id: 'desk-ai1-p1', key: { aiId: 'ai1', projectId: 'p1' } });

    const chunks = [];
    for await (const chunk of hands.execute(ref, { tool: 'bash', args: { command: 'echo ok' } })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      { type: 'stdout', data: 'ok\n' },
      { type: 'exit', code: 0, truncated: false },
    ]);

    await hands.stop(ref, { keepWorkspace: false });
    expect(stops).toEqual([{ ref, keepWorkspace: false }]);
  });

  it('surfaces a queued answer and a fixed error code', async () => {
    const hands = createCloudHands(socketPath);
    await expect(hands.provision(spec('queued'))).rejects.toBeInstanceOf(HandsQueued);
    await expect(hands.provision(spec('queued'))).rejects.toMatchObject({ position: 2 });
    await expect(hands.provision({ ...spec(), imageDigest: 'bad' })).rejects.toBeInstanceOf(
      HandsError,
    );
  });
});
