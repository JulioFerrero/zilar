import { describe, expect, it } from 'vitest';
import { type ForwardOrigin, decodeOrThrow, ForwardOriginSchema, isValid } from './index';

const origin: ForwardOrigin = {
  sender_id: 'ana@zilar.localhost',
  sender_name: 'Ana',
  original_at: '2026-10-06T10:00:00.000Z',
};

const withChat: ForwardOrigin = {
  ...origin,
  chat_id: 'design@rooms.zilar.localhost',
  chat_name: 'Design',
  original_id: 'orig-123',
};

describe('ForwardOriginSchema', () => {
  it('accepts a valid private origin', () => {
    expect(isValid(ForwardOriginSchema)(origin)).toBe(true);
    expect(decodeOrThrow(ForwardOriginSchema)(origin)).toEqual(origin);
  });

  it('accepts a valid public origin with a chat and original id', () => {
    expect(isValid(ForwardOriginSchema)(withChat)).toBe(true);
    expect(decodeOrThrow(ForwardOriginSchema)(withChat)).toEqual(withChat);
  });

  it('rejects an unknown key', () => {
    expect(isValid(ForwardOriginSchema)({ ...origin, extra: true })).toBe(false);
  });

  it.each(['sender_id', 'sender_name', 'original_at'] as const)('rejects a missing %s', (field) => {
    const rest: Record<string, unknown> = { ...origin };
    delete rest[field];
    expect(isValid(ForwardOriginSchema)(rest)).toBe(false);
  });

  it('rejects an empty sender_id or sender_name', () => {
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_id: '' })).toBe(false);
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_name: '' })).toBe(false);
  });

  it('rejects a sender_id over 255 characters', () => {
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_id: 'a'.repeat(256) })).toBe(false);
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_id: 'a'.repeat(255) })).toBe(true);
  });

  it('rejects a sender_name over 120 characters', () => {
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_name: 'a'.repeat(121) })).toBe(false);
    expect(isValid(ForwardOriginSchema)({ ...origin, sender_name: 'a'.repeat(120) })).toBe(true);
  });

  it('rejects a chat_id over 255 characters', () => {
    expect(isValid(ForwardOriginSchema)({ ...withChat, chat_id: 'a'.repeat(256) })).toBe(false);
  });

  it('rejects a chat_name over 120 characters', () => {
    expect(isValid(ForwardOriginSchema)({ ...withChat, chat_name: 'a'.repeat(121) })).toBe(false);
  });

  it('rejects an original_id over 255 characters', () => {
    expect(isValid(ForwardOriginSchema)({ ...withChat, original_id: 'a'.repeat(256) })).toBe(false);
  });

  it('rejects a bad datetime', () => {
    expect(isValid(ForwardOriginSchema)({ ...origin, original_at: 'not-a-date' })).toBe(false);
    expect(isValid(ForwardOriginSchema)({ ...origin, original_at: '2026-10-06' })).toBe(false);
  });

  it('rejects a chat_id without a chat_name', () => {
    const withoutName = { ...withChat };
    delete withoutName.chat_name;
    expect(isValid(ForwardOriginSchema)(withoutName)).toBe(false);
  });

  it('rejects a chat_name without a chat_id', () => {
    const withoutId = { ...withChat };
    delete withoutId.chat_id;
    expect(isValid(ForwardOriginSchema)(withoutId)).toBe(false);
  });
});
