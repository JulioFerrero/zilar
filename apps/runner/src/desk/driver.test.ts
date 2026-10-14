import { describe, expect, it } from 'vitest';
import type { DeskProvisionFrame } from '@zilar/runner-tunnel';
import { detectDriver, type DriverProbe } from './driver.ts';
import { RunnerDeskHandler } from './handler.ts';
import { DEFAULT_POLICY } from './policy.ts';

function probe(version: string, runtimes: string): DriverProbe {
  return (_file, args) => {
    if (args[0] === 'version') return Promise.resolve({ stdout: version });
    if (args[0] === 'info') return Promise.resolve({ stdout: runtimes });
    return Promise.reject(new Error('unexpected probe'));
  };
}

const missing: DriverProbe = () => Promise.reject(new Error('command not found'));

function frame(): DeskProvisionFrame {
  return {
    type: 'desk.provision',
    desk_id: 'desk-ai-1-proj-1',
    ai_id: 'ai-1',
    project_id: 'proj-1',
    image_digest: 'zilar-desk@sha256:deadbeef',
    limits: {
      memory_bytes: 1024 * 1024 * 1024,
      pids: 256,
      cpu_shares: 512,
      disk_bytes: 1024 * 1024 * 1024,
      command_timeout_ms: 600_000,
      task_wall_clock_ms: 600_000,
    },
    egress: { allowed_hosts: ['example.com'] },
  };
}

describe('detectDriver', () => {
  it('refuses when docker is missing', async () => {
    const driver = await detectDriver({ platform: 'linux', execFile: missing });
    expect(driver.kind).toBe('none');
    expect(driver.labels).toEqual([]);
  });

  it('picks runsc on linux when the runtime is registered', async () => {
    const driver = await detectDriver({
      platform: 'linux',
      execFile: probe('24.0.5', '{"runsc":{"path":"runsc"}}'),
    });
    expect(driver.kind).toBe('runsc');
    expect(driver.dockerRuntime).toBe('runsc');
    expect(driver.labels).toEqual(['docker', 'runsc']);
  });

  it('refuses on linux without runsc', async () => {
    const driver = await detectDriver({
      platform: 'linux',
      execFile: probe('24.0.5', '{"runc":{"path":"runc"}}'),
    });
    expect(driver.kind).toBe('none');
    expect(driver.labels).toEqual(['docker']);
  });

  it('picks the docker VM on macOS with the default runtime', async () => {
    const driver = await detectDriver({
      platform: 'darwin',
      execFile: probe('24.0.5', '{"runc":{"path":"runc"}}'),
    });
    expect(driver.kind).toBe('docker-vm');
    expect(driver.dockerRuntime).toBeNull();
    expect(driver.labels).toEqual(['docker-vm']);
  });

  it('refuses on an unsupported platform', async () => {
    const driver = await detectDriver({
      platform: 'win32',
      execFile: probe('24.0.5', '{}'),
    });
    expect(driver.kind).toBe('none');
  });
});

describe('RunnerDeskHandler with no jail driver', () => {
  it('answers jail_unavailable and never falls back to unsandboxed', async () => {
    const driver = await detectDriver({ platform: 'linux', execFile: missing });
    const handler = new RunnerDeskHandler({
      driver,
      policy: DEFAULT_POLICY,
      workspaceRoot: '/tmp/zilar-runner-desk-test',
    });
    expect(await handler.provision(frame())).toEqual({
      kind: 'error',
      code: 'jail_unavailable',
      message: 'docker is not available',
    });
  });
});
