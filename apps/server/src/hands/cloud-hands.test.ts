import { mkdtempSync, rmSync } from 'node:fs';
import net, { type Server, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeskChunk, Hands, DeskSpec } from '@zilar/desk';
import { DeskError, DeskQueued } from '@zilar/desk';
import { createDeskRunner } from '../agents/gateway/desk-exec';
import { createCloudHands, socketLines } from './cloud-hands';

/**
 * A minimal stand-in for the desk-agent's unix socket, so the app-side client
 * is tested without Docker. The real protocol lives in
 * `packages/desk/src/agent/server.ts`.
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
    await expect(hands.provision(spec('queued'))).rejects.toBeInstanceOf(DeskQueued);
    await expect(hands.provision(spec('queued'))).rejects.toMatchObject({ position: 2 });
    await expect(hands.provision({ ...spec(), imageDigest: 'bad' })).rejects.toBeInstanceOf(
      DeskError,
    );
  });

  it('throws when the peer sends 2 MiB without a newline', async () => {
    const longPath = path.join(directory, 'long.sock');
    const longServer = net.createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('x'.repeat(2 * 1024 * 1024));
    });
    await new Promise<void>((resolve) => longServer.listen(longPath, () => resolve()));
    const client = net.connect(longPath);
    try {
      const consume = async (): Promise<void> => {
        for await (const line of socketLines(client)) {
          void line;
        }
      };
      await expect(consume()).rejects.toThrow('desk output line too long');
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => longServer.close(() => resolve()));
    }
  });

  it('throws when the peer sends a newline-terminated line over 1 MiB', async () => {
    const longPath = path.join(directory, 'long-newline.sock');
    const longServer = net.createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('x'.repeat(1024 * 1024));
      socket.write(`${'y'.repeat(100)}\n`);
    });
    await new Promise<void>((resolve) => longServer.listen(longPath, () => resolve()));
    const client = net.connect(longPath);
    try {
      const consume = async (): Promise<void> => {
        for await (const line of socketLines(client)) {
          void line;
        }
      };
      await expect(consume()).rejects.toThrow('desk output line too long');
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => longServer.close(() => resolve()));
    }
  });
});

describe('desk runner result cap', () => {
  it('stops at the cap on an endless stream and aborts it', async () => {
    let yielded = 0;
    let streamSignal: AbortSignal | undefined;
    const hands: Hands = {
      provision: async (deskSpec) => ({ id: 'desk-ai1-p1', key: deskSpec.key }),
      execute: async function* (_ref, _call, signal): AsyncIterable<DeskChunk> {
        streamSignal = signal;
        for (;;) {
          yielded += 1;
          yield { type: 'stdout', data: 'x'.repeat(1024) };
        }
      },
      stop: async () => undefined,
      snapshot: async () => {
        throw new DeskError('tool_failed', 'snapshot is not available');
      },
    };
    const runner = createDeskRunner({
      hands,
      imageDigest: 'pinned@sha256:abc',
      aiId: 'ai1',
      ownerUserId: 'owner-a',
      logger: { info: () => undefined, warn: () => undefined },
    });
    const result = await runner({ id: 'call-1', tool: 'bash', args: { command: 'yes' } });
    expect(result.content).toContain('(truncated)');
    expect(result.content.length).toBeLessThan(9_000);
    expect(yielded).toBeLessThan(50);
    expect(streamSignal?.aborted).toBe(true);
  });
});
