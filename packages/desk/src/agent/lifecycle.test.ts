import { describe, expect, it, vi } from 'vitest';
import { Admission } from './admission';
import { loadAgentConfig, type AgentConfig } from './config';
import type { EgressRegistrar } from './egress';
import { Lifecycle } from './lifecycle';
import { runIdleSweep } from './main';
import { FakeDocker, PACKAGE, fakeWorkspaces, one, send, setupAgent, spec } from './test-harness';
import type { Workspaces } from './workspace';

const agent = setupAgent();

const REF = 'ghcr.io/julioferrero/zilar-desk:latest';
const DIGEST = `ghcr.io/julioferrero/zilar-desk@sha256:${'a'.repeat(64)}`;

function localLifecycle(docker: FakeDocker, config: AgentConfig): Lifecycle {
  return new Lifecycle({
    docker,
    workspaces: fakeWorkspaces(agent.directory),
    admission: new Admission({
      maxRunning: 4,
      memoryRatioLimit: 0.75,
      pool: () => Promise.resolve(null),
    }),
    config,
  });
}

function refConfig(): AgentConfig {
  return { ...agent.config, docker: { ...agent.config.docker, image: REF } };
}

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

  it('recreates a jail left from an earlier agent run with the current proxy URL', async () => {
    const docker = new FakeDocker();
    const makeEgress = (secret: string): EgressRegistrar => ({
      register: () => Promise.resolve(`http://desk-ai1-p1:${secret}@proxy:8080`),
      unregister: () => Promise.resolve(),
    });
    const build = (egress: EgressRegistrar, log?: (message: string) => void): Lifecycle =>
      new Lifecycle({
        docker,
        workspaces: fakeWorkspaces(agent.directory),
        admission: new Admission({
          maxRunning: 4,
          memoryRatioLimit: 0.75,
          pool: () => Promise.resolve(null),
        }),
        config: agent.config,
        egress,
        ...(log === undefined ? {} : { log }),
      });

    const before = build(makeEgress('old-secret'));
    await before.checkReadiness();
    await before.provision(spec());
    expect(docker.running.has('desk-ai1-p1')).toBe(true);

    // A new agent process: fresh records and a fresh egress secret, but the jail
    // from the earlier process is still there.
    const logs: string[] = [];
    const after = build(makeEgress('new-secret'), (message) => logs.push(message));
    await after.checkReadiness();
    const result = await after.provision(spec());

    expect(result.kind).toBe('ready');
    expect(docker.removed).toEqual(['desk-ai1-p1']);
    expect(docker.created).toEqual(['desk-ai1-p1', 'desk-ai1-p1']);
    expect(docker.calls[1]?.proxyUrl).toBe('http://desk-ai1-p1:new-secret@proxy:8080');
    expect(docker.started).toEqual(['desk-ai1-p1', 'desk-ai1-p1']);
    expect(logs).toContain('desk desk-ai1-p1: removed a jail left from an earlier agent run');
  });

  it('re-registers a known desk with the egress proxy on every provision', async () => {
    const docker = new FakeDocker();
    const registered: string[] = [];
    const lifecycle = new Lifecycle({
      docker,
      workspaces: fakeWorkspaces(agent.directory),
      admission: new Admission({
        maxRunning: 4,
        memoryRatioLimit: 0.75,
        pool: () => Promise.resolve(null),
      }),
      config: agent.config,
      egress: {
        register: (deskId) => {
          registered.push(deskId);
          return Promise.resolve(`http://${deskId}:secret@proxy:8080`);
        },
        unregister: () => Promise.resolve(),
      },
    });
    await lifecycle.checkReadiness();

    await lifecycle.provision(spec());
    const second = await lifecycle.provision(spec());

    expect(second).toMatchObject({ kind: 'ready' });
    expect(registered).toEqual(['desk-ai1-p1', 'desk-ai1-p1']);
    // The jail stays as it is; only the proxy registry is refreshed.
    expect(docker.created).toEqual(['desk-ai1-p1']);
  });

  it('still returns ready when re-registering a known desk fails', async () => {
    const docker = new FakeDocker();
    const logs: string[] = [];
    let calls = 0;
    const lifecycle = new Lifecycle({
      docker,
      workspaces: fakeWorkspaces(agent.directory),
      admission: new Admission({
        maxRunning: 4,
        memoryRatioLimit: 0.75,
        pool: () => Promise.resolve(null),
      }),
      config: agent.config,
      egress: {
        register: (deskId) => {
          calls += 1;
          return calls === 1
            ? Promise.resolve(`http://${deskId}:secret@proxy:8080`)
            : Promise.reject(new Error('proxy down'));
        },
        unregister: () => Promise.resolve(),
      },
      log: (message) => logs.push(message),
    });
    await lifecycle.checkReadiness();

    await lifecycle.provision(spec());
    const second = await lifecycle.provision(spec());

    expect(second).toMatchObject({ kind: 'ready' });
    expect(logs.some((line) => line.includes('could not re-register'))).toBe(true);
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
    await local.checkReadiness();

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
    await local.checkReadiness();
    await local.provision(spec());
    clock = agent.config.idleMs + 1;
    agent.docker.failRemove = true;

    const messages: string[] = [];
    runIdleSweep(local, (message) => messages.push(message));
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toContain('boom');
  });
});

describe('desk-agent readiness', () => {
  it('refuses provision and reports host_not_set_up while the runtime is missing', async () => {
    const docker = new FakeDocker();
    docker.runtimeReady = false;
    const lifecycle = localLifecycle(docker, agent.config);
    await lifecycle.checkReadiness();

    expect(lifecycle.status()).toMatchObject({
      ready: false,
      imageDigest: null,
      detail: 'host_not_set_up',
    });
    await expect(lifecycle.provision(spec())).rejects.toMatchObject({
      code: 'jail_unavailable',
    });
    expect(docker.created).toHaveLength(0);
  });

  it('resolves the ref, turns ready, and accepts a provision with the resolved digest', async () => {
    const docker = new FakeDocker();
    docker.resolveDigest = DIGEST;
    const lifecycle = localLifecycle(docker, refConfig());
    await lifecycle.checkReadiness();

    expect(lifecycle.status()).toMatchObject({
      ready: true,
      imageDigest: DIGEST,
      detail: null,
    });
    expect(docker.pulled).toEqual([REF]);

    const result = await lifecycle.provision({ ...spec(), imageDigest: DIGEST });
    expect(result.kind).toBe('ready');
    expect(docker.calls[0]?.spec.imageDigest).toBe(DIGEST);
  });

  it('refuses a provision whose digest is not the resolved pin', async () => {
    expect(agent.lifecycle.status().ready).toBe(true);
    await expect(
      agent.lifecycle.provision({ ...spec(), imageDigest: 'other@sha256:deadbeef' }),
    ).rejects.toMatchObject({ code: 'jail_unavailable' });
    expect(agent.docker.created).toHaveLength(0);
  });

  it('stays image_unresolved on a failed pull, then turns ready on a later check', async () => {
    const docker = new FakeDocker();
    docker.resolveDigest = null;
    const lifecycle = localLifecycle(docker, refConfig());

    await lifecycle.checkReadiness();
    expect(lifecycle.status()).toMatchObject({
      ready: false,
      imageDigest: null,
      detail: 'image_unresolved',
    });

    docker.resolveDigest = DIGEST;
    await lifecycle.checkReadiness();
    expect(lifecycle.status()).toMatchObject({
      ready: true,
      imageDigest: DIGEST,
      detail: null,
    });
  });

  it('turns ready from a pinned DESK_IMAGE override without pulling', async () => {
    const docker = new FakeDocker();
    const lifecycle = localLifecycle(docker, agent.config);
    await lifecycle.checkReadiness();

    expect(lifecycle.status()).toMatchObject({
      ready: true,
      imageDigest: PACKAGE,
      detail: null,
    });
    expect(docker.pulled).toEqual([]);
  });
});

describe('desk-agent config', () => {
  it('rejects a DESK_IMAGE_TAG that could reach a docker argument', () => {
    expect(() => loadAgentConfig({ DESK_IMAGE_TAG: 'x;rm' })).toThrow(/DESK_IMAGE_TAG/);
  });

  it('rejects a DESK_IMAGE_OWNER with characters outside the strict set', () => {
    expect(() => loadAgentConfig({ DESK_IMAGE_OWNER: 'Julio/../x' })).toThrow(/DESK_IMAGE_OWNER/);
  });

  it('starts with no DESK_IMAGE and builds the published ref from the defaults', () => {
    expect(loadAgentConfig({}).docker.image).toBe('ghcr.io/julioferrero/zilar-desk:latest');
  });

  it('honours DESK_IMAGE_OWNER and DESK_IMAGE_TAG for the ref', () => {
    expect(
      loadAgentConfig({ DESK_IMAGE_OWNER: 'zilar', DESK_IMAGE_TAG: 'sha-abc123' }).docker.image,
    ).toBe('ghcr.io/zilar/zilar-desk:sha-abc123');
  });
});
