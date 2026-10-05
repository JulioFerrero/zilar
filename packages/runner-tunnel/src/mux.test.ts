import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { StreamMux, type StreamSink } from './mux.ts';
import { waitFor } from './test-harness.ts';

function toBuffer(data: unknown): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

const dummySink: StreamSink = {
  onData: () => true,
  onEnded: () => undefined,
  onFailed: () => undefined,
  onSendResumed: () => undefined,
};

describe('StreamMux teardown ordering', () => {
  it('never lets a FIN overtake stream data parked in backpressure', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    try {
      await once(wss, 'listening');
      const address = wss.address();
      if (typeof address === 'string' || address === null) {
        throw new Error('no port');
      }
      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      const [serverSide] = (await once(wss, 'connection')) as [WebSocket];
      await once(client, 'open');
      try {
        const sender = new StreamMux(client, 0);
        const receiver = new StreamMux(serverSide, 1);
        const received: Buffer[] = [];
        let ended = false;
        receiver.registerStream(7, {
          ...dummySink,
          onData: (chunk: Buffer) => {
            received.push(chunk);
            return true;
          },
          onEnded: () => {
            ended = true;
          },
        });
        serverSide.on('message', (data, isBinary) => {
          if (isBinary) {
            receiver.handleBinary(toBuffer(data));
          }
        });

        // The remote asked us to pause, so the next send parks instead of
        // going out. Then the local socket ends and queues its FIN.
        sender.registerStream(7, dummySink);
        sender.handlePause(7);
        const chunk = Buffer.alloc(1024, 0xab);
        const sent = sender.sendStreamData(7, chunk);
        // Let the send reach its parked wait.
        await new Promise((resolve) => setTimeout(resolve, 50));
        sender.enqueueTeardown(7, 'fin');
        // Release the parked send. The FIN must still go out after the data.
        sender.handleResume(7);
        await sent;
        await waitFor(() => ended, 5000, 'fin arrival');

        expect(Buffer.concat(received)).toEqual(chunk);
        expect(ended).toBe(true);
        // With immediate-FIN semantics the data would arrive after the FIN,
        // hit an unknown stream and be dropped instead.
        expect(receiver.unknownStreamsDropped).toBe(0);
      } finally {
        client.terminate();
        serverSide.terminate();
      }
    } finally {
      wss.close();
    }
  });
});
