/**
 * The mock draft scenario used for screenshots (T-0056). Real mock mode has no
 * SSE server, so `EXPO_PUBLIC_GALENA_MOCK_DRAFT` selects a fixed phase:
 *
 * - `stream`: `dev-ai` is mid-reply, so the chat shows the recessed generating
 *   bubble, the caret and label, and the header/list show `writing…`;
 * - `final`: the same turn has completed, so the final message (with the draft's
 *   text) renders in the incoming-card look in the draft's place.
 */
import type { UiMessage } from '../lib/types';
import { at } from './time';

export const MOCK_DRAFT_CHAT_ID = 'dev-ai';

/** One UUID, matching the contract's `turnId`. */
export const MOCK_DRAFT_TURN_ID = '5f2b7c1e-9a3d-4e6f-8b1c-2d3e4f5a6b7c';

/**
 * A mid-stream prefix of the reply, so the draft looks like it is being written.
 * It is Markdown so the generating bubble also exercises the mobile renderer.
 */
export const MOCK_DRAFT_STREAM_TEXT = [
  '## Nightly build',
  '',
  'The auth suite failed on the **token expiry** check:',
  '',
  '```',
  'FAIL auth.test.ts',
  '```',
  '',
  '- bisected to the clock helper',
  '- fix is on the branch',
].join('\n');

/** The complete reply: the stream text plus the tail the reveal finishes with. */
export const MOCK_DRAFT_FINAL_TEXT = `${MOCK_DRAFT_STREAM_TEXT}\n\n> Want me to redeploy staging?\n\nDetails: https://galena.test/builds/last`;

/** The final message that takes over the draft in the `final` phase. */
export const MOCK_DRAFT_FINAL_MESSAGE_ID = 'dev-ai-draft-final';

/** Builds the completed reply, placed right after the existing `dev-ai` history. */
export function createMockDraftFinalMessage(): UiMessage {
  return {
    id: MOCK_DRAFT_FINAL_MESSAGE_ID,
    chatId: MOCK_DRAFT_CHAT_ID,
    senderId: MOCK_DRAFT_CHAT_ID,
    senderName: 'Dev AI',
    text: MOCK_DRAFT_FINAL_TEXT,
    createdAt: at(0, 11, 6),
    status: 'read',
  };
}

export type MockDraftPhase = 'stream' | 'final';

/** Reads the screenshot phase from the build-time env, or `undefined`. */
export function readMockDraftPhase(
  env: Record<string, string | undefined> = process.env,
): MockDraftPhase | undefined {
  const value = env['EXPO_PUBLIC_GALENA_MOCK_DRAFT'];
  return value === 'stream' || value === 'final' ? value : undefined;
}
