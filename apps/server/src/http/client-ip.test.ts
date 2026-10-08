import { describe, expect, it } from 'vitest';
import { clientIpFrom, trustedClientIp } from './client-ip';

describe('client ip', () => {
  it('resolves trustedClientIp from x-forwarded-for per hop count', () => {
    expect(trustedClientIp(undefined, 1)).toBeNull();
    expect(trustedClientIp('', 1)).toBeNull();
    expect(trustedClientIp('203.0.113.7', 1)).toBe('203.0.113.7');
    expect(trustedClientIp('203.0.113.7, 10.0.0.1', 1)).toBe('10.0.0.1');
    expect(trustedClientIp('203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
    expect(trustedClientIp('forged, 203.0.113.7, 10.0.0.1', 1)).toBe('10.0.0.1');
    expect(trustedClientIp('forged, 203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
    expect(trustedClientIp('203.0.113.7', 2)).toBeNull();
    expect(trustedClientIp(' 203.0.113.7 ,, 10.0.0.1 ', 1)).toBe('10.0.0.1');
  });

  it('ignores proxy headers with 0 trusted hops', () => {
    expect(
      clientIpFrom({ forwardedFor: '203.0.113.7, 10.0.0.1', socketAddress: '192.0.2.1' }, 0),
    ).toBe('192.0.2.1');
  });

  it('reads the Nth address from the right with 1 trusted hop', () => {
    expect(
      clientIpFrom({ forwardedFor: '203.0.113.7, 10.0.0.1', socketAddress: '192.0.2.1' }, 1),
    ).toBe('10.0.0.1');
  });

  it('falls back to the socket address when the header is missing', () => {
    expect(clientIpFrom({ forwardedFor: undefined, socketAddress: '192.0.2.1' }, 1)).toBe(
      '192.0.2.1',
    );
  });
});
