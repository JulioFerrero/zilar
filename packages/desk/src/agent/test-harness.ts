// Shared fakes and a per-test sidecar harness for the desk-agent tests. Only
// the Docker layer is fake; admission, lifecycle and the socket server are the
// real code.
import { mkdtempSync, rmSync } from 'node:fs';
import net, { type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { DeskChunk, DeskSpec } from '../hands';
import { Admission } from './admission';
import type { AgentConfig } from './config';
import type { DockerLayer } from './docker';
import { Lifecycle } from './lifecycle';
import { createAgentServer, type AgentServer } from './server';
import type { Workspaces } from './workspace';

export class FakeDocker implements DockerLayer {
  readonly created: string[] = [];
  readonly calls: Array<{
    name: string;
    spec: DeskSpec;
    workspaceDir: string;
    proxyUrl: string | null;
  }> = [];
  readonly started: string[] = [];
  readonly removed: string[] = [];
  readonly running = new Set<string>();
  failStart = false;
  failRemove = false;
  beforeCreate: (() => Promise<void>) | null = null;

  async create(
    name: string,
    spec: DeskSpec,
    workspaceDir: string,
    proxyUrl: string | null,
  ): Promise<void> {
    this.created.push(name);
    this.calls.push({ name, spec, workspaceDir, proxyUrl });
    if (this.beforeCreate !== null) {
      await this.beforeCreate();
    }
    this.running.add(name);
  }

  async start(name: string): Promise<void> {
    if (this.failStart) {
      throw new Error('start failed');
    }
    this.started.push(name);
  }

  async inspect(name: string): Promise<boolean> {
    return this.running.has(name);
  }

  async *run(): AsyncIterable<DeskChunk> {
    yield { type: 'stdout', data: 'ok' };
    yield { type: 'exit', code: 0, truncated: false };
  }

  async remove(name: string): Promise<void> {
    if (this.failRemove) {
      throw new Error('boom');
    }
    this.removed.push(name);
    this.running.delete(name);
  }

  async listDeskNames(): Promise<readonly string[]> {
    return [...this.running];
  }
}

export const PACKAGE =
  'zilar-desk@sha256:0000000000000000000000000000000000000000000000000000000000000000';

export function fakeWorkspaces(root: string): Workspaces {
  return {
    ensure: (key) => Promise.resolve(path.join(root, key.aiId, key.projectId)),
    release: () => Promise.resolve(),
    snapshot: (_key, label) => Promise.resolve(label.length),
    remove: () => Promise.resolve(),
  };
}

export function makeConfig(root: string, socket: string): AgentConfig {
  return {
    socketPath: socket,
    workspaceRoot: root,
    workspaceMode: 'dir',
    diskBytes: 1_048_576,
    maxRunning: 12,
    idleMs: 120_000,
    memoryRatioLimit: 0.75,
    poolCgroupPath: null,
    docker: {
      runtime: 'runc',
      image: PACKAGE,
      network: 'none',
      cgroupParent: null,
    },
    egress: null,
  };
}

export function spec(aiId = 'ai1', projectId = 'p1'): DeskSpec {
  return {
    key: { aiId, projectId },
    ownerUserId: 'owner-a',
    imageDigest: PACKAGE,
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

export function open(socket: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

/** Writes one request and reads reply lines until `done` says to stop. */
export async function send(
  socket: string,
  payload: unknown,
  done: (line: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const client = await open(socket);
  return new Promise((resolve, reject) => {
    const seen: Array<Record<string, unknown>> = [];
    let buffer = '';
    client.on('data', (data) => {
      buffer += String(data);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const text = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (text.length > 0) {
          const line = JSON.parse(text) as Record<string, unknown>;
          seen.push(line);
          if (done(line)) {
            client.destroy();
            resolve(seen);
            return;
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
    client.on('error', reject);
    client.write(`${JSON.stringify(payload)}\n`);
  });
}

export const one = (line: Record<string, unknown>): boolean => 'ok' in line || 'error' in line;

export interface AgentHarness {
  directory: string;
  socketPath: string;
  config: AgentConfig;
  docker: FakeDocker;
  server: AgentServer;
  lifecycle: Lifecycle;
}

/** Registers the per-test hooks and returns a handle whose fields each test
 * sees filled in. */
export function setupAgent(): AgentHarness {
  const harness = {} as AgentHarness;
  beforeEach(async () => {
    harness.directory = mkdtempSync(path.join(os.tmpdir(), 'desk-agent-'));
    harness.socketPath = path.join(harness.directory, 'desk.sock');
    harness.config = makeConfig(harness.directory, harness.socketPath);
    harness.docker = new FakeDocker();
    const admission = new Admission({
      maxRunning: harness.config.maxRunning,
      memoryRatioLimit: harness.config.memoryRatioLimit,
      pool: () => Promise.resolve(null),
    });
    harness.lifecycle = new Lifecycle({
      docker: harness.docker,
      workspaces: fakeWorkspaces(harness.directory),
      admission,
      config: harness.config,
    });
    harness.server = createAgentServer(harness.config, harness.lifecycle);
    await harness.server.listen();
  });
  afterEach(async () => {
    await harness.server.close();
    rmSync(harness.directory, { recursive: true, force: true });
  });
  return harness;
}
