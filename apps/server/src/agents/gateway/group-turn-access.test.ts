// T-1706 (SEC-13b, Julio chose (a)): `groupTurnAccess` decides `allowDesk`, the
// flag that offers the AI's computer for a room turn. Only the AI's owner, a
// room owner or admin, or a scheduled routine may use it; a plain member or
// another AI's handoff may not.
// T-1727 (Julio, 2026-10-16, "Members can ask"): a plain human member may ask
// the AI for an action, but the computer stays owner/admin/AI-owner only.
import { describe, expect, it } from 'vitest';
import type { GroupRole } from '../../groups/schemas';
import type { RoomGateState } from './db';
import { groupTurnAccess, type GroupTurnAccess } from './group-turn-body';
import type { RoomPendingMessage } from './contracts';

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

const ACTIONS = [{ name: 'web.price', description: 'look up a market price' }];

function access(
  fromJid: string,
  gateState: RoomGateState,
  overrides: Partial<RoomPendingMessage> = {},
): GroupTurnAccess {
  return groupTurnAccess({
    trigger: trigger({ fromJid, ...overrides }),
    gate: gateState,
    actionsList: ACTIONS,
    canDelegate: false,
    handoffTargets: [],
    aiOwnerBare: AI_OWNER_BARE,
  });
}

describe('groupTurnAccess member actions (T-1727)', () => {
  it('lets a plain room member ask for an action, but not the computer', () => {
    const member = access('bob@example.com', gate([['bob@example.com', 'member']]));

    expect(member.allowActions).toBe(true);
    expect(member.allowDesk).toBe(false);
  });

  it('lets a room owner and a room admin ask for an action', () => {
    expect(access('carol@example.com', gate([['carol@example.com', 'owner']])).allowActions).toBe(
      true,
    );
    expect(access('dave@example.com', gate([['dave@example.com', 'admin']])).allowActions).toBe(
      true,
    );
  });

  it('refuses an action to an unknown sender with no role', () => {
    const stranger = access('stranger@example.com', gate([]));

    expect(stranger.allowActions).toBe(false);
    expect(stranger.allowDesk).toBe(false);
  });

  it('refuses an action to a handoff triggered by a member', () => {
    const handoff = access('bob@example.com', gate([['bob@example.com', 'member']]), {
      handoff: true,
    });

    expect(handoff.allowActions).toBe(false);
    expect(handoff.allowDesk).toBe(false);
  });
});

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
