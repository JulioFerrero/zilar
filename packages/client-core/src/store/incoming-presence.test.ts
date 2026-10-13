// PERF-7: a presence or occupant event that changes nothing visible must keep
// the same `chats` array (and the same chat objects), so no subscriber of the
// list re-renders. Kept beside `incoming.test.ts` (which is at its size cap).
import { describe, expect, it } from 'vitest';
import { handleOccupants, handlePresence } from './incoming';
import { ANA, TEAM, testCtx } from './test-ctx';

describe('presence and occupant events keep the chats reference (PERF-7)', () => {
  it('keeps the chats array and the chat objects when nothing visible changed', () => {
    const { ctx, state } = testCtx();
    handlePresence(ctx, { jid: ANA, available: true });
    const chats = state().chats;
    const ana = state().chats.find((chat) => chat.id === ANA);

    // A repeated availability is a no-op: same array, same chat object.
    handlePresence(ctx, { jid: ANA, available: true });
    expect(state().chats).toBe(chats);
    expect(state().chats.find((chat) => chat.id === ANA)).toBe(ana);

    // An occupant burst that repeats the same counts is a no-op too.
    const occupant = (nick: string, available: boolean) => ({
      jid: `${TEAM}/${nick}`,
      nick,
      available,
    });
    const occupants = [occupant('a', true), occupant('b', false)];
    handleOccupants(ctx, { roomJid: TEAM, occupants });
    const afterFirst = state().chats;
    const team = state().chats.find((chat) => chat.id === TEAM);
    handleOccupants(ctx, { roomJid: TEAM, occupants });
    expect(state().chats).toBe(afterFirst);
    expect(state().chats.find((chat) => chat.id === TEAM)).toBe(team);
    // Only the changed chat was rebuilt; the others are the same objects.
    expect(state().chats.find((chat) => chat.id === ANA)).toBe(ana);
  });
});
