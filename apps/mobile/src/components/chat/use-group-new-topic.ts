import { useRouter } from 'expo-router';
import { Effect } from 'effect';
import { useState } from 'react';

import { rawCall } from '@/components/chat/group-action';
import type { NewTopicInput } from '@/components/chat/new-topic-sheet';
import type { GroupAi } from '@/lib/chat-api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';
import { failureOf } from '@zilar/client-core';

// The group screen's new-topic sheet state: creates the topic, then adds one AI per tick. The sheet stays open until the topic exists.
export function useGroupNewTopic(options: { groupChatId: string; myAis: readonly GroupAi[] }) {
  const router = useRouter();
  const createTopic = useChatStore((state) => state.createTopic);
  const addTopicAi = useChatStore((state) => state.addTopicAi);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerAiError, setComposerAiError] = useState('');

  // A `createTopic` failure shows its error in the open sheet; a failed AI add names the AI (the topic still exists, so the user lands in it and can retry).
  const [topicState, runTopicCreate, topicControls] = useAction((input: NewTopicInput) => {
    const aiNames = new Map(options.myAis.map((ai) => [ai.aiId, ai.name]));
    return rawCall(() =>
      createTopic(options.groupChatId, {
        name: input.name,
        visibility: input.visibility,
        ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
      }),
    ).pipe(
      Effect.flatMap((chatId) =>
        Effect.forEach(input.aiIds, (aiId) =>
          rawCall(() => addTopicAi(chatId, aiId)).pipe(
            Effect.map((): string[] => []),
            Effect.catch(() => Effect.succeed([aiId])),
          ),
        ).pipe(Effect.map((groups) => ({ chatId, failed: groups.flat() }))),
      ),
      Effect.tap(({ chatId, failed }) =>
        Effect.sync(() => {
          setComposerOpen(false);
          if (failed.length > 0) {
            setComposerAiError(
              `Topic created, but could not add: ${failed
                .map((aiId) => aiNames.get(aiId) ?? 'An AI')
                .join(', ')}. Add them from the topic panel.`,
            );
          }
          router.push({ pathname: '/chat/[id]', params: { id: chatId } });
        }),
      ),
    );
  });
  const busy = isWaiting(topicState);
  const error =
    !busy && failureOf(topicState) !== undefined ? 'Could not create the topic. Try again.' : '';

  const open = () => {
    topicControls.reset();
    setComposerAiError('');
    setComposerOpen(true);
  };

  const close = () => {
    if (!busy) {
      setComposerOpen(false);
    }
  };

  const create = (input: NewTopicInput) => {
    setComposerAiError('');
    runTopicCreate(input);
  };

  return {
    visible: composerOpen,
    open,
    close,
    busy,
    error,
    aiError: composerAiError,
    create,
  };
}
