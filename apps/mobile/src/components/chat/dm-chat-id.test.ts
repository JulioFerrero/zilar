import { describe, expect, it } from 'vitest';

import type { Contact } from '@/lib/chat-api';
import { resolveDmChatId } from './dm-chat-id';

// MUX-16: the profile's Message action must open the real DM even when the
// server gave the contact's id a hashed localpart, instead of guessing an id
// that points at no chat.

const DOMAIN = 'zilar.test';

function contact(userId: string, jid: string): Contact {
  return { userId, name: 'Peer', jid };
}

describe('resolveDmChatId', () => {
  it('uses the contacts real JID over the lowercased-id guess', () => {
    const hashed = 'ZHj28vfbcT5vss0u0vWhveDDnx5ptPkk';
    const contacts = [contact(hashed, `uabc123@${DOMAIN}`)];
    expect(resolveDmChatId(hashed, contacts, DOMAIN)).toBe(`uabc123@${DOMAIN}`);
  });

  it('guesses the id the server builds when the peer is not a loaded contact', () => {
    expect(resolveDmChatId('Ana.Smith', [], DOMAIN)).toBe(`ana.smith@${DOMAIN}`);
  });

  it('returns undefined for an id the server would hash', () => {
    const unsafe = 'id+with/unsafe*chars';
    expect(resolveDmChatId(unsafe, [], DOMAIN)).toBeUndefined();
  });

  it('returns undefined for an id longer than a localpart', () => {
    expect(resolveDmChatId('a'.repeat(65), [], DOMAIN)).toBeUndefined();
  });
});
