import { describe, expect, it } from 'vitest';
import {
  buildGenericPushPayload,
  buildPushPayload,
  PushPayloadSchema,
  type ResolvedPushMessage,
} from './payload';

const message: ResolvedPushMessage = {
  chatJid: 'bug@rooms.galena.localhost',
  senderName: 'Ana',
  place: 'Acme Web › Bug: checkout…',
  text: 'Fixed the total, please re-check the cart.',
  messageId: 'origin-1',
};

describe('buildPushPayload', () => {
  it('says who and where with the preview when previews are on', () => {
    const payload = buildPushPayload(message, { muted: false, visible: true, showPreviews: true });
    expect(payload?.title).toBe('Ana in Acme Web › Bug: checkout…');
    expect(payload?.body).toBe('Fixed the total, please re-check the cart.');
    expect(payload?.chatId).toBe('bug@rooms.galena.localhost');
    expect(payload?.messageId).toBe('origin-1');
  });

  it('uses just the name for a DM', () => {
    const payload = buildPushPayload(
      { ...message, chatJid: 'ana@galena.localhost', place: 'Ana' },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(payload?.title).toBe('Ana');
  });

  it('hides the text when previews are off', () => {
    const payload = buildPushPayload(message, {
      muted: false,
      visible: true,
      showPreviews: false,
    });
    expect(payload?.title).toBe('Ana in Acme Web › Bug: checkout…');
    expect(payload?.body).toBe('New message');
  });

  it('caps the preview at 120 characters', () => {
    const payload = buildPushPayload(
      { ...message, text: `${'x'.repeat(200)} tail` },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(payload?.body).toBe(`${'x'.repeat(120)}…`);
    expect([...(payload?.body ?? '')].length).toBe(121);
  });

  it('collapses whitespace in the preview', () => {
    const payload = buildPushPayload(
      { ...message, text: 'line one\n\n  line two' },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(payload?.body).toBe('line one line two');
  });

  it('shows a placeholder when the message has no text', () => {
    const payload = buildPushPayload(
      { ...message, text: undefined },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(payload?.body).toBe('New message');
  });

  it('drops muted and invisible chats', () => {
    expect(
      buildPushPayload(message, { muted: true, visible: true, showPreviews: true }),
    ).toBeUndefined();
    expect(
      buildPushPayload(message, { muted: false, visible: false, showPreviews: true }),
    ).toBeUndefined();
  });

  it('caps the payload at 3000 bytes', () => {
    const payload = buildPushPayload(
      { ...message, senderName: 'A'.repeat(500), text: 'B'.repeat(5000) },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThanOrEqual(
      PushPayloadSchema.MAX_BYTES,
    );
  });
});

describe('buildGenericPushPayload', () => {
  it('carries no chat reference and no text', () => {
    expect(buildGenericPushPayload()).toEqual({ title: 'Galena', body: 'New message' });
  });
});
