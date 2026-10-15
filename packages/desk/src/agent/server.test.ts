import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeskToolCall } from '../hands';
import { Admission } from './admission';
import { createArgs, DESK_LABEL } from './docker';
import { Lifecycle } from './lifecycle';
import { PACKAGE, fakeWorkspaces, one, send, setupAgent, spec } from './test-harness';

const agent = setupAgent();

describe('desk-agent server', () => {
  it('refuses a request with an extra field (a host path or image)', async () => {
    const withImage = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: { ...spec(), image: 'evil:latest' } } },
      one,
    );
    expect(withImage[0]?.ok).toBe(false);

    const withFlag = await send(
      agent.socketPath,
      { id: 2, method: 'provision', params: { spec: spec(), runtime: '--privileged' } },
      one,
    );
    expect(withFlag[0]?.ok).toBe(false);
    expect(agent.docker.created).toHaveLength(0);
  });

  it('refuses an id that tries to escape the workspace root', async () => {
    const reply = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: spec('../x', 'p1') } },
      one,
    );
    expect(reply[0]?.ok).toBe(false);
    expect(agent.docker.created).toHaveLength(0);
  });

  it('refuses an image digest that is not the pinned one', async () => {
    const reply = await send(
      agent.socketPath,
      {
        id: 1,
        method: 'provision',
        params: { spec: { ...spec(), imageDigest: 'other@sha256:deadbeef' } },
      },
      one,
    );
    expect(reply[0]?.error).toMatchObject({ code: 'jail_unavailable' });
    expect(agent.docker.created).toHaveLength(0);
  });

  it('builds the §4.2 fixed flags and the pinned image for every jail', () => {
    const workspace = path.join(agent.directory, 'workspace');
    const args = createArgs('desk-ai1-p1', spec(), workspace, agent.config.docker, null);
    const valueAfter = (flag: string): string | undefined => {
      const index = args.indexOf(flag);
      return index === -1 ? undefined : args[index + 1];
    };

    expect(args).toContain('--read-only');
    expect(valueAfter('--cap-drop')).toBe('ALL');
    expect(valueAfter('--security-opt')).toBe('no-new-privileges');
    expect(valueAfter('--runtime')).toBe('runc');
    expect(valueAfter('--pids-limit')).toBe('256');
    expect(valueAfter('--memory')).toBe(String(spec().limits.memoryBytes));
    expect(valueAfter('--memory-swap')).toBe(String(spec().limits.memoryBytes));
    expect(valueAfter('--memory-reservation')).toBe(
      String(Math.floor(spec().limits.memoryBytes / 2)),
    );
    expect(valueAfter('--network')).toBe('none');
    expect(valueAfter('--mount')).toBe(`type=bind,src=${workspace},dst=/workspace`);
    expect(valueAfter('--label')).toBe(`${DESK_LABEL}=1`);
    expect(valueAfter('--name')).toBe('desk-ai1-p1');
    expect(args).toContain(PACKAGE);
  });

  it('binds the workspace directory and the pinned image into the jail', async () => {
    await send(agent.socketPath, { id: 1, method: 'provision', params: { spec: spec() } }, one);
    expect(agent.docker.calls).toHaveLength(1);
    expect(agent.docker.calls[0]?.spec.imageDigest).toBe(PACKAGE);
    expect(agent.docker.calls[0]?.workspaceDir).toBe(path.join(agent.directory, 'ai1', 'p1'));
  });

  it('is idempotent per DeskKey', async () => {
    const first = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: spec() } },
      one,
    );
    const second = await send(
      agent.socketPath,
      { id: 2, method: 'provision', params: { spec: spec() } },
      one,
    );
    expect(first[0]?.ok).toBe(true);
    expect(second[0]?.ref).toEqual(first[0]?.ref);
    expect(agent.docker.created).toEqual(['desk-ai1-p1']);

    await send(
      agent.socketPath,
      { id: 3, method: 'provision', params: { spec: spec('ai2', 'p1') } },
      one,
    );
    expect(agent.docker.created).toEqual(['desk-ai1-p1', 'desk-ai2-p1']);
  });

  it('stops the jail but keeps the record gone, so the next provision starts it again', async () => {
    const provisioned = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: spec() } },
      one,
    );
    await send(
      agent.socketPath,
      { id: 2, method: 'stop', params: { ref: provisioned[0]?.ref } },
      one,
    );
    expect(agent.docker.removed).toEqual(['desk-ai1-p1']);

    await send(agent.socketPath, { id: 3, method: 'provision', params: { spec: spec() } }, one);
    expect(agent.docker.created).toHaveLength(2);
  });

  it('streams the daemon chunks for execute and answers not_provisioned otherwise', async () => {
    const missing = await send(
      agent.socketPath,
      {
        id: 1,
        method: 'execute',
        params: {
          ref: { id: 'desk-ai9-p9', key: { aiId: 'ai9', projectId: 'p9' } },
          call: { tool: 'bash', args: { command: 'echo ok' } },
        },
      },
      (line) => 'error' in line || 'done' in line,
    );
    expect(missing[0]?.error).toMatchObject({ code: 'not_provisioned' });

    const provisioned = await send(
      agent.socketPath,
      { id: 2, method: 'provision', params: { spec: spec() } },
      one,
    );
    const call: DeskToolCall = { tool: 'bash', args: { command: 'echo ok' } };
    const streamed = await send(
      agent.socketPath,
      { id: 3, method: 'execute', params: { ref: provisioned[0]?.ref, call } },
      (line) => 'done' in line || 'error' in line,
    );
    expect(streamed).toHaveLength(3);
    expect(streamed[0]?.chunk).toEqual({ type: 'stdout', data: 'ok' });
    expect(streamed[1]?.chunk).toEqual({ type: 'exit', code: 0, truncated: false });
    expect(streamed[2]?.done).toBe(true);
  });

  it('refuses a ref whose id does not match its key', async () => {
    const provisioned = await send(
      agent.socketPath,
      { id: 1, method: 'provision', params: { spec: spec() } },
      one,
    );
    const ref = provisioned[0]?.ref as { id: string; key: Record<string, string> };
    const forged = { id: ref.id, key: { aiId: 'ai2', projectId: 'p1' } };

    const executed = await send(
      agent.socketPath,
      {
        id: 2,
        method: 'execute',
        params: { ref: forged, call: { tool: 'bash', args: { command: 'echo ok' } } },
      },
      one,
    );
    expect(executed[0]?.error).toMatchObject({ code: 'not_provisioned' });

    const stopped = await send(
      agent.socketPath,
      { id: 3, method: 'stop', params: { ref: forged } },
      one,
    );
    expect(stopped[0]?.error).toMatchObject({ code: 'not_provisioned' });

    const snap = await send(
      agent.socketPath,
      { id: 4, method: 'snapshot', params: { ref: forged, label: 'l1' } },
      one,
    );
    expect(snap[0]?.error).toMatchObject({ code: 'not_provisioned' });
    expect(agent.docker.removed).toHaveLength(0);
  });

  it('frees the admission slot when a failed provision cannot release the workspace', async () => {
    const admission = new Admission({
      maxRunning: 1,
      memoryRatioLimit: 0.75,
      pool: () => Promise.resolve(null),
    });
    const logs: string[] = [];
    const local = new Lifecycle({
      docker: agent.docker,
      workspaces: {
        ...fakeWorkspaces(agent.directory),
        release: () => Promise.reject(new Error('umount busy')),
      },
      admission,
      config: agent.config,
      log: (message) => logs.push(message),
    });
    await local.checkReadiness();
    agent.docker.failStart = true;

    await expect(local.provision(spec())).rejects.toMatchObject({ code: 'jail_unavailable' });
    expect(admission.running).toBe(0);
    expect(logs.some((message) => message.includes('desk-ai1-p1'))).toBe(true);
  });

  it('lists running desks and kills them all', async () => {
    await send(agent.socketPath, { id: 1, method: 'provision', params: { spec: spec() } }, one);
    const status = await send(agent.socketPath, { id: 2, method: 'status' }, one);
    const statusReply = status[0]?.status as
      | {
          running: unknown[];
          queued: number;
          ready: boolean;
          imageDigest: string | null;
          detail: string | null;
        }
      | undefined;
    expect(statusReply?.queued).toBe(0);
    expect(statusReply?.running).toHaveLength(1);
    expect(statusReply?.ready).toBe(true);
    expect(statusReply?.imageDigest).toBe(PACKAGE);
    expect(statusReply?.detail).toBeNull();

    await send(agent.socketPath, { id: 3, method: 'stop_all' }, one);
    expect(agent.docker.removed).toEqual(['desk-ai1-p1']);
  });

  it('clears records and admission when one stop_all release fails', async () => {
    const admission = new Admission({
      maxRunning: 2,
      memoryRatioLimit: 0.75,
      pool: () => Promise.resolve(null),
    });
    const released: string[] = [];
    const local = new Lifecycle({
      docker: agent.docker,
      workspaces: {
        ...fakeWorkspaces(agent.directory),
        release: (key) => {
          released.push(key.aiId);
          return key.aiId === 'ai1' ? Promise.reject(new Error('umount busy')) : Promise.resolve();
        },
      },
      admission,
      config: agent.config,
      log: () => {},
    });
    await local.checkReadiness();
    await local.provision(spec('ai1', 'p1'));
    await local.provision(spec('ai2', 'p1'));

    await expect(local.stopAll()).resolves.toBe(1);
    expect(released).toEqual(['ai1', 'ai2']);
    expect(admission.running).toBe(0);
    expect(local.status().running).toHaveLength(0);
  });
});
