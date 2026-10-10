import { Deferred, Effect } from 'effect';
import type { XmppElement } from '@xmpp/client';
import { HistoryFailed, IqFailed } from '../errors';
import { parseMamFin, toHistoryPage } from '../mam';
import { PING_NAMESPACE } from '../namespaces';
import {
  buildPingResult,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  parseDirectInvitation,
  parseRosterPush,
  stanzaErrorCondition,
} from '../stanza';
import type { CoreRuntime } from './config';

export type StanzaRouterApi = {
  handleStanza: (stanza: XmppElement) => void;
};

export function createStanzaRouter(runtime: CoreRuntime): StanzaRouterApi {
  function handleMamResult(stanza: XmppElement): void {
    const queryId = mamResultQueryId(stanza);
    if (queryId === undefined) return;
    const pending = runtime.pendingQueries.get(queryId);
    if (pending === undefined) return;
    const decoded = decodeMessageStanza(stanza, runtime.parseContext());
    if (decoded.message !== undefined) pending.messages.push(decoded.message);
  }

  function handleIq(stanza: XmppElement): void {
    const id = stanza.attrs['id'];
    if (id !== undefined) {
      // Our own keepalive ping answered (a result or an error both prove
      // the connection is alive).
      if (runtime.handleKeepaliveReply(id)) return;
      const pending = runtime.pendingIqs.get(id);
      if (pending !== undefined) {
        runtime.pendingIqs.delete(id);
        if (stanza.attrs['type'] === 'error') {
          Deferred.doneUnsafe(
            pending.deferred,
            Effect.fail(new IqFailed({ condition: stanzaErrorCondition(stanza) })),
          );
        } else {
          Deferred.doneUnsafe(pending.deferred, Effect.succeed(stanza));
        }
        return;
      }
    }

    // An incoming server ping (XEP-0199) gets an empty result back.
    if (
      stanza.attrs['type'] === 'get' &&
      id !== undefined &&
      stanza.getChild('ping', PING_NAMESPACE) !== undefined
    ) {
      const current = runtime.xmpp;
      if (current !== undefined) {
        const from = stanza.attrs['from'];
        Effect.runFork(runtime.sendQuietly(current, buildPingResult(id, from)));
      }
      return;
    }

    const rosterPush = parseRosterPush(stanza, runtime.options.domain, runtime.meJid);
    if (rosterPush !== undefined) {
      runtime.handleRosterPush(rosterPush);
      return;
    }

    if (id === undefined) return;
    for (const [queryId, pending] of runtime.pendingQueries) {
      if (pending.iqId !== id) continue;
      runtime.pendingQueries.delete(queryId);
      if (stanza.attrs['type'] === 'error') {
        Deferred.doneUnsafe(
          pending.deferred,
          Effect.fail(new HistoryFailed({ condition: stanzaErrorCondition(stanza) })),
        );
        return;
      }
      Deferred.doneUnsafe(
        pending.deferred,
        Effect.succeed(toHistoryPage(pending.messages, parseMamFin(stanza))),
      );
      return;
    }
  }

  function handleStanza(stanza: XmppElement): void {
    if (stanza.is('message')) {
      if (isMamResult(stanza)) {
        handleMamResult(stanza);
        return;
      }
      const invited = parseDirectInvitation(stanza, runtime.options.domain, runtime.mucDomain);
      if (invited !== undefined) runtime.emitEvent('invited', invited);
      const decoded = decodeMessageStanza(stanza, runtime.parseContext());
      if (decoded.message !== undefined) runtime.emitEvent('message', decoded.message);
      if (decoded.typing !== undefined) runtime.emitEvent('typing', decoded.typing);
      if (decoded.displayed !== undefined) runtime.emitEvent('displayed', decoded.displayed);
      return;
    }
    if (stanza.is('presence')) {
      runtime.handlePresence(stanza);
      return;
    }
    if (stanza.is('iq')) {
      handleIq(stanza);
    }
  }

  return { handleStanza };
}
