import { describe, expect, it } from 'vitest';
import { classifyIp } from './ip-guard';

describe('classifyIp', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '198.18.0.1',
  ])('blocks %s', (address) => {
    expect(classifyIp(address)).toBe('blocked');
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1'])('allows public %s', (address) => {
    expect(classifyIp(address)).toBe('public');
  });

  it.each([
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd00::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (address) => {
    expect(classifyIp(address)).toBe('blocked');
  });

  it('allows a public IPv6 address', () => {
    expect(classifyIp('2606:4700:4700::1111')).toBe('public');
  });

  it('blocks garbage', () => {
    expect(classifyIp('not-an-ip')).toBe('blocked');
  });
});
