import { describe, expect, it } from 'vitest';
import {
  classifyHandle,
  isReservedHandle,
  isValidHandleShape,
  normalizeHandle,
  suggestHandle,
} from './handles';

describe('handle rules', () => {
  it('accepts ordinary handles and normalizes case-insensitively', () => {
    expect(classifyHandle('ada')).toBeNull();
    expect(classifyHandle('Ada_Lovelace9')).toBeNull();
    expect(normalizeHandle('  Ada  ')).toBe('ada');
    expect(isValidHandleShape('a_bc123')).toBe(true);
  });

  it('rejects shapes outside 3-32 chars, letters-first, a-z0-9_', () => {
    expect(classifyHandle('ab')).toBe('invalid');
    expect(classifyHandle('a'.repeat(33))).toBe('invalid');
    expect(classifyHandle('1abc')).toBe('invalid');
    expect(classifyHandle('_abc')).toBe('invalid');
    expect(classifyHandle('a-b')).toBe('invalid');
    expect(classifyHandle('a b')).toBe('invalid');
    expect(classifyHandle('')).toBe('invalid');
  });

  it('reserves the well-known words whatever the casing', () => {
    for (const word of [
      'admin',
      'administrator',
      'support',
      'help',
      'root',
      'system',
      'zilar',
      'ejabberd',
      'api',
      'settings',
      'me',
      'everyone',
      'all',
      'here',
      'channel',
      'bot',
      'owner',
      'moderator',
    ]) {
      expect(classifyHandle(word)).toBe('reserved');
      expect(classifyHandle(word.toUpperCase())).toBe('reserved');
      expect(isReservedHandle(word)).toBe(true);
    }
    expect(classifyHandle('administrator2')).toBeNull();
  });

  it('suggests from the name, then the email local part', () => {
    expect(suggestHandle('Ada Lovelace')).toBe('ada_lovelace');
    expect(suggestHandle('J')).toBe('j00');
    expect(suggestHandle('!!!', 'bob.smith@example.com')).toBe('bob_smith');
    expect(suggestHandle('!!!')).toBe('user');
    expect(suggestHandle('Admin')).toBe('user');
  });
});
