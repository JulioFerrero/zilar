import { describe, expect, it } from 'vitest';
import { type DeskStopFrame } from './desk-frames.ts';
import { DeskServer } from './desk-server.ts';
import type { StreamMux } from './mux.ts';
import type { ControlMessage } from './protocol.ts';

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
