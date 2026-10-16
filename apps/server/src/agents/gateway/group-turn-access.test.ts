// T-1706 (SEC-13b, Julio chose (a)): `groupTurnAccess` decides `allowDesk`, the
// flag that offers the AI's computer for a room turn. Only the AI's owner, a
// room owner or admin, or a scheduled routine may use it; a plain member or
// another AI's handoff may not.
import { describe, expect, it } from 'vitest';
import type { GroupRole } from '../../groups/schemas';
import type { RoomGateState } from './db';
import { groupTurnAccess } from './group-turn-access';
import type { RoomPendingMessage } from './pending';

const AI_OWNER_BARE = 'alice@example.com';

function trigger(overrides: Partial<RoomPendingMessage> = {}): RoomPendingMessage {
  return {
    id: 'm1',
    body: 'hello',
    fromJid: 'bob@example.com',
    fromResolved: true,
    timestamp: new Date(0),
    ...overrides,
  };
}

function gate(roles: ReadonlyArray<[string, GroupRole]>): RoomGateState {
  const memberRolesByJid = new Map<string, GroupRole>(roles);
  return { memberJids: new Set(memberRolesByJid.keys()), memberRolesByJid };
}

function allowDesk(
  fromJid: string,
  gateState: RoomGateState,
  overrides: Partial<RoomPendingMessage> = {},
): boolean {
  return groupTurnAccess({
    trigger: trigger({ fromJid, ...overrides }),
    gate: gateState,
    actionsList: [],
    canDelegate: false,
    handoffTargets: [],
    aiOwnerBare: AI_OWNER_BARE,
  }).allowDesk;
}

describe('groupTurnAccess allowDesk (SEC-13b)', () => {
  it('refuses a plain room member', () => {
    expect(allowDesk('bob@example.com', gate([['bob@example.com', 'member']]))).toBe(false);
  });

  it('allows a room owner', () => {
    expect(allowDesk('carol@example.com', gate([['carol@example.com', 'owner']]))).toBe(true);
  });

  it('allows a room admin', () => {
    expect(allowDesk('dave@example.com', gate([['dave@example.com', 'admin']]))).toBe(true);
  });

  it("allows the AI's owner even as a plain room member", () => {
    expect(allowDesk(AI_OWNER_BARE, gate([[AI_OWNER_BARE, 'member']]))).toBe(true);
  });

  it('allows a scheduled routine', () => {
    expect(
      allowDesk('routine@example.com', gate([]), {
        scheduled: { routineId: 'r1', onOutcome: () => undefined },
      }),
    ).toBe(true);
  });

  it("refuses another AI's handoff JID", () => {
    expect(allowDesk('worker@example.com', gate([]), { handoff: true })).toBe(false);
  });
});
