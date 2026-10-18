import { aiSuggestions, providerLabel, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { listAis, listConnections, type AiTemplate } from '@/lib/api';
import { dmContactFor } from '@/lib/contacts';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { AiBadge } from '../AiBadge';
import { EntityAvatar } from '../EntityAvatar';
import { StateMessage } from '../ui/state-message';

interface AiEmptyInfo {
  template: AiTemplate;
  model: string;
}

export function EmptyChat({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const contacts = useChatSelector((s) => s.contacts);

  const [aiResult] = useQuery(
    () =>
      chat.isAI
        ? fromApi(() => listAis()).pipe(
            Effect.flatMap((ais) => {
              const found = ais.find((item) => item.jid === chat.id);
              if (found === undefined) {
                return Effect.succeed<AiEmptyInfo | null>(null);
              }
              const fallback: AiEmptyInfo = { template: found.template, model: found.model };
              return fromApi(() => listConnections()).pipe(
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
    [chat.id, chat.isAI],
  );
  const ai = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;

  if (chat.isAI) {
    const suggestions = aiSuggestions(ai === null ? '' : ai.template);
    return (
      <div className="flex flex-col items-center gap-4">
        <EntityAvatar chat={chat} size={72} ai />
        <div className="flex flex-col items-center gap-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[18px] font-semibold">{chat.title}</span>
            <AiBadge />
          </span>
          {ai !== null && (
            <span className="font-mono text-[12px] text-muted-foreground">{ai.model}</span>
          )}
        </div>
        <div className="mt-2 flex max-w-[520px] flex-wrap justify-center gap-2">
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => storeApi.getState().sendText(chat.id, text, {})}
              className="key-icon flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (chat.kind === 'dm') {
    const known = dmContactFor(chat, contacts)?.handle;
    const handle = known === undefined || known === null || known === '' ? undefined : known;
    return (
      <div className="flex flex-col items-center gap-4">
        <EntityAvatar chat={chat} size={72} />
        <div className="flex flex-col items-center gap-1">
          <span className="text-[18px] font-semibold">{chat.title}</span>
          {handle !== undefined && (
            <span className="font-mono text-[12px] text-muted-foreground">@{handle}</span>
          )}
        </div>
      </div>
    );
  }

  return <StateMessage kind="empty" title="No messages yet" />;
}
