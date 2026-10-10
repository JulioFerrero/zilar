import { describe, expect, it } from 'vitest';
import { bareJid, isAiJid, jidDomain, jidLocal, normalizeJid } from './jid';

describe('jid helpers', () => {
  it('strips the resource', () => {
    expect(bareJid('ana@zilar.test/web')).toBe('ana@zilar.test');
    expect(bareJid('ana@zilar.test')).toBe('ana@zilar.test');
    expect(bareJid('room@muc.zilar.test/Ana/x')).toBe('room@muc.zilar.test');
  });

  it('splits local and domain on the first @ of the bare JID', () => {
    expect(jidLocal('ana@zilar.test/web')).toBe('ana');
    expect(jidDomain('ana@zilar.test/web')).toBe('zilar.test');
    expect(jidLocal('zilar.test')).toBe('zilar.test');
    expect(jidDomain('zilar.test')).toBe('zilar.test');
    expect(jidDomain('a@b/c@d')).toBe('b');
  });

  it('normalizes to bare plus lowercase', () => {
    expect(normalizeJid('Ana@Zilar.Test/Web')).toBe('ana@zilar.test');
  });

  it('recognizes AI JIDs by localpart, ignoring resource and query', () => {
    expect(isAiJid('ai-1@zilar.test')).toBe(true);
    expect(isAiJid('ai-1@zilar.test/nick')).toBe(true);
    expect(isAiJid('ai-1@zilar.test?x=1')).toBe(true);
    expect(isAiJid('ana@zilar.test/ai-1')).toBe(false);
    expect(isAiJid('ana-ai-1@zilar.test')).toBe(false);
  });
});
