import { describe, expect, it } from 'vitest';
import { type DeskProvisionFrame } from './desk-frames.ts';
import { DeskRunner } from './desk-runner.ts';
import type { StreamMux } from './mux.ts';
import type { ControlMessage } from './protocol.ts';
import { waitFor } from './test-harness.ts';

function fakeMux(sent: ControlMessage[]): StreamMux {
  return {
    sendControl: (message: ControlMessage) => {
      sent.push(message);
    },
  } as unknown as StreamMux;
}

const provisionFrame: DeskProvisionFrame = {
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
};

describe('DeskRunner with no injected handler', () => {
  it('answers desk.provision with jail_unavailable', async () => {
    const sent: ControlMessage[] = [];
    const runner = new DeskRunner();
    runner.handle(fakeMux(sent), provisionFrame);
    await waitFor(() => sent.length > 0, 1000, 'desk.error');
    expect(sent[0]).toEqual({
      type: 'desk.error',
      desk_id: 'desk-ai-1-proj-1',
      code: 'jail_unavailable',
      message: 'this runner has no desk handler',
    });
  });
});
