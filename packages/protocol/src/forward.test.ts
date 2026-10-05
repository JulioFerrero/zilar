import { describe, expect, it } from 'vitest';
import { ForwardOriginSchema, type ForwardOrigin } from './index';

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
    const result = ForwardOriginSchema.safeParse(origin);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(origin);
    }
  });

  it('accepts a valid public origin with a chat and original id', () => {
    const result = ForwardOriginSchema.safeParse(withChat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(withChat);
    }
  });

  it('rejects an unknown key', () => {
    expect(ForwardOriginSchema.safeParse({ ...origin, extra: true }).success).toBe(false);
  });

  it.each(['sender_id', 'sender_name', 'original_at'] as const)('rejects a missing %s', (field) => {
    const rest: Record<string, unknown> = { ...origin };
    delete rest[field];
    expect(ForwardOriginSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty sender_id or sender_name', () => {
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_id: '' }).success).toBe(false);
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_name: '' }).success).toBe(false);
  });

  it('rejects a sender_id over 255 characters', () => {
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_id: 'a'.repeat(256) }).success).toBe(
      false,
    );
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_id: 'a'.repeat(255) }).success).toBe(
      true,
    );
  });

  it('rejects a sender_name over 120 characters', () => {
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_name: 'a'.repeat(121) }).success).toBe(
      false,
    );
    expect(ForwardOriginSchema.safeParse({ ...origin, sender_name: 'a'.repeat(120) }).success).toBe(
      true,
    );
  });

  it('rejects a chat_id over 255 characters', () => {
    expect(ForwardOriginSchema.safeParse({ ...withChat, chat_id: 'a'.repeat(256) }).success).toBe(
      false,
    );
  });

  it('rejects a chat_name over 120 characters', () => {
    expect(ForwardOriginSchema.safeParse({ ...withChat, chat_name: 'a'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('rejects an original_id over 255 characters', () => {
    expect(
      ForwardOriginSchema.safeParse({ ...withChat, original_id: 'a'.repeat(256) }).success,
    ).toBe(false);
  });

  it('rejects a bad datetime', () => {
    expect(ForwardOriginSchema.safeParse({ ...origin, original_at: 'not-a-date' }).success).toBe(
      false,
    );
    expect(ForwardOriginSchema.safeParse({ ...origin, original_at: '2026-10-06' }).success).toBe(
      false,
    );
  });

  it('rejects a chat_id without a chat_name', () => {
    const withoutName = { ...withChat };
    delete withoutName.chat_name;
    expect(ForwardOriginSchema.safeParse(withoutName).success).toBe(false);
  });

  it('rejects a chat_name without a chat_id', () => {
    const withoutId = { ...withChat };
    delete withoutId.chat_id;
    expect(ForwardOriginSchema.safeParse(withoutId).success).toBe(false);
  });
});
