import type { ChatSummary } from '@zilar/chat-core';
import { formatListTime } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { useMemo, useState } from 'react';
import { EntityAvatar } from '@/components/EntityAvatar';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const UNMUTE_ERROR = 'Could not unmute. Try again.';
// `mutedUntilFor('forever')` is 100 years out; anything at least this year reads
// as "always" (chat-core keeps the exact sentinel private).
const FOREVER_MUTE_YEAR = 2100;

class UnmuteFailed extends Data.TaggedError('UnmuteFailed') {}

/**
 * WUX-39: Settings → Notifications → Muted chats. Lists every chat (and thread)
 * muted on its own row, with the mute's end, and lets you unmute it with the
 * same store action the row menus use (`setMuted(id, null)`).
 */
export function MutedChatsSection() {
  const chats = useChatSelector((s) => s.chats);
  const chatPrefs = useChatSelector((s) => s.chatPrefs);
  const storeApi = useChatStoreApi();
  const [error, setError] = useState<string | undefined>(undefined);

  // Only rows muted by their own pref are listed: a group mute lives on the
  // General row and the group's other topics inherit it, so listing every
  // topic would repeat the group. The General row itself is included.
  const muted = useMemo((): ChatSummary[] => {
    return chats.filter((chat) => {
      if (!chat.muted) {
        return false;
      }
      return (
        chat.topic === undefined ||
        chat.topic.isGeneral ||
        chatPrefs[chat.id.toLowerCase()] !== undefined
      );
    });
  }, [chats, chatPrefs]);

  const [state, unmute] = useAction<string, void, UnmuteFailed>((chatId) =>
    Effect.tryPromise({
      try: () => storeApi.getState().setMuted(chatId, null),
      catch: () => new UnmuteFailed(),
    }).pipe(Effect.tapError(() => Effect.sync(() => setError(UNMUTE_ERROR)))),
  );
  const busy = isWaiting(state);
  const startUnmute = (chatId: string): void => {
    if (busy) {
      return;
    }
    setError(undefined);
    unmute(chatId);
  };

  return (
    <section aria-label="Muted chats" className="flex flex-col gap-2">
      <SectionLabel>Muted chats</SectionLabel>
      {muted.length === 0 ? (
        <StateMessage kind="empty" title="No muted chats." />
      ) : (
        <Card>
          <ul className="divide-y divide-divider">
            {muted.map((chat) => (
              <li key={chat.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <EntityAvatar chat={chat} size={36} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-[15px] font-medium">{chat.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {muteEndLabel(chatPrefs[chat.id.toLowerCase()]?.mutedUntil ?? null, new Date())}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => startUnmute(chat.id)}
                >
                  Unmute
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {error !== undefined && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** The mute end shown under a title: `always` or `until 18:00`. */
function muteEndLabel(mutedUntil: string | null, now: Date): string {
  const date = mutedUntil === null ? undefined : new Date(mutedUntil);
  if (
    date === undefined ||
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() >= FOREVER_MUTE_YEAR
  ) {
    return 'always';
  }
  return `until ${formatListTime(date, now)}`;
}
