import { aiSuggestions, providerLabel, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { MessageSquare } from 'lucide-react-native';
import { View } from 'react-native';

import { useAisApi } from '@/components/ais/use-ais-api';
import { dmHandleFor } from '@/components/chat/chat-header';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore } from '@/store/chat-store-provider';

interface AiEmptyInfo {
  template: string;
  /** The mono model line: `<model>` or `<model> · <provider>`. */
  model: string;
}

/**
 * The empty chat (T-1520), the phone twin of web's `EmptyChat.tsx` (T-1511). A
 * DM shows only the person's picture, name and `@handle`; an AI chat adds the
 * model line and the three suggestion chips from its template, and a chip
 * sends. Any other chat keeps the "No messages yet" state.
 */
export function EmptyChat({ chat }: { chat: ChatSummary }) {
  const { api: aisApi } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
  const contacts = useChatStore((state) => state.contacts);
  const sendText = useChatStore((state) => state.sendText);

  // The AI's template and model line: found by jid, the provider named from its
  // connection. Left out while loading, for a chat that is not a known AI and
  // for someone else's AI (which is not in the list). A failed connections read
  // just drops the provider name.
  const [aiResult] = useQuery(
    () =>
      chat.isAI
        ? Effect.promise(() => aisApi.listAis()).pipe(
            Effect.flatMap((ais) => {
              const found = ais.find((item) => item.jid === chat.id);
              if (found === undefined) {
                return Effect.succeed<AiEmptyInfo | null>(null);
              }
              const fallback: AiEmptyInfo = { template: found.template, model: found.model };
              return Effect.promise(() => connectionsApi.listConnections()).pipe(
                Effect.map((connections): AiEmptyInfo => {
                  const connection = connections.find(
                    (entry) => entry.id === found.providerConnectionId,
                  );
                  return connection === undefined
                    ? fallback
                    : {
                        template: found.template,
                        model: `${found.model} · ${providerLabel(connection.provider)}`,
                      };
                }),
                Effect.orElseSucceed((): AiEmptyInfo => fallback),
              );
            }),
          )
        : Effect.succeed<AiEmptyInfo | null>(null),
    [aisApi, connectionsApi, chat.id, chat.isAI],
  );
  const ai = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;

  if (chat.isAI) {
    const suggestions = aiSuggestions(ai === null ? '' : ai.template);
    return (
      <View className="flex-1 items-center justify-center gap-3.5 px-4 py-6">
        <EntityAvatar chat={chat} size={80} ai />
        <View className="items-center gap-1">
          <Text className="text-[20px] font-semibold">{chat.title}</Text>
          {ai === null ? null : (
            <Text className="font-mono text-[12px] text-muted-foreground">{ai.model}</Text>
          )}
        </View>
        <View className="mt-2.5 items-center gap-2">
          {suggestions.map((text) => (
            <Button
              key={text}
              variant="outline"
              onPress={() => sendText(chat.id, text)}
              className="h-11 rounded-full px-4"
            >
              <Text className="text-[15px] font-medium">{text}</Text>
            </Button>
          ))}
        </View>
      </View>
    );
  }

  if (chat.kind === 'dm') {
    const handle = dmHandleFor(chat, contacts);
    return (
      <View className="flex-1 items-center justify-center gap-3.5 px-4 py-6">
        <EntityAvatar chat={chat} size={80} />
        <View className="items-center gap-1">
          <Text className="text-[20px] font-semibold">{chat.title}</Text>
          {handle === undefined ? null : (
            <Text className="font-mono text-[12px] text-muted-foreground">@{handle}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center p-8">
      <StateMessage
        kind="empty"
        icon={MessageSquare}
        title="No messages yet"
        hint="Send a message to start the conversation."
      />
    </View>
  );
}
