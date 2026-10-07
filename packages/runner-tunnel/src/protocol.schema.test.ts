import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { CLOSE_MALFORMED, parseControlMessage } from './protocol.ts';
import { RunnerOptionsSchema } from './runner.ts';

describe('Effect Schema protocol validation', () => {
  it('rejects an excess key on a hello frame', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        type: 'hello',
        runner_id: 'runner-1',
        runner_version: '0.1.0',
        protocol_version: 1,
        surprise: true,
      }),
      'runner-to-server',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
      expect(parsed.reason).toBe('invalid hello frame');
    }
  });

  it('rejects an excess key on a tunnel.open frame', () => {
    const parsed = parseControlMessage(
      JSON.stringify({ type: 'tunnel.open', stream_id: 1, port: 8080, extra: 'no' }),
      'server-to-runner',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
      expect(parsed.reason).toBe('invalid tunnel.open frame');
    }
  });

  it('rejects a stream id of 2**32', () => {
    const parsed = parseControlMessage(
      JSON.stringify({ type: 'tunnel.open', stream_id: 2 ** 32, port: 8080 }),
      'server-to-runner',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
      expect(parsed.reason).toBe('invalid tunnel.open frame');
    }
  });

  it('applies the runner option defaults', () => {
    const decoded = Schema.decodeUnknownSync(RunnerOptionsSchema)({
      serverUrl: 'ws://127.0.0.1:9000/tunnel',
      runnerId: 'runner-1',
    });
    expect(decoded.runnerVersion).toBe('0.1.0');
    expect(decoded.exposedPorts).toEqual([]);
    expect(decoded.enableModelListener).toBe(true);
    expect(decoded.reconnectBaseMs).toBe(250);
    expect(decoded.reconnectMaxMs).toBe(5000);
    expect(decoded.handshakeTimeoutMs).toBe(10000);
    expect(decoded.highWaterMarkBytes).toBe(1024 * 1024);
  });
});
