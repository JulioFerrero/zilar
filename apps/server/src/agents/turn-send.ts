// effect-plain: moved unchanged from agents/{dm-tool-turn,group-turn}.ts (size split)
// T-1422: the two turn senders — the DM's `sendReply` and the group's
// `sendGroupReply` — split out so both turn files stay under the 400-line cap.
// Each sends the final text and shapes the outcome; a send failure is logged
// (ids only) and never thrown.
import type { SendMessageOptions } from '@zilar/xmpp-core';
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { byteLength } from './log/append';
import { redactError } from './tool-exec';

export async function sendReply(deps: DmTurnDeps, text: string): Promise<DmTurnOutcome> {
  const secrets = [deps.target.apiKey, ...(deps.secrets ?? [])];
  // The complete text goes out as a draft first, so the last `draft` carries
  // the final text before the XMPP message lands. A hook failure is a turn
  // failure, not a send failure, so it runs before the send's try.
  deps.beforeFinalSend?.(text);
  try {
    await deps.sendMessage(deps.ownerJid, 'chat', text);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  // T-1426: the answer went out. The session log stores its size only, never
  // the text.
  deps.log?.append('answer', { bytes: byteLength(text) });
  return { kind: 'replied', text };
}

// Sends the text into the room and shapes the outcome. A failure flag is
// carried so the result mirrors the success / failure paths the DM tool
// loop returns (today's `runToolTurn` returns `{ kind: 'failed', text }`
// when the second call throws).
export async function sendGroupReply(
  deps: GroupTurnDeps,
  secrets: string[],
  outgoing: { text: string; opts: SendMessageOptions },
  options: { failure: boolean } = { failure: false },
): Promise<DmTurnOutcome> {
  try {
    await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI group reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  if (!options.failure) {
    deps.log?.append('answer', { bytes: byteLength(outgoing.text) });
  }
  return options.failure
    ? { kind: 'failed', text: outgoing.text }
    : { kind: 'replied', text: outgoing.text };
}
