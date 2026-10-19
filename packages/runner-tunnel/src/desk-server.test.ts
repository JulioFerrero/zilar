import { describe, expect, it } from 'vitest';
import { type DeskStopFrame } from './desk-frames.ts';
import { DeskServer } from './desk-server.ts';
import type { StreamMux } from './mux.ts';
import { parseControlMessage, type ControlMessage } from './protocol.ts';
import { dropConn, type ServerConn, type ServerRuntime } from './server.ts';

function fakeMux(sent: ControlMessage[]): StreamMux {
  return {
    sendControl: (message: ControlMessage) => {
      sent.push(message);
    },
  } as unknown as StreamMux;
}

const stopFrame: DeskStopFrame = {
  type: 'desk.stop',
  desk_id: 'desk-1',
  keep_workspace: false,
};

describe('DeskServer reply routing', () => {
  it('never resolves a request with another runner’s reply', async () => {
    const desk = new DeskServer(() => fakeMux([]), 150);
    const reply = desk.sendDesk('runner-a', stopFrame);
    // A recognized reply from a different runner resolves nothing.
    expect(desk.route('runner-b', { type: 'desk.ready', desk_id: 'desk-1' })).toBe(true);
    await expect(reply).rejects.toThrow(/no desk reply/);
  });

  it('resolves a request with its own runner’s reply', async () => {
    const desk = new DeskServer(() => fakeMux([]), 150);
    const reply = desk.sendDesk('runner-a', stopFrame);
    expect(desk.route('runner-a', { type: 'desk.stopped', desk_id: 'desk-1' })).toBe(true);
    await expect(reply).resolves.toEqual({ type: 'desk.stopped', desk_id: 'desk-1' });
  });

  it('lets two runners hold a request for the same desk id', async () => {
    const desk = new DeskServer(() => fakeMux([]), 150);
    const first = desk.sendDesk('runner-a', stopFrame);
    const second = desk.sendDesk('runner-b', stopFrame);
    expect(desk.route('runner-a', { type: 'desk.stopped', desk_id: 'desk-1' })).toBe(true);
    expect(desk.route('runner-b', { type: 'desk.stopped', desk_id: 'desk-1' })).toBe(true);
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
  });
});

const DIGEST = `zilar-desk@sha256:${'a'.repeat(64)}`;

function provisionFrame(imageDigest: string): string {
  return JSON.stringify({
    type: 'desk.provision',
    desk_id: 'desk-ai-1-proj-1',
    ai_id: 'ai-1',
    project_id: 'proj-1',
    image_digest: imageDigest,
    limits: {
      memory_bytes: 1024 * 1024,
      pids: 64,
      cpu_shares: 256,
      disk_bytes: 1024 * 1024,
      command_timeout_ms: 1000,
      task_wall_clock_ms: 1000,
    },
  });
}

describe('DeskServer provision image', () => {
  it('accepts a pinned digest', () => {
    const parsed = parseControlMessage(provisionFrame(DIGEST), 'server-to-runner');
    expect(parsed.ok).toBe(true);
  });

  it('refuses an image that starts with a dash', () => {
    const parsed = parseControlMessage(
      provisionFrame(`-rm@sha256:${'a'.repeat(64)}`),
      'server-to-runner',
    );
    expect(parsed.ok).toBe(false);
  });
});

function fakeRuntime(failed: string[]): ServerRuntime {
  return {
    conns: new Set<ServerConn>(),
    live: new Map<string, ServerConn>(),
    droppedFromDeadConns: 0,
    desk: { failRunner: (runnerId: string) => failed.push(runnerId) } as unknown as DeskServer,
  } as unknown as ServerRuntime;
}

function fakeConn(runnerId: string, state: ServerConn['state']): ServerConn {
  return {
    state,
    runnerId,
    nonce: null,
    mux: null,
    handshakeFiber: null,
    pendingOpens: new Map(),
  } as unknown as ServerConn;
}

describe('DeskServer connection close', () => {
  it('keeps the live connection’s requests when a hello-only connection closes', () => {
    const failed: string[] = [];
    const rt = fakeRuntime(failed);
    const live = fakeConn('runner-a', 'ready');
    rt.live.set('runner-a', live);
    const helloOnly = fakeConn('runner-a', 'auth');

    dropConn(rt, helloOnly, 1000, 'gone');

    expect(failed).toEqual([]);
    expect(rt.live.get('runner-a')).toBe(live);

    dropConn(rt, live, 1000, 'gone');

    expect(failed).toEqual(['runner-a']);
    expect(rt.live.has('runner-a')).toBe(false);
  });

  it('keeps the successor connection’s requests when a replaced connection closes', () => {
    const failed: string[] = [];
    const rt = fakeRuntime(failed);
    const replaced = fakeConn('runner-a', 'ready');
    const successor = fakeConn('runner-a', 'ready');
    rt.live.set('runner-a', successor);

    dropConn(rt, replaced, 1000, 'replaced by a new connection');

    expect(failed).toEqual([]);
    expect(rt.live.get('runner-a')).toBe(successor);
  });
});
