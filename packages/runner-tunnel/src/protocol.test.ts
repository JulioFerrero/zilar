import { describe, expect, it } from 'vitest';
import {
  CLOSE_MALFORMED,
  CLOSE_UNKNOWN_TYPE,
  decodeBinaryFrame,
  encodeBinaryFrame,
  FRAME_DATA,
  FRAME_FIN,
  parseControlMessage,
} from './protocol.ts';

describe('parseControlMessage', () => {
  it('accepts a valid hello from a runner', () => {
    const parsed = parseControlMessage(
      JSON.stringify({
        type: 'hello',
        runner_id: 'runner-1',
        runner_version: '0.1.0',
        protocol_version: 1,
      }),
      'runner-to-server',
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects a non-JSON frame as malformed without throwing', () => {
    const parsed = parseControlMessage('this is not json', 'runner-to-server');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
    }
  });

  it('rejects a non-object frame as malformed', () => {
    const parsed = parseControlMessage('[1,2,3]', 'runner-to-server');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
    }
  });

  it('rejects an unknown type with the unknown-type code', () => {
    const parsed = parseControlMessage(
      JSON.stringify({ type: 'desk.teleport' }),
      'runner-to-server',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_UNKNOWN_TYPE);
    }
  });

  it('rejects a known shape going the wrong direction', () => {
    // challenge is server-to-runner only; a runner sending it is a violation.
    const parsed = parseControlMessage(
      JSON.stringify({ type: 'challenge', nonce: 'eA==' }),
      'runner-to-server',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_UNKNOWN_TYPE);
    }
  });

  it('rejects a well-typed frame with a bad field as malformed', () => {
    const parsed = parseControlMessage(
      JSON.stringify({ type: 'tunnel.open', stream_id: -1, port: 99999 }),
      'server-to-runner',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(CLOSE_MALFORMED);
    }
  });
});

describe('binary framing', () => {
  it('round-trips a data frame', () => {
    const payload = Buffer.from('hello-bytes');
    const frame = encodeBinaryFrame(7, FRAME_DATA, payload);
    expect(frame.length).toBe(5 + payload.length);
    const decoded = decodeBinaryFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded?.streamId).toBe(7);
    expect(decoded?.kind).toBe(FRAME_DATA);
    expect(decoded?.payload.toString()).toBe('hello-bytes');
  });

  it('round-trips an empty fin frame', () => {
    const decoded = decodeBinaryFrame(encodeBinaryFrame(3, FRAME_FIN, Buffer.alloc(0)));
    expect(decoded?.streamId).toBe(3);
    expect(decoded?.kind).toBe(FRAME_FIN);
    expect(decoded?.payload.length).toBe(0);
  });

  it('returns null for a frame shorter than the header', () => {
    expect(decodeBinaryFrame(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('supports the full 32-bit stream id range', () => {
    const decoded = decodeBinaryFrame(
      encodeBinaryFrame(0xff_ff_ff_ff, FRAME_DATA, Buffer.from('x')),
    );
    expect(decoded?.streamId).toBe(0xff_ff_ff_ff);
  });
});
