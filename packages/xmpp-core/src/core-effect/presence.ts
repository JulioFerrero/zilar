import { Deferred, Effect } from 'effect';
import type { XmppElement } from '@xmpp/client';
import { JoinRejected } from '../errors';
import {
  buildRosterError,
  buildRosterResult,
  parseContactPresence,
  parseMucPresence,
  stanzaErrorCondition,
  type MucPresence,
  type ParseContext,
  type RosterPush,
} from '../stanza';
import type { Occupant } from '../types';
import type { CoreRuntime } from './config';

export type PresenceApi = {
  occupantsFor: (roomJid: string) => Occupant[];
  parseContext: () => ParseContext;
  handlePresence: (stanza: XmppElement) => void;
  handleRosterPush: (push: RosterPush) => void;
  clearRoster: (roomJid: string) => void;
  clearAllRosters: () => void;
};

export function createPresence(runtime: CoreRuntime): PresenceApi {
  function rosterFor(roomJid: string): Map<string, Occupant> {
    let roster = runtime.rosters.get(roomJid);
    if (roster === undefined) {
      roster = new Map();
      runtime.rosters.set(roomJid, roster);
    }
    return roster;
  }

  function occupantsFor(roomJid: string): Occupant[] {
    const roster = runtime.rosters.get(roomJid);
    if (roster === undefined) return [];
    const result: Occupant[] = [];
    for (const occupant of roster.values()) {
      result.push({ ...occupant });
    }
    result.sort((left, right) => left.jid.localeCompare(right.jid));
    return result;
  }

  function emitOccupants(roomJid: string): void {
    runtime.emitEvent('occupants', { roomJid, occupants: occupantsFor(roomJid) });
  }

  function clearRoster(roomJid: string): void {
    const roster = runtime.rosters.get(roomJid);
    if (roster === undefined) return;
    runtime.rosters.delete(roomJid);
    if (roster.size > 0) {
      runtime.emitEvent('occupants', { roomJid, occupants: [] });
    }
  }

  function clearAllRosters(): void {
    const roomJids: string[] = [];
    for (const roomJid of runtime.rosters.keys()) {
      roomJids.push(roomJid);
    }
    for (const roomJid of roomJids) {
      clearRoster(roomJid);
    }
  }

  function applyPresence(presence: MucPresence): void {
    const roster = rosterFor(presence.roomJid);
    if (!presence.available) {
      if (roster.delete(presence.occupantJid)) {
        emitOccupants(presence.roomJid);
      }
      return;
    }

    const occupant: Occupant = {
      jid: presence.occupantJid,
      nick: presence.nick,
      available: true,
    };
    if (presence.realJid !== undefined) occupant.realJid = presence.realJid;
    if (presence.occupantId !== undefined) occupant.occupantId = presence.occupantId;
    if (presence.affiliation !== undefined) occupant.affiliation = presence.affiliation;
    if (presence.role !== undefined) occupant.role = presence.role;
    roster.set(presence.occupantJid, occupant);
    emitOccupants(presence.roomJid);
  }

  function parseContext(): ParseContext {
    const context: ParseContext = {
      domain: runtime.options.domain,
      mucDomain: runtime.mucDomain,
      now: runtime.now,
      rosterFor: (roomJid) => runtime.rosters.get(roomJid),
      myNickFor: (roomJid) => runtime.joinedRooms.get(roomJid),
    };
    if (runtime.meJid !== undefined) context.me = runtime.meJid;
    return context;
  }

  function handlePresence(stanza: XmppElement): void {
    const from = stanza.attrs['from'];
    if (from !== undefined) {
      const pending = runtime.pendingJoins.get(from);
      if (pending !== undefined) {
        const type = stanza.attrs['type'];
        if (type === 'error') {
          runtime.pendingJoins.delete(from);
          Deferred.doneUnsafe(
            pending.deferred,
            Effect.fail(new JoinRejected({ condition: stanzaErrorCondition(stanza) })),
          );
        } else if (type === undefined) {
          runtime.pendingJoins.delete(from);
          Deferred.doneUnsafe(pending.deferred, Effect.void);
        }
      }
    }

    // Roster data is only trusted from rooms we joined and only from the MUC
    // domain, so another sender cannot claim an identity.
    const presence = parseMucPresence(stanza, runtime.mucDomain);
    if (presence !== undefined && runtime.joinedRooms.has(presence.roomJid)) {
      applyPresence(presence);
      return;
    }

    const contact = parseContactPresence(stanza, runtime.options.domain);
    if (contact !== undefined) runtime.emitEvent('presence', contact);
  }

  function handleRosterPush(push: RosterPush): void {
    const current = runtime.xmpp;
    if (current !== undefined) {
      const reply = push.trusted
        ? buildRosterResult(push.id, push.from)
        : buildRosterError(push.id, push.from);
      Effect.runFork(runtime.sendQuietly(current, reply));
    }
    if (!push.trusted) return;
    for (const item of push.items) runtime.emitEvent('roster', item);
  }

  return {
    occupantsFor,
    parseContext,
    handlePresence,
    handleRosterPush,
    clearRoster,
    clearAllRosters,
  };
}
