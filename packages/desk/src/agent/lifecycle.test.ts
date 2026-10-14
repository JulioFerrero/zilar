import { describe, expect, it, vi } from 'vitest';
import { Admission } from './admission';
import { Lifecycle } from './lifecycle';
import { runIdleSweep } from './main';
import { fakeWorkspaces, one, send, setupAgent, spec } from './test-harness';
import type { Workspaces } from './workspace';

const agent = setupAgent();

describe('desk-agent lifecycle', () => {
  it('removes a partial jail when provision fails, so the key is usable again', async () => {
    agent.docker.failStart = true;
    const failed = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: spec() } },
      one,
    );
    expect(failed[0]?.ok).toBe(false);
    expect(agent.docker.removed).toEqual(['desk-ai1-p1']);

    agent.docker.failStart = false;
    const retry = await send(
      agent.socketPath,
      { id: 2, method: 'provision', params: { spec: spec() } },
      one,
    );
    expect(retry[0]?.ok).toBe(true);
    expect(agent.docker.created).toEqual(['desk-ai1-p1', 'desk-ai1-p1']);
  });

  it('runs one create for concurrent provisions of the same key', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    agent.docker.beforeCreate = () => gate;

    const first = agent.lifecycle.provision(spec());
    await vi.waitFor(() => expect(agent.docker.created).toContain('desk-ai1-p1'));
    const second = agent.lifecycle.provision(spec());
    release();

    await expect(first).resolves.toMatchObject({ kind: 'ready' });
    await expect(second).resolves.toMatchObject({ kind: 'ready' });
    expect(agent.docker.created).toEqual(['desk-ai1-p1']);
    expect(agent.docker.started).toEqual(['desk-ai1-p1']);
  });

  it('frees the admission slot even when the workspace release throws', async () => {
    const admission = new Admission({
      maxRunning: 1,
      memoryRatioLimit: 0.75,
      pool: () => Promise.resolve(null),
    });
    const throwingWorkspaces: Workspaces = {
      ...fakeWorkspaces(agent.directory),
      release: () => Promise.reject(new Error('umount failed')),
    };
    const local = new Lifecycle({
      docker: agent.docker,
      workspaces: throwingWorkspaces,
      admission,
      config: agent.config,
    });

    await local.provision(spec());
    await expect(
      local.stop({ id: 'desk-ai1-p1', key: { aiId: 'ai1', projectId: 'p1' } }),
    ).rejects.toThrow('umount failed');
    expect(admission.running).toBe(0);

    const next = await local.provision(spec('ai2', 'p1'));
    expect(next.kind).toBe('ready');
  });

  it('logs idle sweep failures instead of crashing the daemon', async () => {
    let clock = 0;
    const admission = new Admission({
      maxRunning: 2,
      memoryRatioLimit: 0.75,
      pool: () => Promise.resolve(null),
    });
    const local = new Lifecycle({
      docker: agent.docker,
      workspaces: fakeWorkspaces(agent.directory),
      admission,
      config: agent.config,
      now: () => clock,
    });
    await local.provision(spec());
    clock = agent.config.idleMs + 1;
    agent.docker.failRemove = true;

    const messages: string[] = [];
    runIdleSweep(local, (message) => messages.push(message));
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toContain('boom');
  });
});
