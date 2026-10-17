// T-1808: the preview of a public topic, whether or not the viewer joined it,
// mirroring the server's `readTopicPreview` (`apps/server/src/topics/preview.ts`):
// the last 30 messages, oldest first, and the same 404 for a General or private
// topic. A member reads the same preview, as on the server. Mock history already
// has the API's message shape, so the route only adds the sender's display name
// and the ISO timestamp.
import type { TopicPreviewMessage } from '@zilar/api-contract';
import { jsonResponse, notFound } from '../../http/shared';
import type { MockMessage } from '../../data';
import type { MockData } from '../../state';
import { senderNameFor } from '../media/routes';
import type { MockTopic } from './tables';

const TOPIC_NOT_FOUND = 'Topic not found';
const TOPIC_PREVIEW_LIMIT = 30;

export function topicPreviewRoute(data: MockData, topic: MockTopic): Response {
  if (topic.visibility !== 'public' || topic.isGeneral) {
    return notFound(TOPIC_NOT_FOUND);
  }
  const messages = data.messages[topic.chatJid] ?? [];
  const preview = messages
    .filter(isPlainMessage)
    .slice(-TOPIC_PREVIEW_LIMIT)
    .map((message) => toPreviewMessage(data, message));
  return jsonResponse({ messages: preview });
}

function toPreviewMessage(data: MockData, message: MockMessage): TopicPreviewMessage {
  return {
    id: message.id,
    at: message.timestamp.toISOString(),
    nick: senderNameFor(data, message.fromJid),
    body: message.body ?? '',
    ...(message.payload === undefined ? {} : { payload: message.payload }),
  };
}

// Reaction, correction and retraction stanzas are archive records, not messages
// of their own; the server's `readTopicPreview` drops them as well.
function isPlainMessage(message: MockMessage): boolean {
  return (
    message.reactions === undefined &&
    message.correction === undefined &&
    message.retraction === undefined
  );
}
