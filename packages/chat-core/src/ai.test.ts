import { describe, expect, it } from 'vitest';
import { isAiJid } from './ai';

describe('isAiJid', () => {
  it('recognizes an AI localpart, dropping a resource or query', () => {
    expect(isAiJid('ai-dev-1@zilar.test')).toBe(true);
    expect(isAiJid('ai-dev-1')).toBe(true);
    expect(isAiJid('ai-dev-1@zilar.test/nick')).toBe(true);
    expect(isAiJid('ai-dev-1@zilar.test?x=1')).toBe(true);
  });

  it('rejects people and other localparts', () => {
    expect(isAiJid('u-ana@zilar.test')).toBe(false);
    expect(isAiJid('ana@zilar.test')).toBe(false);
    expect(isAiJid('')).toBe(false);
  });
});
