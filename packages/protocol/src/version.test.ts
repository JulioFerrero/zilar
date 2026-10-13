import { describe, expect, it } from 'vitest';
import { isClientOutdated, minClientProtocol, protocolVersion } from './index';

describe('isClientOutdated', () => {
  it('is false for the same version', () => {
    expect(isClientOutdated('0.2.0', '0.2.0')).toBe(false);
  });

  it('is true when the client is older', () => {
    expect(isClientOutdated('0.1.9', '0.2.0')).toBe(true);
    expect(isClientOutdated('0.2.0', '0.2.1')).toBe(true);
  });

  it('is false when the client is newer', () => {
    expect(isClientOutdated('0.3.0', '0.2.0')).toBe(false);
  });

  it('pads missing parts with zero', () => {
    expect(isClientOutdated('0.2', '0.2.0')).toBe(false);
    expect(isClientOutdated('0.2.0', '0.2')).toBe(false);
    expect(isClientOutdated('0.2', '0.2.1')).toBe(true);
  });

  it('treats a malformed part as zero', () => {
    expect(isClientOutdated('0.x.0', '0.1.0')).toBe(true);
  });

  it('is a dotted version no newer than the current protocol', () => {
    expect(minClientProtocol).toMatch(/^\d+(\.\d+)*$/);
    expect(isClientOutdated(minClientProtocol, protocolVersion)).toBe(false);
  });
});
