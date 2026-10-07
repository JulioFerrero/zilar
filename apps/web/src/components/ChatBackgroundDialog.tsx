import type { ChatSummary } from '@zilar/chat-core';
import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  CHAT_BACKGROUND_PRESET_IDS,
  DEFAULT_CHAT_BACKGROUND_PRESET,
  type ChatBackgroundPresetId,
} from '@zilar/ui-tokens';
import { chatBackgroundStyle } from '@/lib/chatBackground';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/ChatStoreProvider';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';

type Scope = 'chat' | 'all';

function presetLabel(id: ChatBackgroundPresetId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * T-0462: pick one of the seven shared presets for this chat or for all
 * chats, or reset to the default. The store paints the choice optimistically;
 * a failed write rolls back and shows a fixed sentence here.
 */
export function ChatBackgroundDialog({
  chat,
  open,
  onClose,
}: {
  chat: ChatSummary;
  open: boolean;
  onClose: () => void;
}) {
  const store = useChatStore();
  const [scope, setScope] = useState<Scope>('chat');
  const [error, setError] = useState(false);

  if (!open) {
    return null;
  }

  const chatPreset = store.chatPrefs[chat.id.toLowerCase()]?.backgroundPreset ?? null;
  const defaultPreset = store.defaultBackground?.backgroundPreset ?? null;
  // "This chat" shows the chat's own preset (none when unset); "All chats"
  // shows the caller's default, falling back to slate.
  const selected: string | null =
    scope === 'chat' ? chatPreset : (defaultPreset ?? DEFAULT_CHAT_BACKGROUND_PRESET);

  const choose = async (presetId: string | null): Promise<void> => {
    setError(false);
    try {
      if (scope === 'chat') {
        await store.setChatBackground(chat.id, presetId);
      } else {
        await store.setDefaultBackground(presetId);
      }
    } catch {
      setError(true);
    }
  };

  // Each open starts clean: the previous scope and a stale save error must not
  // carry over to the next time the dialog is shown.
  const close = (): void => {
    setError(false);
    setScope('chat');
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title="Chat background">
      <SegmentedControl
        options={[
          { value: 'chat', label: 'This chat' },
          { value: 'all', label: 'All chats' },
        ]}
        value={scope}
        onChange={(value) => {
          setError(false);
          setScope(value === 'all' ? 'all' : 'chat');
        }}
        ariaLabel="Background scope"
        mode="radio"
      />
      <div className="mt-4 grid grid-cols-4 gap-3">
        {CHAT_BACKGROUND_PRESET_IDS.map((id) => {
          const isSelected = selected === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={presetLabel(id)}
              aria-pressed={isSelected}
              onClick={() => void choose(id)}
              className={cn(
                'chat-background relative aspect-square rounded-[10px] border transition-shadow',
                isSelected ? 'border-accent ring-2 ring-accent/40' : 'border-border',
              )}
              style={chatBackgroundStyle({ kind: 'preset', id })}
            >
              {isSelected && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check className="size-5 text-white" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void choose(null)}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          Use default
        </button>
        {error && (
          <span role="alert" className="text-[12px] text-danger">
            Couldn&apos;t save the background
          </span>
        )}
      </div>
    </Dialog>
  );
}
