import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeskChunk, Hands } from '@zilar/desk';
import { DeskError } from '@zilar/desk';
import { createDeskRunner } from '../agents/gateway/desk-exec';
import { socketLines } from './cloud-hands';

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'cloud-hands-'));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('cloud Hands over the sidecar socket', () => {
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
