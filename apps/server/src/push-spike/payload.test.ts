import { describe, expect, it } from 'vitest';
import { buildPushPayload } from './payload';
import type { PushNotification } from './protocol';

function notification(overrides: Partial<PushNotification> = {}): PushNotification {
  return {
    node: 'spike-abc123',
    from: 'galena.localhost',
    lastMessageSender: 'ana@galena.localhost/mobile',
    lastMessageBody: 'Wherefore art thou?',
    ...overrides,
  };
}

describe('buildPushPayload', () => {
  it('builds a labelled payload for a DM', () => {
    expect(
      buildPushPayload(notification(), { muted: false, visible: true, chatId: 'ana' }),
    ).toEqual({ title: 'ana', body: 'Wherefore art thou?', chatId: 'ana' });
  });

  it('drops muted chats without looking at the body', () => {
    expect(
      buildPushPayload(notification(), { muted: true, visible: true, chatId: 'ana' }),
    ).toBeUndefined();
  });

  it('drops private topics the user can no longer see', () => {
    expect(
      buildPushPayload(notification(), { muted: false, visible: false, chatId: 'topic' }),
    ).toBeUndefined();
  });

  it('drops when no chat id is known', () => {
    expect(
      buildPushPayload(notification(), { muted: false, visible: true, chatId: undefined }),
    ).toBeUndefined();
  });

  it('falls back to a neutral title and body, never leaking absence', () => {
    expect(
      buildPushPayload(notification({ lastMessageSender: undefined, lastMessageBody: undefined }), {
        muted: false,
        visible: true,
        chatId: 'ana',
      }),
    ).toEqual({ title: 'New message', body: 'New message', chatId: 'ana' });
  });

  it('keeps the encrypted payload under the 3000-byte budget', () => {
    const payload = buildPushPayload(notification({ lastMessageBody: 'x'.repeat(10_000) }), {
      muted: false,
      visible: true,
      chatId: 'ana',
    });
    expect(payload).toBeDefined();
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThanOrEqual(3000);
  });
});
